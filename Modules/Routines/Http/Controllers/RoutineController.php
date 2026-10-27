<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Routines\Http\Controllers;

use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Modules\Routines\Ddl\RoutineDdl;

/**
 * Shared ground for the routine nodes (functions, procedures, trigger functions), after
 * pgAdmin's FunctionView: the templates take the schema as "scid" and the routine as "fnid";
 * the tree lists them by signature from node.sql.
 */
abstract class RoutineController extends NodeController
{
    /** The node type: function, procedure or trigger_function. */
    abstract protected function kind(): string;

    /** The routines of the schema, each with its signature ("name(integer, text)") under "signature". */
    public function list(NodeContext $ctx): array
    {
        $rows = [];
        foreach ($ctx->rows('properties.sql') as $row) {
            $row['signature'] = $this->signature($row);
            $rows[] = $row;
        }

        return $rows;
    }

    public function nodes(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->toNode($ctx, $row), $ctx->rows('node.sql'));
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('node.sql', ['fnid' => $oid, 'scid' => null]) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    /** The properties with the arguments, privileges, variables and labels, as pgAdmin's dialog reads them. */
    public function properties(NodeContext $ctx, int $oid): array
    {
        $row = RoutineDdl::properties($ctx, $this->kind(), $oid, $this->row($ctx, $oid));
        $row['signature'] = $this->signature($row);

        return $row;
    }

    /** The "SQL" tab. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        return RoutineDdl::sql($ctx, $this->kind(), $oid, $this->row($ctx, $oid));
    }

    /** CREATE FUNCTION / PROCEDURE; the new routine's node. */
    public function create(NodeContext $ctx, array $data): array
    {
        $this->execute($ctx, RoutineDdl::createSql($ctx, $this->kind(), $data));

        $schema = (string) $ctx->conn->scalar($ctx->render('get_schema.sql', ['scid' => $ctx->id('scid')]));
        // An overloaded name has several rows; the one just created has the highest OID.
        $rows = $ctx->rows('get_oid.sql', ['nspname' => $schema, 'name' => trim((string) $data['name'])]);
        $oid = max(array_map(static fn (array $r): int => (int) $r['oid'], $rows) ?: [0]);

        return $this->node($ctx, $oid ?: throw $this->gone($ctx));
    }

    /** The ALTERs, or CREATE OR REPLACE, for what the client's data changes. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, RoutineDdl::updateSql($ctx, $this->kind(), $data, $this->properties($ctx, $oid)));

        return $this->node($ctx, $oid);
    }

    /** DROP FUNCTION / PROCEDURE by signature, CASCADE on request. */
    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = $ctx->row('delete.sql', ['scid' => $ctx->id('scid'), 'fnid' => $oid]) ?? throw $this->gone($ctx);
        $this->execute($ctx, $ctx->render('delete.sql', ['scid' => null, 'fnid' => null, 'name' => $row['name'], 'func_args' => $row['func_args'], 'nspname' => $row['nspname'], 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid === null) {
            return RoutineDdl::createSql($ctx, $this->kind(), $data);
        }

        return RoutineDdl::updateSql($ctx, $this->kind(), $data, $this->properties($ctx, $oid));
    }

    /** pg_stat_user_functions for one routine, or for every one of the schema. */
    public function statistics(NodeContext $ctx, ?int $oid): array
    {
        if ($oid === null) {
            $schema = (string) $ctx->conn->scalar($ctx->render('get_schema.sql', ['scid' => $ctx->id('scid')]));
            $result = $ctx->query('coll_stats.sql', ['schema_name' => $schema]);
        } else {
            $result = $ctx->query('stats.sql', ['fnid' => $oid]);
        }

        return [
            'columns' => array_map(static fn ($c): array => ['name' => $c->name, 'type' => $c->typeName], $result->columns()),
            'rows' => $result->rows(),
        ];
    }

    /** The SELECT or CALL that runs the routine, with a placeholder per argument. */
    public function callSql(NodeContext $ctx, int $oid): string
    {
        $properties = $this->properties($ctx, $oid);
        $schema = (string) $ctx->conn->scalar($ctx->render('get_schema.sql', ['scid' => (int) $properties['pronamespace']]));

        return RoutineDdl::callSql($this->kind(), $properties, $schema);
    }

    /**
     * What the editor offers: the types an argument or result may have, the languages, the
     * configuration variables a routine may SET, the support functions, the roles and schemas.
     *
     * @return array<string, mixed>
     */
    public function options(NodeContext $ctx): array
    {
        return [
            'types' => array_map(static fn (array $r): array => ['name' => $r['typname'], 'schema' => $r['nspname']], $ctx->renderFrom('functions', 'get_types.sql') === '' ? [] : $ctx->conn->rows($ctx->renderFrom('functions', 'get_types.sql'))),
            'languages' => array_column($ctx->conn->rows($ctx->renderFrom('functions', 'get_languages.sql')), 'value'),
            'variables' => $ctx->conn->rows($ctx->renderFrom('functions', 'variables.sql')),
            'support_functions' => array_column($ctx->conn->rows($ctx->renderFrom('functions', 'get_support_functions.sql', ['show_system_objects' => false])), 'sfunctions'),
            'roles' => Catalog::roles($ctx->conn),
            'schemas' => Catalog::schemas($ctx->conn),
        ];
    }

    /** @return array<string, mixed> the row of properties.sql */
    private function row(NodeContext $ctx, int $oid): array
    {
        return $ctx->row('properties.sql', ['fnid' => $oid, 'scid' => null]) ?? throw $this->gone($ctx);
    }

    /** "name(integer, text)": the routine as the tree and the list name it. */
    protected function signature(array $row): string
    {
        if (isset($row['name_with_args'])) {
            return (string) $row['name_with_args'];
        }

        return $row['name'] . '(' . trim((string) ($row['proargtypenames'] ?? ''), '()') . ')';
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, $row);
        $node['inode'] = false;

        return $node;
    }
}
