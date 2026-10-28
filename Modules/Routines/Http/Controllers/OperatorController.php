<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Routines\Http\Controllers;

use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * The operator node, after pgAdmin's OperatorView: the operators of a schema with their
 * function, operand types, commutator, negator and selectivity estimators, the CREATE
 * OPERATOR that describes one, and DROP. pgAdmin's node is read-only, and so is this one: an
 * operator is created and altered on the SQL page.
 */
final class OperatorController extends NodeController
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
        $row = $ctx->row('nodes.sql', ['scid' => null, 'opid' => $oid]) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        return $this->decorate($ctx->row('properties.sql', ['opid' => $oid]) ?? throw $this->gone($ctx));
    }

    /** The "SQL" tab: the commented header and DROP, then CREATE OPERATOR with its function, operands and options. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        $data = $this->properties($ctx, $oid);
        $create = $ctx->render('create.sql', ['data' => $data]);
        if ($data['description'] !== null && $data['description'] !== '') {
            $create .= sprintf("\n\nCOMMENT ON OPERATOR %s.%s (%s, %s)\n    IS %s;", Quoting::ident((string) $data['schema']), $data['name'], $data['lefttype'] ?? 'NONE', $data['righttype'] ?? 'NONE', Quoting::literal((string) $data['description']));
        }

        return Ddl::assemble([Ddl::header('Operator', $data['signature'], $this->dropSql($ctx, $data)), $create]);
    }

    /** DROP OPERATOR with the operand types, CASCADE on request. */
    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $this->execute($ctx, $this->dropSql($ctx, $this->properties($ctx, $oid), $cascade));
    }

    /** @param array<string, mixed> $data */
    private function dropSql(NodeContext $ctx, array $data, bool $cascade = false): string
    {
        return $ctx->render('delete.sql', ['name' => $data['name'], 'oprnamespace' => $data['schema'], 'lefttype' => $data['lefttype'], 'righttype' => $data['righttype'], 'cascade' => $cascade]);
    }

    /** @param array<string, mixed> $row */
    private function decorate(array $row): array
    {
        $operands = array_filter([$row['lefttype'], $row['righttype']], static fn (?string $t): bool => $t !== null && $t !== '');
        $row['signature'] = $row['name'] . ' (' . implode(', ', $operands) . ')';
        $row['is_sys_obj'] = (int) $row['oid'] <= DatabaseController::LAST_SYSTEM_OID;
        $row['support_hash'] = (bool) $row['support_hash'];
        $row['support_merge'] = (bool) $row['support_merge'];

        return $row;
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, $row);
        $node['inode'] = false;

        return $node;
    }
}
