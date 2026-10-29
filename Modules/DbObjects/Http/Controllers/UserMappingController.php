<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\DbObjects\Http\Controllers;

use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;

/**
 * The user mapping node, after pgAdmin's UserMappingView: the mappings of a foreign server,
 * one per role (or PUBLIC), with their options, and CREATE, ALTER (options only) and DROP
 * USER MAPPING. pg_user_mappings shows a mapping's options only to whom may see them.
 *
 * The client's data carries pgAdmin's field names: name (a role, CURRENT_USER or PUBLIC) and
 * umoptions as {option, value}.
 */
final class UserMappingController extends NodeController
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
        return self::decorate($ctx->row('properties.sql', ['fsid' => null, 'umid' => $oid]) ?? throw $this->gone($ctx));
    }

    public function sql(NodeContext $ctx, int $oid): string
    {
        $data = $this->properties($ctx, $oid);
        $data['umoptions'] = ForeignOptions::named($data['umoptions'], 'um');
        $server = ['name' => $data['srvname']];
        $drop = $ctx->render('delete.sql', ['fsid' => null, 'name' => $server['name'], 'data' => $data]);

        return Ddl::assemble([Ddl::header('User Mapping', sprintf('%s SERVER %s', $data['name'], $server['name']), $drop), $ctx->render('create.sql', ['data' => $data, 'fdwdata' => $server, 'is_valid_options' => $data['umoptions'] !== []])]);
    }

    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($data);
        $this->execute($ctx, $ctx->render('create.sql', ['data' => $data, 'fdwdata' => $this->server($ctx), 'is_valid_options' => $data['umoptions'] !== []]));
        $role = in_array($data['name'], ['CURRENT_USER', 'PUBLIC'], true) ? ($data['name'] === 'PUBLIC' ? 'public' : (string) $ctx->conn->scalar('SELECT current_user')) : $data['name'];
        $oid = $ctx->conn->scalar('SELECT umid FROM pg_catalog.pg_user_mappings WHERE srvid = $1 AND usename = $2', [$ctx->id('fsid'), $role]) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $oid);
    }

    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));

        return $this->node($ctx, $oid);
    }

    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = $this->properties($ctx, $oid);
        $this->execute($ctx, $ctx->render('delete.sql', ['fsid' => null, 'name' => $row['srvname'], 'data' => $row]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid === null) {
            $data = $this->forCreate($data);

            return $ctx->render('create.sql', ['data' => $data, 'fdwdata' => $this->server($ctx), 'is_valid_options' => $data['umoptions'] !== []]);
        }

        return $this->updateSql($ctx, $oid, $data);
    }

    /** @return array{roles: list<string>} the roles a mapping may be for, CURRENT_USER and PUBLIC first */
    public function options(NodeContext $ctx): array
    {
        return ['roles' => ['CURRENT_USER', 'PUBLIC', ...Catalog::roles($ctx->conn)]];
    }

    /** @return array{name: string} the route's server */
    private function server(NodeContext $ctx): array
    {
        $name = $ctx->conn->scalar('SELECT srvname FROM pg_catalog.pg_foreign_server WHERE oid = $1', [$ctx->id('fsid')]) ?? throw $this->notFound('Could not find the foreign server.');

        return ['name' => (string) $name];
    }

    private static function decorate(array $row): array
    {
        $row['umoptions'] = ForeignOptions::fromCatalog($row['umoptions']);

        return $row;
    }

    /** @param array<string, mixed> $data */
    private function forCreate(array $data): array
    {
        return ['name' => $this->requireName($data), 'umoptions' => ForeignOptions::named(ForeignOptions::fromClient($data['umoptions'] ?? []), 'um')];
    }

    /** @param array<string, mixed> $data */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $old = $this->properties($ctx, $oid);
        if (!array_key_exists('umoptions', $data)) {
            return '';
        }
        $diff = ForeignOptions::diff($old['umoptions'], ForeignOptions::fromClient($data['umoptions']), 'um');

        return $ctx->render('update.sql', [
            'data' => ['umoptions' => $diff],
            'o_data' => $old,
            'fdwdata' => ['name' => $old['srvname']],
            'is_valid_added_options' => $diff['added'] !== [],
            'is_valid_changed_options' => $diff['changed'] !== [],
        ]);
    }
}
