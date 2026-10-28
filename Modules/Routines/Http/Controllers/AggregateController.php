<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Routines\Http\Controllers;

use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * The aggregate node, after pgAdmin's AggregateView: the aggregates of a schema with their
 * state, final and moving-aggregate functions, the CREATE AGGREGATE that describes one, and
 * DROP. pgAdmin's node is read-only, and so is this one: an aggregate is created and altered
 * on the SQL page.
 */
final class AggregateController extends NodeController
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
        $row = $ctx->row('nodes.sql', ['scid' => null, 'agid' => $oid]) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        return $this->decorate($ctx->row('properties.sql', ['agid' => $oid]) ?? throw $this->gone($ctx));
    }

    /** The "SQL" tab: the commented header and DROP, then CREATE OR REPLACE AGGREGATE with every function and setting. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        $data = $this->properties($ctx, $oid);
        $create = $ctx->render('create.sql', ['data' => $data]);
        if ($data['description'] !== null && $data['description'] !== '') {
            $create .= sprintf("\n\nCOMMENT ON AGGREGATE %s(%s)\n    IS %s;", Quoting::ident((string) $data['schema'], (string) $data['name']), $data['input_types'], Quoting::literal((string) $data['description']));
        }

        return Ddl::assemble([Ddl::header('Aggregate', $data['signature'], $ctx->render('delete.sql', ['data' => $data])), $create]);
    }

    /** DROP AGGREGATE with the input types, CASCADE on request. */
    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $this->execute($ctx, $ctx->render('delete.sql', ['data' => $this->properties($ctx, $oid), 'cascade' => $cascade]));
    }

    /** @param array<string, mixed> $row */
    private function decorate(array $row): array
    {
        $row['signature'] = $row['name'] . '(' . $row['input_types'] . ')';
        $row['is_sys_obj'] = (int) $row['oid'] <= DatabaseController::LAST_SYSTEM_OID;
        foreach (['final_extra_param', 'moving_final_extra_param'] as $flag) {
            $row[$flag] = (bool) $row[$flag];
        }
        // The default modify setting says nothing in the DDL; only the other two are spelled.
        foreach (['final_func_modify', 'moving_final_func_modify'] as $key) {
            if ($row[$key] === 'READ_ONLY' || $row[$key] === 'unknown') {
                $row[$key] = null;
            }
        }

        return $row;
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, $row);
        $node['inode'] = false;

        return $node;
    }
}
