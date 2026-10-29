<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Search\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Database\QueryException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Facades\Sql;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The database's Search tab. GET …/search/options lists the relations to search in and the
 * object types; POST …/search/data is phpMyAdmin's Database\Search, counting the rows of each
 * relation in which a column holds the words; POST …/search/objects is pgAdmin's
 * search_objects tool, the objects whose name holds the text, of one type or of any.
 */
final class SearchController
{
    /** phpMyAdmin's criteriaSearchType: at least one word, all words, the phrase as a substring, as the whole field, a regular expression. */
    public const array SEARCH_TYPES = [1, 2, 3, 4, 5];

    /**
     * pgAdmin's search_objects node types, with its labels for the types that have no node
     * here yet; the others take the label of their node.
     */
    private const array OBJECT_TYPES = [
        'schema' => 'Schemas', 'table' => 'Tables', 'partition' => 'Partitions', 'column' => 'Columns',
        'view' => 'Views', 'mview' => 'Materialized Views', 'sequence' => 'Sequences', 'index' => 'Indexes',
        'constraints' => 'Constraints', 'primary_key' => 'Primary Key', 'unique_constraint' => 'Unique Constraints',
        'foreign_key' => 'Foreign Keys', 'check_constraint' => 'Check Constraints', 'exclusion_constraint' => 'Exclusion Constraints',
        'trigger' => 'Triggers', 'rule' => 'Rules', 'row_security_policy' => 'RLS Policies',
        'function' => 'Functions', 'procedure' => 'Procedures', 'trigger_function' => 'Trigger Functions',
        'aggregate' => 'Aggregates', 'operator' => 'Operators', 'type' => 'Types', 'domain' => 'Domains',
        'domain_constraints' => 'Domain Constraints', 'collation' => 'Collations',
        'fts_configuration' => 'FTS Configurations', 'fts_dictionary' => 'FTS Dictionaries', 'fts_parser' => 'FTS Parsers', 'fts_template' => 'FTS Templates',
        'foreign_table' => 'Foreign Tables', 'foreign_data_wrapper' => 'Foreign Data Wrappers', 'foreign_server' => 'Foreign Servers', 'user_mapping' => 'User Mappings',
        'extension' => 'Extensions', 'language' => 'Languages', 'cast' => 'Casts', 'event_trigger' => 'Event Triggers',
        'publication' => 'Publications', 'subscription' => 'Subscriptions',
    ];

    /** pgAdmin's DATABASE_LAST_SYSTEM_OID: casts with lower OIDs are the system's. */
    private const int LAST_SYSTEM_OID = 16383;

    /** @return array{relations: list<array{schema: string, name: string, kind: string}>, object_types: list<array{type: string, label: string, icon: string|null}>} */
    public function options(ServerRequestInterface $request, array $args): array
    {
        $conn = $this->connection($request, $args);

        return ['relations' => $this->relations($conn), 'object_types' => self::objectTypes()];
    }

    /**
     * phpMyAdmin's search of the data: for each relation chosen, the number of rows in which a
     * column (or the column named) matches, with the SELECT and DELETE that show and remove them.
     *
     * A relation the search fails in (a type without a text cast, a permission it lacks) is
     * reported with its error, and the search goes on with the next one.
     *
     * @return array{results: list<array{schema: string, name: string, kind: string, count: int, select: string, delete: string|null, error: string|null}>, total: int}
     */
    public function data(ServerRequestInterface $request, array $args): array
    {
        $input = (array) ($request->getParsedBody() ?? []);
        $text = (string) ($input['text'] ?? '');
        if (trim($text) === '') {
            throw new BadRequestException('Enter the words or values to search for.');
        }
        $type = (int) ($input['type'] ?? 1);
        if (!in_array($type, self::SEARCH_TYPES, true)) {
            throw new BadRequestException('The search type is 1 to 5.');
        }
        $chosen = is_array($input['relations'] ?? null) ? $input['relations'] : [];
        if ($chosen === []) {
            throw new BadRequestException('Select at least one table to search in.');
        }
        $column = is_string($input['column'] ?? null) && trim($input['column']) !== '' ? trim($input['column']) : null;

        $conn = $this->connection($request, $args);
        $known = [];
        foreach ($this->relations($conn) as $relation) {
            $known[$relation['schema'] . "\0" . $relation['name']] = $relation;
        }

        $results = [];
        $total = 0;
        foreach ($chosen as $entry) {
            $relation = is_array($entry) ? ($known[($entry['schema'] ?? '') . "\0" . ($entry['name'] ?? '')] ?? null) : null;
            if ($relation === null) {
                continue;
            }
            $columns = array_column($conn->rows(
                'SELECT attname FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped' . ($column !== null ? ' AND attname = $2' : '') . ' ORDER BY attnum',
                $column !== null ? [Quoting::ident($relation['schema'], $relation['name']), $column] : [Quoting::ident($relation['schema'], $relation['name'])],
            ), 'attname');
            $name = Quoting::ident($relation['schema'], $relation['name']);
            $where = self::where($text, $type, $columns);
            $error = null;
            try {
                $count = $where === null ? 0 : (int) $conn->scalar("SELECT count(*) FROM {$name} WHERE {$where}");
            } catch (QueryException $e) {
                $count = 0;
                $error = $e->getMessage();
            }
            $total += $count;
            $results[] = $relation + [
                'count' => $count,
                'select' => $where === null ? '' : "SELECT * FROM {$name} WHERE {$where}",
                // Rows are deleted from a table; a view or a materialized view is left to the user.
                'delete' => $where === null || !in_array($relation['kind'], ['r', 'p'], true) ? null : "DELETE FROM {$name} WHERE {$where}",
                'error' => $error,
            ];
        }

        return ['results' => $results, 'total' => $total];
    }

