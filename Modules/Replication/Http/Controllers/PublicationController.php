<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Replication\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;

/**
 * The publication node, after pgAdmin's PublicationView: the publications of a database with
 * the events they publish and their tables (from PostgreSQL 15 with column lists and row
 * filters) and schemas, and the statements that create, alter and drop one.
 *
 * The client's data carries pgAdmin's field names: name, pubowner, description, all_table,
 * only_table, evnt_insert / evnt_update / evnt_delete / evnt_truncate,
 * publish_via_partition_root, pubtable ([{tid, columns, where}]) and pubschema (names). An
 * update takes the whole form and is compared with the publication as it stands: tables and
 * schemas gone are dropped, new ones added, and a table whose columns or row filter changed is
 * dropped and added again in the same transaction (pgAdmin's SET TABLE would drop the schemas
 * too). Tables and columns are named by the server from their OIDs and attribute names, never
 * taken quoted from the client.
 */
final class PublicationController extends NodeController
{
    private const array EVENTS = ['evnt_insert', 'evnt_update', 'evnt_delete', 'evnt_truncate'];

    public function list(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->withTables($ctx, $this->transform($row)), $ctx->rows('properties.sql'));
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        return $this->withTables($ctx, $this->old($ctx, $oid));
    }

    /** pgAdmin's sql(): the header with the DROP, then CREATE PUBLICATION as it stands. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        $data = $this->withTables($ctx, $this->old($ctx, $oid));

        return Ddl::assemble([
            Ddl::header('Publication', $data['name'], $ctx->render('delete.sql', ['pbid' => null, 'pname' => $data['name']])),
            $ctx->render('create.sql', ['data' => $data]),
        ]);
    }

    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($ctx, $data);
        $this->execute($ctx, $ctx->render('create.sql', ['data' => $data]));
        $oid = $ctx->conn->scalar($ctx->render('get_position.sql', ['pubname' => $data['name']])) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $oid);
    }

    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));

        return $this->node($ctx, $oid);
    }

    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $name = $ctx->conn->scalar($ctx->render('delete.sql', ['pbid' => $oid])) ?? throw $this->gone($ctx);
        $ctx->conn->query(trim($ctx->render('delete.sql', ['pbid' => null, 'pname' => (string) $name, 'cascade' => $cascade])));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        return Ddl::assemble([$oid === null ? $ctx->render('create.sql', ['data' => $this->forCreate($ctx, $data)]) : $this->updateSql($ctx, $oid, $data)]);
    }

    /** A publication by name: resolve('publication', {name}) → {pbid}. */
    public function resolve(NodeContext $ctx, array $params): ?array
    {
        $oid = $ctx->conn->scalar($ctx->render('get_position.sql', ['pubname' => (string) ($params['name'] ?? '')]));

        return $oid === null ? null : ['pbid' => (int) $oid];
    }

    /**
     * What the form offers: pgAdmin's get_tables and get_schemas, the owners, and whether this
     * server takes column lists, row filters and schemas (PostgreSQL 15).
     *
     * @return array{tables: list<array{tid: int, table: string}>, schemas: list<string>, roles: list<string>, version: int}
     */
    public function options(NodeContext $ctx): array
    {
        return [
            'tables' => array_map(static fn (array $row): array => ['tid' => (int) $row['tid'], 'table' => (string) $row['table']], $ctx->rows('get_all_tables.sql')),
            'schemas' => $ctx->version() >= 150000 ? array_column($ctx->rows('get_all_schemas.sql'), 'nspname') : [],
            'roles' => Catalog::roles($ctx->conn),
            'version' => $ctx->version(),
        ];
    }

    /**
     * pgAdmin's get_all_columns: the columns of a table, quoted, for a column list.
     *
     * @return list<string>
     */
    public function columns(NodeContext $ctx, int $tid): array
    {
        return array_column($ctx->rows('get_all_columns.sql', ['tid' => $tid]), 'column');
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function transform(array $row): array
    {
        $row['oid'] = (int) $row['oid'];

        return $row;
    }

    /** @return array<string, mixed> */
    private function old(NodeContext $ctx, int $oid): array
    {
        return $this->transform($ctx->row('properties.sql', ['pbid' => $oid]) ?? throw $this->gone($ctx));
    }

    /**
     * pgAdmin's _fetch_properties: the tables (each with its column list and row filter from
     * PostgreSQL 15) and the schemas, unless the publication is FOR ALL TABLES.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function withTables(NodeContext $ctx, array $row): array
    {
        $row['pubtable'] = [];
        $row['pubschema'] = [];
        if ($row['all_table']) {
            return $row;
        }
        foreach ($ctx->rows('get_tables.sql', ['pbid' => $row['oid']]) as $table) {
            $row['pubtable'][] = [
                'tid' => (int) $table['tid'],
                'table_name' => (string) $table['table_name'],
                'columns' => isset($table['columns']) ? json_decode((string) $table['columns'], true, flags: JSON_THROW_ON_ERROR) : [],
                'where' => isset($table['where']) ? self::unwrap((string) $table['where']) : null,
            ];
        }
        if ($ctx->version() >= 150000) {
            $row['pubschema'] = array_column($ctx->rows('get_pub_schemas.sql', ['pbid' => $row['oid']]), 'sname');
        }

        return $row;
    }

    /**
     * The client's data as create.sql takes it.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function forCreate(NodeContext $ctx, array $data): array
    {
        $create = [
            'name' => $this->requireName($data),
            'pubowner' => self::blankToNull($data['pubowner'] ?? null),
            'description' => self::blankToNull($data['description'] ?? null),
            'all_table' => ($data['all_table'] ?? false) === true,
            'only_table' => ($data['only_table'] ?? false) === true,
            'publish_via_partition_root' => ($data['publish_via_partition_root'] ?? false) === true,
            'pubtable' => [],
            'pubschema' => [],
        ];
        foreach (self::EVENTS as $event) {
            $create[$event] = ($data[$event] ?? true) === true;
        }
        if (!$create['all_table']) {
            $create['pubtable'] = $this->tables($ctx, $data['pubtable'] ?? []);
            $create['pubschema'] = $this->schemas($ctx, $data['pubschema'] ?? []);
        }

        return $create;
    }

    /**
     * update.sql for what the form changes against the publication as it stands.
     *
     * @param array<string, mixed> $data
     */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $old = $this->withTables($ctx, $this->old($ctx, $oid));
        $changes = [
            'name' => trim((string) ($data['name'] ?? '')) ?: $old['name'],
            'pubowner' => self::blankToNull($data['pubowner'] ?? null),
            'description' => array_key_exists('description', $data) ? (string) $data['description'] : null,
            'only_table' => ($data['only_table'] ?? false) === true,
            'publish_via_partition_root' => array_key_exists('publish_via_partition_root', $data) ? $data['publish_via_partition_root'] === true : null,
        ];
        foreach (self::EVENTS as $event) {
            $changes[$event] = array_key_exists($event, $data) ? $data[$event] === true : $old[$event];
        }

        $drop = $add = $dropSchemas = $addSchemas = [];
        if (!$old['all_table']) {
            if (array_key_exists('pubtable', $data)) {
                $was = array_column($old['pubtable'], null, 'tid');
                $new = array_column($this->tables($ctx, $data['pubtable']), null, 'tid');
                foreach ($was as $tid => $table) {
                    $now = $new[$tid] ?? null;
                    if ($now === null || $now['columns'] !== $table['columns'] || (string) $now['where'] !== (string) $table['where']) {
                        $drop[] = $table;
                    }
                }
                foreach ($new as $tid => $table) {
                    $before = $was[$tid] ?? null;
                    if ($before === null || $before['columns'] !== $table['columns'] || (string) $before['where'] !== (string) $table['where']) {
                        $add[] = $table;
                    }
                }
            }
            if (array_key_exists('pubschema', $data)) {
                $schemas = $this->schemas($ctx, $data['pubschema']);
                $dropSchemas = array_values(array_diff($old['pubschema'], $schemas));
                $addSchemas = array_values(array_diff($schemas, $old['pubschema']));
            }
        }

        return $ctx->render('update.sql', [
            'data' => $changes,
            'o_data' => $old,
            'drop_table_data' => $drop,
            'add_table_data' => $add,
            'drop_schema_data' => $dropSchemas,
            'add_schema_data' => $addSchemas,
        ]);
    }

    /**
     * The tables the client chose, each named from its OID by get_all_tables; the column list
     * and row filter are kept from PostgreSQL 15, the columns checked against the table's own.
     *
     * @return list<array{tid: int, table_name: string, columns: list<string>, where: string|null}>
     */
    private function tables(NodeContext $ctx, mixed $tables): array
    {
        $list = [];
        foreach (is_array($tables) ? $tables : [] as $table) {
            $tid = (int) (is_array($table) ? ($table['tid'] ?? 0) : $table);
            if ($tid <= 0 || isset($list[$tid])) {
                continue;
            }
            $name = $ctx->row('get_all_tables.sql', ['tid' => $tid])['table'] ?? throw new BadRequestException(sprintf('There is no table with OID %d to publish.', $tid));
            $columns = [];
            $where = null;
            if ($ctx->version() >= 150000 && is_array($table)) {
                $known = $this->columns($ctx, $tid);
                foreach (is_array($table['columns'] ?? null) ? $table['columns'] : [] as $column) {
                    $column = (string) $column;
                    if (!in_array($column, $known, true)) {
                        throw new BadRequestException(sprintf('%s has no column %s.', $name, $column));
                    }
                    $columns[] = $column;
                }
                $columns = array_values(array_unique($columns));
                $where = self::blankToNull($table['where'] ?? null);
            }
            $list[$tid] = ['tid' => $tid, 'table_name' => (string) $name, 'columns' => $columns, 'where' => $where === null ? null : trim($where)];
        }

        return array_values($list);
    }

    /**
     * The schemas the client chose; TABLES IN SCHEMA needs PostgreSQL 15.
     *
     * @return list<string>
     */
    private function schemas(NodeContext $ctx, mixed $schemas): array
    {
        $schemas = array_values(array_unique(array_filter(array_map(static fn (mixed $s): string => trim((string) $s), is_array($schemas) ? $schemas : []), static fn (string $s): bool => $s !== '')));
        if ($schemas !== [] && $ctx->version() < 150000) {
            throw new BadRequestException('Publishing the tables of a schema needs PostgreSQL 15 or later.');
        }

        return $schemas;
    }

    /** pg_get_expr's "(id > 0)" as the form shows it, "id > 0": the outer parentheses the template adds again. */
    private static function unwrap(string $expression): string
    {
        if (!str_starts_with($expression, '(') || !str_ends_with($expression, ')')) {
            return $expression;
        }
        $depth = 0;
        $quote = null;
        $last = strlen($expression) - 1;
        for ($i = 0; $i <= $last; $i++) {
            $char = $expression[$i];
            if ($quote !== null) {
                $quote = $char === $quote ? null : $quote;
            } elseif ($char === "'" || $char === '"') {
                $quote = $char;
            } elseif ($char === '(') {
                $depth++;
            } elseif ($char === ')' && --$depth === 0 && $i < $last) {
                return $expression;
            }
        }

        return substr($expression, 1, -1);
    }

    private static function blankToNull(mixed $value): ?string
    {
        return $value === null || trim((string) $value) === '' ? null : (string) $value;
    }
}
