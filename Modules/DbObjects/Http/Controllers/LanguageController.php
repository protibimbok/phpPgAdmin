<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\DbObjects\Http\Controllers;

use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Acl;
use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * The language node, after pgAdmin's LanguageView: the database's procedural languages with
 * their handler, inline and validator functions, trust, owner and comment, and the statements
 * that create, alter and drop one. A new handler, inline function, validator or trust is a
 * DROP … CASCADE and CREATE, as pgAdmin writes it, since ALTER LANGUAGE cannot change them.
 *
 * The client's data carries pgAdmin's field names: name, lanowner, description, trusted,
 * lanproc, laninl, lanval.
 */
final class LanguageController extends NodeController
{
    private const array FIELDS = ['name', 'lanowner', 'description', 'trusted', 'lanproc', 'laninl', 'lanval'];

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
        return self::decorate($ctx->row('properties.sql', ['lid' => $oid]) ?? throw $this->gone($ctx));
    }

    public function sql(NodeContext $ctx, int $oid): string
    {
        $data = $this->properties($ctx, $oid);
        $drop = $ctx->render('delete.sql', ['lid' => null, 'lname' => $data['name']]);

        return Ddl::assemble([Ddl::header('Language', Quoting::ident((string) $data['name']), $drop), $ctx->render('create.sql', ['data' => $data, 'add_replace_clause' => true])]);
    }

    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($data);
        $this->execute($ctx, $ctx->render('create.sql', ['data' => $data]));

        return $this->toNode($ctx, $ctx->row('properties.sql', ['lid' => null, 'lanname' => $data['name']]) ?? throw $this->gone($ctx));
    }

    /** The ALTERs, or the DROP and CREATE, for what changes; a recreated language has a new OID, so it is found by name. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $name = trim((string) ($data['name'] ?? '')) !== '' ? (string) $data['name'] : (string) $this->properties($ctx, $oid)['name'];
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));

        return $this->toNode($ctx, $ctx->row('properties.sql', ['lid' => null, 'lanname' => $name]) ?? throw $this->gone($ctx));
    }

    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = $this->properties($ctx, $oid);
        $this->execute($ctx, $ctx->render('delete.sql', ['lid' => null, 'lname' => $row['name'], 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        return $oid === null ? $ctx->render('create.sql', ['data' => $this->forCreate($data)]) : $this->updateSql($ctx, $oid, $data);
    }

    /**
     * The functions a language may name, by role (handler, inline, validator), and the roles.
     *
     * @return array{handler: list<string>, inline: list<string>, validator: list<string>, roles: list<string>}
     */
    public function options(NodeContext $ctx): array
    {
        $functions = ['handler' => [], 'inline' => [], 'validator' => []];
        foreach ($ctx->rows('functions.sql') as $row) {
            $functions[(string) $row['prop_type']][] = (string) $row['label'];
        }

        return $functions + ['roles' => Catalog::roles($ctx->conn)];
    }

    /** @param array<string, mixed> $row */
    private static function decorate(array $row): array
    {
        $row['is_sys_obj'] = (int) $row['oid'] <= DatabaseController::LAST_SYSTEM_OID;
        $row['trusted'] = (bool) $row['trusted'];

        return $row;
    }

    /** @param array<string, mixed> $data */
    private function forCreate(array $data): array
    {
        $out = ['name' => $this->requireName($data), 'trusted' => filter_var($data['trusted'] ?? false, FILTER_VALIDATE_BOOL)];
        foreach (['lanowner', 'description', 'lanproc', 'laninl', 'lanval'] as $key) {
            $value = trim((string) ($data[$key] ?? ''));
            if ($value !== '') {
                $out[$key] = $value;
            }
        }
        if (!isset($out['lanproc'])) {
            throw $this->incomplete('handler function');
        }

        return $out;
    }

    /**
     * update.sql for what differs from the catalog; the name is always passed, as the template
     * compares it.
     *
     * @param array<string, mixed> $data
     */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $old = $this->properties($ctx, $oid);
        $changes = ['name' => trim((string) ($data['name'] ?? '')) !== '' ? (string) $data['name'] : (string) $old['name']];
        foreach (self::FIELDS as $key) {
            if ($key === 'name' || !array_key_exists($key, $data)) {
                continue;
            }
            $value = $key === 'trusted' ? filter_var($data[$key], FILTER_VALIDATE_BOOL) : (string) ($data[$key] ?? '');
            $was = $key === 'trusted' ? (bool) $old[$key] : (string) ($old[$key] ?? '');
            if ($value !== $was) {
                $changes[$key] = $value;
            }
        }
        // The template recreates the language when trust is switched on; switched off is a recreation too.
        if (array_key_exists('trusted', $changes) && $changes['trusted'] === false) {
            $changes['lanproc'] = (string) ($changes['lanproc'] ?? $old['lanproc']);
            $changes['trusted'] = false;
            $old['lanproc'] = '';
        }
        // A recreated language starts with default privileges; the template grants the old ones again.
        $old['lanacl'] = Acl::toDb(Acl::allFromDb($ctx->rows('acl.sql', ['lid' => $oid])), ['U']);

        return $ctx->render('update.sql', ['data' => $changes, 'o_data' => $old]);
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, $row);
        $node['inode'] = false;

        return $node;
    }
}
