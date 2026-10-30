<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Ddl;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\VacuumSettings;
use PhpPgAdmin\Modules\Tables\Http\Controllers\PolicyController;

/**
 * The statements behind a partitioned table's partitions, after pgAdmin's tables/utils.py
 * (get_partitions_sql, _get_resql_for_partitions): CREATE TABLE … PARTITION OF with the
 * bounds spelled from the client's values, ATTACH PARTITION for an existing table, DETACH,
 * and the "-- Partitions SQL" block of a table's DDL.
 *
 * A partition's data carries pgAdmin's field names: partition_name (or name), is_attach (then
 * partition_name is the schema-qualified table), is_default, values_from / values_to (range),
 * values_in (list), values_modulus / values_remainder (hash), is_sub_partitioned with
 * sub_partition_scheme, relpersistence, spcname, amname, description, relowner.
 */
final class PartitionDdl
{
    /** The partitioning strategy of a table, from pg_get_partkeydef's "RANGE (col)": range, list or hash. */
    public static function type(string $scheme): string
    {
        return strtolower(strtok(trim($scheme), ' (') ?: '');
    }

    /**
     * The bounds clause of a partition from the client's values: pgAdmin's get_partitions_sql.
     *
     * @param array<string, mixed> $row
     */
    public static function partitionValue(string $type, array $row): string
    {
        if (!empty($row['is_default']) && in_array($type, ['range', 'list'], true)) {
            return 'DEFAULT';
        }
        $list = static fn (mixed $value): string => implode(', ', array_map(trim(...), is_array($value) ? $value : explode(',', (string) $value)));
        switch ($type) {
            case 'range':
                if (trim((string) ($row['values_from'] ?? '')) === '' || trim((string) ($row['values_to'] ?? '')) === '') {
                    throw new BadRequestException('A range partition needs its FROM and TO values.');
                }

                return 'FOR VALUES FROM (' . $list($row['values_from']) . ') TO (' . $list($row['values_to']) . ')';
            case 'list':
                if (trim((string) ($row['values_in'] ?? '')) === '') {
                    throw new BadRequestException('A list partition needs its IN values.');
                }

                return 'FOR VALUES IN (' . $list($row['values_in']) . ')';
            case 'hash':
                if (trim((string) ($row['values_modulus'] ?? '')) === '' || trim((string) ($row['values_remainder'] ?? '')) === '') {
                    throw new BadRequestException('A hash partition needs its modulus and remainder.');
                }

                return 'FOR VALUES WITH (MODULUS ' . $list($row['values_modulus']) . ', REMAINDER ' . $list($row['values_remainder']) . ')';
            default:
                throw new BadRequestException('The table is not partitioned.');
        }
    }

    /**
     * CREATE TABLE … PARTITION OF, or ATTACH PARTITION, for one partition of the given parent.
     *
     * @param array<string, mixed> $row the client's data for the partition
     */
    public static function createSql(NodeContext $ctx, string $parentSchema, string $parentName, string $type, array $row): string
    {
        $data = [
            'partitioned_table_name' => $parentName,
            'parent_schema' => $parentSchema,
            'amname' => $row['amname'] ?? null,
            'partition_value' => $row['partition_value'] ?? self::partitionValue($type, $row),
        ];
        $name = trim((string) ($row['partition_name'] ?? $row['name'] ?? ''));
        if ($name === '') {
            throw new BadRequestException('Could not find the required parameter (name).');
        }

        if (!empty($row['is_attach'])) {
            // The table to attach is named schema-qualified, as get_attach_tables.sql lists them.
            [$schema, $table] = self::splitQualified($name, $parentSchema);
            $data['schema'] = $schema;
            $data['name'] = $table;

            return $ctx->renderFrom('partitions', 'attach.sql', ['data' => $data]);
        }

        $data['schema'] = trim((string) ($row['schema'] ?? '')) ?: $parentSchema;
        $data['name'] = $name;
        $data['relispartition'] = true;
        if (!empty($row['is_sub_partitioned']) && !empty($row['sub_partition_type'])) {
            // pgAdmin's Partitioned table? of a partition: its own PARTITION BY, from the type
            // and the keys, each a column (quoted here) or an expression (in parentheses).
            $data['is_partitioned'] = true;
            $data['partition_scheme'] = self::subPartitionScheme((string) $row['sub_partition_type'], is_array($row['sub_partition_keys'] ?? null) ? $row['sub_partition_keys'] : []);
        } elseif (!empty($row['is_sub_partitioned']) && !empty($row['sub_partition_scheme'])) {
            $data['is_partitioned'] = true;
            $data['partition_scheme'] = $row['sub_partition_scheme'];
        }
        foreach (['relpersistence', 'spcname', 'description', 'relowner', 'fillfactor'] as $key) {
            if (isset($row[$key]) && $row[$key] !== '' && $row[$key] !== false) {
                $data[$key] = $row[$key];
            }
        }
        $data['primary_key'] = $data['unique_constraint'] = $data['foreign_key'] = $data['check_constraint'] = $data['exclude_constraint'] = [];
        $data['vacuum_table'] = $data['vacuum_toast'] = [];

        return $ctx->renderFrom('partitions', 'create.sql', ['data' => $data]);
    }

