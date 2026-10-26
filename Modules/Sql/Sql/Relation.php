<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sql\Sql;

use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Connection;

/** A relation named by schema and name, and its columns as the SQL pages and the row editor need them. */
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
               NOT a.attnotnull AS nullable, a.atthasdef OR a.attidentity <> '' AS has_default, a.attgenerated <> '' AS is_generated,
               COALESCE(a.attnum = ANY ((SELECT i.indkey FROM pg_catalog.pg_index i WHERE i.indrelid = a.attrelid AND i.indisprimary)::int2[]), false) AS pk,
               pg_catalog.col_description(a.attrelid, a.attnum) AS comment,
               CASE WHEN a.attcollation = 0 THEN NULL ELSE (SELECT co.collname FROM pg_catalog.pg_collation co WHERE co.oid = a.attcollation) END AS collation
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
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
        $this->columns = $conn->rows(self::COLUMNS_SQL, [$oid]);
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
