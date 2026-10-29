<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Types\Http\Controllers;

use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * What pgAdmin's four full text search nodes share: the schema's objects by properties.sql
 * (which names the schema by OID; the name is put in), the node and properties lookups, CREATE
 * TEXT SEARCH … from the client's data with the new object found by name, the ALTERs for what
 * the data changes against the object as it stands, and DROP. Each kind adds what its own
 * definition needs.
 */
abstract class FtsController extends NodeController
{
    /** The route's OID parameter, by pgAdmin's name: cfgid, dcid, pid or tid. */
    abstract protected function idName(): string;

    /** The object kind as CREATE TEXT SEARCH … names it. */
    abstract protected function kind(): string;

    /**
     * The client's data as create.sql takes it, checked for what the kind requires.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    abstract protected function forCreate(NodeContext $ctx, array $data): array;

    /**
     * The kind's own change lists for update.sql, from the client's full data against the old
     * properties: the common name, owner and comment are already in $changes.
     *
     * @param array<string, mixed> $data
     * @param array<string, mixed> $old
     * @param array<string, mixed> $changes
     * @return array<string, mixed>
     */
    abstract protected function changes(NodeContext $ctx, array $data, array $old, array $changes): array;

    public function list(NodeContext $ctx): array
    {
        $schema = $this->schemaName($ctx);

        return array_map(fn (array $row): array => $this->decorate($ctx, $row, $schema), $ctx->rows('properties.sql'));
    }

    public function nodes(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->toNode($ctx, $row), $ctx->rows('nodes.sql'));
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('nodes.sql', ['scid' => null, $this->idName() => $oid]) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('properties.sql', [$this->idName() => $oid]) ?? throw $this->gone($ctx);

        return $this->decorate($ctx, $row, $this->schemaName($ctx));
    }

    /** CREATE TEXT SEARCH …; the new object's node. */
    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($ctx, $this->common($ctx, $data));
        $this->execute($ctx, $ctx->render('create.sql', ['data' => $data]));
        $row = $ctx->row('properties.sql', ['name' => $data['name']]) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $row['oid']);
    }

    /** The ALTERs for what the client's data changes. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $name = (string) $this->properties($ctx, $oid)['name'];
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));

        // A parser whose functions change is dropped and recreated with a new OID: found again by name.
        if (isset($data['name']) && trim((string) $data['name']) !== '') {
            $name = (string) $data['name'];
        }
        $row = $ctx->row('properties.sql', ['name' => $name, $this->idName() => null]) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $row['oid']);
    }

    /** DROP TEXT SEARCH …, CASCADE on request. */
    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = $this->properties($ctx, $oid);
        $this->execute($ctx, $ctx->render('delete.sql', [$this->idName() => null, 'schema' => $row['schema'], 'name' => $row['name'], 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid === null) {
            return $ctx->render('create.sql', ['data' => $this->forCreate($ctx, $this->common($ctx, $data))]);
        }

        return $this->updateSql($ctx, $oid, $data);
    }

    /** The object by schema and name: resolve(type, {schema, name}) → {scid, <id>}. */
    public function resolve(NodeContext $ctx, array $params): ?array
    {
        $schema = (string) ($params['schema'] ?? '');
        $name = (string) ($params['name'] ?? '');
        if ($schema === '' || $name === '') {
            return null;
        }
        $scid = $ctx->conn->scalar('SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = $1', [$schema]);
        if ($scid === null) {
            return null;
        }
        $row = $ctx->conn->row($ctx->render('properties.sql', ['scid' => (int) $scid, 'name' => $name, $this->idName() => null]));

        return $row === null ? null : ['scid' => (int) $scid, $this->idName() => (int) $row['oid']];
    }

    /** @return list<string> the roles the owner select offers */
    protected function roles(NodeContext $ctx): array
    {
        return Catalog::roles($ctx->conn);
    }

    /** The route's schema by name. */
    protected function schemaName(NodeContext $ctx): string
    {
        return (string) ($ctx->conn->scalar('SELECT nspname FROM pg_catalog.pg_namespace WHERE oid = $1', [$ctx->id('scid')]) ?? throw $this->notFound('Could not find the schema.'));
    }

    /**
     * A properties row with the schema named and the system flag; a kind adds its own fields.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    protected function decorate(NodeContext $ctx, array $row, string $schema): array
    {
        $row['schema'] = $schema;
        $row['is_sys_obj'] = (int) $row['oid'] <= DatabaseController::LAST_SYSTEM_OID;

        return $row;
    }

    /** "schema.name", or the bare name for pg_catalog's objects, as the templates write them. */
    protected static function qualify(?string $schema, string $name): string
    {
        return $schema === null || $schema === '' || $schema === 'pg_catalog' ? $name : $schema . '.' . $name;
    }

    /**
     * A function list from functions.sql as the selects offer it.
     *
     * @param list<array<string, mixed>> $rows
     * @return list<string>
     */
    protected static function functionNames(array $rows): array
    {
        return array_values(array_unique(array_map(static fn (array $r): string => self::qualify($r['nspname'], (string) $r['proname']), $rows)));
    }

    /**
     * The name required and the schema named, the blank optional fields dropped.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function common(NodeContext $ctx, array $data): array
    {
        $data['name'] = $this->requireName($data);
        $data['schema'] = $this->schemaName($ctx);
        foreach (['owner', 'description'] as $key) {
            if (array_key_exists($key, $data) && trim((string) ($data[$key] ?? '')) === '') {
                unset($data[$key]);
            }
        }

        return $data;
    }

    /** @param array<string, mixed> $data */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $old = $this->properties($ctx, $oid);
        $changes = [];
        foreach (['name', 'owner', 'description'] as $key) {
            if (array_key_exists($key, $data) && (string) ($data[$key] ?? '') !== (string) ($old[$key] ?? '')) {
                $changes[$key] = $data[$key];
            }
        }
        if (isset($changes['owner']) && trim((string) $changes['owner']) === '') {
            unset($changes['owner']);
        }
        if (isset($changes['name']) && trim((string) $changes['name']) === '') {
            unset($changes['name']);
        }

        return $ctx->render('update.sql', ['data' => $this->changes($ctx, $data, $old, $changes), 'o_data' => $old]);
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, $row);
        $node['inode'] = false;

        return $node;
    }
}
