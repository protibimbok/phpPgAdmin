<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Ddl;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\GoneException;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;

/**
 * The statements that add, alter and drop a table's constraints: the get_sql of pgAdmin's
 * index_constraint, foreign_key, check_constraint and exclusion_constraint utils, on each
 * node's create.sql, update.sql and delete.sql.
 *
 * Constraints from the client carry pgAdmin's field names. A primary key or unique
 * constraint: name, columns [{column}], include, condeferrable, condeferred, fillfactor,
 * spcname, indnullsnotdistinct, comment. A foreign key: name, columns [{local_column,
 * referenced}], remote_schema, remote_table (or references, the referenced table's OID),
 * confupdtype and confdeltype ('a', 'r', 'c', 'n', 'd'), confmatchtype (true for FULL),
 * condeferrable, condeferred, convalidated (false adds NOT VALID), autoindex and
 * coveringindex, comment. A check constraint: name, consrc, convalidated (true adds NOT
 * VALID, as pgAdmin reads the flag inverted), connoinherit, comment. An exclusion constraint:
 * name, amname, columns [{column, is_exp, oper_class, order, nulls_order, operator}],
 * include, indconstraint, fillfactor, spcname, condeferrable, condeferred, comment.
 */
final class ConstraintSql
{
    /** The template folder of each constraint type, by the node type and the key create.sql groups them under. */
    public const array TEMPLATES = [
        'primary_key' => 'index_constraint',
        'unique_constraint' => 'index_constraint',
        'foreign_key' => 'foreign_key',
        'check_constraint' => 'check_constraint',
        'exclusion_constraint' => 'exclusion_constraint',
        'exclude_constraint' => 'exclusion_constraint',
    ];

    /** pg_constraint.contype per type. */
    public const array CONTYPES = ['primary_key' => 'p', 'unique_constraint' => 'u', 'foreign_key' => 'f', 'check_constraint' => 'c', 'exclusion_constraint' => 'x', 'exclude_constraint' => 'x'];

    /** ALTER TABLE … ADD CONSTRAINT and its comment. */
    public static function createSql(NodeContext $ctx, string $type, string $schema, string $table, array $data): string
    {
        $folder = self::folder($type);
        $data = self::forTemplate($ctx, $type, $data);
        $data['schema'] = $schema;
        $data['table'] = $table;

        switch ($folder) {
            case 'index_constraint':
                if (empty($data['columns']) && empty($data['index'])) {
                    throw new BadRequestException('A constraint needs at least one column.');
                }

                return $ctx->renderFrom($folder, 'create.sql', ['data' => $data, 'constraint_name' => $type === 'primary_key' ? 'PRIMARY KEY' : 'UNIQUE']);
            case 'foreign_key':
                if (empty($data['columns'])) {
                    throw new BadRequestException('A foreign key needs at least one column.');
                }
                if (empty($data['remote_schema']) || empty($data['remote_table'])) {
                    throw new BadRequestException('A foreign key needs the table it references.');
                }
                $sql = $ctx->renderFrom($folder, 'create.sql', ['data' => $data]);
                if (!empty($data['autoindex']) && !empty($data['coveringindex'])) {
                    $sql = Ddl::assemble([$sql, $ctx->renderFrom($folder, 'create_index.sql', ['data' => $data])]);
                }

                return $sql;
            case 'check_constraint':
                if (trim((string) ($data['consrc'] ?? '')) === '') {
                    throw new BadRequestException('A check constraint needs an expression.');
                }

                return $ctx->renderFrom($folder, 'create.sql', ['data' => $data]);
            default:
                if (empty($data['columns'])) {
                    throw new BadRequestException('An exclusion constraint needs at least one column.');
                }

                return $ctx->renderFrom($folder, 'create.sql', ['data' => $data]);
        }
    }

    /** The ALTER statements for what differs from the constraint as it stands: the name, comment, validation, fillfactor, tablespace. */
    public static function updateSql(NodeContext $ctx, string $type, int $tid, string $schema, string $table, int $cid, array $data): string
    {
        $folder = self::folder($type);
        $old = self::current($ctx, $type, $tid, $cid);
        $data = self::forTemplate($ctx, $type, $data);
        $data['schema'] = $schema;
        $data['table'] = $table;
        if (!isset($data['name']) || trim((string) $data['name']) === '') {
            $data['name'] = $old['name'];
        }

        return $ctx->renderFrom($folder, 'update.sql', ['data' => $data, 'o_data' => $old]);
    }

    /** ALTER TABLE … DROP CONSTRAINT. */
    public static function deleteSql(NodeContext $ctx, string $type, string $schema, string $table, string $name, bool $cascade): string
    {
        $folder = self::folder($type);
        $data = ['schema' => $schema, 'table' => $table, 'name' => $name, 'nspname' => $schema, 'relname' => $table];

        return $ctx->renderFrom($folder, 'delete.sql', ['data' => $data, 'cascade' => $cascade]);
    }

