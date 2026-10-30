<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sql\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Sql\Sql\Relation;
use PhpPgAdmin\Modules\Sql\Storage\QueryHistory;
use Psr\Http\Message\ServerRequestInterface;

/**
 * phpMyAdmin's table "Find and replace" (FindReplaceController): the values of one text column
 * that contain a string, or match a regular expression, beside what they become, and the
 * UPDATE that replaces them. A plain search is case-sensitive, as phpMyAdmin's is with its
 * binary collation; the regular expression is PostgreSQL's (regexp_replace, every match).
 *
 * The body of both calls is {schema, table, column, find, replace_with, use_regex}.
 */
final class FindReplaceController
{
    /** The type class phpMyAdmin offers the columns of: its "CHAR" types, in PostgreSQL. */
    private const array TEXT_TYPES = ['varchar', 'bpchar', 'text', 'citext', 'name'];

    /**
     * The preview (replace_preview.twig): each distinct value found, its replacement and how
     * many rows hold it, with the UPDATE that "Replace" runs.
     *
     * @param array{db: string} $args
     * @return array{rows: list<array{original: string|null, replaced: string|null, count: int}>, sql: string}
     */
    public function preview(ServerRequestInterface $request, array $args): array
    {
        [$conn, $relation, $column, $match, $replaced] = $this->parts($request, $args);

        $rows = $conn->query(sprintf(
            'SELECT %1$s, (%2$s)::text, count(*) FROM %3$s WHERE %4$s GROUP BY %1$s ORDER BY %1$s',
            self::source($column),
            $replaced,
            Quoting::ident($relation->schema, $relation->name),
            $match,
        ))->textRows();

        return [
            'rows' => array_map(static fn (array $row): array => ['original' => $row[0], 'replaced' => $row[1], 'count' => (int) $row[2]], $rows),
            'sql' => self::update($relation, $column, $match, $replaced),
        ];
    }

    /**
     * Replace: run the UPDATE and answer as a statement of the SQL page does, so the page can
     * show phpMyAdmin's success message with the query under it.
     *
     * @param array{db: string} $args
     * @return array{kind: 'command', sql: string, line: int, duration_ms: float, notices: list<string>, affected_rows: int, command_tag: string}
     */
    public function replace(ServerRequestInterface $request, array $args): array
    {
        [$conn, $relation, $column, $match, $replaced] = $this->parts($request, $args);
        $sql = self::update($relation, $column, $match, $replaced);

        $startedAt = gmdate('Y-m-d\TH:i:s\Z');
        $started = hrtime(true);
        $result = $conn->query($sql);
        $duration = (hrtime(true) - $started) / 1e6;

        $pool = ConnectionPool::from($request);
        QueryHistory::for(Authenticate::sessionServer()?->key() ?? '', $pool->username())
            ->record($conn->database(), $sql, 'success', $result->affectedRows(), $duration, $result->commandTag(), $startedAt);

        return [
            'kind' => 'command',
            'sql' => $sql,
            'line' => 1,
            'duration_ms' => $duration,
            'notices' => $result->notices(),
            'affected_rows' => $result->affectedRows(),
            'command_tag' => $result->commandTag(),
        ];
    }

    /**
     * The column as plain text in the default collation, so the search stays case-sensitive:
     * citext has its own case-blind strpos and replace, and a nondeterministic collation
     * refuses substring searches and groups values that differ in case.
     */
    private static function source(string $column): string
    {
        return sprintf('%s::text COLLATE "default"', $column);
    }

    private static function update(Relation $relation, string $column, string $match, string $replaced): string
    {
        return sprintf('UPDATE %s SET %s = %s WHERE %s', Quoting::ident($relation->schema, $relation->name), $column, $replaced, $match);
    }

    /**
     * The connection, the relation, the quoted column, the condition a value must meet and the
     * expression of its replacement, from the body.
     *
     * @param array{db: string} $args
     * @return array{\PhpPgAdmin\Core\Database\Connection, Relation, string, string, string}
     */
    private function parts(ServerRequestInterface $request, array $args): array
    {
        $input = (array) ($request->getParsedBody() ?? []);
        $schema = (string) ($input['schema'] ?? '');
        $table = (string) ($input['table'] ?? '');
        $name = (string) ($input['column'] ?? '');
        $find = (string) ($input['find'] ?? '');
        $replaceWith = (string) ($input['replace_with'] ?? '');
        if ($schema === '' || $table === '') {
            throw new BadRequestException('A schema and a table are required.');
        }
        if ($find === '') {
            throw new BadRequestException('The text to find is required.');
        }

        $conn = ConnectionPool::from($request)->for(rawurldecode($args['db']));
        $relation = Relation::find($conn, $schema, $table);
        $info = $relation->column($name);
        if ($info === null || !in_array($info['type_name'], self::TEXT_TYPES, true)) {
            throw new BadRequestException(sprintf('"%s" is not a text column of %s.%s.', $name, $schema, $table));
        }

        $column = Quoting::ident($name);
        $source = self::source($column);
        if (!empty($input['use_regex'])) {
            $match = sprintf('%s ~ %s', $source, Quoting::literal($find));
            $replaced = sprintf("regexp_replace(%s, %s, %s, 'g')", $source, Quoting::literal($find), Quoting::literal($replaceWith));
        } else {
            $match = sprintf('strpos(%s, %s) > 0', $source, Quoting::literal($find));
            $replaced = sprintf('replace(%s, %s, %s)', $source, Quoting::literal($find), Quoting::literal($replaceWith));
        }

        return [$conn, $relation, $column, $match, $replaced];
    }
}
