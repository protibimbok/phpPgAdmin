<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Ddl;

use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Acl;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\Options;
use PhpPgAdmin\Core\Nodes\VacuumSettings;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;
use PhpPgAdmin\Modules\Tables\Http\Controllers\PolicyController;
use PhpPgAdmin\Modules\Tables\Http\Controllers\RuleController;

/**
 * The reverse-engineered SQL of a table, as pgAdmin's "SQL" tab shows it: BaseTableView's
 * _fetch_table_properties, _formatter and get_reverse_engineered_sql (tables/utils.py).
 *
 * The table's own DDL (create.sql) is followed by its indexes, row security policies,
 * triggers, rules and partitions, in pgAdmin's order.
 */
final class TableDdl
{
    /** The privilege codes a table accepts. */
    public const array ACL = ['a', 'r', 'w', 'd', 'D', 'x', 't', 'm'];

    /**
     * The table's properties row as pgAdmin's properties action returns it: with the autovacuum
     * flags, the privileges and the formatted columns and constraints.
     *
     * @param array<string, mixed> $row the row of tables/properties.sql
     * @return array<string, mixed>
     */
    public static function properties(NodeContext $ctx, int $tid, array $row): array
    {
        VacuumSettings::flags($row);

        $row['relacl'] = [];
        foreach ($ctx->conn->rows($ctx->renderFrom('tables', 'acl.sql', ['tid' => $tid, 'scid' => $ctx->id('scid')])) as $acl) {
            $row[$acl['deftype']][] = Acl::fromDb($acl);
        }

        return self::format($ctx, $tid, $row);
    }

    /** The "SQL" tab: header, commented DROP, CREATE TABLE with everything, then each index, policy, trigger, rule and partition. */
    public static function sql(NodeContext $ctx, int $tid, array $row, bool $ifNotExists = true): string
    {
        // A partition's DDL is CREATE TABLE … PARTITION OF its parent, with what it adds of its own.
        if (!empty($row['relispartition'])) {
            $parent = $ctx->conn->row('SELECT inh.inhparent AS oid, rel.relname AS name, nsp.nspname AS schema FROM pg_catalog.pg_inherits inh JOIN pg_catalog.pg_class rel ON rel.oid = inh.inhparent JOIN pg_catalog.pg_namespace nsp ON nsp.oid = rel.relnamespace WHERE inh.inhrelid = $1', [$tid]);
            if ($parent !== null) {
                return PartitionDdl::partitionSql($ctx, (int) $parent['oid'], $tid, [...$parent, 'default_amname' => $row['default_amname'] ?? null], withHeader: true);
            }
        }

        $data = self::properties($ctx, $tid, $row);
        $data['columns'] = ColumnFormatter::forTemplate($data['columns']);

        $header = Ddl::header('Table', Quoting::ident($data['schema'], $data['name']), $ctx->renderFrom('tables', 'delete.sql', ['data' => $data]));

        $data['relacl'] = Acl::toDb($data['relacl'], self::ACL);

        // A grantee holding some but not every privilege gets REVOKE ALL first, so the GRANTs below say it all.
        $data['revoke_all'] = [];
        foreach ($data['acl'] ?? [] as $acl) {
            $count = count($acl['privileges']);
            if ($count > 0 && $count < 7) {
                $data['revoke_all'][] = $acl['grantee'] === 'PUBLIC' ? 'PUBLIC' : Quoting::ident((string) $acl['grantee']);
            }
        }

        $parts = [$header, $ctx->renderFrom('tables', 'create.sql', ['data' => $data, 'is_sql' => true, 'add_not_exists_clause' => $ifNotExists])];

        // Indexes that are not inherited from a parent: PostgreSQL makes those itself.
        foreach ($ctx->conn->rows($ctx->renderFrom('indexes', 'nodes.sql', ['tid' => $tid, 'show_sys_objects' => false])) as $index) {
            if ($index['is_inherited'] ?? false) {
                continue;
            }
            $parts[] = IndexDdl::sql($ctx, (string) $data['schema'], (string) $data['name'], $tid, (int) $index['oid'], withHeader: true, ifNotExists: $ifNotExists);
        }

        $schema = (string) $data['schema'];
        $table = (string) $data['name'];
        foreach ($ctx->conn->rows($ctx->renderFrom('row_security_policies', 'nodes.sql', ['tid' => $tid])) as $policy) {
            $parts[] = (new PolicyController())->createSqlOf(self::childContext($ctx, 'row_security_policy'), (int) $policy['oid'], true);
        }
        foreach ($ctx->conn->rows($ctx->renderFrom('triggers', 'nodes.sql', ['tid' => $tid])) as $trigger) {
            $parts[] = TriggerDdl::sql($ctx, $schema, $table, $tid, (int) $trigger['oid']);
        }
        foreach ($ctx->conn->rows($ctx->renderFrom('rules', 'nodes.sql', ['tid' => $tid])) as $rule) {
            if ($rule['name'] !== '_RETURN') {
                $parts[] = (new RuleController())->createSqlOf(self::childContext($ctx, 'rule'), (int) $rule['oid'], true);
            }
        }
        if (!empty($data['is_partitioned'])) {
            array_push($parts, ...PartitionDdl::partitionsSql($ctx, $tid, $data));
        }

        return Ddl::assemble($parts);
    }

