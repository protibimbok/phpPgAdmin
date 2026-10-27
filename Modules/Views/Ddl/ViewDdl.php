<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Views\Ddl;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\GoneException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Acl;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\Options;
use PhpPgAdmin\Core\Nodes\VacuumSettings;
use PhpPgAdmin\Modules\Tables\Ddl\IndexDdl;

/**
 * The statements behind a view or materialized view, after pgAdmin's ViewNode and MViewNode
 * (views/__init__.py): the properties with their privileges, CREATE from the client's data,
 * the ALTERs for what differs from the view as it stands, and the "SQL" tab that recreates the
 * view with its grants, column comments and (for a materialized view) its indexes.
 *
 * The client's data carries pgAdmin's field names: name, schema, definition, owner, comment,
 * check_option ('no', 'local', 'cascaded'), security_barrier, security_invoker, datacl; a
 * materialized view adds spcname, with_data, amname, fillfactor, toast_tuple_target and the
 * autovacuum settings. phpMyAdmin's form adds column_names, the view's column list.
 */
final class ViewDdl
{
    /** The privilege codes a view accepts, from allowed_privs.json. */
    public const array ACL = ['a', 'r', 'w', 'd', 'D', 'x', 't'];

    /**
     * The properties row with what pgAdmin's _fetch_properties adds: the privileges under
     * "datacl", the security labels as objects and, for a materialized view, the autovacuum
     * flags and settings.
     *
     * @param array<string, mixed> $row the row of properties.sql
     * @return array<string, mixed>
     */
    public static function properties(NodeContext $ctx, int $vid, array $row, bool $materialized): array
    {
        $row['seclabels'] = Options::parseSecurityLabels($row['seclabels'] ?? null);
        $row['datacl'] = [];
        foreach ($ctx->rows('acl.sql', ['vid' => $vid]) as $acl) {
            $row[$acl['deftype']][] = Acl::fromDb($acl);
        }
        if ($materialized) {
            VacuumSettings::flags($row);
            $row['vacuum_table'] = VacuumSettings::parse($ctx->conn, $row, 'table');
            $row['vacuum_toast'] = VacuumSettings::parse($ctx->conn, $row, 'toast');
            $row['dependsonextensions'] = Options::list($row['dependsonextensions'] ?? null);
        }

        return $row;
    }

    /**
     * The "SQL" tab: the commented header and DROP, CREATE (OR REPLACE / IF NOT EXISTS) with
     * owner and comment, the grants, the column defaults and comments, then a materialized
     * view's indexes. pgAdmin's sql().
     *
     * @param array<string, mixed> $row the row of properties.sql
     */
    public static function sql(NodeContext $ctx, int $vid, array $row, bool $materialized): string
    {
        $data = self::properties($ctx, $vid, $row, $materialized);
        $data['datacl'] = Acl::toDb($data['datacl'], self::ACL);
        if ($materialized) {
            $data['vacuum_data'] = self::vacuumData($data);
        }

        $parts = [
            $ctx->render('create.sql', ['data' => $data, 'display_comments' => true, 'add_replace_clause' => true, 'add_not_exists_clause' => true]),
            $ctx->render('grant.sql', ['data' => $data]),
            self::columnsSql($ctx, $vid, (string) $data['schema']),
        ];

        if ($materialized) {
            foreach ($ctx->conn->rows($ctx->renderFrom('indexes', 'nodes.sql', ['tid' => $vid, 'show_sys_objects' => false])) as $index) {
                $parts[] = IndexDdl::sql($ctx, (string) $data['schema'], (string) $data['name'], $vid, (int) $index['oid'], withHeader: true);
            }
        }

        return Ddl::assemble($parts);
    }