    /**
     * "RANGE (created_at)" from pgAdmin's sub_partition_type and sub_partition_keys, each key
     * {key_type: 'column', pt_column} or {key_type: 'expression', expression}.
     *
     * @param list<mixed> $keys
     */
    private static function subPartitionScheme(string $type, array $keys): string
    {
        $type = strtoupper(trim($type));
        if (!in_array($type, ['RANGE', 'LIST', 'HASH'], true)) {
            throw new BadRequestException('A partition is partitioned by RANGE, LIST or HASH.');
        }
        $parts = [];
        foreach ($keys as $key) {
            if (!is_array($key)) {
                continue;
            }
            if (($key['key_type'] ?? 'column') === 'expression') {
                $expression = trim((string) ($key['expression'] ?? ''));
                if ($expression !== '') {
                    $parts[] = '(' . $expression . ')';
                }
            } elseif (($column = trim((string) ($key['pt_column'] ?? ''))) !== '') {
                $parts[] = Quoting::ident($column);
            }
        }
        if ($parts === []) {
            throw new BadRequestException('A partitioned partition needs at least one partition key.');
        }
        if ($type === 'LIST' && count($parts) > 1) {
            throw new BadRequestException('LIST partitioning takes a single key.');
        }

        return sprintf('%s (%s)', $type, implode(', ', $parts));
    }

    /** ALTER TABLE … DETACH PARTITION, plain, CONCURRENTLY or FINALIZE. */
    public static function detachSql(NodeContext $ctx, string $parentSchema, string $parentName, string $schema, string $name, string $mode = ''): string
    {
        return $ctx->renderFrom('partitions', 'detach.sql', ['data' => ['parent_schema' => $parentSchema, 'partitioned_table_name' => $parentName, 'schema' => $schema, 'name' => $name, 'mode' => $mode]]);
    }

    /**
     * The "-- Partitions SQL" block of a partitioned table's DDL: every partition's CREATE
     * TABLE … PARTITION OF with its own constraints and settings, followed by its indexes,
     * policies and triggers. pgAdmin's _get_resql_for_partitions.
     *
     * @param array<string, mixed> $parent the parent's formatted properties
     * @return list<string>
     */
    public static function partitionsSql(NodeContext $ctx, int $tid, array $parent): array
    {
        $rows = $ctx->conn->rows($ctx->renderFrom('partitions', 'nodes.sql', ['tid' => $tid]));
        if ($rows === []) {
            return [];
        }

        $parts = ['-- Partitions SQL'];
        foreach ($rows as $row) {
            $parts[] = self::partitionSql($ctx, $tid, (int) $row['oid'], $parent);
        }

        return $parts;
    }

