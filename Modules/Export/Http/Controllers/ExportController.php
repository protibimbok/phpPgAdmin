<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use Nyholm\Psr7\Factory\Psr17Factory;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Database\QueryException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Http\ApiException;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Export\Dump\ClientTools;
use PhpPgAdmin\Modules\Export\Dump\CopyCommand;
use PhpPgAdmin\Modules\Export\Dump\CopyFormat;
use PhpPgAdmin\Modules\Export\Dump\CsvLineEnds;
use PhpPgAdmin\Modules\Export\Dump\DirectoryDump;
use PhpPgAdmin\Modules\Export\Dump\DumpCommand;
use PhpPgAdmin\Modules\Export\Dump\DumpStream;
use PhpPgAdmin\Modules\Export\Dump\ExportRequest;
use PhpPgAdmin\Modules\Export\Dump\FileName;
use PhpPgAdmin\Modules\Export\Dump\HtmlFormat;
use PhpPgAdmin\Modules\Export\Dump\JsonFormat;
use PhpPgAdmin\Modules\Export\Dump\RowStream;
use PhpPgAdmin\Modules\Export\Dump\SqlInsertFormat;
use PhpPgAdmin\Modules\Export\Dump\XmlFormat;
use PhpPgAdmin\Modules\Export\Storage\ExportTemplates;
use PhpPgAdmin\Modules\Sql\Sql\Splitter;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Message\StreamInterface;

/**
 * The Export pages' backend: what a scope offers to export (GET /api/export/options), and the
 * export itself (POST /api/export), pg_dump or pg_dumpall streamed to the response as an
 * attachment, or as text for "View output as text", CSV and tab-separated text written by
 * COPY through psql, and HTML, XML and a view's rows read through a cursor (RowStream).
 */
final class ExportController
{
    /** @return array<string, mixed> */
    public function options(ServerRequestInterface $request): array
    {
        $query = $request->getQueryParams();
        $pool = ConnectionPool::from($request);
        $database = self::name($query, 'database');
        $schema = self::name($query, 'schema');
        $table = self::name($query, 'table');
        $scope = ($query['scope'] ?? null) === 'query' ? 'query' : ($database === null ? 'server' : ($schema === null ? 'database' : ($table === null ? 'schema' : 'table')));
        $conn = $database === null ? $pool->maintenance() : $pool->for($database);
        $tools = ClientTools::locate();
        $serverMajor = intdiv($pool->version(), 10000);

        $objects = match ($scope) {
            'server' => array_map(static fn (string $name): array => ['name' => $name], array_keys($this->databases($conn))),
            'database' => array_map(static fn (string $name): array => ['name' => $name], array_keys($this->schemas($conn))),
            'schema' => array_map(static fn (string $name, string $kind): array => ['name' => $name, 'kind' => $kind], array_keys($rel = $this->relations($conn, (string) $schema)), $rel),
            'table', 'query' => [],
        };
        if ($scope === 'table' && $this->relationKind($conn, (string) $schema, (string) $table) === null) {
            throw new NotFoundException(sprintf('There is no relation "%s"."%s".', $schema, $table));
        }

        return [
            'scope' => $scope,
            'objects' => $objects,
            'encodings' => array_column($conn->rows("SELECT pg_encoding_to_char(i) AS name FROM generate_series(0, 63) AS i WHERE pg_encoding_to_char(i) <> '' ORDER BY 1"), 'name'),
            'encoding' => (string) $conn->scalar('SELECT pg_encoding_to_char(encoding) FROM pg_database WHERE datname = current_database()'),
            'filename_template' => FileName::DEFAULTS[$scope],
            'server_major' => $serverMajor,
            'tools' => $tools === null ? null : [
                'directory' => $tools->directory,
                'version' => $tools->versionString(),
                'usable' => $tools->major() >= $serverMajor,
                'statistics' => $tools->version >= 180000,
                'policies' => $tools->version >= 180000,
                'toast_compression' => $tools->version >= 140000,
                'table_access_method' => $tools->version >= 150000,
                'psql' => is_executable($tools->path('psql')),
            ],
            'templates' => ExportTemplates::for(self::serverKey(), $pool->username())->all($scope),
        ];
    }

