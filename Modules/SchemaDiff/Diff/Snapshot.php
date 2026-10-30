<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\SchemaDiff\Diff;

use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The objects of one container (a schema, or a database's own objects) as the schema diff
 * compares them, after pgAdmin's fetch_objects_to_compare: for each node type, its objects by
 * the name the navigation panel gives them, and on demand an object's DDL, which the node's
 * controller writes as its SQL tab does. An extension's members are left out, as pgAdmin's
 * schema_diff queries leave them out: CREATE EXTENSION makes them; so are the sequences of
 * identity columns, which the column's GENERATED … AS IDENTITY makes.
 */
abstract class Snapshot
{
    /** @var array<string, array<string, int>> type → name → oid */
    private array $objects = [];

    /** @var array<string, array<int, array<string, int>>> type → oid → the route ids its context takes */
    private array $ids = [];

    /** @var array<string, string> "type/oid" → DDL */
    private array $ddl = [];

    /** @var array<string, NodeContext|null> */
    private array $contexts = [];

    /** @var array<int, true>|null */
    private ?array $members = null;

    public function __construct(
        protected readonly ConnectionPool $pool,
        public readonly Connection $conn,
        protected readonly ServerRequestInterface $request,
    ) {
    }

    /**
     * The node types compared, in the order a script creates them.
     *
     * @return list<string>
     */
    abstract public function types(): array;

    /** The node type the compared types hang under: "schema" or "database". */
    abstract protected function parent(): string;

    /** @return array<string, int> the route ids of the container: ['scid' => …] */
    abstract protected function containerIds(): array;

    /** False for the side of a schema that is not there: it has every type and no objects. */
    protected function exists(): bool
    {
        return true;
    }

    /**
     * The objects of a type, by name; null when this server has no such objects.
     *
     * @return array<string, int>|null
     */
    public function objects(string $type): ?array
    {
        if (!array_key_exists($type, $this->objects)) {
            $ctx = $this->context($type);
            if ($ctx === null) {
                return null;
            }
            $this->objects[$type] = [];
            if (!$this->exists()) {
                return [];
            }
            foreach ($this->parentIds($type) as $ids) {
                $scoped = $this->withIds($ctx, $ids);
                foreach ($this->controller($ctx)->nodes($scoped) as $node) {
                    $oid = (int) $node['oid'];
                    if (isset($this->extensionMembers()[$oid])) {
                        continue;
                    }
                    $this->objects[$type][$this->name($type, $node, $ids)] = $oid;
                    $this->ids[$type][$oid] = $ids;
                }
            }
        }

        return $this->objects[$type];
    }

    /** An object's DDL, as its SQL tab shows it. */
    public function ddl(string $type, int $oid): string
    {
        $key = $type . '/' . $oid;
        if (!isset($this->ddl[$key])) {
            $ctx = $this->context($type) ?? throw new NotFoundException(sprintf('This server has no %s objects.', $type));
            $this->objects($type);
            // With the route ids its own SQL tab has: a table's policies and rules resolve it from "tid".
            $ctx = $this->withIds($ctx, [...($this->ids[$type][$oid] ?? []), $ctx->node->idParam => $oid]);
            $this->ddl[$key] = $this->controller($ctx)->sql($ctx, $oid);
        }

        return $this->ddl[$key];
    }

    /**
     * The route ids of each parent the type's objects are listed under: one empty set for a
     * type directly in the container, one per foreign server for a user mapping.
     *
     * @return list<array<string, int>>
     */
    protected function parentIds(string $type): array
    {
        return [[]];
    }

    /**
     * The name an object is matched by on the other side.
     *
     * @param array<string, mixed> $node
     * @param array<string, int> $ids
     */
    protected function name(string $type, array $node, array $ids): string
    {
        return (string) $node['label'];
    }

    private function context(string $type): ?NodeContext
    {
        if (!array_key_exists($type, $this->contexts)) {
            $node = Nodes::find($type);
            $this->contexts[$type] = $node === null || !$this->accepts($node->parent, $type) || !$node->availableOn($this->conn->version())
                ? null
                : new NodeContext($node, Nodes::registry(), $this->pool, $this->conn, $this->conn->database(), $this->containerIds(), $this->request);
        }

        return $this->contexts[$type];
    }

    protected function accepts(?string $parent, string $type): bool
    {
        return $parent === $this->parent();
    }

    /** @param array<string, int> $ids */
    private function withIds(NodeContext $ctx, array $ids): NodeContext
    {
        return $ids === [] ? $ctx : new NodeContext($ctx->node, $ctx->registry, $ctx->pool, $ctx->conn, $ctx->database, [...$ctx->ids, ...$ids], $ctx->request);
    }

    /**
     * Has the connection write every name with its schema, as pg_dump does: pg_get_viewdef,
     * format_type and pg_get_expr leave out the schema of whatever is on the search_path, and a
     * view of public's tables would read "items" where the script needs "public.items". The
     * connection's search_path before, to set back with restoreSearchPath().
     */
    public static function qualifyNames(Connection $conn): string
    {
        $before = (string) $conn->scalar("SELECT pg_catalog.current_setting('search_path')");
        $conn->scalar("SELECT pg_catalog.set_config('search_path', '', false)");

        return $before;
    }

    public static function restoreSearchPath(Connection $conn, string $before): void
    {
        $conn->scalar("SELECT pg_catalog.set_config('search_path', \$1, false)", [$before]);
    }

    /** @return array<int, true> the OIDs of the objects an extension owns, and of identity columns' sequences */
    private function extensionMembers(): array
    {
        if ($this->members === null) {
            $this->members = [];
            foreach ($this->conn->rows("SELECT DISTINCT objid FROM pg_catalog.pg_depend WHERE deptype = 'e' OR (deptype = 'i' AND classid = 'pg_catalog.pg_class'::regclass AND refclassid = 'pg_catalog.pg_class'::regclass AND refobjsubid > 0)") as $row) {
                $this->members[(int) $row['objid']] = true;
            }
        }

        return $this->members;
    }

    private function controller(NodeContext $ctx): NodeController
    {
        return new ($ctx->node->controller)();
    }
}