    /**
     * A context for one of the table's child nodes, on the same connection and route ids
     * (overridden by the given ones: a partition's own "tid").
     *
     * @param array<string, int> $ids
     */
    public static function childContext(NodeContext $ctx, string $type, array $ids = []): NodeContext
    {
        return new NodeContext($ctx->registry->get($type), $ctx->registry, $ctx->pool, $ctx->conn, $ctx->database, [...$ctx->ids, ...$ids], $ctx->request);
    }

    /** The last OID the server initialised, below which objects are the system's. */
    public static function lastSystemOid(): int
    {
        return DatabaseController::LAST_SYSTEM_OID;
    }

    /**
     * pgAdmin's _formatter: security labels, autovacuum settings, the columns (marking the ones
     * that come from the table's type or parents) and the constraints.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private static function format(NodeContext $ctx, int $tid, array $data): array
    {
        $data['seclabels'] = Options::parseSecurityLabels($data['seclabels'] ?? null);
        $data['coll_inherits'] = Options::list($data['coll_inherits'] ?? null);
        $data['vacuum_table'] = VacuumSettings::parse($ctx->conn, $data, 'table');
        $data['vacuum_toast'] = VacuumSettings::parse($ctx->conn, $data, 'toast');

        $otherColumns = [];
        $tableOrType = '';
        if (!empty($data['typoid'])) {
            $otherColumns = $ctx->conn->rows($ctx->renderFrom('tables', 'get_columns_for_table.sql', ['tid' => $data['typoid']]));
            $tableOrType = 'type';
        } elseif ($data['coll_inherits'] !== []) {
            foreach ($ctx->conn->rows($ctx->renderFrom('tables', 'get_inherits.sql', ['show_system_objects' => false, 'scid' => $ctx->id('scid'), 'server_type' => 'pg'])) as $parent) {
                if (in_array($parent['inherits'], $data['coll_inherits'], true)) {
                    array_push($otherColumns, ...$ctx->conn->rows($ctx->renderFrom('tables', 'get_columns_for_table.sql', ['tid' => $parent['oid']])));
                }
            }
            $tableOrType = 'table';
        }

        $data['columns'] = ColumnFormatter::columns($ctx, $tid, $otherColumns, $tableOrType);

        $isPartition = (bool) ($data['relispartition'] ?? false);
        $local = static fn (array $c): bool => !($isPartition && array_key_exists('conislocal', $c) && $c['conislocal'] === false);

        $data['primary_key'] = array_values(array_filter(Constraints::indexConstraints($ctx, $tid, 'p'), $local));
        $data['unique_constraint'] = array_values(array_filter(Constraints::indexConstraints($ctx, $tid, 'u'), $local));
        $data['foreign_key'] = array_values(array_filter(Constraints::foreignKeys($ctx, $tid), $local));
        $data['check_constraint'] = array_values(array_filter(Constraints::checks($ctx, $tid), $local));
        $data['exclude_constraint'] = Constraints::exclusions($ctx, $tid);

        return $data;
    }
}