    public function export(ServerRequestInterface $request): ResponseInterface
    {
        $body = (array) ($request->getParsedBody() ?? []);
        // The page posts a form into a hidden frame, the options as one JSON field, so that the
        // browser saves the response; "View output as text" sends them as a JSON body.
        if (isset($body['options']) && is_string($body['options'])) {
            $decoded = json_decode($body['options'], true);
            if (!is_array($decoded)) {
                throw new BadRequestException('The export options are not valid JSON.');
            }
            $body = $decoded;
        }
        $export = ExportRequest::fromArray($body);
        $pool = ConnectionPool::from($request);
        if ($export->scope === 'query') {
            return $this->queryExport($export, $pool);
        }

        $conn = $export->database === null ? $pool->maintenance() : $pool->for($export->database);
        $tableKind = $export->scope === 'table'
            ? ($this->relationKind($conn, (string) $export->schema, (string) $export->table) ?? throw new NotFoundException(sprintf('There is no relation "%s"."%s".', $export->schema, $export->table)))
            : 'r';

        // HTML, XML, and the rows of a view or foreign table (which pg_dump does not dump) are
        // read here through a cursor; the rest is pg_dump, pg_dumpall or psql's COPY.
        if ($export->isRowFormat() || ($export->format === 'plain' && $export->contents === 'data' && in_array($tableKind, ['v', 'f'], true))) {
            return $this->rowExport($export, $pool);
        }

        $tools = ClientTools::locate() ?? throw new ApiException(503, 'pg_dump was not found. Set PGADMIN_PG_BIN_DIR (config/tools.php) to the directory of the PostgreSQL client programs.');
        $serverMajor = intdiv($pool->version(), 10000);
        if ($export->csv !== null && !is_executable($tools->path('psql'))) {
            throw new ApiException(503, sprintf('psql was not found in %s, next to pg_dump.', $tools->directory));
        }
        // COPY has not changed in a way an older psql would notice; pg_dump has to be as new as the server.
        if ($export->csv === null && $tools->major() < $serverMajor) {
            throw new ApiException(422, sprintf('pg_dump %s cannot dump a PostgreSQL %d server; point PGADMIN_PG_BIN_DIR at the client programs of version %d or newer.', $tools->versionString(), $serverMajor, $serverMajor));
        }

        $objects = match ($export->scope) {
            'server' => $this->databases($conn),
            'database' => $this->schemas($conn),
            'schema' => $this->relations($conn, (string) $export->schema),
            'table', 'query' => [],
        };
        $oversized = $export->maxSize !== null && $export->scope !== 'server' ? $this->oversized($conn, $export) : [];

        $command = $export->csv !== null
            ? new CopyCommand($export, $export->csv, $tools, $this->copyRelations($conn, $export, $objects, $tableKind, $oversized))
            : new DumpCommand($export, $tools, $objects, $oversized, $tableKind);
        $environment = $pool->environment($export->database ?? $conn->database());
        $plain = $export->format === 'plain';
        $gzip = $this->gzip($export);
        $filter = $export->csv !== null && $export->csv->terminated !== "\n" ? (new CsvLineEnds($export->csv->enclosed, $export->csv->escaped, $export->csv->terminated))(...) : null;
        $prefix = $plain ? $this->headerComment($export) : '';

        $this->detachSession();
        $stream = $export->format === 'directory'
            ? DirectoryDump::run($command->program(), $command->arguments(), $environment, substr($this->fileName($export), 0, -strlen('.tar')))
            : DumpStream::start($command->program(), $command->arguments(), $environment, $gzip, $plain, $prefix, $filter);

        return $this->respond($export, $stream, $gzip);
    }