    /**
     * CREATE VIEW / CREATE MATERIALIZED VIEW and the grants from the client's data, in the
     * route's schema: pgAdmin's _get_create_view_sql and _getSQL_new.
     *
     * @param array<string, mixed> $data
     */
    public static function createSql(NodeContext $ctx, array $data, bool $materialized): string
    {
        $data['name'] = self::required($data, 'name');
        $data['definition'] = self::required($data, 'definition');
        $data['schema'] = self::schemaName($ctx);
        $data = self::normalise($data);
        if (isset($data['datacl']) && is_array($data['datacl'])) {
            $data['datacl'] = Acl::toDb($data['datacl'], self::ACL);
        }
        if ($materialized) {
            // Only the settings the client set, as WITH (...) options; the toast ones prefixed.
            $vacuum = [];
            if (!empty($data['autovacuum_custom'])) {
                $vacuum = array_values(array_filter((array) ($data['vacuum_table'] ?? []), static fn ($i): bool => isset($i['value']) && $i['value'] !== null));
            }
            if (!empty($data['toast_autovacuum'])) {
                foreach ((array) ($data['vacuum_toast'] ?? []) as $item) {
                    if (isset($item['value']) && $item['value'] !== null) {
                        $vacuum[] = ['name' => 'toast.' . $item['name'], 'value' => $item['value']];
                    }
                }
            }
            $data['vacuum_data'] = $vacuum;
            $data['dependsonextensions'] = (array) ($data['dependsonextensions'] ?? []);
            $data['with_data'] = $data['with_data'] ?? true;
        }

        return Ddl::assemble([
            $ctx->render('create.sql', ['data' => $data, 'add_replace_clause' => !empty($data['or_replace'])]),
            $ctx->render('grant.sql', ['data' => $data]),
        ]);
    }

    /**
     * The ALTER statements for what the client's data changes against the view as it stands,
     * pgAdmin's getSQL for an existing view: a view whose definition drops or reorders
     * columns is dropped and recreated with its privileges restored; a materialized view's
     * autovacuum changes are split into the settings to SET and to RESET.
     *
     * @param array<string, mixed> $data
     * @param array<string, mixed> $old the formatted properties (self::properties)
     */
    public static function updateSql(NodeContext $ctx, int $vid, array $data, array $old, bool $materialized): string
    {
        if (trim((string) ($data['name'] ?? '')) === '') {
            $data['name'] = $old['name'];
        }
        if (trim((string) ($data['schema'] ?? '')) === '') {
            $data['schema'] = $old['schema'];
        }
        $data = self::normalise($data);
        if (isset($data['datacl']) && is_array($data['datacl']) && !array_is_list($data['datacl'])) {
            foreach (['added', 'changed', 'deleted'] as $mode) {
                if (isset($data['datacl'][$mode])) {
                    $data['datacl'][$mode] = Acl::toDb($data['datacl'][$mode], self::ACL);
                }
            }
        }

        if ($materialized) {
            // A field the client leaves out is unchanged, not cleared: the template reads an empty
            // fillfactor as "RESET", and Twig's loose comparison would read a missing one the same way.
            foreach (['fillfactor', 'toast_tuple_target'] as $key) {
                if (!array_key_exists($key, $data)) {
                    $data[$key] = $old[$key] ?? null;
                }
            }
            $old['dependsonextensions'] = (array) ($old['dependsonextensions'] ?? []);
            if (array_key_exists('dependsonextensions', $data)) {
                $data['dependsonextensions'] = (array) ($data['dependsonextensions'] ?? []);
            }
            $data['vacuum_data'] = ['changed' => [], 'reset' => []];
            self::mergeVacuum($old, $data, 'vacuum_table');
            self::mergeVacuum($old, $data, 'vacuum_toast');

            return $ctx->render('update.sql', ['data' => $data, 'o_data' => $old]);
        }

        $data['del_sql'] = false;
        $old['acl_sql'] = '';
        if (isset($data['definition']) && $data['definition'] !== '') {
            $new = self::splitDefinition((string) $data['definition']);
            $was = self::splitDefinition((string) $old['definition']);
            if ((count($was) > 1 || count($new) > 1) && $was[0] !== $new[0] && !str_contains($new[0], $was[0])) {
                // Recreating the view loses its grants: the current ones are re-issued after it.
                $data['del_sql'] = true;
                $old['datacl'] = Acl::toDb($old['datacl'] ?? [], self::ACL);
                $old['acl_sql'] = $ctx->render('grant.sql', ['data' => $old]);
            }
        }

        $sql = $ctx->render('update.sql', ['data' => $data, 'o_data' => $old]);
        if (!empty($data['definition'])) {
            $sql = Ddl::assemble([$sql, self::columnsSql($ctx, $vid, (string) $old['schema'])]);
        }

        return $sql;
    }

