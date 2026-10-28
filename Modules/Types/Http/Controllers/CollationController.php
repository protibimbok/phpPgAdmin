<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Types\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * The collation node, after pgAdmin's CollationView: the collations of a schema with their
 * locale, provider and version, and the statements that create, alter and drop one. A
 * collation's definition cannot be altered: only its name, owner and comment change.
 *
 * The client's data carries pgAdmin's field names: name, owner, description, and one of the
 * definitions copy_collation ("schema.name"), locale, or lc_collate with lc_type; with
 * provider, is_deterministic, rules (PostgreSQL 16+) and version.
 */
final class CollationController extends NodeController
{
    public function list(NodeContext $ctx): array
    {
        return array_map($this->decorate(...), $ctx->rows('properties.sql'));
    }

    public function nodes(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->toNode($ctx, $row), $ctx->rows('nodes.sql'));
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('nodes.sql', ['scid' => null, 'coid' => $oid]) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        return $this->decorate($ctx->row('properties.sql', ['coid' => $oid]) ?? throw $this->gone($ctx));
    }

    /**
     * The "SQL" tab: the commented header and DROP, then CREATE COLLATION as the catalog
     * describes it. A collation whose LC_COLLATE and LC_CTYPE agree is spelled with LOCALE;
     * the recorded version is left out, since it describes the installed library rather than
     * the definition.
     */
    public function sql(NodeContext $ctx, int $oid): string
    {
        $data = $this->properties($ctx, $oid);
        unset($data['version']);
        if ((string) ($data['lc_collate'] ?? '') === (string) ($data['lc_type'] ?? '')) {
            $data['locale'] = $data['lc_collate'];
            unset($data['lc_collate'], $data['lc_type']);
        }
        // DETERMINISTIC = true is the default: only the other spelling says anything.
        if ($data['is_deterministic']) {
            unset($data['is_deterministic']);
        } else {
            $data['is_deterministic'] = 'false';
        }
        $drop = $ctx->render('delete.sql', ['nspname' => $data['schema'], 'name' => $data['name']]);

        return Ddl::assemble([Ddl::header('Collation', Quoting::ident((string) $data['schema'], (string) $data['name']), $drop), $ctx->render('create.sql', ['data' => $data])]);
    }

    /** CREATE COLLATION from a copied collation, a locale or an LC_COLLATE / LC_CTYPE pair; the new node. */
    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($ctx, $data);
        $this->execute($ctx, $ctx->render('create.sql', ['data' => $data]));
        $oid = $ctx->conn->scalar($ctx->render('get_oid.sql', ['data' => $data, 'coid' => null])) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $oid);
    }

    /** ALTER COLLATION for a new name, owner or comment. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));

        return $this->node($ctx, $oid);
    }

    /** DROP COLLATION, CASCADE on request. */
    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = $this->properties($ctx, $oid);
        $this->execute($ctx, $ctx->render('delete.sql', ['nspname' => $row['schema'], 'name' => $row['name'], 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid === null) {
            return $ctx->render('create.sql', ['data' => $this->forCreate($ctx, $data)]);
        }

        return $this->updateSql($ctx, $oid, $data);
    }

    /**
     * What the editor offers: every collation of the database to copy from, the roles, and the
     * server version the provider and rules fields depend on.
     *
     * @return array<string, mixed>
     */
    public function options(NodeContext $ctx): array
    {
        return [
            'collations' => array_values(array_filter(array_column($ctx->rows('get_collations.sql'), 'copy_collation'))),
            'roles' => Catalog::roles($ctx->conn),
            'version' => $ctx->version(),
        ];
    }

    /** A collation by schema and name: resolve('collation', {schema, name}) → {scid, coid}. */
    public function resolve(NodeContext $ctx, array $params): ?array
    {
        $schema = (string) ($params['schema'] ?? '');
        $name = (string) ($params['name'] ?? '');
        if ($schema === '' || $name === '') {
            return null;
        }
        $row = $ctx->conn->row(
            'SELECT c.oid, c.collnamespace FROM pg_catalog.pg_collation c JOIN pg_catalog.pg_namespace n ON n.oid = c.collnamespace WHERE n.nspname = $1 AND c.collname = $2',
            [$schema, $name],
        );

        return $row === null ? null : ['scid' => (int) $row['collnamespace'], 'coid' => (int) $row['oid']];
    }

    /** @param array<string, mixed> $row */
    private function decorate(array $row): array
    {
        $row['is_sys_obj'] = (int) $row['oid'] <= DatabaseController::LAST_SYSTEM_OID;
        $row['is_deterministic'] = (bool) $row['is_deterministic'];

        return $row;
    }

    /**
     * The client's data as create.sql takes it: in the route's schema, with exactly one of
     * the definitions (pgAdmin's _check_definition) and the booleans spelled for the options.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function forCreate(NodeContext $ctx, array $data): array
    {
        $data['name'] = $this->requireName($data);
        $data['schema'] = (string) ($ctx->conn->scalar('SELECT nspname FROM pg_catalog.pg_namespace WHERE oid = $1', [$ctx->id('scid')]) ?? throw $this->notFound('Could not find the schema.'));
        foreach (['copy_collation', 'locale', 'lc_collate', 'lc_type', 'provider', 'rules', 'version', 'owner', 'description'] as $key) {
            if (array_key_exists($key, $data) && trim((string) ($data[$key] ?? '')) === '') {
                unset($data[$key]);
            }
        }
        if (isset($data['copy_collation'])) {
            unset($data['locale'], $data['lc_collate'], $data['lc_type'], $data['provider'], $data['rules'], $data['version'], $data['is_deterministic']);
        } elseif (isset($data['locale'])) {
            unset($data['lc_collate'], $data['lc_type']);
        } elseif (!isset($data['lc_collate'], $data['lc_type'])) {
            throw new BadRequestException('Definition incomplete. Please provide Locale OR Copy Collation OR LC_TYPE/LC_COLLATE.');
        }
        if (array_key_exists('is_deterministic', $data)) {
            // Only a non-default DETERMINISTIC = false needs spelling; the option is for ICU.
            $deterministic = filter_var($data['is_deterministic'], FILTER_VALIDATE_BOOL);
            unset($data['is_deterministic']);
            if (!$deterministic) {
                $data['is_deterministic'] = 'false';
            }
        }

        return $data;
    }

    /**
     * update.sql for what the client's data changes among the name, owner and comment; the
     * definition is left alone, as PostgreSQL cannot alter it.
     *
     * @param array<string, mixed> $data
     */
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
            throw new BadRequestException('Could not find the required parameter (name).');
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
