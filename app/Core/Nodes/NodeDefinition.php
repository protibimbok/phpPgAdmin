<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Nodes;

use InvalidArgumentException;

/**
 * One object type of the browser, as pgAdmin defines a node: where it sits in the tree, which
 * controller serves it and which template folder holds its SQL.
 *
 * The routes are built from the parent chain, each level an OID parameter named after
 * pgAdmin's template variables (did, scid, tid…), so the ported templates read them as they are:
 *
 *     /api/databases/{db}/schemas/{scid}/tables            list, create
 *     /api/databases/{db}/schemas/{scid}/tables/nodes      tree children
 *     /api/databases/{db}/schemas/{scid}/tables/{tid}      properties, update, delete
 *     /api/databases/{db}/schemas/{scid}/tables/{tid}/sql  … stats, dependencies, dependents, children
 */
final readonly class NodeDefinition
{
    /** The parent of a node directly under a database: schemas, extensions, casts… */
    public const string DATABASE = 'database';

    /** The parent of a server-wide node: databases, roles, tablespaces. */
    public const string SERVER = 'server';

    /** Operations every node has; the others are opted into with "supports". */
    public const array BASE_OPERATIONS = ['list', 'nodes', 'node', 'properties', 'create', 'update', 'delete'];

    public const array OPTIONAL_OPERATIONS = ['sql', 'msql', 'stats', 'depends', 'children', 'resolve'];

    /**
     * @param string $type The node type, "table"; what the tree and the URLs of the client use.
     * @param string $collection The plural URL segment, "tables".
     * @param string $idParam The route parameter holding the object's OID, "tid", as pgAdmin's templates name it.
     * @param class-string<NodeController> $controller
     * @param string|null $parent The parent node's type, or self::DATABASE / self::SERVER for a node directly under the database or the server.
     * @param string $templateDir The folder of the node's SQL templates, "tables".
     * @param int $minVersion The lowest server version the node exists for, 130000 for 13.0.
     * @param list<string> $supports Optional operations: sql, msql, stats, depends, children, resolve.
     * @param bool $collectionNode Whether the tree shows a folder ("Tables") holding the nodes, as pgAdmin does.
     * @param string|null $extension The extension the objects belong to ("pg_cron"): the type is
     *        offered only in a database that has it installed, as pgAdmin shows pgAgent Jobs only
     *        where pgagent is.
     */
    public function __construct(
        public string $type,
        public string $collection,
        public string $idParam,
        public string $controller,
        public ?string $parent = self::DATABASE,
        public string $templateDir = '',
        public string $label = '',
        public string $icon = '',
        public int $minVersion = 130000,
        public ?int $maxVersion = null,
        public array $supports = [],
        public bool $collectionNode = true,
        public ?string $extension = null,
    ) {
        if (!preg_match('/^[a-z][a-z0-9_]*$/', $type) || !preg_match('/^[a-z][a-z0-9_-]*$/', $collection) || !preg_match('/^[a-z][a-z0-9_]*$/', $idParam)) {
            throw new InvalidArgumentException(sprintf('Node [%s] needs lower-case type, collection and id parameter names.', $type));
        }
        if ($parent === null) {
            throw new InvalidArgumentException(sprintf('Node [%s] needs a parent: another type, NodeDefinition::DATABASE or NodeDefinition::SERVER.', $type));
        }
        if (!is_subclass_of($controller, NodeController::class)) {
            throw new InvalidArgumentException(sprintf('Node [%s] controller %s must extend %s.', $type, $controller, NodeController::class));
        }
        foreach ($supports as $operation) {
            if (!in_array($operation, self::OPTIONAL_OPERATIONS, true)) {
                throw new InvalidArgumentException(sprintf('Node [%s] cannot support unknown operation "%s".', $type, $operation));
            }
        }
    }

    /** Whether the node lives under the server rather than inside a database. */
    public function isServerLevel(): bool
    {
        return $this->parent === self::SERVER;
    }

    public function supports(string $operation): bool
    {
        return in_array($operation, self::BASE_OPERATIONS, true) || in_array($operation, $this->supports, true);
    }

    /** Whether a server of the given version has this kind of object. */
    public function availableOn(int $version): bool
    {
        return $version >= $this->minVersion && ($this->maxVersion === null || $version <= $this->maxVersion);
    }

    /** The folder the templates are rendered from: the one given, or the collection's name. */
    public function templateDir(): string
    {
        return $this->templateDir !== '' ? $this->templateDir : $this->collection;
    }

    /** @return array<string, mixed> what the client needs to know about the type */
    public function toArray(): array
    {
        return [
            'type' => $this->type,
            'collection' => $this->collection,
            'parent' => $this->parent,
            'label' => $this->label,
            'icon' => $this->icon,
            'supports' => $this->supports,
            'collection_node' => $this->collectionNode,
        ];
    }
}
