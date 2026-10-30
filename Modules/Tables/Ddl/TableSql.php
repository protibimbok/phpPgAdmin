<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Ddl;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Nodes\Acl;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\Options;

/**
 * The statements that create and alter a table from the client's data: pgAdmin's
 * BaseTableView.get_sql on tables/create.sql and update.sql, with the column and constraint
 * statements that follow an ALTER.
 *
 * The data carries pgAdmin's field names: name, schema, columns, primary_key,
 * unique_constraint, foreign_key, check_constraint, exclude_constraint, relowner, spcname,
 * description, relpersistence (true for UNLOGGED), coll_inherits [quoted names], fillfactor,
 * relacl, typname (OF type), like_relation with the like_* INCLUDING flags, amname (USING)…
 * An update sends the columns and constraints as {added, changed, deleted} lists,
 * and may add "indexes" ({added, deleted}) for CREATE INDEX statements after the ALTERs, and
 * "partitions" ({added, deleted}) to create or attach and to detach partitions. A new table with
 * "partition_scheme" is created PARTITION BY it, with its "partitions" list after it.
 */
final class TableSql
{
    /**
     * CREATE TABLE and what follows it, then one CREATE INDEX per "indexes" entry (never
     * CONCURRENTLY, so that all of it can run in one transaction).
     *
     * @return array{sql: string, indexes: list<string>, name: string, schema: string}
     */
    public static function create(NodeContext $ctx, array $data): array
    {
        $name = trim((string) ($data['name'] ?? ''));
        if ($name === '') {
            throw new BadRequestException('Could not find the required parameter (name).');
        }
        $data['name'] = $name;
        $data['schema'] = (string) ($ctx->conn->scalar($ctx->renderFrom('tables', 'get_schema.sql', ['scid' => $ctx->id('scid')])) ?? throw new BadRequestException('Unknown schema.'));

        $data['columns'] = self::columnsForCreate((array) ($data['columns'] ?? []));
        foreach (['primary_key', 'unique_constraint', 'foreign_key', 'check_constraint', 'exclude_constraint'] as $type) {
            $data[$type] = array_values(array_map(fn (array $c): array => ConstraintSql::forTemplate($ctx, $type, $c), (array) ($data[$type] ?? [])));
        }
        foreach ($data['primary_key'] as $pk) {
            if (empty($pk['columns'])) {
                throw new BadRequestException('A primary key needs at least one column.');
            }
        }
        if (isset($data['relacl']) && is_array($data['relacl'])) {
            $data['relacl'] = Acl::toDb($data['relacl'], TableDdl::ACL);
        }
        foreach (['relowner', 'spcname', 'description', 'amname', 'typname', 'like_relation'] as $key) {
            if (isset($data[$key]) && trim((string) $data[$key]) === '') {
                unset($data[$key]);
            }
        }
        $data['coll_inherits'] = array_values(array_filter((array) ($data['coll_inherits'] ?? []), static fn ($v): bool => trim((string) $v) !== ''));
        self::checkTypedAndLike($ctx, $data);
        $data['relpersistence'] = (bool) ($data['relpersistence'] ?? false);
        $data['vacuum_table'] = [];
        $data['vacuum_toast'] = [];

        // A partitioned table: PARTITION BY from the scheme ("RANGE (col)"), then its first partitions.
        $partitions = [];
        if (trim((string) ($data['partition_scheme'] ?? '')) !== '') {
            $data['relkind'] = 'p';
            $data['partition_scheme'] = trim((string) $data['partition_scheme']);
            $type = PartitionDdl::type($data['partition_scheme']);
            foreach ((array) ($data['partitions'] ?? []) as $partition) {
                $partitions[] = PartitionDdl::createSql($ctx, $data['schema'], $name, $type, (array) $partition);
            }
        } else {
            unset($data['partition_scheme'], $data['relkind']);
        }

        $indexes = [];
        foreach ((array) ($data['indexes'] ?? []) as $index) {
            // The table runs in one transaction with its indexes, which CONCURRENTLY cannot
            // join; nobody else sees the new table before the commit anyway.
            $index = [...(array) $index, 'isconcurrent' => false];
            $indexes[] = IndexSql::createSql($ctx, $data['schema'], $name, $index);
        }

        return [
            'sql' => $ctx->renderFrom('tables', 'create.sql', ['data' => $data, 'add_not_exists_clause' => false]),
            'indexes' => [...$partitions, ...$indexes],
            'name' => $name,
            'schema' => $data['schema'],
        ];
    }

