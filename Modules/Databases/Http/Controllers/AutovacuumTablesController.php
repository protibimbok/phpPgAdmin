<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Databases\Http\Controllers;

use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\Quoting;

/**
 * Classic phpPgAdmin's database Admin → Autovacuum: every table and materialized view of the
 * database with its own autovacuum settings (autovacuum_* and toast.autovacuum_* in its
 * reloptions, with autovacuum_enabled), and the RESET that removes them so the server's
 * settings apply again.
 */
final class AutovacuumTablesController
{
    /**
     * @return list<array{oid: int, schema: string, name: string, relkind: string, options: list<array{name: string, value: string}>, reset_sql: string}>
     */
    public function list(Connection $conn): array
    {
        $rows = $conn->rows(<<<'SQL'
            SELECT c.oid, n.nspname, c.relname, c.relkind,
                pg_catalog.array_to_json(ARRAY(SELECT o FROM pg_catalog.unnest(c.reloptions) o WHERE o LIKE 'autovacuum\_%' ORDER BY o)) AS table_options,
                pg_catalog.array_to_json(ARRAY(SELECT o FROM pg_catalog.unnest(t.reloptions) o WHERE o LIKE 'autovacuum\_%' ORDER BY o)) AS toast_options
            FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                LEFT JOIN pg_catalog.pg_class t ON t.oid = c.reltoastrelid
            WHERE c.relkind IN ('r', 'm', 'p')
                AND (EXISTS (SELECT 1 FROM pg_catalog.unnest(c.reloptions) o WHERE o LIKE 'autovacuum\_%')
                    OR EXISTS (SELECT 1 FROM pg_catalog.unnest(t.reloptions) o WHERE o LIKE 'autovacuum\_%'))
            ORDER BY n.nspname, c.relname
            SQL);

        return array_map(function (array $row): array {
            $options = [
                ...array_map(fn (string $o): array => $this->option($o, ''), json_decode((string) $row['table_options'], true) ?: []),
                ...array_map(fn (string $o): array => $this->option($o, 'toast.'), json_decode((string) $row['toast_options'], true) ?: []),
            ];

            return [
                'oid' => (int) $row['oid'],
                'schema' => (string) $row['nspname'],
                'name' => (string) $row['relname'],
                'relkind' => (string) $row['relkind'],
                'options' => $options,
                'reset_sql' => $this->resetStatement((string) $row['relkind'], (string) $row['nspname'], (string) $row['relname'], $options),
            ];
        }, $rows);
    }

    /** The RESET of one table's autovacuum settings, as the list shows it. */
    public function resetSql(Connection $conn, int $oid): string
    {
        foreach ($this->list($conn) as $row) {
            if ($row['oid'] === $oid) {
                return $row['reset_sql'];
            }
        }
        throw new NotFoundException('The table has no autovacuum settings of its own.');
    }

    public function reset(Connection $conn, int $oid): void
    {
        $conn->query($this->resetSql($conn, $oid));
    }

    /** @return array{name: string, value: string} */
    private function option(string $entry, string $prefix): array
    {
        [$name, $value] = array_pad(explode('=', $entry, 2), 2, '');

        return ['name' => $prefix . $name, 'value' => $value];
    }

    /** @param list<array{name: string, value: string}> $options */
    private function resetStatement(string $relkind, string $schema, string $name, array $options): string
    {
        return sprintf('ALTER %s %s RESET (%s);', $relkind === 'm' ? 'MATERIALIZED VIEW' : 'TABLE', Quoting::ident($schema, $name), implode(', ', array_column($options, 'name')));
    }
}
