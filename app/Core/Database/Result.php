<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Database;

use PgSql\Result as PgResult;

/**
 * The outcome of one statement: its rows and columns for a query, the affected row count for a
 * command, and the notices the server raised while running it.
 *
 * Values come back as PHP types for booleans, integers and floats; everything else stays the
 * server's text form, so numerics keep their precision and dates their formatting.
 */
final class Result
{
    private const int OID_BOOL = 16;

    private const array OID_INT = [20 => true, 21 => true, 23 => true, 26 => true];

    private const array OID_FLOAT = [700 => true, 701 => true];

    /** @var list<Column>|null */
    private ?array $columns = null;

    /**
     * @param list<string> $notices
     */
    public function __construct(
        private readonly PgResult $result,
        private readonly array $notices = [],
    ) {
    }

    /** @return list<Column> */
    public function columns(): array
    {
        if ($this->columns !== null) {
            return $this->columns;
        }

        $columns = [];
        for ($i = 0, $n = pg_num_fields($this->result); $i < $n; $i++) {
            $table = pg_field_table($this->result, $i, true);

            $columns[] = new Column(
                pg_field_name($this->result, $i),
                pg_field_type_oid($this->result, $i),
                pg_field_type($this->result, $i),
                $table === false || $table === 0 ? null : (int) $table,
            );
        }

        return $this->columns = $columns;
    }

    /**
     * Every row as an associative array.
     *
     * @return list<array<string, mixed>>
     */
    public function rows(): array
    {
        $rows = pg_fetch_all($this->result, PGSQL_ASSOC);
        $casts = $this->casts();

        if ($casts === []) {
            return $rows;
        }

        foreach ($rows as &$row) {
            foreach ($casts as $name => $cast) {
                if ($row[$name] !== null) {
                    $row[$name] = $cast($row[$name]);
                }
            }
        }

        return $rows;
    }

    /**
     * Every row as a list of values, in column order.
     *
     * @return list<list<mixed>>
     */
    public function rowsAsLists(): array
    {
        return array_map(array_values(...), $this->rows());
    }

    /** @return array<string, mixed>|null */
    public function row(): ?array
    {
        $rows = $this->rows();

        return $rows[0] ?? null;
    }

    /** The first column of the first row, or null when there is none. */
    public function scalar(): mixed
    {
        $row = $this->row();

        return $row === null ? null : reset($row);
    }

    public function rowCount(): int
    {
        return pg_num_rows($this->result);
    }

    /** Rows affected by INSERT, UPDATE, DELETE, COPY; 0 for other statements. */
    public function affectedRows(): int
    {
        return pg_affected_rows($this->result);
    }

    /** The command tag, "SELECT 3" or "CREATE TABLE". */
    public function commandTag(): string
    {
        $status = pg_result_status($this->result, PGSQL_STATUS_STRING);

        return is_string($status) ? $status : '';
    }

    /** True when the statement produced a row set (even an empty one), false for a command. */
    public function hasRows(): bool
    {
        return pg_result_status($this->result) === PGSQL_TUPLES_OK;
    }

    /** @return list<string> */
    public function notices(): array
    {
        return $this->notices;
    }

    /**
     * The conversions to apply per column name, for the types PDO used to hand back as PHP values.
     *
     * @return array<string, callable(string): mixed>
     */
    private function casts(): array
    {
        $casts = [];

        foreach ($this->columns() as $column) {
            if ($column->typeOid === self::OID_BOOL) {
                $casts[$column->name] = static fn (string $v): bool => $v === 't';
            } elseif (isset(self::OID_INT[$column->typeOid])) {
                // int8 may exceed PHP_INT_MAX on 32-bit builds; keep the text when it does.
                $casts[$column->name] = static fn (string $v): int|string => is_numeric($v) && (string) (int) $v === $v ? (int) $v : $v;
            } elseif (isset(self::OID_FLOAT[$column->typeOid])) {
                $casts[$column->name] = static fn (string $v): float|string => is_numeric($v) ? (float) $v : $v;
            }
        }

        return $casts;
    }
}