    /**
     * The constraint as it stands, from the node's properties.sql.
     *
     * @return array<string, mixed>
     */
    public static function current(NodeContext $ctx, string $type, int $tid, int $cid): array
    {
        $folder = self::folder($type);
        $vars = ['tid' => $tid, 'cid' => $cid];
        if ($folder === 'index_constraint') {
            $vars['constraint_type'] = self::CONTYPES[$type];
        }

        return $ctx->conn->row($ctx->renderFrom($folder, 'properties.sql', $vars)) ?? throw new GoneException('Could not find the constraint in the table.');
    }

    /** The OID a constraint of the type is addressed by (the index for a primary key, unique or exclusion constraint, the constraint itself otherwise). */
    public static function oidOf(NodeContext $ctx, string $type, int $tid, string $name): ?int
    {
        $folder = self::folder($type);
        $row = match ($folder) {
            'index_constraint' => $ctx->conn->row($ctx->renderFrom($folder, 'get_oid.sql', ['name' => $name, 'constraint_type' => self::CONTYPES[$type]])),
            'check_constraint' => $ctx->conn->row($ctx->renderFrom($folder, 'get_oid.sql', ['tid' => $tid, 'name' => $name])),
            default => $ctx->conn->row($ctx->renderFrom($folder, 'get_oid.sql', ['name' => $name])),
        };

        return $row === null ? null : (int) $row['oid'];
    }

    /**
     * The statements for the constraints a table update adds, changes and deletes: pgAdmin's
     * get_index_constraint_sql, get_foreign_key_sql, get_check_constraint_sql and
     * get_exclusion_constraint_sql. A primary key or unique constraint whose columns are all
     * being dropped goes with them and is not dropped on its own.
     *
     * @param array<string, mixed> $data the table's data, with the constraint lists under primary_key, unique_constraint…
     * @param list<string> $droppedColumns
     * @return list<string>
     */
    public static function forTable(NodeContext $ctx, int $tid, string $schema, string $table, array $data, array $droppedColumns = []): array
    {
        $sql = [];
        foreach (['primary_key', 'unique_constraint', 'foreign_key', 'check_constraint', 'exclusion_constraint', 'exclude_constraint'] as $type) {
            $changes = $data[$type] ?? null;
            if (!is_array($changes) || array_is_list($changes)) {
                continue;
            }
            foreach ((array) ($changes['deleted'] ?? []) as $c) {
                if (self::folder($type) === 'index_constraint' && $droppedColumns !== [] && isset($c['columns'])) {
                    $columns = array_map(static fn (array $col): string => (string) ($col['column'] ?? ''), $c['columns']);
                    if ($columns !== [] && array_diff($columns, $droppedColumns) === []) {
                        continue;
                    }
                }
                $sql[] = self::deleteSql($ctx, $type, $schema, $table, (string) $c['name'], false);
            }
            foreach ((array) ($changes['changed'] ?? []) as $c) {
                $sql[] = self::updateSql($ctx, $type, $tid, $schema, $table, (int) $c['oid'], $c);
            }
            foreach ((array) ($changes['added'] ?? []) as $c) {
                $sql[] = self::createSql($ctx, $type, $schema, $table, $c);
            }
        }

        return array_values(array_filter($sql, static fn (string $s): bool => trim($s) !== ''));
    }

    /**
     * The client's constraint as the templates take it: a foreign key's referenced table
     * resolved from its OID when given that way, its validation defaulting to validated;
     * empty optional fields dropped.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    public static function forTemplate(NodeContext $ctx, string $type, array $data): array
    {
        foreach (['name', 'comment', 'spcname', 'fillfactor', 'indconstraint', 'index'] as $key) {
            if (isset($data[$key]) && trim((string) $data[$key]) === '') {
                unset($data[$key]);
            }
        }
        if (isset($data['include'])) {
            $data['include'] = array_values(array_filter((array) $data['include'], static fn ($c): bool => trim((string) $c) !== ''));
        }

        if (self::folder($type) === 'foreign_key') {
            $references = $data['columns'][0]['references'] ?? null;
            if ($references !== null && $references !== '' && (empty($data['remote_schema']) || empty($data['remote_table']))) {
                $parent = $ctx->conn->row($ctx->renderFrom('foreign_key', 'get_parent.sql', ['tid' => (int) $references]));
                $data['remote_schema'] = $parent['schema'] ?? null;
                $data['remote_table'] = $parent['table'] ?? null;
            }
            $data['convalidated'] = (bool) ($data['convalidated'] ?? true);
        }

        if (self::folder($type) === 'exclusion_constraint') {
            $amname = (string) ($data['amname'] ?? '');
            foreach ((array) ($data['columns'] ?? []) as $i => $column) {
                $data['columns'][$i]['is_sort_nulls_applicable'] = $amname === '' || $amname === 'btree';
            }
        }

        return $data;
    }

    private static function folder(string $type): string
    {
        return self::TEMPLATES[$type] ?? throw new BadRequestException(sprintf('Unknown constraint type "%s".', $type));
    }
}
