<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\Options;

/**
 * The row security policy node, after pgAdmin's RowSecurityView: the policies of a table with
 * their command, kind, roles and expressions, and the statements that create, alter and drop
 * one.
 *
 * The client's data carries pgAdmin's field names: name, event ('ALL', 'SELECT', 'INSERT',
 * 'UPDATE', 'DELETE'), type ('PERMISSIVE', 'RESTRICTIVE'), policyowner [roles], using,
 * withcheck, description.
 */
final class PolicyController extends TableChildController
{
    public function list(NodeContext $ctx): array
    {
        return array_map(self::format(...), $ctx->rows('properties.sql', ['tid' => $this->tableOid($ctx)]));
    }

    public function nodes(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->toNode($ctx, $row), $ctx->rows('nodes.sql', ['tid' => $this->tableOid($ctx)]));
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('nodes.sql', ['tid' => null, 'plid' => $oid]) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        return self::format($this->row($ctx, $oid));
    }

    /** The "SQL" tab: "-- POLICY: name", the commented DROP and CREATE POLICY. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        return $this->createSqlOf($ctx, $oid, true);
    }

    public function create(NodeContext $ctx, array $data): array
    {
        $this->execute($ctx, $this->createSql($ctx, $data));

        $oid = $ctx->conn->scalar($ctx->render('get_position.sql', ['tid' => $this->tableOid($ctx), 'data' => ['name' => trim((string) $data['name'])]])) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $oid);
    }

    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));

        return $this->node($ctx, $oid);
    }

    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = $this->row($ctx, $oid);
        [$schema, $table] = $this->parentNames($ctx);
        $this->execute($ctx, $ctx->render('delete.sql', ['policy_name' => $row['name'], 'result' => ['schema' => $schema, 'table' => $table]]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        return $oid === null ? $this->createSql($ctx, $data) : $this->updateSql($ctx, $oid, $data);
    }

    /** CREATE POLICY for the "SQL" tab or a table's DDL, by OID. */
    public function createSqlOf(NodeContext $ctx, int $oid, bool $withHeader): string
    {
        $data = self::format($this->row($ctx, $oid));
        [$data['schema'], $data['table']] = $this->parentNames($ctx);

        $parts = [];
        if ($withHeader) {
            $parts[] = "-- POLICY: {$data['name']}\n\n-- " . $ctx->render('delete.sql', ['policy_name' => $data['name'], 'result' => $data]);
        }
        $parts[] = $ctx->render('create.sql', ['data' => $data]);

        return Ddl::assemble($parts);
    }

    private function createSql(NodeContext $ctx, array $data): string
    {
        $data['name'] = $this->requireName($data);
        [$data['schema'], $data['table']] = $this->parentNames($ctx);

        return $ctx->render('create.sql', ['data' => self::normalise($data)]);
    }

    /**
     * update.sql against the policy as it stands. PostgreSQL cannot change a policy's command
     * or kind; the form keeps them fixed. Fields equal to the current value are dropped.
     */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $old = self::format($this->row($ctx, $oid));
        [$old['schema'], $old['table']] = $this->parentNames($ctx);
        $data = self::normalise($data);
        foreach (['name', 'using', 'withcheck', 'description'] as $key) {
            if (array_key_exists($key, $data) && trim((string) ($data[$key] ?? '')) === trim((string) ($old[$key] ?? ''))) {
                unset($data[$key]);
            }
        }
        if (array_key_exists('policyowner', $data)) {
            $new = array_values((array) $data['policyowner']);
            $was = array_values((array) $old['policyowner']);
            sort($new);
            sort($was);
            if ($new === $was || ($new === [] && $was === ['public'])) {
                unset($data['policyowner']);
            }
        }
        unset($data['event'], $data['type']);

        return $ctx->render('update.sql', ['data' => $data, 'o_data' => $old]);
    }

    /** The roles as a list and the expressions without their outer parentheses, as pgAdmin's _fetch_properties returns them. */
    private static function format(array $row): array
    {
        $row['policyowner'] = Options::list($row['policyowner'] ?? null);
        foreach (['using', 'withcheck'] as $key) {
            $value = $row[$key] ?? null;
            if (is_string($value) && str_starts_with($value, '(') && str_ends_with($value, ')')) {
                $row[$key] = substr($value, 1, -1);
            }
        }

        return $row;
    }

    /** @param array<string, mixed> $data */
    private static function normalise(array $data): array
    {
        if (array_key_exists('policyowner', $data)) {
            $roles = array_values(array_filter(array_map(static fn ($r): string => trim((string) $r), (array) $data['policyowner']), static fn (string $r): bool => $r !== ''));
            $data['policyowner'] = $roles;
        }
        foreach (['using', 'withcheck', 'description'] as $key) {
            if (array_key_exists($key, $data)) {
                $data[$key] = trim((string) ($data[$key] ?? ''));
            }
        }
        if (isset($data['event'])) {
            $data['event'] = strtoupper(trim((string) $data['event']));
        }
        if (isset($data['type'])) {
            $data['type'] = strtoupper(trim((string) $data['type']));
        }

        return $data;
    }

    /** @return array<string, mixed> */
    private function row(NodeContext $ctx, int $oid): array
    {
        return $ctx->row('properties.sql', ['tid' => null, 'plid' => $oid, 'scid' => $ctx->id('scid'), 'policy_table_id' => $this->tableOid($ctx)]) ?? throw $this->gone($ctx);
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, $row);
        $node['inode'] = false;

        return $node;
    }
}
