<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\DbObjects\Http\Controllers;

use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;

/**
 * The foreign server node, after pgAdmin's ForeignServerView: the servers of a foreign data
 * wrapper with their type, version, options, owner and comment, and the statements that
 * create, alter and drop one. A new type is a DROP and CREATE, as pgAdmin writes it, so the
 * server is found again by name. Its children are the user mappings.
 *
 * The client's data carries pgAdmin's field names: name, fsrvtype, fsrvversion, fsrvowner,
 * description, and fsrvoptions as {option, value}.
 */
final class ForeignServerController extends NodeController
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
        return self::decorate($ctx->row('properties.sql', ['fid' => null, 'fsid' => $oid]) ?? throw $this->gone($ctx));
    }

    public function sql(NodeContext $ctx, int $oid): string
    {
        $data = $this->properties($ctx, $oid);
        $data['fsrvoptions'] = ForeignOptions::named($data['fsrvoptions'], 'fsrv');
        $drop = $ctx->render('delete.sql', ['fsid' => null, 'name' => $data['name']]);

        return Ddl::assemble([Ddl::header('Foreign Server', Quoting::ident((string) $data['name']), $drop), $ctx->render('create.sql', ['data' => $data, 'fdwdata' => ['name' => $data['fdwname']], 'is_valid_options' => $data['fsrvoptions'] !== []])]);
    }

    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($data);
        $this->execute($ctx, $this->createSql($ctx, $data));

        return $this->byName($ctx, $data['name']);
    }

    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $name = trim((string) ($data['name'] ?? '')) !== '' ? (string) $data['name'] : (string) $this->properties($ctx, $oid)['name'];
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));

        return $this->byName($ctx, $name);
    }

    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = $this->properties($ctx, $oid);
        $this->execute($ctx, $ctx->render('delete.sql', ['fsid' => null, 'name' => $row['name'], 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        return $oid === null ? $this->createSql($ctx, $this->forCreate($data)) : $this->updateSql($ctx, $oid, $data);
    }

    /** @return array{roles: list<string>} */
    public function options(NodeContext $ctx): array
    {
        return ['roles' => Catalog::roles($ctx->conn)];
    }

    private function byName(NodeContext $ctx, string $name): array
    {
        $oid = $ctx->conn->scalar('SELECT oid FROM pg_catalog.pg_foreign_server WHERE srvname = $1', [$name]) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $oid);
    }

    /** CREATE SERVER under the route's wrapper. */
    private function createSql(NodeContext $ctx, array $data): string
    {
        $wrapper = $ctx->row('properties.sql', ['fid' => null, 'fsid' => null, 'fdwid' => $ctx->id('fid')]) ?? throw $this->notFound('Could not find the foreign data wrapper.');

        return $ctx->render('create.sql', ['data' => $data, 'fdwdata' => ['name' => $wrapper['name']], 'is_valid_options' => $data['fsrvoptions'] !== []]);
    }

    private static function decorate(array $row): array
    {
        $row['fsrvoptions'] = ForeignOptions::fromCatalog($row['fsrvoptions']);

        return $row;
    }

    /** @param array<string, mixed> $data */
    private function forCreate(array $data): array
    {
        $out = ['name' => $this->requireName($data), 'fsrvoptions' => ForeignOptions::named(ForeignOptions::fromClient($data['fsrvoptions'] ?? []), 'fsrv')];
        foreach (['fsrvtype', 'fsrvversion', 'fsrvowner', 'description'] as $key) {
            $value = trim((string) ($data[$key] ?? ''));
            if ($value !== '') {
                $out[$key] = $value;
            }
        }

        return $out;
    }

    /** @param array<string, mixed> $data */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $old = $this->properties($ctx, $oid);
        $changes = ['name' => trim((string) ($data['name'] ?? '')) !== '' ? (string) $data['name'] : (string) $old['name']];
        foreach (['fsrvtype', 'fsrvversion', 'fsrvowner', 'description'] as $key) {
            if (array_key_exists($key, $data) && (string) ($data[$key] ?? '') !== (string) ($old[$key] ?? '')) {
                $changes[$key] = (string) ($data[$key] ?? '');
            }
        }
        $vars = [];
        if (array_key_exists('fsrvoptions', $data)) {
            $diff = ForeignOptions::diff($old['fsrvoptions'], ForeignOptions::fromClient($data['fsrvoptions']), 'fsrv');
            $changes['fsrvoptions'] = $diff;
            $vars = ['is_valid_added_options' => $diff['added'] !== [], 'is_valid_changed_options' => $diff['changed'] !== []];
        }
        $old['fsrvoptions'] = ForeignOptions::named($old['fsrvoptions'], 'fsrv');

        return $ctx->render('update.sql', ['data' => $changes, 'o_data' => $old] + $vars);
    }
}