    /**
     * One partition's CREATE TABLE … PARTITION OF (its local constraints, storage and
     * autovacuum settings, owner and comment) followed by its indexes, policies and triggers.
     *
     * @param array<string, mixed> $parent the parent's formatted properties (schema, name, default_amname)
     */
    public static function partitionSql(NodeContext $ctx, int $tid, int $ptid, array $parent, bool $withHeader = false): string
    {
        $row = $ctx->conn->row($ctx->renderFrom('partitions', 'nodes.sql', ['tid' => $tid, 'ptid' => $ptid]))
            ?? throw new \League\Route\Http\Exception\GoneException('Could not find the partition in the table.');
        VacuumSettings::flags($row);

        $data = $row;
        $data['partitioned_table_name'] = $parent['name'];
        $data['parent_schema'] = $parent['schema'];
        $data['schema'] = $row['schema_name'];
        $data['relispartition'] = true;
        $data['default_amname'] = $parent['default_amname'] ?? null;
        $data['vacuum_table'] = VacuumSettings::parse($ctx->conn, $row, 'table');
        $data['vacuum_toast'] = VacuumSettings::parse($ctx->conn, $row, 'toast');

        // Only the constraints declared on the partition itself; the parent's come with PARTITION OF.
        $local = static fn (array $c): bool => !(array_key_exists('conislocal', $c) && $c['conislocal'] === false);
        $data['primary_key'] = array_values(array_filter(Constraints::indexConstraints($ctx, $ptid, 'p'), $local));
        $data['unique_constraint'] = array_values(array_filter(Constraints::indexConstraints($ctx, $ptid, 'u'), $local));
        $data['foreign_key'] = array_values(array_filter(Constraints::foreignKeys($ctx, $ptid), $local));
        $data['check_constraint'] = array_values(array_filter(Constraints::checks($ctx, $ptid), $local));
        $data['exclude_constraint'] = Constraints::exclusions($ctx, $ptid);

        $schema = (string) $data['schema'];
        $name = (string) $data['name'];
        $parts = [];
        if ($withHeader) {
            $parts[] = Ddl::header('Table', Quoting::ident($schema, $name), $ctx->renderFrom('tables', 'delete.sql', ['data' => $data]));
        }
        $parts[] = $ctx->renderFrom('partitions', 'create.sql', ['data' => $data]);

        foreach ($ctx->conn->rows($ctx->renderFrom('indexes', 'nodes.sql', ['tid' => $ptid, 'show_sys_objects' => false])) as $index) {
            if (!($index['is_inherited'] ?? false)) {
                $parts[] = IndexDdl::sql($ctx, $schema, $name, $ptid, (int) $index['oid'], withHeader: true);
            }
        }
        foreach ($ctx->conn->rows($ctx->renderFrom('row_security_policies', 'nodes.sql', ['tid' => $ptid])) as $policy) {
            $parts[] = (new PolicyController())->createSqlOf(TableDdl::childContext($ctx, 'row_security_policy', ['tid' => $ptid]), (int) $policy['oid'], true);
        }
        foreach ($ctx->conn->rows($ctx->renderFrom('triggers', 'nodes.sql', ['tid' => $ptid])) as $trigger) {
            $parts[] = TriggerDdl::sql($ctx, $schema, $name, $ptid, (int) $trigger['oid']);
        }
        // A partition that is itself partitioned lists its own partitions.
        if (!empty($row['is_partitioned'])) {
            array_push($parts, ...self::partitionsSql($ctx, $ptid, ['name' => $name, 'schema' => $schema, 'default_amname' => $data['default_amname']]));
        }

        return Ddl::assemble($parts);
    }

    /**
     * "schema"."table" (or schema.table, or a bare name in the default schema) as its parts.
     *
     * @return array{0: string, 1: string}
     */
    public static function splitQualified(string $qualified, string $defaultSchema): array
    {
        if (preg_match('/^(?:"((?:[^"]|"")+)"|([^".]+))\.(?:"((?:[^"]|"")+)"|([^".]+))$/', $qualified, $m)) {
            $schema = $m[1] !== '' ? str_replace('""', '"', $m[1]) : $m[2];
            $table = ($m[3] ?? '') !== '' ? str_replace('""', '"', $m[3]) : $m[4];

            return [$schema, $table];
        }

        return [$defaultSchema, trim($qualified, '"')];
    }
}
