<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sql\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Sql\Sql\QueryRunner;
use PhpPgAdmin\Modules\Sql\Sql\Relation;
use PhpPgAdmin\Modules\Sql\Sql\RowEditor;
use PhpPgAdmin\Modules\Sql\Sql\Splitter;
use PhpPgAdmin\Modules\Sql\Storage\QueryHistory;
use PhpPgAdmin\Modules\Sql\Storage\RunningQueries;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Runs SQL for the SQL page and the Browse grid, cancels a running request, describes a
 * relation's columns, reads one row by key and saves the rows the grid or the form changed.
 */
final class QueryController
{
    /**
     * Run a batch. The body carries the options QueryRunner reads: sql, delimiter, request_id,
     * limit, offset, count, order, transaction, rollback, statement_timeout_ms.
     *
     * @param array{db?: string} $args
     * @return array<string, mixed>
     */
    public function run(ServerRequestInterface $request, array $args): array
    {
        $input = (array) ($request->getParsedBody() ?? []);
        $sql = (string) ($input['sql'] ?? '');
        if (Splitter::split($sql, (string) ($input['delimiter'] ?? ';')) === []) {
            throw new BadRequestException('The query is empty.');
        }

        $pool = ConnectionPool::from($request);
        $server = Authenticate::sessionServer()?->key() ?? '';

        // A cancel request for this query must get at the session while this one runs, so the
        // session lock is released before the statements start; nothing below writes to it.
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }

        $runner = new QueryRunner(
            $this->connection($pool, $args),
            $input + ['sql' => $sql],
            QueryHistory::for($server, $pool->username()),
            RunningQueries::for($server, $pool->username()),
        );

