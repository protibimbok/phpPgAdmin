<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Import\Restore;

use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Http\ApiException;
use PhpPgAdmin\Modules\Export\Dump\ClientTools;

/**
 * The psql command line of a table's import from CSV, COPY's text format or its binary format,
 * as pgAdmin's import runs \copy: COPY … FROM STDIN, with the file on psql's input. The data is
 * read by COPY, never as psql's script, so no meta-command in it can run.
 *
 * Updating the rows a duplicate key matches (phpMyAdmin's ON DUPLICATE KEY UPDATE) and stopping
 * at a number of rows take a temporary table: the file is copied into it, numbered in the order
 * it was read, and then inserted into the table, with ON CONFLICT on the primary key and LIMIT,
 * in one transaction.
 *
 * @phpstan-type Column array{name: string, generated: bool, identity: string}
 */
final readonly class CopyCommand
{
    /** The temporary table of a staged import. */
    private const string STAGE = 'phppgadmin_import';

    /**
     * @param list<Column> $columns the table's columns, in order
     * @param list<string> $primaryKey the primary key's columns
     */
    public function __construct(
        private ImportRequest $request,
        private CopyImport $copy,
        private ClientTools $tools,
        private string $schema,
        private string $table,
        private array $columns,
        private array $primaryKey,
        private int $serverVersion,
    ) {
    }

    public function program(): string
    {
        return $this->tools->path('psql');
    }

    /** @return list<string> */
    public function arguments(): array
    {
        $args = ['--no-password', '--no-psqlrc', '--set=ON_ERROR_STOP=1'];
        foreach ($this->statements() as $statement) {
            $args[] = '--command=' . $statement;
        }

        return $args;
    }

    /** Foreign key checks switched off, as for an SQL import. */
    public function environment(): array
    {
        return $this->request->foreignKeyChecks ? [] : ['PGOPTIONS' => '-c session_replication_role=replica'];
    }

    /** @return list<string> */
    public function statements(): array
    {
        $this->check();
        $table = Quoting::ident($this->schema, $this->table);
        if (!$this->copy->staged()) {
            $list = $this->copy->columns === [] ? '' : ' (' . self::identList($this->copy->columns) . ')';

            return [sprintf('COPY %s%s FROM STDIN WITH (%s)', $table, $list, implode(', ', $this->options()))];
        }

        $columns = $this->copy->columns !== [] ? $this->copy->columns : array_column(array_filter($this->columns, static fn (array $c): bool => !$c['generated']), 'name');
        $list = self::identList($columns);
        $stage = Quoting::ident('pg_temp', self::STAGE);
        $row = 'row';
        while (in_array($row, $columns, true)) {
            $row = '_' . $row;
        }

        $insert = sprintf('INSERT INTO %s (%s)', $table, $list);
        $byName = array_column($this->columns, null, 'name');
        if (array_filter($columns, static fn (string $name): bool => $byName[$name]['identity'] === 'a') !== []) {
            $insert .= ' OVERRIDING SYSTEM VALUE';
        }
        $insert .= sprintf(' SELECT %s FROM %s ORDER BY %s', $list, $stage, Quoting::ident($row));
        if ($this->copy->limit !== null) {
            $insert .= ' LIMIT ' . $this->copy->limit;
        }
        if ($this->copy->replace) {
            $updated = array_values(array_diff($columns, $this->primaryKey));
            $insert .= sprintf(' ON CONFLICT (%s) DO ', self::identList($this->primaryKey)) . ($updated === []
                ? 'NOTHING'
                : 'UPDATE SET ' . implode(', ', array_map(static fn (string $c): string => sprintf('%1$s = EXCLUDED.%1$s', Quoting::ident($c)), $updated)));
        }

        return [
            'BEGIN',
            sprintf('CREATE TEMPORARY TABLE %s ON COMMIT DROP AS SELECT %s FROM %s WITH NO DATA', self::STAGE, $list, $table),
            sprintf('ALTER TABLE %s ADD COLUMN %s bigint GENERATED ALWAYS AS IDENTITY', $stage, Quoting::ident($row)),
            sprintf('COPY %s (%s) FROM STDIN WITH (%s)', $stage, $list, implode(', ', $this->options())),
            $insert,
            'COMMIT',
        ];
    }

    /** COPY's options for the format; the file's character set is its ENCODING. */
    private function options(): array
    {
        $copy = $this->copy;
        $options = ['FORMAT ' . $copy->format];
        if ($copy->format === 'binary') {
            return $options;
        }
        $options[] = 'DELIMITER ' . Quoting::literal($copy->separator);
        if ($copy->format === 'csv') {
            $options[] = 'QUOTE ' . Quoting::literal($copy->enclosed);
            $options[] = 'ESCAPE ' . Quoting::literal($copy->escaped);
        }
        $options[] = 'NULL ' . Quoting::literal((string) $copy->null);
        if ($copy->default !== null) {
            $options[] = 'DEFAULT ' . Quoting::literal($copy->default);
        }
        if ($copy->header !== 'none') {
            $options[] = 'HEADER ' . ($copy->header === 'match' ? 'MATCH' : 'true');
        }
        if ($this->request->charset !== null) {
            $options[] = 'ENCODING ' . Quoting::literal($this->request->charset);
        }
        if ($copy->ignoreErrors) {
            // Each row skipped is reported as a NOTICE.
            $options[] = 'ON_ERROR ignore';
            $options[] = 'LOG_VERBOSITY verbose';
        }

        return $options;
    }

    /** What the server and the table cannot do with the options, refused before psql starts. */
    private function check(): void
    {
        $copy = $this->copy;
        $names = array_column($this->columns, 'name');
        foreach ($copy->columns as $name) {
            if (!in_array($name, $names, true)) {
                throw new ApiException(422, sprintf('The table "%s" has no column "%s".', $this->table, $name));
            }
            if ($this->columns[array_search($name, $names, true)]['generated']) {
                throw new ApiException(422, sprintf('"%s" is a generated column: its values are computed, not imported.', $name));
            }
        }
        if ($copy->replace && $this->primaryKey === []) {
            throw new ApiException(422, sprintf('The table "%s" has no primary key for a duplicate to be found by.', $this->table));
        }
        $requires = match (true) {
            $copy->ignoreErrors => [170000, 'Skipping the rows COPY cannot read (ON_ERROR ignore)'],
            $copy->default !== null => [160000, 'A DEFAULT string'],
            $copy->header === 'match' => [150000, 'Matching the header line against the columns (HEADER MATCH)'],
            $copy->header !== 'none' && $copy->format === 'text' => [150000, 'A header line in the text format'],
            default => null,
        };
        if ($requires !== null && $this->serverVersion < $requires[0]) {
            throw new ApiException(422, sprintf('%s takes PostgreSQL %d or newer.', $requires[1], intdiv($requires[0], 10000)));
        }
    }

    /** @param list<string> $names */
    private static function identList(array $names): string
    {
        return implode(', ', array_map(static fn (string $name): string => Quoting::ident($name), $names));
    }
}