    /**
     * The statements that give the view's columns their defaults and comments, and their
     * column-level grants: pgAdmin's get_columns_sql. Rendered after a definition change too,
     * since CREATE OR REPLACE keeps neither.
     */
    public static function columnsSql(NodeContext $ctx, int $vid, string $schema): string
    {
        $parts = [];
        $columns = $ctx->conn->rows($ctx->renderFrom('columns', 'properties.sql', ['tid' => $vid, 'show_sys_objects' => false]));

        foreach ($columns as $column) {
            $data = [
                'name' => $column['name'],
                'atttypid' => $column['atttypid'],
                'attlen' => $column['attlen'],
                'typnspname' => $column['typnspname'],
                'defval' => null,
                'description' => null,
                'table' => $column['relname'],
                'schema' => $schema,
            ];
            $before = $column;
            if (($column['defval'] ?? null) !== null) {
                $data['defval'] = $column['defval'];
                $before['defval'] = null;
            }
            if (($column['description'] ?? null) !== null && $column['description'] !== '') {
                $data['description'] = $column['description'];
                $before['description'] = null;
            }
            $parts[] = $ctx->renderFrom('columns', 'update.sql', ['o_data' => $before, 'data' => $data, 'is_view_only' => true]);
        }

        foreach ($columns as $column) {
            if (empty($column['attacl'])) {
                continue;
            }
            $data = ['name' => $column['name'], 'table' => $column['relname'], 'schema' => $schema];
            foreach ($ctx->conn->rows($ctx->renderFrom('columns', 'acl.sql', ['tid' => $vid, 'clid' => $column['attnum']])) as $acl) {
                $data[$acl['deftype']][] = Acl::fromDb($acl);
            }
            foreach (['attacl'] as $type) {
                if (isset($data[$type])) {
                    $data[$type] = Acl::toDb($data[$type], self::ACL);
                }
            }
            $parts[] = $ctx->render('grant.sql', ['data' => $data]);
        }

        return Ddl::assemble($parts);
    }

    /**
     * The definition split at each FROM and normalised, so that only changes that can affect
     * the view's columns are noticed: pgAdmin's _split_definition. Quoted identifiers and
     * literals keep their text (the quotes around an identifier dropped), the rest is
     * lower-cased with its non-word characters removed, so a reformat is not a change.
     *
     * @return list<string>
     */
    public static function splitDefinition(string $definition): array
    {
        $segments = [''];
        foreach (self::tokenise($definition) as $i => $part) {
            if ($i % 2 === 1) {
                $segments[count($segments) - 1] .= $part[0] === '"' ? substr($part, 1, -1) : $part;
                continue;
            }
            $pieces = array_map(static fn (string $piece): string => (string) preg_replace('/\W/u', '', $piece), preg_split('/\bfrom\b/', strtolower($part)) ?: ['']);
            $segments[count($segments) - 1] .= $pieces[0];
            array_push($segments, ...array_slice($pieces, 1));
        }

        return $segments;
    }

    /**
     * pgAdmin's _tokenise_definition: the definition split into plain SQL (even indexes) and
     * quoted parts (odd indexes: a quoted identifier, a string literal or a dollar-quoted
     * string as written), following PostgreSQL's lexer. Comments become a space.
     *
     * @return list<string>
     */
    private static function tokenise(string $definition): array
    {
        $parts = [''];
        $n = strlen($definition);
        $i = 0;
        $identChar = static fn (string $c): bool => (bool) preg_match('/[A-Za-z0-9_$\x80-\xff]/', $c);
        $followsIdent = static fn (int $pos): bool => $pos > 0 && $identChar($definition[$pos - 1]);

        while ($i < $n) {
            $ch = $definition[$i];
            $pair = substr($definition, $i, 2);
            if ($pair === '--') {
                $end = strpos($definition, "\n", $i);
                $i = $end === false ? $n : $end;
                $parts[count($parts) - 1] .= ' ';
            } elseif ($pair === '/*') {
                $depth = 1;
                $i += 2;
                while ($i < $n && $depth > 0) {
                    $pair = substr($definition, $i, 2);
                    if ($pair === '/*') {
                        $depth++;
                        $i += 2;
                    } elseif ($pair === '*/') {
                        $depth--;
                        $i += 2;
                    } else {
                        $i++;
                    }
                }
                $parts[count($parts) - 1] .= ' ';
            } elseif ($ch === '"' || $ch === "'") {
                $escapes = $ch === "'" && $i > 0 && in_array($definition[$i - 1], ['e', 'E'], true) && !$followsIdent($i - 1);
                $j = $i + 1;
                while ($j < $n) {
                    if ($escapes && $definition[$j] === '\\') {
                        $j += 2;
                    } elseif ($definition[$j] !== $ch) {
                        $j++;
                    } elseif (($definition[$j + 1] ?? '') === $ch) {
                        $j += 2;
                    } else {
                        break;
                    }
                }
                $j = min($j + 1, $n);
                array_push($parts, substr($definition, $i, $j - $i), '');
                $i = $j;
            } else {
                $tag = null;
                if ($ch === '$' && !$followsIdent($i) && preg_match('/\G\$(?:[A-Za-z_\x80-\xff][A-Za-z0-9_\x80-\xff]*)?\$/', $definition, $m, 0, $i)) {
                    $tag = $m[0];
                }
                if ($tag === null) {
                    $parts[count($parts) - 1] .= $ch;
                    $i++;
                    continue;
                }
                $end = strpos($definition, $tag, $i + strlen($tag));
                $j = $end === false ? $n : $end + strlen($tag);
                array_push($parts, substr($definition, $i, $j - $i), '');
                $i = $j;
            }
        }

        return $parts;
    }