        return $runner->run();
    }

    /**
     * Ask the server to cancel the statement a request of this role is running: pgAdmin's
     * cancel_transaction, with pg_cancel_backend from another connection.
     *
     * @return array{ok: bool}
     */
    public function cancel(ServerRequestInterface $request): array
    {
        $input = (array) ($request->getParsedBody() ?? []);
        $requestId = (string) ($input['request_id'] ?? '');
        if ($requestId === '') {
            throw new BadRequestException('A request id is required.');
        }

        $pool = ConnectionPool::from($request);
        $server = Authenticate::sessionServer()?->key() ?? '';
        $pid = RunningQueries::for($server, $pool->username())->backendPid($requestId);
        if ($pid === null) {
            throw new NotFoundException('No running query with that id.');
        }

        return ['ok' => (bool) $pool->maintenance()->scalar('SELECT pg_catalog.pg_cancel_backend($1)', [$pid])];
    }

    /**
     * The columns of a relation named by schema and name: for the SQL page's column list and
     * the insert form.
     *
     * @param array{db: string} $args
     * @return array{relkind: string, primary_keys: list<string>, columns: list<array<string, mixed>>}
     */
    public function columns(ServerRequestInterface $request, array $args): array
    {
        $relation = $this->relation($request, $args, $request->getQueryParams());

        return ['relkind' => $relation->relkind, 'primary_keys' => $relation->primaryKeys(), 'columns' => $relation->columns()];
    }

    /**
     * One row of a table by primary key, as text values, with the columns: what the edit form
     * starts from. "keys" is a JSON object of key column => value.
     *
     * @param array{db: string} $args
     * @return array{columns: list<array<string, mixed>>, primary_keys: list<string>, row: array<string, string|null>}
     */
    public function row(ServerRequestInterface $request, array $args): array
    {
        $query = $request->getQueryParams();
        $relation = $this->relation($request, $args, $query);
        $keys = json_decode((string) ($query['keys'] ?? ''), true);
        if (!is_array($keys) || $keys === []) {
            throw new BadRequestException('The row\'s primary key values are required.');
        }

        $conn = $this->connection(ConnectionPool::from($request), $args);
        $params = [];
        $conditions = [];
        foreach ($relation->primaryKeys() as $key) {
            if (!array_key_exists($key, $keys)) {
                throw new BadRequestException(sprintf('The primary key column "%s" is missing.', $key));
            }
            $params[] = $keys[$key] === null ? null : (string) $keys[$key];
            $conditions[] = $conn->escapeIdentifier($key) . ' = $' . count($params);
        }
        if ($conditions === []) {
            throw new BadRequestException('The table has no primary key.');
        }

        $result = $conn->query(sprintf('SELECT * FROM %s WHERE %s', $relation->quotedName(), implode(' AND ', $conditions)), $params);
        $rows = $result->textRows();
        if ($rows === []) {
            throw new NotFoundException('The row was not found. It may have been deleted by another user.');
        }

        $row = [];
        foreach ($result->columns() as $i => $column) {
            $row[$column->name] = $rows[0][$i];
        }

        return ['columns' => $relation->columns(), 'primary_keys' => $relation->primaryKeys(), 'row' => $row];
    }

    /**
     * Save the grid's or the form's changes: {schema, table, changes: {added, updated, deleted,
     * ignore}}; with "preview" true the statements are returned instead of run.
     *
     * @param array{db: string} $args
     * @return array<string, mixed>
     */
    public function save(ServerRequestInterface $request, array $args): array
    {
        $input = (array) ($request->getParsedBody() ?? []);
        $relation = $this->relation($request, $args, $input);
        $editor = new RowEditor($this->connection(ConnectionPool::from($request), $args), $relation);
        $changes = (array) ($input['changes'] ?? []);

        if (!empty($input['preview'])) {
            return ['sql' => $editor->preview($changes)];
        }

        return ['ok' => true, ...$editor->save($changes)];
    }

    /**
     * Every user schema with its relations and their columns, for the editor's completions:
     * {schemas: [{name, relations: [{name, columns: [name]}]}]}. System schemas are left out.
     *
     * @param array{db: string} $args
     * @return array{schemas: list<array{name: string, relations: list<array{name: string, columns: list<string>}>}>}
     */
    public function catalog(ServerRequestInterface $request, array $args): array
    {
        $rows = $this->connection(ConnectionPool::from($request), $args)->rows(<<<'SQL'
            SELECT n.nspname AS schema, c.relname AS relation,
                   COALESCE((SELECT array_agg(a.attname ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped), '{}') AS columns
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
            ORDER BY n.nspname, c.relname
            SQL);

        $schemas = [];
        foreach ($rows as $row) {
            $columns = (string) $row['columns'];
            $schemas[(string) $row['schema']][] = ['name' => (string) $row['relation'], 'columns' => self::parseArray($columns)];
        }

        return ['schemas' => array_map(static fn (string $name, array $relations): array => ['name' => $name, 'relations' => $relations], array_keys($schemas), $schemas)];
    }

    /**
     * A PostgreSQL text array, '{a,"b c"}', as a list.
     *
     * @return list<string>
     */
    private static function parseArray(string $text): array
    {
        if ($text === '{}' || $text === '') {
            return [];
        }
        preg_match_all('/"((?:[^"\\\\]|\\\\.)*)"|([^,{}]+)/', substr($text, 1, -1), $matches, PREG_SET_ORDER);

        return array_map(static fn (array $m): string => isset($m[2]) && $m[2] !== '' ? $m[2] : stripcslashes($m[1]), $matches);
    }

    /**
     * The relation named by "schema" and "table" (or "name") in the given parameters.
     *
     * @param array{db?: string} $args
     * @param array<string, mixed> $params
     */
    private function relation(ServerRequestInterface $request, array $args, array $params): Relation
    {
        $schema = (string) ($params['schema'] ?? '');
        $name = (string) ($params['table'] ?? $params['name'] ?? '');
        if ($schema === '' || $name === '') {
            throw new BadRequestException('A schema and a relation name are required.');
        }

        return Relation::find($this->connection(ConnectionPool::from($request), $args), $schema, $name);
    }

    /** @param array{db?: string} $args */
    private function connection(ConnectionPool $pool, array $args): Connection
    {
        $db = rawurldecode((string) ($args['db'] ?? ''));

        return $db === '' ? $pool->maintenance() : $pool->for($db);
    }
}
