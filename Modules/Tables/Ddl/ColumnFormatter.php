<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Ddl;

use PhpPgAdmin\Core\Nodes\Acl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\Options;

/**
 * The columns of a table as pgAdmin's create.sql reads them: columns/utils.py's
 * get_formatted_columns and column_formatter, with the parts the DDL needs.
 */
final class ColumnFormatter
{
    /** The privilege codes a column accepts. */
    public const array ACL = ['a', 'r', 'w', 'x'];

    /** The integer types a SERIAL declaration becomes, and the pseudo-type that produced them. */
    private const array SERIAL_TYPES = ['integer' => 'serial', 'smallint' => 'smallserial', 'bigint' => 'bigserial'];

    /**
     * Every column of the table, formatted. $otherColumns are the columns of the type or of the
     * parent tables the table is made of, which mark the columns they define as inherited.
     *
     * @param list<array<string, mixed>> $otherColumns
     * @param 'type'|'table'|'' $tableOrType
     * @return list<array<string, mixed>>
     */
    public static function columns(NodeContext $ctx, int $tid, array $otherColumns, string $tableOrType): array
    {
        $columns = $ctx->conn->rows($ctx->renderFrom('columns', 'properties.sql', ['tid' => $tid, 'clid' => null, 'show_sys_objects' => false]));

        foreach ($columns as &$column) {
            foreach ($otherColumns as $other) {
                if ($column['name'] === $other['name']) {
                    $column['inheritedfrom' . $tableOrType] = $other['inheritedfrom'];
                    $column['inheritedid'] ??= $other['inheritedid'];
                }
            }
            self::reprojectSerial($column);
            self::format($ctx, $tid, $column);
        }
        unset($column);

        return $columns;
    }

    /**
     * What column_formatter adds for the DDL: primary-key membership, the parent tables that
     * declare the column, options, security labels and privileges.
     *
     * @param array<string, mixed> $column
     */
    private static function format(NodeContext $ctx, int $tid, array &$column): void
    {
        $indkey = array_filter(explode(' ', (string) ($column['indkey'] ?? '')));
        $column['is_pk'] = $column['is_primary_key'] = in_array((string) $column['attnum'], $indkey, true);

        foreach ($ctx->conn->rows($ctx->renderFrom('columns', 'get_inherited_tables.sql', ['tid' => $tid])) as $row) {
            if ($row['attrname'] === $column['name']) {
                $column['is_inherited'] = true;
                $column['tbls_inherited'] = $row['inhrelname'];
            }
        }

        $column['attoptions'] = array_map(
            static fn (string $option): array => ['name' => strstr($option, '=', true), 'value' => substr(strstr($option, '='), 1)],
            Options::list($column['attoptions'] ?? null),
        );
        $column['seclabels'] = Options::parseSecurityLabels($column['seclabels'] ?? null);

        $column['attacl'] = [];
        foreach ($ctx->conn->rows($ctx->renderFrom('columns', 'acl.sql', ['tid' => $tid, 'clid' => $column['attnum']])) as $acl) {
            $column[$acl['deftype']][] = Acl::fromDb($acl);
        }
    }

    /**
     * A column that owns the sequence behind its nextval() default was declared SERIAL; write it
     * back that way so the DDL round-trips (pgAdmin's reproject_serial_column).
     *
     * @param array<string, mixed> $column
     */
    private static function reprojectSerial(array &$column): void
    {
        $defval = (string) ($column['defval'] ?? '');
        $serial = !empty($column['seqrelid'])
            && str_starts_with($defval, "nextval('")
            && empty($column['attidentity'])
            && $column['seqrelid'] == ($column['defseqrelid'] ?? null)
            && isset(self::SERIAL_TYPES[$column['typname']]);

        if (!$serial) {
            return;
        }

        $type = self::SERIAL_TYPES[$column['typname']];
        $column['displaytypname'] = $column['cltype'] = $column['typname'] = $type;
        $column['serial_defval'] = $column['defval'];
        $column['defval'] = '';
    }

    /**
     * What _format_column_list does before create.sql: privileges as template rows, the type
     * split from its array brackets.
     *
     * @param list<array<string, mixed>> $columns
     * @return list<array<string, mixed>>
     */
    public static function forTemplate(array $columns): array
    {
        foreach ($columns as &$column) {
            if (isset($column['attacl']) && is_array($column['attacl'])) {
                $column['attacl'] = Acl::toDb($column['attacl'], self::ACL);
            }
            if (isset($column['cltype'])) {
                $type = (string) $column['cltype'];
                $column['hasSqrBracket'] = str_ends_with($type, '[]');
                $column['cltype'] = $column['hasSqrBracket'] ? substr($type, 0, -2) : $type;
            }
        }
        unset($column);

        return $columns;
    }
}
