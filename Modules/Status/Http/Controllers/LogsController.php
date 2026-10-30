<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Status\Http\Controllers;

use League\Route\Http\Exception\NotFoundException;
use Nyholm\Psr7\Factory\Psr17Factory;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Database\QueryException;
use PhpPgAdmin\Core\Http\ChunkStream;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The server's log files, after pgAdmin's dashboard Logs panel: the files of the log directory
 * (pg_ls_logdir) rather than only pg_current_logfile(), each read with pg_read_binary_file a
 * page at a time and split into entries for the stderr, csvlog and jsonlog formats. A page is
 * about pgAdmin's ON_DEMAND_LOG_COUNT bytes, widened to whole entries, so an entry is never
 * cut between two pages (nor a multi-byte character with it).
 *
 * Listing needs pg_monitor; reading needs pg_read_server_files (or EXECUTE on
 * pg_read_binary_file). PostgreSQL's own permission errors are passed on.
 */
final class LogsController
{
    /** Bytes per page, pgAdmin's ON_DEMAND_LOG_COUNT. */
    private const int PAGE = 10000;

    /** Bytes read at a time while looking for the end of an entry. */
    private const int STEP = 4096;

    /** Bytes after a newline that startsEntry() may look at: the stderr format's log_line_prefix comes first. */
    private const int LOOKAHEAD = 512;

    /** Bytes per pg_read_binary_file call while downloading. */
    private const int DOWNLOAD_CHUNK = 1048576;

    /** The severities that start an entry in the stderr format, and the lines that belong to the entry before. */
    private const string STDERR_LINE = '/^(.*?)\b(DEBUG[1-5]?|INFO|NOTICE|WARNING|ERROR|LOG|FATAL|PANIC|DETAIL|HINT|CONTEXT|STATEMENT|QUERY|LOCATION):  (.*)$/s';

    /** The csvlog columns, in PostgreSQL 13's order; 14 added leader_pid and query_id. */
    private const array CSV_COLUMNS = [
        'log_time', 'user_name', 'database_name', 'process_id', 'connection_from', 'session_id', 'session_line_num', 'command_tag',
        'session_start_time', 'virtual_transaction_id', 'transaction_id', 'error_severity', 'sql_state_code', 'message', 'detail',
        'hint', 'internal_query', 'internal_query_pos', 'context', 'query', 'query_pos', 'location', 'application_name', 'backend_type',
    ];

    /** PostgreSQL's server encodings under their mbstring names, where they differ from UTF-8. */
    private const array ENCODINGS = [
        'LATIN1' => 'ISO-8859-1', 'LATIN2' => 'ISO-8859-2', 'LATIN3' => 'ISO-8859-3', 'LATIN4' => 'ISO-8859-4', 'LATIN5' => 'ISO-8859-9',
        'LATIN6' => 'ISO-8859-10', 'LATIN7' => 'ISO-8859-13', 'LATIN8' => 'ISO-8859-14', 'LATIN9' => 'ISO-8859-15', 'LATIN10' => 'ISO-8859-16',
        'ISO_8859_5' => 'ISO-8859-5', 'ISO_8859_6' => 'ISO-8859-6', 'ISO_8859_7' => 'ISO-8859-7', 'ISO_8859_8' => 'ISO-8859-8',
        'WIN866' => 'CP866', 'WIN874' => 'CP874', 'WIN1250' => 'Windows-1250', 'WIN1251' => 'Windows-1251', 'WIN1252' => 'Windows-1252',
        'WIN1253' => 'Windows-1253', 'WIN1254' => 'Windows-1254', 'WIN1255' => 'Windows-1255', 'WIN1256' => 'Windows-1256',
        'WIN1257' => 'Windows-1257', 'WIN1258' => 'Windows-1258', 'KOI8R' => 'KOI8-R', 'KOI8U' => 'KOI8-U', 'EUC_JP' => 'EUC-JP',
        'EUC_JIS_2004' => 'EUC-JP-2004', 'EUC_KR' => 'EUC-KR', 'EUC_CN' => 'EUC-CN', 'EUC_TW' => 'EUC-TW', 'MULE_INTERNAL' => 'UTF-8',
    ];

