<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Tables\Ddl\TriggerDdl;

/**
 * The trigger node, after pgAdmin's TriggerView: the triggers of a table or view, with the
 * firing definition decoded, and the statements that create, alter, enable, disable and drop
 * one. Registered under tables and under views (as view_trigger).
 */
final class TriggerController extends TableChildController
{
    /** Every trigger of the relation with its function, arguments, columns and firing definition. */
    public function list(NodeContext $ctx): array
    {
        $tid = $this->tableOid($ctx);

        return array_map(fn (array $row): array => TriggerDdl::properties($ctx, $tid, $row), parent::list($ctx));
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        return TriggerDdl::properties($ctx, $this->tableOid($ctx), parent::properties($ctx, $oid));
    }

    public function sql(NodeContext $ctx, int $oid): string
    {
        [$schema, $table] = $this->parentNames($ctx);

        return TriggerDdl::sql($ctx, $schema, $table, $this->tableOid($ctx), $oid);
    }

    /** CREATE TRIGGER; the new trigger's node. */
    public function create(NodeContext $ctx, array $data): array
    {
        [$schema, $table] = $this->parentNames($ctx);
        $this->execute($ctx, TriggerDdl::createSql($ctx, $schema, $table, $data));

        return $this->node($ctx, $this->oidOf($ctx, (string) $data['name']));
    }

    /** The rename, CREATE OR REPLACE, comment or ENABLE / DISABLE; a replaced trigger keeps its OID. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        [$schema, $table] = $this->parentNames($ctx);
        $old = parent::properties($ctx, $oid);
        $this->execute($ctx, TriggerDdl::updateSql($ctx, $schema, $table, $this->tableOid($ctx), $oid, $data));

        return $this->node($ctx, $this->oidOf($ctx, trim((string) ($data['name'] ?? '')) ?: (string) $old['name']));
    }

    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = parent::properties($ctx, $oid);
        $this->execute($ctx, $ctx->renderFrom('triggers', 'delete.sql', ['data' => $row, 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        [$schema, $table] = $this->parentNames($ctx);
        if ($oid === null) {
            return TriggerDdl::createSql($ctx, $schema, $table, $data);
        }

        return TriggerDdl::updateSql($ctx, $schema, $table, $this->tableOid($ctx), $oid, $data);
    }

    /**
     * What the trigger and policy editors offer: the trigger functions (schema-qualified) and
     * the roles.
     *
     * @return array{functions: list<string>, roles: list<string>}
     */
    public function options(NodeContext $ctx): array
    {
        return [
            'functions' => array_column($ctx->conn->rows($ctx->renderFrom('triggers', 'get_triggerfunctions.sql', ['show_system_objects' => false, 'without_schema' => false])), 'tfunctions'),
            'roles' => Catalog::roles($ctx->conn),
        ];
    }

    private function oidOf(NodeContext $ctx, string $name): int
    {
        return (int) ($ctx->conn->scalar($ctx->renderFrom('triggers', 'get_oid.sql', ['tid' => $this->tableOid($ctx), 'data' => ['name' => $name]])) ?? throw $this->gone($ctx));
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, $row);
        $node['inode'] = false;

        return $node;
    }
}
