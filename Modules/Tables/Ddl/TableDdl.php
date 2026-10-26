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

/**
 * The reverse-engineered SQL of a table, as pgAdmin's "SQL" tab shows it: BaseTableView's
 * _fetch_table_properties, _formatter and get_reverse_engineered_sql (tables/utils.py).
 *
 * The table's own DDL (create.sql) is followed by its indexes. Row security policies,
 * triggers, rules and partitions follow once their nodes are ported.
 */
final class TableDdl
{
    /** The privilege codes a table accepts. */
    public const array ACL = ['a', 'r', 'w', 'd', 'D', 'x', 't', 'm'];

    private const array AUTOVACUUM_OPTIONS = [
        'autovacuum_vacuum_threshold', 'autovacuum_vacuum_scale_factor', 'autovacuum_analyze_threshold',
        'autovacuum_analyze_scale_factor', 'autovacuum_vacuum_cost_delay', 'autovacuum_vacuum_cost_limit',
        'autovacuum_freeze_min_age', 'autovacuum_freeze_max_age', 'autovacuum_freeze_table_age',
    ];

    /**
     * The table's properties row as pgAdmin's properties action returns it: with the autovacuum
     * flags, the privileges and the formatted columns and constraints.
     *
     * @param array<string, mixed> $row the row of tables/properties.sql
     * @return array<string, mixed>
     */
    public static function properties(NodeContext $ctx, int $tid, array $row): array
    {
        self::autovacuumFlags($row);

        $row['relacl'] = [];
        foreach ($ctx->conn->rows($ctx->renderFrom('tables', 'acl.sql', ['tid' => $tid, 'scid' => $ctx->id('scid')])) as $acl) {
            $row[$acl['deftype']][] = Acl::fromDb($acl);
        }

        return self::format($ctx, $tid, $row);
    }

    /** The "SQL" tab: header, commented DROP, CREATE TABLE with everything, then each index. */
    public static function sql(NodeContext $ctx, int $tid, array $row, bool $ifNotExists = true): string
    {
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

        return Ddl::assemble($parts);
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

    /**
     * pgAdmin's update_autovacuum_properties: autovacuum_enabled as 'x' (not set), 't' or 'f',
     * and whether any custom setting is in force, for the table and its TOAST table.
     *
     * @param array<string, mixed> $row
     */
    private static function autovacuumFlags(array &$row): void
    {
        foreach (['' => 'autovacuum_custom', 'toast_' => 'toast_autovacuum'] as $prefix => $flag) {
            $enabled = $row[$prefix . 'autovacuum_enabled'] ?? null;
            $row[$prefix . 'autovacuum_enabled'] = $enabled === null ? 'x' : ($enabled ? 't' : 'f');

            $custom = $row[$prefix . 'autovacuum_enabled'] !== 'x';
            foreach (self::AUTOVACUUM_OPTIONS as $option) {
                if (!empty($row[$prefix . $option])) {
                    $custom = true;
                }
            }
            $row[$flag] = $custom;
        }
    }
}