    /**
     * An export whose rows RowStream reads through a cursor: HTML, XML, or the INSERT or COPY
     * statements of a view's or foreign table's rows.
     */
    private function rowExport(ExportRequest $export, ConnectionPool $pool): ResponseInterface
    {
        if ($export->format === 'json') {
            return $this->jsonExport($export, $pool);
        }
        $relation = Quoting::ident((string) $export->schema, (string) $export->table);
        $title = $export->schema . '.' . $export->table;
        $format = match ($export->format) {
            'html' => new HtmlFormat($title, $export->htmlColumns, $export->htmlNull, $export->encoding ?? 'UTF-8'),
            'xml' => new XmlFormat($export->encoding ?? 'UTF-8'),
            default => $this->sqlFormat($export, $relation),
        };
        $plain = $export->format === 'plain';
        $gzip = $this->gzip($export);

        $this->detachSession();
        $stream = RowStream::start($pool->detached($export->database), 'SELECT * FROM ' . $relation, $format, $gzip, $plain ? $this->headerComment($export) : '', $plain ? '-- ' : '', $export->encoding);

        return $this->respond($export, $stream, $gzip);
    }

    /**
     * phpMyAdmin's JSON export of a relation's rows, or of the relations ticked under Data at
     * the schema scope (the tables, partitioned tables, materialized views and foreign tables
     * when nothing is ticked), each relation one "table" object in the same file.
     */
    private function jsonExport(ExportRequest $export, ConnectionPool $pool): ResponseInterface
    {
        $schema = (string) $export->schema;
        if ($export->scope === 'schema') {
            $objects = $this->relations($pool->for($export->database), $schema);
            $names = $export->data ?? array_keys(array_filter($objects, static fn (string $kind): bool => in_array($kind, ['r', 'p', 'm', 'f'], true)));
            $names = array_values(array_filter(array_map('strval', $names), static fn (string $name): bool => ($objects[$name] ?? 'S') !== 'S'));
            foreach ($export->data ?? [] as $name) {
                if (!array_key_exists($name, $objects)) {
                    throw new BadRequestException(sprintf('There is no relation "%s".', $name));
                }
            }
            sort($names);
            if ($names === []) {
                throw new ApiException(422, 'There is no data to export: tick a table under Data.');
            }
        } else {
            $names = [(string) $export->table];
        }

        $format = new JsonFormat((string) $export->database, array_map(static fn (string $name): array => ['schema' => $schema, 'name' => $name], $names), $export->jsonPretty, $export->jsonUnicode);
        $gzip = $this->gzip($export);

        $this->detachSession();
        $stream = RowStream::start($pool->detached($export->database), array_map(static fn (string $name): string => 'SELECT * FROM ' . Quoting::ident($schema, $name), $names), $format, $gzip);

        return $this->respond($export, $stream, $gzip);
    }

