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
 * The objects of one schema as the schema diff compares them, after pgAdmin's
 * fetch_objects_to_compare: for each node type under a schema, its objects by the name the
 * navigation panel gives them (a routine's with its arguments), and on demand an object's DDL,
 * which the node's controller writes as its SQL tab does.
 */
final class SchemaSnapshot
{
    /**
     * The node types compared, in the order a script creates them: what a column or a routine
     * may use comes first, the relations that use them after, the views last.
     */
    public const array TYPES = [
        'collation', 'type', 'domain', 'fts_parser', 'fts_template', 'fts_dictionary', 'fts_configuration',
        'sequence', 'function', 'procedure', 'trigger_function', 'aggregate', 'operator',
        'table', 'foreign_table', 'view', 'mview',
    ];

    public readonly int $scid;

    /** @var array<string, array<string, int>> type → name → oid */
    private array $objects = [];

    /** @var array<string, string> "type/oid" → DDL */
    private array $ddl = [];

    /** @var array<string, NodeContext> */
    private array $contexts = [];

    public function __construct(
        private readonly ConnectionPool $pool,
        public readonly Connection $conn,
        public readonly string $schema,
        private readonly ServerRequestInterface $request,
    ) {
        $scid = $conn->scalar('SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = $1', [$schema]);
        if ($scid === null) {
            throw new NotFoundException(sprintf('There is no schema "%s" in the database "%s".', $schema, $conn->database()));
        }
        $this->scid = (int) $scid;
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
            foreach ($this->controller($ctx)->nodes($ctx) as $node) {
                $this->objects[$type][(string) $node['label']] = (int) $node['oid'];
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
            $this->ddl[$key] = $this->controller($ctx)->sql($ctx, $oid);
        }

        return $this->ddl[$key];
    }

    private function context(string $type): ?NodeContext
    {
        if (!array_key_exists($type, $this->contexts)) {
            $node = Nodes::find($type);
            $this->contexts[$type] = $node === null || $node->parent !== 'schema' || !$node->availableOn($this->conn->version())
                ? null
                : new NodeContext($node, Nodes::registry(), $this->pool, $this->conn, $this->conn->database(), ['scid' => $this->scid], $this->request);
        }

        return $this->contexts[$type];
    }

    private function controller(NodeContext $ctx): NodeController
    {
        return new ($ctx->node->controller)();
    }
}