    /**
     * The ALTER TABLE statements for what the client's data changes, then the columns dropped,
     * altered and added, the constraints, and the indexes. $old is the table's formatted
     * properties (TableDdl::properties).
     *
     * @param array<string, mixed> $data
     * @param array<string, mixed> $old
     */
    public static function update(NodeContext $ctx, int $tid, array $data, array $old): string
    {
        if (!isset($data['name']) || trim((string) $data['name']) === '') {
            $data['name'] = $old['name'];
        }
        if (!isset($data['schema']) || trim((string) $data['schema']) === '') {
            $data['schema'] = $old['schema'];
        }
        // pgAdmin's client sends the whole model; a missing field here must read as unchanged,
        // not as cleared, or the template would RESET settings the client never touched.
        foreach (['fillfactor', 'parallel_workers', 'toast_tuple_target', 'autovacuum_custom', 'toast_autovacuum', 'autovacuum_enabled', 'toast_autovacuum_enabled'] as $key) {
            if (!array_key_exists($key, $data)) {
                $data[$key] = $old[$key] ?? null;
            }
        }
        if (isset($data['relacl']) && is_array($data['relacl']) && !array_is_list($data['relacl'])) {
            foreach (['added', 'changed', 'deleted'] as $mode) {
                if (isset($data['relacl'][$mode])) {
                    $data['relacl'][$mode] = Acl::toDb($data['relacl'][$mode], TableDdl::ACL);
                }
            }
        }
        if (isset($data['coll_inherits'])) {
            $new = array_values(array_filter((array) $data['coll_inherits'], static fn ($v): bool => trim((string) $v) !== ''));
            $was = Options::list($old['coll_inherits'] ?? []);
            $data['coll_inherits_added'] = array_values(array_diff($new, $was));
            $data['coll_inherits_removed'] = array_values(array_diff($was, $new));
        }
        self::vacuumChanges($data, $old, 'vacuum_table');
        self::vacuumChanges($data, $old, 'vacuum_toast');

        $parts = [$ctx->renderFrom('tables', 'update.sql', ['data' => $data, 'o_data' => $old])];

        $schema = (string) $data['schema'];
        $table = (string) $data['name'];
        $dropped = [];
        $columns = $data['columns'] ?? null;
        if (is_array($columns) && !array_is_list($columns)) {
            foreach ((array) ($columns['deleted'] ?? []) as $c) {
                if (($c['inheritedfrom'] ?? null) === null) {
                    $parts[] = ColumnSql::deleteSql($ctx, $schema, $table, (string) $c['name']);
                    $dropped[] = (string) $c['name'];
                }
            }
            foreach ((array) ($columns['changed'] ?? []) as $c) {
                if (($c['inheritedfrom'] ?? null) === null && ($c['inheritedfromtable'] ?? null) === null) {
                    $parts[] = ColumnSql::updateSql($ctx, $tid, $schema, $table, $c);
                }
            }
            foreach ((array) ($columns['added'] ?? []) as $c) {
                if (($c['inheritedfrom'] ?? null) === null && ($c['inheritedfromtable'] ?? null) === null) {
                    $parts[] = ColumnSql::createSql($ctx, $schema, $table, $c);
                }
            }
        }

        array_push($parts, ...ConstraintSql::forTable($ctx, $tid, $schema, $table, $data, $dropped));

        $indexes = $data['indexes'] ?? null;
        if (is_array($indexes) && !array_is_list($indexes)) {
            foreach ((array) ($indexes['deleted'] ?? []) as $index) {
                $parts[] = IndexSql::deleteSql($ctx, $schema, (string) $index['name'], false);
            }
            foreach ((array) ($indexes['added'] ?? []) as $index) {
                $parts[] = IndexSql::createSql($ctx, $schema, $table, $index);
            }
        }

        // Partitions detached ("deleted", by oid) and created or attached ("added"): pgAdmin's _check_for_partitions_in_sql.
        $partitions = $data['partitions'] ?? null;
        if (is_array($partitions) && !array_is_list($partitions)) {
            foreach ((array) ($partitions['deleted'] ?? []) as $partition) {
                $target = $ctx->conn->row('SELECT rel.relname AS name, nsp.nspname AS schema FROM pg_catalog.pg_class rel JOIN pg_catalog.pg_namespace nsp ON nsp.oid = rel.relnamespace WHERE rel.oid = $1', [(int) ($partition['oid'] ?? 0)]);
                if ($target !== null) {
                    $parts[] = PartitionDdl::detachSql($ctx, $schema, $table, (string) $target['schema'], (string) $target['name'], (string) ($partition['mode'] ?? ''));
                }
            }
            $type = PartitionDdl::type((string) ($old['partition_scheme'] ?? ''));
            foreach ((array) ($partitions['added'] ?? []) as $partition) {
                $parts[] = PartitionDdl::createSql($ctx, $schema, $table, $type, (array) $partition);
            }
        }

        return Ddl::assemble($parts);
    }