    /**
     * The rows of a query from the SQL page or a result grid. It must be one statement that
     * DECLARE takes, a SELECT or VALUES without data-modifying WITH clauses, which is checked
     * in a read-only transaction before anything is written. CSV and tab-separated text are
     * COPY (query) through psql, in a session that is read-only by default; the rest is read
     * through a cursor. INSERT statements name the table the columns all come from, or
     * query_result.
     */
    private function queryExport(ExportRequest $export, ConnectionPool $pool): ResponseInterface
    {
        $statements = Splitter::split((string) $export->sql);
        if (count($statements) !== 1) {
            throw new BadRequestException('Export the rows of one statement at a time.');
        }
        $sql = rtrim(trim($statements[0]->sql), ';');
        if (!Splitter::isSelect($sql)) {
            throw new ApiException(422, 'Only the rows of a SELECT, VALUES or TABLE statement can be exported.');
        }
        $conn = $pool->for($export->database);

        try {
            $conn->exec('BEGIN READ ONLY');
            $conn->exec('DECLARE pga_check NO SCROLL CURSOR FOR ' . $sql);
            $columns = $conn->query('FETCH FORWARD 0 FROM pga_check')->columns();
        } catch (QueryException $e) {
            throw new ApiException(422, $e->getMessage());
        } finally {
            try {
                $conn->exec('ROLLBACK');
            } catch (QueryException) {
                // Nothing was begun.
            }
        }

        if ($export->csv !== null) {
            $tools = ClientTools::locate() ?? throw new ApiException(503, 'psql was not found. Set PGADMIN_PG_BIN_DIR (config/tools.php) to the directory of the PostgreSQL client programs.');
            if (!is_executable($tools->path('psql'))) {
                throw new ApiException(503, sprintf('psql was not found in %s.', $tools->directory));
            }
            $relation = ['schema' => '', 'name' => '', 'kind' => 'q', 'columns' => array_map(static fn ($column): string => $column->name, $columns), 'query' => $sql];
            $command = new CopyCommand($export, $export->csv, $tools, [$relation]);
            $environment = $pool->environment($export->database ?? $conn->database()) + ['PGOPTIONS' => '-c default_transaction_read_only=on'];
            $filter = $export->csv->terminated !== "\n" ? (new CsvLineEnds($export->csv->enclosed, $export->csv->escaped, $export->csv->terminated))(...) : null;
            $gzip = $this->gzip($export);

            $this->detachSession();
            $stream = DumpStream::start($command->program(), $command->arguments(), $environment, $gzip, false, '', $filter);

            return $this->respond($export, $stream, $gzip);
        }

        $source = $this->sourceRelation($conn, $columns);
        $target = $source === null ? 'query_result' : Quoting::ident($source['schema'], $source['name']);
        $format = match ($export->format) {
            'html' => new HtmlFormat('Query result', $export->htmlColumns, $export->htmlNull, $export->encoding ?? 'UTF-8'),
            'xml' => new XmlFormat($export->encoding ?? 'UTF-8'),
            'json' => new JsonFormat((string) $export->database, [$source ?? ['schema' => null, 'name' => 'query_result']], $export->jsonPretty, $export->jsonUnicode),
            default => $this->sqlFormat($export, $target),
        };
        $plain = $export->format === 'plain';
        $prefix = $plain ? $this->headerComment($export) . '-- ' . str_replace("\n", "\n-- ", $sql) . "\n\n" : '';
        $gzip = $this->gzip($export);

        $this->detachSession();
        // JSON is UTF-8 whatever the character set chosen.
        $stream = RowStream::start($pool->detached($export->database), $sql, $format, $gzip, $prefix, $plain ? '-- ' : '', $export->format === 'json' ? null : $export->encoding);

        return $this->respond($export, $stream, $gzip);
    }

    /**
     * The table every column of a result is read from, or null when they come from several
     * tables or from expressions.
     *
     * @param list<\PhpPgAdmin\Core\Database\Column> $columns
     * @return array{schema: string, name: string}|null
     */
    private function sourceRelation(Connection $conn, array $columns): ?array
    {
        $tables = array_unique(array_map(static fn ($column): ?int => $column->tableOid, $columns));
        if (count($tables) !== 1 || $tables[0] === null) {
            return null;
        }
        $row = $conn->row('SELECT n.nspname, c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = $1', [$tables[0]]);

        return $row === null ? null : ['schema' => (string) $row['nspname'], 'name' => (string) $row['relname']];
    }

    private function sqlFormat(ExportRequest $export, string $relation): SqlInsertFormat|CopyFormat
    {
        return $export->dataStyle === 'insert'
            ? new SqlInsertFormat($relation, in_array($export->insertSyntax, ['columns', 'both'], true), in_array($export->insertSyntax, ['multi', 'both'], true) ? $export->rowsPerInsert : 1, $export->flag('on_conflict_do_nothing'))
            : new CopyFormat($relation);
    }

    private function gzip(ExportRequest $export): bool
    {
        // pg_dump compresses a custom archive and a directory archive's files itself.
        return !$export->asText && $export->compression === 'gzip' && $export->format !== 'custom' && $export->format !== 'directory';
    }

    /** phpMyAdmin's "Add custom comment into header", as SQL comment lines. */
    private function headerComment(ExportRequest $export): string
    {
        return trim($export->headerComment) !== ''
            ? implode('', array_map(static fn (string $line): string => '-- ' . $line . "\n", explode('\n', str_replace(["\r\n", "\n"], '\n', $export->headerComment)))) . "\n"
            : '';
    }