    /**
     * pgAdmin's search of the objects: those whose name holds the text, in pgAdmin's order,
     * each with its type, its path of schema, relation and so on, and pgAdmin's catalog level
     * (N for the user's schemas, D for pg_catalog, O for information_schema).
     *
     * @return array{results: list<array{name: string, type: string, path: list<array{type: string, oid: int, name: string}>, other_info: string|null, catalog_level: string}>}
     */
    public function objects(ServerRequestInterface $request, array $args): array
    {
        $input = (array) ($request->getParsedBody() ?? []);
        $text = (string) ($input['text'] ?? '');
        if (mb_strlen(trim($text)) < 3) {
            throw new BadRequestException('Enter at least three characters of the name.');
        }
        $type = is_string($input['type'] ?? null) && $input['type'] !== '' ? $input['type'] : 'all';
        if ($type !== 'all' && !isset(self::OBJECT_TYPES[$type])) {
            throw new BadRequestException(sprintf('"%s" is not a type of object.', $type));
        }
        $conn = $this->connection($request, $args);

        // Without SELECT on pg_subscription the subscriptions are left out, as pgAdmin does.
        $skip = [];
        if ($type === 'all' && !(bool) $conn->scalar("SELECT has_table_privilege('pg_catalog.pg_subscription', 'SELECT')")) {
            $skip['subscription'] = true;
        }
        $sql = Sql::render('search_objects', 'search.sql', [
            'search_text' => str_replace("'", "''", mb_strtolower($text)),
            'obj_type' => $type,
            'show_system_objects' => filter_var($input['system'] ?? false, FILTER_VALIDATE_BOOL),
            'show_node_prefs' => array_fill_keys(array_keys(self::OBJECT_TYPES), 'true'),
            'last_system_oid' => self::LAST_SYSTEM_OID,
            'skip_obj_type' => $skip,
        ], $conn->version());

        return ['results' => array_map(static fn (array $row): array => [
            'name' => (string) $row['obj_name'],
            'type' => (string) $row['obj_type'],
            'path' => self::path((string) $row['obj_path']),
            'other_info' => $row['other_info'] === null ? null : (string) $row['other_info'],
            'catalog_level' => (string) $row['catalog_level'],
        ], $conn->rows($sql))];
    }

    /**
     * phpMyAdmin's Search::getWhereClause, for PostgreSQL: each column read as text and matched
     * without regard to case (ILIKE, ~*), as MySQL's case-insensitive collations match. The
     * text takes the database's default collation, since a column's nondeterministic one
     * supports neither ILIKE nor regular expressions.
     *
     * @param list<string> $columns
     */
    public static function where(string $text, int $type, array $columns): ?string
    {
        if ($columns === []) {
            return null;
        }
        $cast = array_map(static fn (string $c): string => Quoting::ident($c) . '::text COLLATE "default"', $columns);
        $any = static fn (string $op, string $pattern): string => '(' . implode(' OR ', array_map(static fn (string $c): string => "{$c} {$op} " . Quoting::literal($pattern), $cast)) . ')';

        if ($type === 1 || $type === 2) {
            $words = array_values(array_filter(explode(' ', $text), static fn (string $w): bool => $w !== ''));
            $parts = array_map(static fn (string $word): string => $any('ILIKE', '%' . $word . '%'), $words);

            return '(' . implode($type === 1 ? ' OR ' : ' AND ', $parts) . ')';
        }

        return match ($type) {
            3 => $any('ILIKE', '%' . $text . '%'),
            4 => $any('ILIKE', $text),
            default => $any('~*', $text),
        };
    }

    /** @return list<array{type: string, label: string, icon: string|null}> */
    private static function objectTypes(): array
    {
        $types = [];
        foreach (self::OBJECT_TYPES as $type => $label) {
            $node = Nodes::find($type);
            $types[] = ['type' => $type, 'label' => $node !== null && $node->label !== '' ? $node->label : $label, 'icon' => $node?->icon ?: null];
        }

        return $types;
    }

    /**
     * pgAdmin's object path, ":schema.2200:/public/:table.16384:/t/:column.3:/c", as the nodes
     * from the outermost in.
     *
     * @return list<array{type: string, oid: int, name: string}>
     */
    private static function path(string $path): array
    {
        preg_match_all('#:([a-z_]+)\.(\d+):/([^/]*)#', $path, $matches, PREG_SET_ORDER);

        return array_map(static fn (array $m): array => ['type' => $m[1], 'oid' => (int) $m[2], 'name' => $m[3]], $matches);
    }

    /** @return list<array{schema: string, name: string, kind: string}> the user's tables, views and materialized views, partitions left to their parent */
    private function relations(Connection $conn): array
    {
        return $conn->rows(<<<'SQL'
            SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS kind
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND NOT c.relispartition
              AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
            ORDER BY 1, 2
            SQL);
    }

    private function connection(ServerRequestInterface $request, array $args): Connection
    {
        return ConnectionPool::from($request)->for(rawurldecode((string) ($args['db'] ?? '')));
    }
}
