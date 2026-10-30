<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\DbObjects\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;

/**
 * The foreign table node, after pgAdmin's ForeignTableView: the foreign tables of a schema
 * with their server, options, owner, comment and columns, and the statements that create,
 * alter and drop one. The table's own changes come from pgAdmin's update.sql; the columns'
 * (pgAdmin renders them from its foreign_table_columns node) are written here: DROP COLUMN,
 * ADD COLUMN, and for a column kept RENAME, TYPE, SET/DROP NOT NULL, SET/DROP DEFAULT and its
 * OPTIONS.
 *
 * The client's data carries pgAdmin's field names: name, owner, description, ftsrvname,
 * ftoptions as {option, value}, and columns as {attnum (null for a new one), name, cltype,
 * attnotnull, defval, coloptions as {option, value}}.
 */
final class ForeignTableController extends NodeController
{
    public function list(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->decorate($ctx, $row), $ctx->rows('properties.sql', ['foid' => null]));
    }

    public function nodes(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->toNode($ctx, $row), $ctx->rows('node.sql', ['foid' => null]));
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        return $this->toNode($ctx, $ctx->row('node.sql', ['scid' => null, 'foid' => $oid]) ?? throw $this->gone($ctx));
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        return $this->decorate($ctx, $ctx->row('properties.sql', ['foid' => $oid]) ?? throw $this->gone($ctx));
    }

    public function sql(NodeContext $ctx, int $oid): string
    {
        $data = $this->templateData($this->properties($ctx, $oid));
        $drop = $ctx->render('delete.sql', ['foid' => null, 'name' => $data['name'], 'basensp' => $data['basensp']]);

        return Ddl::assemble([Ddl::header('FOREIGN TABLE', Quoting::ident((string) $data['basensp'], (string) $data['name']), $drop), $ctx->render('create.sql', ['data' => $data, 'is_sql' => true])]);
    }

    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($ctx, $data);
        $this->execute($ctx, $ctx->render('create.sql', ['data' => $data]));
        $row = $ctx->row('get_oid.sql', ['basensp' => $data['basensp'], 'name' => $data['name']]) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $row['oid']);
    }

    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));

        return $this->node($ctx, $oid);
    }

    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = $this->properties($ctx, $oid);
        $this->execute($ctx, $ctx->render('delete.sql', ['foid' => null, 'name' => $row['name'], 'basensp' => $row['basensp'], 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        return $oid === null ? $ctx->render('create.sql', ['data' => $this->forCreate($ctx, $data)]) : $this->updateSql($ctx, $oid, $data);
    }

    /** @return array{servers: list<string>, roles: list<string>, schemas: list<string>} the foreign servers a table may read from, the roles, and the schemas a foreign schema may be imported into */
    public function options(NodeContext $ctx): array
    {
        $foid = isset($ctx->queryParams()['foid']) && is_numeric($ctx->queryParams()['foid']) ? (int) $ctx->queryParams()['foid'] : null;

        return ['servers' => array_column($ctx->rows('get_foreign_servers.sql'), 'srvname'), 'roles' => Catalog::roles($ctx->conn), 'schemas' => Catalog::schemas($ctx->conn), 'tables' => $this->inheritable($ctx, $foid)];
    }

    /**
     * IMPORT FOREIGN SCHEMA from the client's data: server, remote_schema, mode ('all', 'limit'
     * or 'except'), tables (names one per line or comma-separated), into (a local schema, the
     * route's when left out) and options as {option, value}.
     *
     * @param array<string, mixed> $data
     */
    public function importSql(NodeContext $ctx, array $data): string
    {
        $server = trim((string) ($data['server'] ?? ''));
        $remote = trim((string) ($data['remote_schema'] ?? ''));
        if ($server === '') {
            throw new BadRequestException('A foreign schema is imported from a foreign server: choose one.');
        }
        if ($remote === '') {
            throw new BadRequestException('Name the remote schema to import.');
        }
        $mode = (string) ($data['mode'] ?? 'all');
        if (!in_array($mode, ['all', 'limit', 'except'], true)) {
            throw new BadRequestException(sprintf('"%s" is not a table restriction.', $mode));
        }
        $tables = array_values(array_unique(array_filter(array_map('trim', preg_split('/[\r\n,]+/', (string) ($data['tables'] ?? '')) ?: []), static fn (string $t): bool => $t !== '')));
        if ($mode !== 'all' && $tables === []) {
            throw new BadRequestException('LIMIT TO and EXCEPT need at least one table name.');
        }
        $into = trim((string) ($data['into'] ?? ''));
        if ($into === '') {
            $into = $this->schemaName($ctx);
        }
        $options = array_map(static fn (array $o): string => Quoting::ident($o['option']) . ' ' . Quoting::literal($o['value']), ForeignOptions::fromClient($data['options'] ?? []));

        $sql = 'IMPORT FOREIGN SCHEMA ' . Quoting::ident($remote);
        if ($mode !== 'all') {
            $sql .= "\n    " . ($mode === 'limit' ? 'LIMIT TO' : 'EXCEPT') . ' (' . implode(', ', array_map(static fn (string $t): string => Quoting::ident($t), $tables)) . ')';
        }
        $sql .= "\n    FROM SERVER " . Quoting::ident($server) . "\n    INTO " . Quoting::ident($into);
        if ($options !== []) {
            $sql .= "\n    OPTIONS (" . implode(', ', $options) . ')';
        }

        return $sql . ';';
    }

    /** Runs IMPORT FOREIGN SCHEMA; the foreign tables it created in the target schema. */
    public function import(NodeContext $ctx, array $data): array
    {
        $sql = $this->importSql($ctx, $data);
        $into = trim((string) ($data['into'] ?? ''));
        $schema = $into === '' ? $this->schemaName($ctx) : $into;
        $before = $this->foreignTableNames($ctx, $schema);
        $this->execute($ctx, $sql);

        return ['sql' => $sql, 'tables' => array_values(array_diff($this->foreignTableNames($ctx, $schema), $before))];
    }

    /** @return list<string> */
    private function foreignTableNames(NodeContext $ctx, string $schema): array
    {
        return array_column($ctx->conn->rows("SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'f' AND n.nspname = $1 ORDER BY 1", [$schema]), 'relname');
    }

    /** The row with its options and columns as the client reads them. */
    private function decorate(NodeContext $ctx, array $row): array
    {
        $row['ftoptions'] = ForeignOptions::fromCatalog($row['ftoptions']);
        $row['columns'] = array_map(static fn (array $c): array => [
            'attnum' => (int) $c['attnum'],
            'name' => (string) $c['name'],
            'cltype' => (string) $c['fulltype'],
            'attnotnull' => (bool) $c['attnotnull'],
            'defval' => $c['defval'] === null ? '' : (string) $c['defval'],
            'coloptions' => ForeignOptions::fromCatalog($c['attfdwoptions']),
            'inheritedfrom' => $c['inheritedfrom'],
        ], $ctx->rows('get_columns.sql', ['foid' => (int) $row['oid']]));
        // pgAdmin's Inherits and Constraints (CHECK) of a foreign table. A partition's parent
        // is its partition_of, with partition_bound its FOR VALUES or DEFAULT, not a table it
        // inherits from.
        $row['is_partition'] = (bool) ($row['is_partition'] ?? false);
        $row['partition_of'] = $row['is_partition'] ? $row['partition_of'] : null;
        $row['partition_bound'] = $row['is_partition'] ? $row['partition_bound'] : null;
        $row['inherits'] = $row['is_partition'] ? [] : array_column($ctx->rows('get_tables.sql', ['attrelid' => (int) $row['oid']]), 'inherits');
        $row['constraints'] = array_map(static fn (array $c): array => [
            'conname' => (string) $c['conname'],
            'consrc' => (string) $c['consrc'],
            'convalidated' => (bool) $c['convalidated'],
            'connoinherit' => (bool) $c['connoinherit'],
            'conislocal' => (bool) $c['conislocal'],
        ], $ctx->rows('get_constraints.sql', ['foid' => (int) $row['oid']]));

        return $row;
    }

    /**
     * A row or the client's data as create.sql takes it: the option names quoted, since the
     * template writes them as they are, and a column's type as cltype (fulltype for the SQL tab).
     */
    private function templateData(array $data): array
    {
        $data['ftoptions'] = self::quotedOptions($data['ftoptions']);
        $data['columns'] = array_map(static fn (array $c): array => ['fulltype' => $c['cltype'], 'coloptions' => self::quotedOptions($c['coloptions'])] + $c, $data['columns']);

        return $data;
    }

    /**
     * @param list<array{option: string, value: string}> $options
     * @return list<array{option: string, value: string}>
     */
    private static function quotedOptions(array $options): array
    {
        return array_map(static fn (array $o): array => ['option' => Quoting::ident($o['option']), 'value' => $o['value']], $options);
    }

    /** @param array<string, mixed> $data */
    private function forCreate(NodeContext $ctx, array $data): array
    {
        $server = trim((string) ($data['ftsrvname'] ?? ''));
        if ($server === '') {
            throw new BadRequestException('A foreign table reads from a foreign server: choose one.');
        }
        $out = [
            'name' => $this->requireName($data),
            'basensp' => $this->schemaName($ctx),
            'ftsrvname' => $server,
            'owner' => trim((string) ($data['owner'] ?? '')),
            'description' => trim((string) ($data['description'] ?? '')),
            'ftoptions' => ForeignOptions::fromClient($data['ftoptions'] ?? []),
            'columns' => array_map(fn (array $c): array => $this->column($c), $this->columnList($data)),
            'inherits' => $this->inheritsOf($ctx, $data, null),
            'constraints' => $this->constraintsOf($data),
        ];

        return $this->templateData($out);
    }

    /**
     * update.sql for the table's name, owner, comment and options, then the columns' ALTERs.
     *
     * @param array<string, mixed> $data
     */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $old = $this->properties($ctx, $oid);
        $changes = [];
        foreach (['name', 'owner', 'description'] as $key) {
            if (array_key_exists($key, $data) && trim((string) ($data[$key] ?? '')) !== (string) ($old[$key] ?? '')) {
                $changes[$key] = trim((string) $data[$key]);
            }
        }
        if (($changes['name'] ?? null) === '') {
            throw $this->incomplete('name');
        }
        if (($changes['owner'] ?? null) === '') {
            unset($changes['owner']);
        }
        if (array_key_exists('ftoptions', $data)) {
            $diff = ForeignOptions::diff($old['ftoptions'], ForeignOptions::fromClient($data['ftoptions']), '');
            $changes['ftoptions'] = array_map(static fn (array $list): array => self::quotedOptions(array_map(static fn (array $o): array => ['option' => $o['option'], 'value' => $o['value']], $list)), $diff);
        }
        if (array_key_exists('inherits', $data)) {
            if ($old['is_partition']) {
                self::checkPartitionInherits($old, $data);
            } else {
                $changes['inherits'] = $this->inheritsOf($ctx, $data, $oid);
            }
        }
        if (array_key_exists('constraints', $data)) {
            $changes['constraints'] = self::constraintChanges($old['constraints'], $this->constraintsOf($data));
        }
        $sql = $ctx->render('update.sql', ['data' => $changes, 'o_data' => $old]);

        $table = Quoting::ident((string) $old['basensp'], (string) ($changes['name'] ?? $old['name']));

        return Ddl::assemble([$sql, ...(array_key_exists('columns', $data) ? $this->columnSql($table, $old['columns'], $this->columnList($data)) : [])]);
    }

    /**
     * The ALTERs that turn the old columns into the client's: the columns missing from the
     * client's list are dropped, those with an attnum are altered, the others added.
     *
     * @param list<array<string, mixed>> $old
     * @param list<array<string, mixed>> $new
     * @return list<string>
     */
    private function columnSql(string $table, array $old, array $new): array
    {
        $byNum = array_column($old, null, 'attnum');
        $kept = array_filter(array_map(static fn (array $c): ?int => isset($c['attnum']) && $c['attnum'] !== null && $c['attnum'] !== '' ? (int) $c['attnum'] : null, $new));
        $sql = [];
        foreach ($old as $column) {
            if ($column['inheritedfrom'] === null && !in_array($column['attnum'], $kept, true)) {
                $sql[] = sprintf("ALTER FOREIGN TABLE %s\n    DROP COLUMN %s;", $table, Quoting::ident($column['name']));
            }
        }
        foreach ($new as $entry) {
            $column = $this->column($entry);
            $attnum = isset($entry['attnum']) && $entry['attnum'] !== null && $entry['attnum'] !== '' ? (int) $entry['attnum'] : null;
            if ($attnum === null || !isset($byNum[$attnum])) {
                $sql[] = sprintf("ALTER FOREIGN TABLE %s\n    ADD COLUMN %s;", $table, $this->columnDefinition($column));
                continue;
            }
            $was = $byNum[$attnum];
            $name = Quoting::ident($was['name']);
            if ($column['name'] !== $was['name']) {
                $sql[] = sprintf("ALTER FOREIGN TABLE %s\n    RENAME COLUMN %s TO %s;", $table, $name, Quoting::ident($column['name']));
                $name = Quoting::ident($column['name']);
            }
            if ($column['cltype'] !== $was['cltype']) {
                $sql[] = sprintf("ALTER FOREIGN TABLE %s\n    ALTER COLUMN %s TYPE %s;", $table, $name, $column['cltype']);
            }
            if ($column['attnotnull'] !== $was['attnotnull']) {
                $sql[] = sprintf("ALTER FOREIGN TABLE %s\n    ALTER COLUMN %s %s NOT NULL;", $table, $name, $column['attnotnull'] ? 'SET' : 'DROP');
            }
            if ($column['defval'] !== $was['defval']) {
                $sql[] = $column['defval'] === ''
                    ? sprintf("ALTER FOREIGN TABLE %s\n    ALTER COLUMN %s DROP DEFAULT;", $table, $name)
                    : sprintf("ALTER FOREIGN TABLE %s\n    ALTER COLUMN %s SET DEFAULT %s;", $table, $name, $column['defval']);
            }
            $diff = ForeignOptions::diff($was['coloptions'], $column['coloptions'], '');
            $changes = [
                ...array_map(static fn (array $o): string => 'ADD ' . Quoting::ident($o['option']) . ' ' . Quoting::literal($o['value']), $diff['added']),
                ...array_map(static fn (array $o): string => 'SET ' . Quoting::ident($o['option']) . ' ' . Quoting::literal($o['value']), $diff['changed']),
                ...array_map(static fn (array $o): string => 'DROP ' . Quoting::ident($o['option']), $diff['deleted']),
            ];
            if ($changes !== []) {
                $sql[] = sprintf("ALTER FOREIGN TABLE %s\n    ALTER COLUMN %s OPTIONS (%s);", $table, $name, implode(', ', $changes));
            }
        }

        return $sql;
    }

    /** A column as ADD COLUMN writes it: name, type, OPTIONS, NOT NULL, DEFAULT. */
    private function columnDefinition(array $column): string
    {
        $options = array_map(static fn (array $o): string => Quoting::ident($o['option']) . ' ' . Quoting::literal($o['value']), $column['coloptions']);

        return Quoting::ident($column['name']) . ' ' . $column['cltype']
            . ($options === [] ? '' : ' OPTIONS (' . implode(', ', $options) . ')')
            . ($column['attnotnull'] ? ' NOT NULL' : '')
            . ($column['defval'] !== '' ? ' DEFAULT ' . $column['defval'] : '');
    }

    /** @return list<string> the tables a foreign table may inherit from, schema-qualified and quoted as INHERITS names them */
    private function inheritable(NodeContext $ctx, ?int $foid): array
    {
        return array_column($ctx->rows('get_tables.sql', ['attrelid' => null, 'foid' => $foid]), 'label');
    }

    /**
     * The client's "inherits": names from the list of tables a foreign table may inherit from,
     * which the templates write as they are, so nothing else is taken.
     *
     * @param array<string, mixed> $data
     * @return list<string>
     */
    private function inheritsOf(NodeContext $ctx, array $data, ?int $foid): array
    {
        $given = array_values(array_filter(array_map(static fn (mixed $v): string => trim((string) $v), is_array($data['inherits'] ?? null) ? $data['inherits'] : []), static fn (string $v): bool => $v !== ''));
        if ($given === []) {
            return [];
        }
        $known = $this->inheritable($ctx, $foid);
        foreach ($given as $name) {
            if (!in_array($name, $known, true)) {
                throw new BadRequestException(sprintf('"%s" is not a table this foreign table can inherit from.', $name));
            }
        }

        return array_values(array_unique($given));
    }

    /**
     * A partition inherits only from the table it is a partition of, which ATTACH and DETACH
     * PARTITION change: the client may send no parents, or that one as the properties named
     * it before partitions had their own field, and nothing else.
     *
     * @param array<string, mixed> $old
     * @param array<string, mixed> $data
     */
    private static function checkPartitionInherits(array $old, array $data): void
    {
        $given = array_values(array_filter(array_map(static fn (mixed $v): string => trim((string) $v), is_array($data['inherits'] ?? null) ? $data['inherits'] : []), static fn (string $v): bool => $v !== ''));
        if ($given !== [] && $given !== [$old['partition_of']]) {
            throw new BadRequestException(sprintf('This foreign table is a partition of %s: it cannot inherit from other tables.', $old['partition_of']));
        }
    }

    /**
     * The client's CHECK constraints: conname, consrc (the expression), convalidated (false
     * adds it NOT VALID), connoinherit.
     *
     * @param array<string, mixed> $data
     * @return list<array{conname: string, consrc: string, convalidated: bool, connoinherit: bool}>
     */
    private function constraintsOf(array $data): array
    {
        $out = [];
        foreach (is_array($data['constraints'] ?? null) ? $data['constraints'] : [] as $c) {
            if (!is_array($c)) {
                continue;
            }
            $name = trim((string) ($c['conname'] ?? ''));
            $expression = trim((string) ($c['consrc'] ?? ''));
            if ($name === '' && $expression === '') {
                continue;
            }
            if ($name === '' || $expression === '') {
                throw new BadRequestException('Each check constraint needs a name and an expression.');
            }
            $out[] = ['conname' => $name, 'consrc' => $expression, 'convalidated' => filter_var($c['convalidated'] ?? true, FILTER_VALIDATE_BOOL), 'connoinherit' => filter_var($c['connoinherit'] ?? false, FILTER_VALIDATE_BOOL)];
        }

        return $out;
    }

    /**
     * update.sql's constraint changes, inherited constraints left out on both sides: the ones
     * gone are dropped, the new ones added, one whose expression or NO INHERIT changed dropped
     * and added again, and one now validated VALIDATEd, as pgAdmin's dialog does.
     *
     * @param list<array<string, mixed>> $old
     * @param list<array<string, mixed>> $new
     * @return array{added: list<array<string, mixed>>, changed: list<array<string, mixed>>, deleted: list<array<string, mixed>>}
     */
    private static function constraintChanges(array $old, array $new): array
    {
        $oldByName = array_column(array_filter($old, static fn (array $c): bool => $c['conislocal'] ?? true), null, 'conname');
        // A constraint inherited from a parent is the parent's to change: one the client sends
        // back with the rest is left as it is, not added again.
        $inherited = array_column(array_filter($old, static fn (array $c): bool => !($c['conislocal'] ?? true)), 'conname');
        $newByName = array_diff_key(array_column($new, null, 'conname'), array_flip($inherited));
        $changes = ['added' => [], 'changed' => [], 'deleted' => []];
        foreach ($oldByName as $name => $c) {
            if (!isset($newByName[$name])) {
                $changes['deleted'][] = $c;
            }
        }
        foreach ($newByName as $name => $c) {
            $was = $oldByName[$name] ?? null;
            if ($was === null) {
                $changes['added'][] = $c;
            } elseif ($was['consrc'] !== $c['consrc'] || $was['connoinherit'] !== $c['connoinherit']) {
                $changes['deleted'][] = $was;
                $changes['added'][] = $c;
            } elseif (!$was['convalidated'] && $c['convalidated']) {
                $changes['changed'][] = $c;
            }
        }

        return $changes;
    }

    /** @return list<array<string, mixed>> */
    private function columnList(array $data): array
    {
        return array_values(array_filter(is_array($data['columns'] ?? null) ? $data['columns'] : [], 'is_array'));
    }

    /** One of the client's columns, checked. */
    private function column(array $c): array
    {
        $name = trim((string) ($c['name'] ?? ''));
        $type = trim((string) ($c['cltype'] ?? ''));
        if ($name === '' || $type === '') {
            throw new BadRequestException('Each column needs a name and a type.');
        }
        if (preg_match('/[;]|--|\/\*/', $type) === 1) {
            throw new BadRequestException(sprintf('"%s" is not a data type.', $type));
        }

        return [
            'name' => $name,
            'cltype' => $type,
            'attnotnull' => filter_var($c['attnotnull'] ?? false, FILTER_VALIDATE_BOOL),
            'defval' => trim((string) ($c['defval'] ?? '')),
            'coloptions' => ForeignOptions::fromClient($c['coloptions'] ?? []),
        ];
    }

    private function schemaName(NodeContext $ctx): string
    {
        return (string) ($ctx->conn->scalar('SELECT nspname FROM pg_catalog.pg_namespace WHERE oid = $1', [$ctx->id('scid')]) ?? throw $this->notFound('Could not find the schema.'));
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, $row);
        $node['inode'] = false;

        return $node;
    }
}
