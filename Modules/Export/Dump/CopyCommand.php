<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Dump;

use PhpPgAdmin\Core\Database\Quoting;

/**
 * The psql command line for a CSV export, as pgAdmin's import/export runs \copy: one
 * COPY … TO STDOUT per relation, one after the other in a read-only repeatable-read transaction,
 * so that the tables of a schema or a database are read as of the same moment. Each COPY writes
 * its own header row, as phpMyAdmin's CSV export does for each table. The connection is not on
 * the command line; the process gets it as libpq's environment.
 */
final readonly class CopyCommand
{
    /**
     * @param list<array{schema: string, name: string, kind: string, columns: list<string>}> $relations
     *        what to export, each with its columns (needed when line breaks are taken out of the values)
     */
    public function __construct(
        private ExportRequest $request,
        private CsvOptions $csv,
        private ClientTools $tools,
        private array $relations,
    ) {
    }

    public function program(): string
    {
        return $this->tools->path('psql');
    }

    /** @return list<string> */
    public function arguments(): array
    {
        $args = ['--no-password', '--no-psqlrc', '--quiet', '--set=ON_ERROR_STOP=1'];
        $statements = array_merge(...array_map(fn (array $relation): array => $this->csv->text ? $this->textStatements($relation) : [$this->statement($relation)], $this->relations));
        if (count($statements) > 1) {
            $statements = ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', ...$statements, 'COMMIT'];
        }
        foreach ($statements as $statement) {
            $args[] = '--command=' . $statement;
        }

        return $args;
    }

    /** @param array{schema: string, name: string, kind: string, columns: list<string>} $relation */
    public function statement(array $relation): string
    {
        $csv = $this->csv;
        $name = Quoting::ident($relation['schema'], $relation['name']);
        // A table's own rows, as COPY reads a table; a partitioned table with its partitions.
        $from = ($relation['kind'] === 'r' ? 'ONLY ' : '') . $name;
        $select = $csv->removeCrLf && $relation['columns'] !== []
            ? implode(', ', array_map(static fn (string $column): string => sprintf("regexp_replace(%s::text, '[\\r\\n]', '', 'g') AS %s", Quoting::ident($column), Quoting::ident($column)), $relation['columns']))
            : '*';

        $options = [
            'FORMAT csv',
            'HEADER ' . ($csv->columns ? 'true' : 'false'),
            'DELIMITER ' . Quoting::literal($csv->separator),
            'QUOTE ' . Quoting::literal($csv->enclosed),
            'ESCAPE ' . Quoting::literal($csv->escaped),
            'NULL ' . Quoting::literal($csv->null),
        ];
        if ($csv->forceQuote) {
            $options[] = 'FORCE_QUOTE *';
        }
        if ($this->request->encoding !== null) {
            $options[] = 'ENCODING ' . Quoting::literal($this->request->encoding);
        }

        return sprintf('COPY (SELECT %s FROM %s) TO STDOUT WITH (%s)', $select, $from, implode(', ', $options));
    }

    /**
     * Tab-separated: COPY's text format. Its HEADER needs PostgreSQL 15, so the column names
     * are a COPY of their own, a one-row SELECT that COPY escapes like the data.
     *
     * @param array{schema: string, name: string, kind: string, columns: list<string>} $relation
     * @return list<string>
     */
    private function textStatements(array $relation): array
    {
        $from = ($relation['kind'] === 'r' ? 'ONLY ' : '') . Quoting::ident($relation['schema'], $relation['name']);
        $options = ['FORMAT text', 'NULL ' . Quoting::literal($this->csv->null)];
        if ($this->request->encoding !== null) {
            $options[] = 'ENCODING ' . Quoting::literal($this->request->encoding);
        }
        $copy = sprintf('COPY (SELECT * FROM %s) TO STDOUT WITH (%s)', $from, implode(', ', $options));
        if (!$this->csv->columns || $relation['columns'] === []) {
            return [$copy];
        }
        $header = sprintf('COPY (SELECT %s) TO STDOUT WITH (%s)', implode(', ', array_map(Quoting::literal(...), $relation['columns'])), implode(', ', $options));

        return [$header, $copy];
    }
}