    /** The INCLUDING options of LIKE, by pgAdmin's field names. */
    private const array LIKE_OPTIONS = ['like_default_value', 'like_constraints', 'like_indexes', 'like_storage', 'like_comments', 'like_compression', 'like_generated', 'like_identity', 'like_statistics'];

    /**
     * OF type, LIKE source and USING access method go into the statement as written, so each
     * must be one the lookups offer (the names come quoted from them). A typed table takes no
     * LIKE and no INHERITS, and its columns are the type's: the ones the client sends only add
     * options (WITH OPTIONS: NOT NULL, a default).
     *
     * @param array<string, mixed> $data
     */
    private static function checkTypedAndLike(NodeContext $ctx, array &$data): void
    {
        if (isset($data['typname'])) {
            $types = array_column($ctx->conn->rows($ctx->renderFrom('tables', 'get_oftype.sql', ['show_system_objects' => false, 'server_type' => 'pg'])), 'typname');
            if (!in_array($data['typname'], $types, true)) {
                throw new BadRequestException('Unknown composite type for OF.');
            }
            if (isset($data['like_relation']) || $data['coll_inherits'] !== []) {
                throw new BadRequestException('A typed table (OF type) cannot have LIKE or INHERITS.');
            }
            foreach ($data['columns'] as &$column) {
                $column['inheritedfromtype'] = $data['typname'];
                $column['has_with_options'] = true;
            }
            unset($column);
        }

        if (isset($data['like_relation'])) {
            $relations = array_column($ctx->conn->rows($ctx->renderFrom('tables', 'get_relations.sql', ['show_sys_objects' => false, 'server_type' => 'pg'])), 'like_relation');
            if (!in_array($data['like_relation'], $relations, true)) {
                throw new BadRequestException('Unknown table for LIKE.');
            }
        }
        foreach (self::LIKE_OPTIONS as $option) {
            $data[$option] = isset($data['like_relation']) && !empty($data[$option]);
        }

        if (isset($data['amname'])) {
            $methods = array_column($ctx->conn->rows($ctx->renderFrom('tables', 'get_access_methods.sql')), 'amname');
            if (!in_array($data['amname'], $methods, true)) {
                throw new BadRequestException('Unknown table access method.');
            }
        }
    }

    /**
     * The columns of a new table as create.sql takes them: the inherited ones left out, the rest
     * formatted. pgAdmin's parse_format_columns in create mode.
     *
     * @param list<array<string, mixed>> $columns
     * @return list<array<string, mixed>>
     */
    private static function columnsForCreate(array $columns): array
    {
        $result = [];
        foreach ($columns as $column) {
            if (($column['inheritedfrom'] ?? null) !== null) {
                continue;
            }
            if (trim((string) ($column['name'] ?? '')) === '' || trim((string) ($column['cltype'] ?? '')) === '') {
                continue;
            }
            $result[] = ColumnSql::forTemplate($column);
        }

        return $result;
    }

    /**
     * The autovacuum settings the client changed, as set_values and reset_values for the
     * template: pgAdmin's update_vacuum_settings in edit mode.
     *
     * @param array<string, mixed> $data
     * @param array<string, mixed> $old
     */
    private static function vacuumChanges(array &$data, array $old, string $key): void
    {
        if (!isset($data[$key]['changed']) || !isset($old[$key])) {
            return;
        }
        $set = [];
        $reset = [];
        foreach ((array) $data[$key]['changed'] as $row) {
            foreach ((array) $old[$key] as $oldRow) {
                if (($row['name'] ?? null) !== ($oldRow['name'] ?? null) || !array_key_exists('value', $row)) {
                    continue;
                }
                if ($row['value'] !== null && $row['value'] !== '') {
                    $set[] = $row;
                } elseif (array_key_exists('value', $oldRow)) {
                    $reset[] = $row;
                }
            }
        }
        if ($set !== []) {
            $data[$key]['set_values'] = $set;
        }
        if ($reset !== []) {
            $data[$key]['reset_values'] = $reset;
        }
    }
}