    /**
     * The dump can take long and needs nothing more from the session; let the session's other
     * requests through while it runs.
     */
    private function detachSession(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        set_time_limit(0);
    }

    /** The stream as the response: text for "View output as text", otherwise an attachment named by the template. */
    private function respond(ExportRequest $export, StreamInterface $stream, bool $gzip): ResponseInterface
    {
        $response = (new Psr17Factory())->createResponse()
            ->withHeader('Cache-Control', 'no-store')
            ->withHeader('X-Accel-Buffering', 'no')
            ->withBody($stream);

        if ($export->asText) {
            return $response->withHeader('Content-Type', 'text/plain; charset=utf-8');
        }

        $name = $this->fileName($export);
        $ascii = (string) preg_replace('/[^\x20-\x7e]/', '_', $name);

        return $response
            ->withHeader('Content-Type', match (true) {
                $gzip => 'application/gzip',
                $export->format === 'tar', $export->format === 'directory' => 'application/x-tar',
                $export->format === 'custom' => 'application/octet-stream',
                $export->format === 'tsv' => 'text/tab-separated-values',
                $export->csv !== null => 'text/csv',
                $export->format === 'html' => 'text/html; charset=utf-8',
                $export->format === 'xml' => 'application/xml',
                $export->format === 'json' => 'application/json',
                default => 'application/sql',
            })
            ->withHeader('Content-Disposition', sprintf('attachment; filename="%s"; filename*=UTF-8\'\'%s', addcslashes($ascii, '"\\'), rawurlencode($name)));
    }

    /** The download's file name, from the request's template or the scope's default. */
    private function fileName(ExportRequest $export): string
    {
        $server = Authenticate::sessionServer();

        return FileName::expand(
            $export->filenameTemplate !== '' ? $export->filenameTemplate : FileName::DEFAULTS[$export->scope],
            ['server' => $server?->name ?? $server?->host ?? 'localhost', 'database' => $export->database, 'schema' => $export->schema, 'table' => $export->table],
            FileName::extension($export->format, $export->compression),
        );
    }

    /**
     * The relations a CSV export copies, with their columns: the relation of the table scope,
     * the relations ticked under Data at the schema scope, and the tables and materialized views
     * of the schemas ticked under Data at the database scope. Partitions come with their
     * partitioned table; tables over the size limit are left out.
     *
     * @param array<string, string> $objects what the scope offers, by name
     * @param list<array{0: string, 1: string, 2: string}> $oversized
     * @return list<array{schema: string, name: string, kind: string, columns: list<string>}>
     */
    private function copyRelations(Connection $conn, ExportRequest $export, array $objects, string $tableKind, array $oversized): array
    {
        [$schemas, $names, $kinds] = match ($export->scope) {
            'table' => [[(string) $export->schema], [(string) $export->table], [$tableKind]],
            'schema' => [[(string) $export->schema], $export->data ?? array_keys(array_filter($objects, static fn (string $kind): bool => in_array($kind, ['r', 'p', 'm', 'S'], true))), ['r', 'p', 'v', 'm', 'f', 'S']],
            'database' => [$export->data ?? array_keys($objects), null, ['r', 'p', 'm']],
            default => throw new BadRequestException('A CSV export is of a database, a schema or a relation.'),
        };
        foreach ($export->scope === 'schema' ? $names : ($export->scope === 'database' ? $schemas : []) as $name) {
            if (!array_key_exists($name, $objects)) {
                throw new BadRequestException(sprintf($export->scope === 'schema' ? 'There is no relation "%s".' : 'There is no schema "%s".', $name));
            }
        }

        $rows = $schemas === [] || $names === [] ? [] : $conn->rows(<<<'SQL'
            SELECT n.nspname, c.relname, c.relkind::text AS relkind,
                   array_to_json(ARRAY(SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum))::text AS columns
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname IN (SELECT jsonb_array_elements_text($1::jsonb))
              AND ($2::jsonb IS NULL OR c.relname IN (SELECT jsonb_array_elements_text($2::jsonb)))
              AND c.relkind::text IN (SELECT jsonb_array_elements_text($3::jsonb))
              AND ($2::jsonb IS NOT NULL OR NOT c.relispartition)
            ORDER BY 1, 2
            SQL, [json_encode($schemas), $names === null ? null : json_encode($names), json_encode($kinds)]);

        $skipped = array_map(static fn (array $table): string => $table[0] . '.' . $table[1], $oversized);
        $relations = [];
        foreach ($rows as $row) {
            if (in_array($row['nspname'] . '.' . $row['relname'], $skipped, true)) {
                continue;
            }
            $relations[] = ['schema' => (string) $row['nspname'], 'name' => (string) $row['relname'], 'kind' => (string) $row['relkind'], 'columns' => array_map('strval', (array) json_decode((string) $row['columns'], true))];
        }
        if ($relations === []) {
            throw new ApiException(422, $oversized === [] ? 'There is no data to export: tick a table under Data.' : 'There is no data to export: every table ticked is larger than "Skip tables larger than".');
        }

        return $relations;
    }

