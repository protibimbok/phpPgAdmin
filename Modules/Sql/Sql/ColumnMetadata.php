<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sql\Sql;

use PhpPgAdmin\Core\Database\Column;
use PhpPgAdmin\Core\Database\Connection;

/**
 * What the client needs to know about a result set's columns beyond their names and types:
 * which table they come from, whether they are the table's own columns, which ones form its
 * primary key, and so whether the rows may be edited in place. After pgAdmin's
 * is_query_resultset_updatable: the rows are editable when every table column comes from one
 * table, none is renamed or selected twice, and the whole primary key is among them.
 *
 * libpq knows each column's table and attribute number, but ext-pgsql only exposes the table
 * (pg_field_table), so the attribute is found by name and type among the table's columns: a
 * column selected under another name is read-only, as it is in pgAdmin.
 */
final class ColumnMetadata
{
    private const string SOURCE_SQL = <<<'SQL'
        SELECT c.oid, n.nspname AS schema, c.relname AS name, c.relkind
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.oid = $1
        SQL;

    private const string ATTRIBUTES_SQL = <<<'SQL'
        SELECT a.attname, a.attnum, a.atttypid, a.attnotnull, a.atthasdef,
               a.attidentity <> '' AS is_identity, a.attgenerated <> '' AS is_generated,
               COALESCE(a.attnum = ANY ((SELECT i.indkey FROM pg_catalog.pg_index i WHERE i.indrelid = a.attrelid AND i.indisprimary)::int2[]), false) AS pk
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum
        SQL;

    /**
     * @param list<Column> $columns
     * @return array{columns: list<array<string, mixed>>, source: array<string, mixed>|null}
     */
    public static function describe(Connection $conn, array $columns): array
    {
        $described = array_map(static fn (Column $c): array => [
            ...$c->toArray(),
            'attnum' => null,
            'pk' => false,
            'nullable' => true,
            'has_default' => false,
            'is_generated' => false,
            'editable' => false,
        ], $columns);

        $tables = array_values(array_unique(array_filter(array_map(static fn (Column $c): ?int => $c->tableOid, $columns))));
        if (count($tables) !== 1) {
            return ['columns' => $described, 'source' => null];
        }

        $oid = $tables[0];
        $source = $conn->row(self::SOURCE_SQL, [$oid]);
        if ($source === null) {
            return ['columns' => $described, 'source' => null];
        }

        /** @var array<string, array<string, mixed>> $attributes by name */
        $attributes = [];
        foreach ($conn->rows(self::ATTRIBUTES_SQL, [$oid]) as $attribute) {
            $attributes[(string) $attribute['attname']] = $attribute;
        }

        // A result column is the table's own when its name and type match one attribute; a
        // second column of the same attribute makes both read-only, as pgAdmin treats duplicates.
        $seen = [];
        foreach ($described as $i => &$column) {
            $attribute = $column['table_oid'] === $oid ? $attributes[$column['name']] ?? null : null;
            if ($attribute === null || (int) $attribute['atttypid'] !== $column['type_oid']) {
                continue;
            }

            $column['attnum'] = (int) $attribute['attnum'];
            $column['pk'] = (bool) $attribute['pk'];
            $column['nullable'] = !$attribute['attnotnull'];
            $column['has_default'] = (bool) $attribute['atthasdef'] || (bool) $attribute['is_identity'];
            $column['is_generated'] = (bool) $attribute['is_generated'];
            $column['editable'] = !$column['is_generated'];
            $seen[$column['attnum']][] = $i;
        }
        unset($column);

        foreach ($seen as $indexes) {
            if (count($indexes) > 1) {
                foreach ($indexes as $i) {
                    $described[$i]['editable'] = false;
                }
            }
        }

        $primaryKeys = array_values(array_map(static fn (array $a): string => (string) $a['attname'], array_filter($attributes, static fn (array $a): bool => (bool) $a['pk'])));
        $present = array_column(array_filter($described, static fn (array $c): bool => $c['attnum'] !== null && count($seen[$c['attnum']]) === 1), 'name');
        $editable = in_array($source['relkind'], ['r', 'p'], true)
            && $primaryKeys !== []
            && array_diff($primaryKeys, $present) === [];

        if (!$editable) {
            foreach ($described as &$column) {
                $column['editable'] = false;
            }
            unset($column);
        }

        return [
            'columns' => $described,
            'source' => [
                'oid' => $oid,
                'schema' => $source['schema'],
                'table' => $source['name'],
                'relkind' => $source['relkind'],
                'primary_keys' => $primaryKeys,
                'editable' => $editable,
            ],
        ];
    }
}
