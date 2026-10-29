<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\DbObjects\Http\Controllers;

use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Core\Nodes\Options;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * The extension node, after pgAdmin's ExtensionView: the database's extensions with their
 * schema, version and owner, and CREATE EXTENSION (schema, version, CASCADE), ALTER EXTENSION
 * (SET SCHEMA, UPDATE TO) and DROP EXTENSION. An extension's name cannot change.
 *
 * The client's data carries pgAdmin's field names: name, schema, version, cascade.
 */
final class ExtensionController extends NodeController
{
    public function list(NodeContext $ctx): array
    {
        return array_map(self::decorate(...), $ctx->rows('properties.sql'));
    }

    public function nodes(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->toNode($ctx, $row), $ctx->rows('properties.sql'));
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        return $this->toNode($ctx, $this->properties($ctx, $oid));
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        return self::decorate($ctx->row('properties.sql', ['eid' => $oid]) ?? throw $this->gone($ctx));
    }

    /** The "SQL" tab: the commented header and DROP, then CREATE EXTENSION IF NOT EXISTS in its schema at its version. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        $data = $this->properties($ctx, $oid);

        return Ddl::assemble([$ctx->render('create.sql', ['data' => $data, 'display_comments' => true, 'add_not_exists_clause' => true])]);
    }

    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($data);
        $this->execute($ctx, $ctx->render('create.sql', ['data' => $data]));

        return $this->toNode($ctx, $ctx->row('properties.sql', ['ename' => $data['name']]) ?? throw $this->gone($ctx));
    }

    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));

        return $this->node($ctx, $oid);
    }

    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = $this->properties($ctx, $oid);
        $this->execute($ctx, $ctx->render('delete.sql', ['eid' => null, 'name' => $row['name'], 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        return $oid === null ? $ctx->render('create.sql', ['data' => $this->forCreate($data)]) : $this->updateSql($ctx, $oid, $data);
    }

    /**
     * The extensions the server has, each with the versions it can be installed at and the
     * schema its control file fixes (null for a relocatable one), and the database's schemas.
     *
     * @return array{available: list<array{name: string, installed_version: string|null, versions: list<string>, schema: string|null, superuser: bool}>, schemas: list<string>}
     */
    public function options(NodeContext $ctx): array
    {
        $available = array_map(static function (array $row): array {
            $schemas = array_values(array_filter(Options::list($row['schema']), static fn (string $s): bool => $s !== '' && $s !== 'NULL'));

            return [
                'name' => (string) $row['name'],
                'installed_version' => $row['installed_version'] === null ? null : (string) $row['installed_version'],
                'versions' => array_values(array_unique(Options::list($row['version']))),
                'schema' => $schemas[0] ?? null,
                'superuser' => in_array('t', Options::list($row['superuser']), true),
            ];
        }, $ctx->rows('extensions.sql'));

        return ['available' => $available, 'schemas' => Catalog::schemas($ctx->conn)];
    }

    /** @param array<string, mixed> $row */
    private static function decorate(array $row): array
    {
        $row['is_sys_obj'] = (int) $row['oid'] <= DatabaseController::LAST_SYSTEM_OID;
        $row['relocatable'] = (bool) $row['relocatable'];

        return $row;
    }

    /** @param array<string, mixed> $data */
    private function forCreate(array $data): array
    {
        return [
            'name' => $this->requireName($data),
            'schema' => trim((string) ($data['schema'] ?? '')),
            'version' => trim((string) ($data['version'] ?? '')),
            'cascade' => filter_var($data['cascade'] ?? false, FILTER_VALIDATE_BOOL),
        ];
    }

    /** @param array<string, mixed> $data */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $old = $this->properties($ctx, $oid);
        $changes = [];
        foreach (['schema', 'version'] as $key) {
            if (array_key_exists($key, $data) && trim((string) $data[$key]) !== '' && (string) $data[$key] !== (string) ($old[$key] ?? '')) {
                $changes[$key] = (string) $data[$key];
            }
        }

        return $ctx->render('update.sql', ['data' => $changes, 'o_data' => $old]);
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, $row);
        $node['inode'] = false;

        return $node;
    }
}
