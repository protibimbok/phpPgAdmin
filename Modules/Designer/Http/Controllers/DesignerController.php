<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Designer\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Database\QueryException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Http\ApiException;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\Options;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Designer\Storage\DesignerPages;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The Designer's backend, phpMyAdmin's database/designer with pgAdmin's ERD: the diagram of a
 * database (its tables, views and foreign tables with their columns, and the foreign keys
 * between them), a relation made or dropped, the role's saved pages, and the CREATE statements
 * of the tables a diagram shows.
 */
final class DesignerController
{
    /** The actions a foreign key takes, as ON DELETE / ON UPDATE spell them. */
    private const array ACTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'];

    /**
     * Every relation of the user's schemas with its columns (the primary key's marked) and the
     * foreign keys that leave it.
     *
     * @return array{tables: list<array<string, mixed>>, schemas: list<string>}
     */
    public function diagram(ServerRequestInterface $request, array $args): array
    {
        $conn = $this->connection($request, $args);
        $tables = [];
        foreach ($conn->rows(<<<'SQL'
            SELECT c.oid, n.nspname AS schema, c.relname AS name, c.relkind::text AS kind, pg_catalog.obj_description(c.oid, 'pg_class') AS comment
            FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND NOT c.relispartition
              AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
            ORDER BY 2, 3
            SQL) as $row) {
            $tables[(int) $row['oid']] = ['oid' => (int) $row['oid'], 'schema' => (string) $row['schema'], 'name' => (string) $row['name'], 'kind' => (string) $row['kind'], 'comment' => $row['comment'], 'columns' => [], 'foreign_keys' => []];
        }
        if ($tables !== []) {
            $oids = '{' . implode(',', array_keys($tables)) . '}';
            foreach ($conn->rows(<<<'SQL'
                SELECT a.attrelid, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
                       EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = a.attrelid AND k.contype = 'p' AND a.attnum = ANY (k.conkey)) AS pk,
                       t.typcategory::text AS category
                FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
                WHERE a.attrelid = ANY ($1::oid[]) AND a.attnum > 0 AND NOT a.attisdropped
                ORDER BY a.attrelid, a.attnum
                SQL, [$oids]) as $row) {
                $tables[(int) $row['attrelid']]['columns'][] = ['name' => (string) $row['attname'], 'type' => (string) $row['type'], 'not_null' => (bool) $row['attnotnull'], 'pk' => (bool) $row['pk'], 'category' => (string) $row['category']];
            }
            foreach ($conn->rows(<<<'SQL'
                SELECT c.conname, c.conrelid, c.confrelid, c.confdeltype::text AS on_delete, c.confupdtype::text AS on_update,
                       ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(n, i) JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n ORDER BY k.i) AS columns,
                       ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(n, i) JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n ORDER BY k.i) AS ref_columns
                FROM pg_catalog.pg_constraint c
                WHERE c.contype = 'f' AND c.conrelid = ANY ($1::oid[]) AND c.confrelid = ANY ($1::oid[])
                ORDER BY c.conname
                SQL, [$oids]) as $row) {
                $tables[(int) $row['conrelid']]['foreign_keys'][] = [
                    'name' => (string) $row['conname'],
                    'columns' => Options::list($row['columns']),
                    'ref_oid' => (int) $row['confrelid'],
                    'ref_columns' => Options::list($row['ref_columns']),
                    'on_delete' => self::action((string) $row['on_delete']),
                    'on_update' => self::action((string) $row['on_update']),
                ];
            }
        }

        return ['tables' => array_values($tables), 'schemas' => array_values(array_unique(array_column($tables, 'schema')))];
    }

    /**
     * phpMyAdmin's "Create relationship": ALTER TABLE … ADD FOREIGN KEY from a column of one
     * table to a column of another, with the actions chosen.
     *
     * @return array{ok: true, sql: string}
     */
    public function createRelation(ServerRequestInterface $request, array $args): array
    {
        $conn = $this->connection($request, $args);
        $body = (array) ($request->getParsedBody() ?? []);
        $str = static fn (string $key): string => trim((string) ($body[$key] ?? ''));
        foreach (['schema', 'table', 'column', 'ref_schema', 'ref_table', 'ref_column'] as $key) {
            if ($str($key) === '') {
                throw new BadRequestException('A relation joins a column of one table to a column of another.');
            }
        }
        $onDelete = strtoupper($str('on_delete') ?: 'NO ACTION');
        $onUpdate = strtoupper($str('on_update') ?: 'NO ACTION');
        if (!in_array($onDelete, self::ACTIONS, true) || !in_array($onUpdate, self::ACTIONS, true)) {
            throw new BadRequestException('ON DELETE and ON UPDATE take NO ACTION, RESTRICT, CASCADE, SET NULL or SET DEFAULT.');
        }
        $sql = sprintf(
            'ALTER TABLE %s ADD FOREIGN KEY (%s) REFERENCES %s (%s) ON UPDATE %s ON DELETE %s;',
            Quoting::ident($str('schema'), $str('table')),
            Quoting::ident($str('column')),
            Quoting::ident($str('ref_schema'), $str('ref_table')),
            Quoting::ident($str('ref_column')),
            $onUpdate,
            $onDelete,
        );
        if (filter_var($body['preview'] ?? false, FILTER_VALIDATE_BOOL)) {
            return ['ok' => true, 'sql' => $sql];
        }
        $this->run($conn, $sql);

        return ['ok' => true, 'sql' => $sql];
    }

    /** @return array{ok: true, sql: string} the relation dropped: ALTER TABLE … DROP CONSTRAINT */
    public function dropRelation(ServerRequestInterface $request, array $args): array
    {
        $conn = $this->connection($request, $args);
        $body = (array) ($request->getParsedBody() ?? []);
        $schema = trim((string) ($body['schema'] ?? ''));
        $table = trim((string) ($body['table'] ?? ''));
        $name = trim((string) ($body['name'] ?? ''));
        if ($schema === '' || $table === '' || $name === '') {
            throw new BadRequestException('Name the relation to drop and its table.');
        }
        $sql = sprintf('ALTER TABLE %s DROP CONSTRAINT %s;', Quoting::ident($schema, $table), Quoting::ident($name));
        $this->run($conn, $sql);

        return ['ok' => true, 'sql' => $sql];
    }

    /**
     * pgAdmin's ERD "Generate SQL": the CREATE statements of the tables given, as their SQL tabs
     * write them, the referenced before those that reference them.
     *
     * @return array{sql: string}
     */
    public function sql(ServerRequestInterface $request, array $args): array
    {
        $pool = ConnectionPool::from($request);
        $conn = $this->connection($request, $args);
        $body = (array) ($request->getParsedBody() ?? []);
        $oids = array_values(array_unique(array_map('intval', is_array($body['tables'] ?? null) ? $body['tables'] : [])));
        if ($oids === []) {
            throw new BadRequestException('Show at least one table.');
        }
        $rows = $conn->rows("SELECT c.oid, c.relnamespace, c.relkind::text AS kind FROM pg_catalog.pg_class c WHERE c.oid = ANY (\$1::oid[])", ['{' . implode(',', $oids) . '}']);
        $references = [];
        foreach ($conn->rows("SELECT conrelid, confrelid FROM pg_catalog.pg_constraint WHERE contype = 'f' AND conrelid = ANY (\$1::oid[]) AND confrelid <> conrelid", ['{' . implode(',', $oids) . '}']) as $row) {
            $references[(int) $row['conrelid']][] = (int) $row['confrelid'];
        }
        $ordered = [];
        $visit = static function (int $oid, array $seen) use (&$visit, &$ordered, $references, $oids): void {
            if (in_array($oid, $ordered, true) || in_array($oid, $seen, true)) {
                return;
            }
            foreach ($references[$oid] ?? [] as $ref) {
                if (in_array($ref, $oids, true)) {
                    $visit($ref, [...$seen, $oid]);
                }
            }
            $ordered[] = $oid;
        };
        foreach (array_column($rows, 'oid') as $oid) {
            $visit((int) $oid, []);
        }

        $byOid = array_column($rows, null, 'oid');
        $types = ['r' => 'table', 'p' => 'table', 'v' => 'view', 'm' => 'mview', 'f' => 'foreign_table'];
        $parts = [];
        foreach ($ordered as $oid) {
            $row = $byOid[$oid];
            $node = Nodes::find($types[$row['kind']] ?? '');
            if ($node === null) {
                continue;
            }
            // The route ids a table's own SQL tab has: its policies and rules resolve their table from "tid" (a view's from "vid").
            $ctx = new NodeContext($node, Nodes::registry(), $pool, $conn, $conn->database(), ['scid' => (int) $row['relnamespace'], $node->idParam => $oid], $request);
            $parts[] = (new ($node->controller)())->sql($ctx, $oid);
        }

        return ['sql' => implode("\n\n", $parts)];
    }

    /** @return array{pages: list<array<string, mixed>>} */
    public function pages(ServerRequestInterface $request, array $args): array
    {
        return ['pages' => $this->pageStore($request)->all(self::database($args))];
    }

    /** @return array{page: array<string, mixed>} a page saved under its name, replacing one of that name */
    public function savePage(ServerRequestInterface $request, array $args): array
    {
        $body = (array) ($request->getParsedBody() ?? []);
        $name = trim((string) ($body['name'] ?? ''));
        if ($name === '' || mb_strlen($name) > 100) {
            throw new BadRequestException('Give the page a name of up to 100 characters.');
        }
        $layout = is_array($body['layout'] ?? null) ? $body['layout'] : [];
        $store = $this->pageStore($request);
        $id = $store->save(self::database($args), $name, $layout);

        return ['page' => $store->find($id) ?? throw new \LogicException('The page just saved is gone.')];
    }

    /** @return array{ok: true} */
    public function deletePage(ServerRequestInterface $request, array $args): array
    {
        if (!$this->pageStore($request)->delete((int) ($args['id'] ?? 0))) {
            throw new NotFoundException('There is no such page.');
        }

        return ['ok' => true];
    }

    private function run(Connection $conn, string $sql): void
    {
        try {
            $conn->query($sql);
        } catch (QueryException $e) {
            throw new ApiException(422, $e->getMessage());
        }
    }

    private static function action(string $code): string
    {
        return match ($code) {
            'r' => 'RESTRICT',
            'c' => 'CASCADE',
            'n' => 'SET NULL',
            'd' => 'SET DEFAULT',
            default => 'NO ACTION',
        };
    }

    private function pageStore(ServerRequestInterface $request): DesignerPages
    {
        return DesignerPages::for(Authenticate::sessionServer()?->key() ?? '', ConnectionPool::from($request)->username());
    }

    private function connection(ServerRequestInterface $request, array $args): Connection
    {
        return ConnectionPool::from($request)->for(self::database($args));
    }

    private static function database(array $args): string
    {
        $db = rawurldecode((string) ($args['db'] ?? ''));

        return $db !== '' ? $db : throw new BadRequestException('A database name is required.');
    }
}