    /** @return array<string, string> the databases pg_dumpall dumps, by name */
    private function databases(Connection $conn): array
    {
        $names = array_column($conn->rows("SELECT datname FROM pg_database WHERE datallowconn AND datname <> 'template0' ORDER BY datname"), 'datname');

        return array_fill_keys(array_map('strval', $names), '');
    }

    /** @return array<string, string> the database's own schemas, by name */
    private function schemas(Connection $conn): array
    {
        $names = array_column($conn->rows("SELECT nspname FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' ORDER BY nspname"), 'nspname');

        return array_fill_keys(array_map('strval', $names), '');
    }

    /**
     * The schema's tables, views, materialized views, foreign tables and sequences, with their
     * relkind. Partitions come with their partitioned table and a sequence owned by a column
     * with its table, so neither is listed.
     *
     * @return array<string, string>
     */
    private function relations(Connection $conn, string $schema): array
    {
        if ($conn->scalar('SELECT 1 FROM pg_namespace WHERE nspname = $1', [$schema]) === null) {
            throw new NotFoundException(sprintf('There is no schema "%s".', $schema));
        }
        $rows = $conn->rows(<<<'SQL'
            SELECT c.relname, c.relkind::text AS relkind
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1
              AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
              AND NOT c.relispartition
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i') AND c.relkind = 'S')
            ORDER BY c.relname
            SQL, [$schema]);

        $relations = [];
        foreach ($rows as $row) {
            $relations[(string) $row['relname']] = (string) $row['relkind'];
        }

        return $relations;
    }

    private function relationKind(Connection $conn, string $schema, string $name): ?string
    {
        $kind = $conn->scalar('SELECT c.relkind::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2', [$schema, $name]);

        return $kind === null ? null : (string) $kind;
    }

    /**
     * The tables in the export's scope whose data is over its size limit, with their indexes and
     * TOAST, as phpMyAdmin measures "Skip tables larger than".
     *
     * @return list<array{0: string, 1: string, 2: string}>
     */
    private function oversized(Connection $conn, ExportRequest $export): array
    {
        $rows = $conn->rows(<<<'SQL'
            SELECT n.nspname, c.relname, c.relkind::text AS relkind
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r', 'm')
              AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
              AND ($1::text IS NULL OR n.nspname = $1)
              AND ($2::text IS NULL OR c.relname = $2)
              AND pg_total_relation_size(c.oid) > $3::float8 * 1048576
            ORDER BY 1, 2
            SQL, [$export->schema, $export->table, $export->maxSize]);

        return array_map(static fn (array $row): array => [(string) $row['nspname'], (string) $row['relname'], (string) $row['relkind']], $rows);
    }

    private static function name(array $query, string $key): ?string
    {
        $value = $query[$key] ?? null;

        return is_string($value) && $value !== '' ? $value : null;
    }

    public static function serverKey(): string
    {
        return Authenticate::sessionServer()?->key() ?? '';
    }
}
