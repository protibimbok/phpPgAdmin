<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Schemas\Http\Controllers;

use PhpPgAdmin\Core\Nodes\Acl;
use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Core\Nodes\Options;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * The schema node, after pgAdmin's SchemaView: the schemas of a database (the catalogs
 * pg_catalog and information_schema left out, as pgAdmin shows them under their own node),
 * their properties with privileges and default privileges, and the DDL that recreates one.
 */
final class SchemaController extends NodeController
{
    private const array ACL_COLUMNS = ['nspacl', 'deftblacl', 'defseqacl', 'deffuncacl', 'deftypeacl'];

    public function list(NodeContext $ctx): array
    {
        $rows = [];
        foreach ($ctx->rows('properties.sql', ['show_sysobj' => $ctx->flag('system_objects')]) as $row) {
            $row['is_sys_obj'] = $this->isSystem($row);
            $rows[] = $row;
        }

        return $rows;
    }

    public function nodes(NodeContext $ctx): array
    {
        return array_map(
            fn (array $row): array => $this->toNode($ctx, $row),
            $ctx->rows('nodes.sql', ['show_sysobj' => $ctx->flag('system_objects')]),
        );
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('nodes.sql', ['scid' => $oid, 'show_sysobj' => true]) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('properties.sql', ['scid' => $oid, 'show_sysobj' => true]) ?? throw $this->gone($ctx);
        $row['is_sys_obj'] = $this->isSystem($row);

        return $this->format($ctx, $row, $oid);
    }

    /** "-- SCHEMA: name", the commented DROP, then CREATE SCHEMA IF NOT EXISTS with comment, privileges, default privileges and labels. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        $row = $ctx->row('properties.sql', ['scid' => $oid, 'show_sysobj' => true]) ?? throw $this->gone($ctx);
        $data = $this->toTemplateData($ctx, $this->format($ctx, $row, $oid));

        $header = Ddl::header('SCHEMA', $data['name'], $ctx->render('delete.sql', ['name' => $data['name'], 'cascade' => false]));

        return Ddl::assemble([$header, $ctx->render('create.sql', ['data' => $data, 'add_not_exists_clause' => true])]);
    }

    /** CREATE SCHEMA from the client's data (name, namespaceowner, description, privileges): pgAdmin's create. */
    public function create(NodeContext $ctx, array $data): array
    {
        $name = $this->requireName($data);
        $this->execute($ctx, $ctx->render('create.sql', ['data' => $this->toTemplateData($ctx, $data)]));

        return $this->node($ctx, $this->oidOf($ctx, $name));
    }

    /** ALTER SCHEMA for what differs from the schema as it stands: the name, owner, comment, privileges. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));

        return $this->node($ctx, $oid);
    }

    /** DROP SCHEMA, CASCADE on request. */
    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $name = $ctx->conn->scalar($ctx->render('get_name.sql', ['scid' => $oid])) ?? throw $this->gone($ctx);
        $this->execute($ctx, $ctx->render('delete.sql', ['name' => $name, 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid === null) {
            $this->requireName($data);

            return $ctx->render('create.sql', ['data' => $this->toTemplateData($ctx, $data)]);
        }

        return $this->updateSql($ctx, $oid, $data);
    }

    /** The roles a schema may be owned by, for the forms. */
    public function options(NodeContext $ctx): array
    {
        return ['roles' => Catalog::roles($ctx->conn)];
    }

    /** update.sql with the client's data against the schema's current properties: pgAdmin's get_sql. */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $row = $ctx->row('properties.sql', ['scid' => $oid, 'show_sysobj' => true]) ?? throw $this->gone($ctx);
        $old = $this->format($ctx, $row, $oid);
        if (!isset($data['name']) || trim((string) $data['name']) === '') {
            $data['name'] = $old['name'];
        }

        return $ctx->render('update.sql', ['data' => $this->toTemplateData($ctx, $data, modified: true), 'o_data' => $old]);
    }

    private function oidOf(NodeContext $ctx, string $name): int
    {
        return (int) ($ctx->conn->scalar($ctx->render('oid.sql', ['schema' => $name])) ?? throw $this->gone($ctx));
    }

    /** A schema by name: resolve('schema', {name}) → {scid}. */
    public function resolve(NodeContext $ctx, array $params): ?array
    {
        $name = (string) ($params['name'] ?? ($params['schema'] ?? ''));
        if ($name === '') {
            return null;
        }

        $oid = $ctx->conn->scalar($ctx->render('oid.sql', ['schema' => $name]));

        return $oid === null ? null : ['scid' => (int) $oid];
    }

    /**
     * What pgAdmin's _formatter adds to the catalog row: the privileges and default privileges
     * grouped by column, the security labels as objects.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function format(NodeContext $ctx, array $row, int $oid): array
    {
        $row['seclabels'] = Options::parseSecurityLabels($row['seclabels'] ?? null);

        foreach ($ctx->rows('acl.sql', ['scid' => $oid]) as $acl) {
            $row[$acl['deftype']][] = Acl::fromDb($acl);
        }
        foreach ($ctx->rows('defacl.sql', ['scid' => $oid]) as $acl) {
            $row[$acl['deftype']][] = Acl::fromDb($acl);
        }
        foreach (self::ACL_COLUMNS as $column) {
            $row[$column] ??= [];
        }

        return $row;
    }

    /**
     * The properties as the DDL templates take them: ACL columns turned into template rows per
     * allowed_privs.json (pgAdmin's format_request_acls).
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function toTemplateData(NodeContext $ctx, array $data, bool $modified = false): array
    {
        /** @var array<string, array{type: string, acl: list<string>}> $allowed */
        $allowed = json_decode($ctx->render('allowed_privs.json'), true, flags: JSON_THROW_ON_ERROR);

        foreach ($allowed as $column => $spec) {
            if (!isset($data[$column]) || !is_array($data[$column])) {
                continue;
            }
            if (!$modified) {
                $data[$column] = Acl::toDb($data[$column], $spec['acl']);
                continue;
            }
            // An update carries the changes as added/changed/deleted lists.
            foreach (['added', 'changed', 'deleted'] as $mode) {
                if (isset($data[$column][$mode]) && is_array($data[$column][$mode])) {
                    $data[$column][$mode] = Acl::toDb($data[$column][$mode], $spec['acl']);
                }
            }
        }

        return $data;
    }

    /** @param array<string, mixed> $row */
    private function isSystem(array $row): bool
    {
        return (int) $row['oid'] <= DatabaseController::LAST_SYSTEM_OID || str_starts_with((string) $row['name'], 'pg_');
    }
}