    /**
     * The logging settings and the files of the log directory, newest first, each with its
     * format (by extension, as PostgreSQL names them) and whether the server is writing to it.
     * A directory that does not exist (logging_collector never on) has no files.
     *
     * @return array{collector: bool, destination: string, directory: string, files: list<array<string, mixed>>}
     */
    public function index(ServerRequestInterface $request): array
    {
        $conn = ConnectionPool::from($request)->maintenance();
        $settings = $conn->row("SELECT pg_catalog.current_setting('logging_collector') = 'on' AS collector, pg_catalog.current_setting('log_destination') AS destination, pg_catalog.current_setting('log_directory') AS directory") ?? [];

        try {
            $rows = $conn->rows("SELECT name, size, EXTRACT(EPOCH FROM modification)::float8 AS modification FROM pg_catalog.pg_ls_logdir() ORDER BY modification DESC, name DESC");
            $current = $rows === [] ? [] : $this->currentFiles($conn);
        } catch (QueryException $e) {
            if ($e->sqlstate !== '58P01') {
                throw $e;
            }
            $rows = $current = [];
        }

        return [
            'collector' => (bool) $settings['collector'],
            'destination' => (string) $settings['destination'],
            'directory' => (string) $settings['directory'],
            'files' => array_map(static fn (array $row): array => [
                'name' => $row['name'],
                'size' => (int) $row['size'],
                'modification' => (float) $row['modification'],
                'format' => self::format($row['name']),
                'current' => in_array($row['name'], $current, true),
            ], $rows),
        ];
    }

    /**
     * A page of one log file. "offset" reads the page starting there (0 by default), "before"
     * the page that ends there (the file's size for the last page); either way the page is
     * widened to whole entries, and "start" / "end" give the byte range it covers, from which
     * the client asks for the page before (before=start) or after (offset=end). "plain" returns
     * the text as it is in the file instead of entries.
     *
     * @return array<string, mixed>
     */
    public function show(ServerRequestInterface $request, array $args): array
    {
        $query = $request->getQueryParams();
        $conn = ConnectionPool::from($request)->maintenance();
        [$path, $size, $format] = $this->file($conn, (string) $args['name']);

        if (isset($query['before'])) {
            $end = min(max((int) $query['before'], 0), $size);
            $start = $this->startBefore($conn, $path, $size, $format, $end);
        } else {
            $start = $this->boundaryFrom($conn, $path, $size, $format, min(max((int) ($query['offset'] ?? 0), 0), $size));
            $end = $this->endAfter($conn, $path, $size, $format, $start);
        }
        $text = $this->decode($conn, $this->read($conn, $path, $start, $end - $start));

        return [
            'name' => (string) $args['name'],
            'format' => $format,
            'size' => $size,
            'start' => $start,
            'end' => $end,
            ...(($query['plain'] ?? '') === '1' ? ['text' => $text] : ['entries' => $this->entries($text, $format)]),
        ];
    }

    /**
     * The whole file, as an attachment, read a megabyte at a time while the response is sent:
     * on a connection of its own, since the request's connections close before the body goes out.
     * No Content-Length: a log truncated on rotation while it is read ends the body early.
     */
    public function download(ServerRequestInterface $request, array $args): ResponseInterface
    {
        $pool = ConnectionPool::from($request);
        $name = (string) $args['name'];
        [$path, $size, $format] = $this->file($pool->maintenance(), $name);

        $conn = $pool->detached();
        $offset = 0;
        $body = new ChunkStream(function () use ($conn, $path, $size, &$offset): ?string {
            if ($offset >= $size) {
                return null;
            }
            @set_time_limit(60);
            $chunk = $this->read($conn, $path, $offset, min(self::DOWNLOAD_CHUNK, $size - $offset));
            if ($chunk === '') {
                return null;
            }
            $offset += strlen($chunk);

            return $chunk;
        }, $conn->close(...));

        $factory = new Psr17Factory();

        return $factory->createResponse()
            ->withHeader('Content-Type', match ($format) { 'csvlog' => 'text/csv', 'jsonlog' => 'application/x-ndjson', default => 'text/plain' })
            ->withHeader('Content-Disposition', sprintf('attachment; filename="%s"', addcslashes($name, '"\\')))
            ->withBody($body);
    }

    /** csvlog and jsonlog files carry their own extension; every other file is read as stderr output. */
    private static function format(string $name): string
    {
        return match (strtolower(pathinfo($name, PATHINFO_EXTENSION))) {
            'csv' => 'csvlog',
            'json' => 'jsonlog',
            default => 'stderr',
        };
    }

    /**
     * The names of the files the server is writing to, one per destination with a file.
     *
     * @return list<string>
     */
    private function currentFiles(Connection $conn): array
    {
        // jsonlog is a destination from PostgreSQL 15 on; asking an older server for it is an error.
        $sql = "SELECT pg_catalog.pg_current_logfile('stderr') AS stderr, pg_catalog.pg_current_logfile('csvlog') AS csvlog";
        if ($conn->version() >= 150000) {
            $sql .= ", pg_catalog.pg_current_logfile('jsonlog') AS jsonlog";
        }
        $row = $conn->row($sql) ?? [];

        return array_values(array_map(basename(...), array_filter($row, static fn (?string $path): bool => $path !== null)));
    }

