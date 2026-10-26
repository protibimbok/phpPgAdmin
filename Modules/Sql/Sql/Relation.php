<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sql\Sql;

use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Connection;

/**
 * A relation named by schema and name, and its columns as the SQL pages and the row editor need
 * them: type, nullability, default expression, the labels of an enum type and the column a
 * foreign key points at, which is what phpMyAdmin's insert form and search page draw their
 * controls from.
 */
final readonly class Relation
{
    private const string RELATION_SQL = <<<'SQL'
        SELECT c.oid, c.relkind
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
        SQL;

    private const string COLUMNS_SQL = <<<'SQL'
        SELECT a.attname AS name, a.attnum, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type, t.typname AS type_name,
               NOT a.attnotnull AS nullable, a.atthasdef OR a.attidentity <> '' AS has_default, a.attidentity <> '' AS is_identity,
               a.attgenerated <> '' AS is_generated,
               COALESCE(a.attnum = ANY ((SELECT i.indkey FROM pg_catalog.pg_index i WHERE i.indrelid = a.attrelid AND i.indisprimary)::int2[]), false) AS pk,
               pg_catalog.col_description(a.attrelid, a.attnum) AS comment,
               CASE WHEN a.attcollation = 0 THEN NULL ELSE (SELECT co.collname FROM pg_catalog.pg_collation co WHERE co.oid = a.attcollation) END AS collation,
               pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS "default",
               CASE WHEN t.typtype = 'e' THEN (SELECT pg_catalog.json_agg(e.enumlabel ORDER BY e.enumsortorder)::text FROM pg_catalog.pg_enum e WHERE e.enumtypid = t.oid) END AS enum_values,
               (SELECT pg_catalog.json_build_object('schema', fn.nspname, 'table', fc.relname, 'column', fa.attname)::text
                  FROM pg_catalog.pg_constraint con
                  JOIN pg_catalog.pg_class fc ON fc.oid = con.confrelid
                  JOIN pg_catalog.pg_namespace fn ON fn.oid = fc.relnamespace
                  JOIN pg_catalog.pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = con.confkey[pg_catalog.array_position(con.conkey, a.attnum)]
                 WHERE con.conrelid = a.attrelid AND con.contype = 'f' AND a.attnum = ANY (con.conkey)
                 ORDER BY con.oid LIMIT 1) AS foreign_key
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum
        SQL;

    /** @var list<array<string, mixed>> */
    private array $columns;

    private function __construct(
        private Connection $conn,
        public string $schema,
        public string $name,
        public int $oid,
        public string $relkind,
    ) {
        $this->columns = array_map(static function (array $column): array {
            $column['enum_values'] = is_string($column['enum_values']) ? json_decode($column['enum_values'], true) : null;
            $column['foreign_key'] = is_string($column['foreign_key']) ? json_decode($column['foreign_key'], true) : null;

            return $column;
        }, $conn->rows(self::COLUMNS_SQL, [$oid]));
    }

    /** @throws NotFoundException when there is no such relation */
    public static function find(Connection $conn, string $schema, string $name): self
    {
        $row = $conn->row(self::RELATION_SQL, [$schema, $name]) ?? throw new NotFoundException(sprintf('There is no relation %s.%s.', $schema, $name));

        return new self($conn, $schema, $name, (int) $row['oid'], (string) $row['relkind']);
    }

    /** @return list<array<string, mixed>> */
    public function columns(): array
    {
        return $this->columns;
    }

    /** @return array<string, mixed>|null */
    public function column(string $name): ?array
    {
        foreach ($this->columns as $column) {
            if ($column['name'] === $name) {
                return $column;
            }
        }

        return null;
    }

    /** @return list<string> */
    public function primaryKeys(): array
    {
        return array_values(array_map(static fn (array $c): string => (string) $c['name'], array_filter($this->columns, static fn (array $c): bool => (bool) $c['pk'])));
    }

    /** The relation's name, quoted and qualified. */
    public function quotedName(): string
    {
        return $this->conn->escapeIdentifier($this->schema) . '.' . $this->conn->escapeIdentifier($this->name);
    }
}