    /**
     * pgAdmin's merge_to_vacuum_data: the autovacuum settings the client changed, sorted into
     * the ones to SET (changed) and to RESET (reset) against the old row's raw values.
     *
     * @param array<string, mixed> $old
     * @param array<string, mixed> $data
     */
    private static function mergeVacuum(array $old, array &$data, string $key): void
    {
        foreach ((array) ($data[$key]['changed'] ?? []) as $item) {
            $oldKey = $item['name'];
            if ($key === 'vacuum_toast') {
                $oldKey = 'toast_' . $item['name'];
                $item['name'] = 'toast.' . $item['name'];
            }
            if (!array_key_exists('value', $item)) {
                continue;
            }
            $was = $old[$oldKey] ?? null;
            if ($item['value'] === null || $item['value'] === '') {
                if ($was !== null) {
                    $data['vacuum_data']['reset'][] = $item;
                }
            } elseif ($was === null || (float) $was !== (float) $item['value']) {
                $data['vacuum_data']['changed'][] = $item;
            }
        }
    }

    /**
     * The autovacuum settings a materialized view sets, as create.sql prints them in WITH (...):
     * the table's by name, the TOAST table's prefixed with "toast.".
     *
     * @param array<string, mixed> $data the formatted properties
     * @return list<array{name: string, value: mixed}>
     */
    private static function vacuumData(array $data): array
    {
        $rows = [];
        foreach ((array) ($data['vacuum_table'] ?? []) as $item) {
            if (isset($item['value'])) {
                $rows[] = ['name' => $item['name'], 'value' => $item['value']];
            }
        }
        foreach ((array) ($data['vacuum_toast'] ?? []) as $item) {
            if (isset($item['value'])) {
                $rows[] = ['name' => 'toast.' . $item['name'], 'value' => $item['value']];
            }
        }

        return $rows;
    }

    /**
     * The client's data as the templates take it: blank optional strings dropped, the column
     * list quoted, the definition without its trailing semicolon.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private static function normalise(array $data): array
    {
        foreach (['owner', 'spcname', 'amname', 'check_option'] as $key) {
            if (array_key_exists($key, $data) && ($data[$key] === null || trim((string) $data[$key]) === '')) {
                unset($data[$key]);
            }
        }
        if (isset($data['definition'])) {
            $data['definition'] = rtrim(trim((string) $data['definition']), ';');
        }
        if (array_key_exists('column_names', $data)) {
            $names = array_values(array_filter(array_map(trim(...), explode(',', (string) $data['column_names'])), static fn (string $n): bool => $n !== ''));
            $data['column_names'] = $names === [] ? null : implode(', ', array_map(static fn (string $n): string => Quoting::ident(trim($n, '"')), $names));
        }

        return $data;
    }

    /** @param array<string, mixed> $data */
    private static function required(array $data, string $key): string
    {
        $value = trim((string) ($data[$key] ?? ''));
        if ($value === '') {
            throw new BadRequestException(sprintf('Could not find the required parameter (%s).', $key));
        }

        return $value;
    }

    /** The name of the schema the route addresses. */
    public static function schemaName(NodeContext $ctx): string
    {
        return (string) ($ctx->conn->scalar($ctx->render('get_schema.sql', ['scid' => $ctx->id('scid')])) ?? throw new GoneException('Could not find the schema in the database.'));
    }
}