    /**
     * The path pg_read_binary_file takes for a file of the log directory (relative to the data
     * directory unless log_directory is absolute), its size and format. Only a file
     * pg_ls_logdir lists can be read, so the name cannot reach outside the directory.
     *
     * @return array{string, int, string}
     */
    private function file(Connection $conn, string $name): array
    {
        $size = $conn->scalar('SELECT size FROM pg_catalog.pg_ls_logdir() WHERE name = $1', [$name])
            ?? throw new NotFoundException(sprintf('There is no log file "%s".', $name));
        $directory = rtrim((string) $conn->scalar("SELECT pg_catalog.current_setting('log_directory')"), '/');

        return [$directory . '/' . $name, (int) $size, self::format($name)];
    }

    /** $length bytes from $offset, as they are in the file. */
    private function read(Connection $conn, string $path, int $offset, int $length): string
    {
        if ($length <= 0) {
            return '';
        }

        return (string) hex2bin((string) $conn->scalar('SELECT encode(pg_catalog.pg_read_binary_file($1, $2, $3), \'hex\')', [$path, $offset, $length]));
    }

    /** Whether an entry begins at $i of $data, the byte after a newline. */
    private static function startsEntry(string $data, int $i, string $format): bool
    {
        return match ($format) {
            // A stderr entry's continuation lines are indented with a tab, and its DETAIL,
            // HINT, CONTEXT, STATEMENT and QUERY come on lines of their own.
            'stderr' => $data[$i] !== "\t" && preg_match('/\G[^\n]*?\b(?:DETAIL|HINT|CONTEXT|STATEMENT|QUERY|LOCATION):  /', $data, offset: $i) !== 1,
            // A csvlog record starts with its log_time; a quoted message may hold newlines.
            'csvlog' => preg_match('/\G\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/', $data, offset: $i) === 1,
            default => true,
        };
    }

    /**
     * The first entry boundary at or after $offset: $offset itself when an entry starts there,
     * the file's end when none does.
     */
    private function boundaryFrom(Connection $conn, string $path, int $size, string $format, int $offset): int
    {
        if ($offset === 0 || $offset >= $size) {
            return $offset;
        }
        // Read from the byte before, so a newline right before $offset is seen; keep enough of
        // the previous step to test the line after a newline that ends one.
        $base = $offset - 1;
        $data = '';
        $search = 0;
        while ($base + strlen($data) < $size) {
            $chunk = $this->read($conn, $path, $base + strlen($data), self::STEP);
            if ($chunk === '') {
                break;
            }
            $data .= $chunk;
            while (($i = strpos($data, "\n", $search)) !== false) {
                if ($i + self::LOOKAHEAD > strlen($data) && $base + strlen($data) < $size) {
                    break;
                }
                if ($i + 1 === strlen($data) || self::startsEntry($data, $i + 1, $format)) {
                    return $base + $i + 1;
                }
                $search = $i + 1;
            }
        }

        return $size;
    }

    /** Where the page that starts at $start ends: the first boundary after PAGE bytes, or the file's end. */
    private function endAfter(Connection $conn, string $path, int $size, string $format, int $start): int
    {
        return $start + self::PAGE >= $size ? $size : $this->boundaryFrom($conn, $path, $size, $format, $start + self::PAGE);
    }

    /**
     * Where the page that ends at $end starts: the first boundary after $end - PAGE, reaching
     * further back while a single entry is longer than that.
     */
    private function startBefore(Connection $conn, string $path, int $size, string $format, int $end): int
    {
        for ($back = self::PAGE; ; $back *= 2) {
            if ($end - $back <= 0) {
                return 0;
            }
            $start = $this->boundaryFrom($conn, $path, $size, $format, $end - $back);
            if ($start < $end) {
                return $start;
            }
        }
    }

    /** The bytes in UTF-8, from the server encoding the log is written in; invalid bytes become U+FFFD. */
    private function decode(Connection $conn, string $data): string
    {
        $encoding = self::ENCODINGS[(string) $conn->scalar("SELECT pg_catalog.current_setting('server_encoding')")] ?? 'UTF-8';
        if ($encoding !== 'UTF-8') {
            $data = (string) mb_convert_encoding($data, 'UTF-8', $encoding);
        }

        return mb_scrub($data, 'UTF-8');
    }

    /**
     * The entries of a page: time (or, in the stderr format, the whole log_line_prefix),
     * severity and message, with the detail, hint, context and statement the server wrote,
     * and for csvlog and jsonlog the process, user, database and application.
     *
     * @return list<array<string, mixed>>
     */
    private function entries(string $text, string $format): array
    {
        $lines = explode("\n", rtrim($text, "\n"));
        if ($lines === ['']) {
            return [];
        }

        return match ($format) {
            'jsonlog' => array_values(array_filter(array_map(self::jsonEntry(...), $lines))),
            'csvlog' => $this->csvEntries($text),
            default => $this->stderrEntries($lines),
        };
    }

    /** @return array<string, mixed>|null */
    private static function jsonEntry(string $line): ?array
    {
        $row = json_decode($line, true);
        if (!is_array($row)) {
            return $line === '' ? null : self::entry(['message' => $line]);
        }

        return self::entry([
            'time' => $row['timestamp'] ?? null,
            'severity' => $row['error_severity'] ?? null,
            'message' => $row['message'] ?? null,
            'detail' => $row['detail'] ?? null,
            'hint' => $row['hint'] ?? null,
            'context' => $row['context'] ?? null,
            'statement' => $row['statement'] ?? null,
            'sqlstate' => $row['state_code'] ?? null,
            'pid' => $row['pid'] ?? null,
            'user' => $row['user'] ?? null,
            'database' => $row['dbname'] ?? null,
            'application' => $row['application_name'] ?? null,
            'backend_type' => $row['backend_type'] ?? null,
        ]);
    }

    /** @return list<array<string, mixed>> */
    private function csvEntries(string $text): array
    {
        $stream = fopen('php://memory', 'r+');
        fwrite($stream, $text);
        rewind($stream);
        $entries = [];
        while (($fields = fgetcsv($stream, escape: '')) !== false) {
            if ($fields === [null]) {
                continue;
            }
            $row = array_combine(array_slice(self::CSV_COLUMNS, 0, min(count($fields), count(self::CSV_COLUMNS))), array_slice($fields, 0, count(self::CSV_COLUMNS)));
            $entries[] = self::entry([
                'time' => $row['log_time'] ?? null,
                'severity' => $row['error_severity'] ?? null,
                'message' => $row['message'] ?? null,
                'detail' => $row['detail'] ?? null,
                'hint' => $row['hint'] ?? null,
                'context' => $row['context'] ?? null,
                'statement' => $row['query'] ?? null,
                'sqlstate' => $row['sql_state_code'] ?? null,
                'pid' => isset($row['process_id']) && $row['process_id'] !== '' ? (int) $row['process_id'] : null,
                'user' => $row['user_name'] ?? null,
                'database' => $row['database_name'] ?? null,
                'application' => $row['application_name'] ?? null,
                'backend_type' => $row['backend_type'] ?? null,
            ]);
        }
        fclose($stream);

        return $entries;
    }

    /**
     * pgAdmin's reading of the stderr format: a line with a severity starts an entry, its
     * prefix being the text before; DETAIL, HINT, CONTEXT, STATEMENT and QUERY lines, and
     * lines indented with a tab, belong to the entry before.
     *
     * @param list<string> $lines
     * @return list<array<string, mixed>>
     */
    private function stderrEntries(array $lines): array
    {
        $entries = [];
        $last = null;
        foreach ($lines as $line) {
            if (str_starts_with($line, "\t") && $last !== null) {
                $entries[$last][$entries[$last]['continues']] .= "\n" . substr($line, 1);
                continue;
            }
            if (preg_match(self::STDERR_LINE, $line, $match) !== 1) {
                $entries[] = [...self::entry(['message' => $line]), 'continues' => 'message'];
                $last = array_key_last($entries);
                continue;
            }
            [, $prefix, $severity, $message] = $match;
            $field = match ($severity) {
                'DETAIL' => 'detail',
                'HINT' => 'hint',
                'CONTEXT' => 'context',
                'STATEMENT', 'QUERY' => 'statement',
                'LOCATION' => 'location',
                default => null,
            };
            if ($field !== null && $last !== null) {
                $entries[$last][$field] = $message;
                $entries[$last]['continues'] = $field;
                continue;
            }
            $entries[] = [...self::entry(['time' => rtrim($prefix), 'severity' => $severity, 'message' => $message]), 'continues' => 'message'];
            $last = array_key_last($entries);
        }

        return array_map(static function (array $entry): array {
            unset($entry['continues'], $entry['location']);

            return $entry;
        }, $entries);
    }

    /**
     * An entry with every field present, empty strings read as null.
     *
     * @param array<string, mixed> $fields
     * @return array<string, mixed>
     */
    private static function entry(array $fields): array
    {
        $entry = [];
        foreach (['time', 'severity', 'message', 'detail', 'hint', 'context', 'statement', 'sqlstate', 'pid', 'user', 'database', 'application', 'backend_type'] as $key) {
            $value = $fields[$key] ?? null;
            $entry[$key] = $value === '' ? null : $value;
        }

        return $entry;
    }
}
