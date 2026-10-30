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
 * DROP. pgAdmin's node is read-only; this one also creates and alters, as the classic
 * phpPgAdmin's aggregate form does. A changed definition is CREATE OR REPLACE AGGREGATE
 * (PostgreSQL keeps the kind, the argument types and the result type); the owner, comment,
 * name and schema are ALTERs.
 */
final class AggregateController extends NodeController
{
    /** The fields of the definition, which only CREATE OR REPLACE changes. */
    private const array DEFINITION = [
        'state_func', 'state_type', 'state_data_size', 'final_func', 'final_extra_param', 'final_func_modify',
        'combine_func', 'serialization_func', 'deserialization_func', 'initial_val',
        'moving_state_func', 'moving_inverse_func', 'moving_state_type', 'moving_state_data_size',
        'moving_final_func', 'moving_final_extra_param', 'moving_final_func_modify', 'moving_initial_val',
        'sort_oper', 'parallel',
    ];

    private const array FLAGS = ['final_extra_param', 'moving_final_extra_param'];

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
        $create = $ctx->render('create.sql', ['data' => $data, 'replace' => true]);
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

    /** CREATE AGGREGATE from the client's data, then its owner and comment; the new aggregate's node. */
    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($ctx, $data);
        $this->execute($ctx, $this->createSql($ctx, $data));
        $oid = $ctx->conn->scalar($ctx->render('get_oid.sql', ['scid' => $ctx->id('scid'), 'name' => $data['name']])) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $oid);
    }

    /** CREATE OR REPLACE for a changed definition, then the ALTERs for the owner, comment, name and schema. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));

        return $this->node($ctx, $oid);
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        return $oid === null ? $this->createSql($ctx, $this->forCreate($ctx, $data)) : $this->updateSql($ctx, $oid, $data);
    }

    /** @param array<string, mixed> $data */
    private function createSql(NodeContext $ctx, array $data): string
    {
        $sql = $ctx->render('create.sql', ['data' => $data, 'replace' => false]);
        $extra = ['name' => null, 'schema' => null, 'owner' => $data['owner'], 'description' => $data['description'] === null || $data['description'] === '' ? null : $data['description']];

        return Ddl::assemble([$sql, $ctx->render('update.sql', ['data' => $extra, 'o_data' => $data])]);
    }

    /**
     * The client's data as create.sql takes it: in the route's schema, a name, a state function
     * and type, blanks as absences and the flags as booleans.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function forCreate(NodeContext $ctx, array $data): array
    {
        $data = $this->normalize($data);
        $data['name'] = $this->requireName($data);
        $data['schema'] = (string) ($ctx->conn->scalar('SELECT nspname FROM pg_catalog.pg_namespace WHERE oid = $1', [$ctx->id('scid')]) ?? throw $this->notFound('Could not find the schema.'));
        if ($data['state_func'] === null || $data['state_type'] === null) {
            throw $this->incomplete('definition: the state function and state type are required');
        }
        if (!in_array($data['kind'], ['normal', 'ordered-set', 'hypothetical-set'], true)) {
            $data['kind'] = 'normal';
        }

        return $data;
    }

    /**
     * The statements an edit runs: CREATE OR REPLACE AGGREGATE under the old name when any
     * definition field differs, then update.sql with only the owner, comment, name and schema
     * that differ.
     *
     * @param array<string, mixed> $data
     */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $old = $this->properties($ctx, $oid);
        $new = $this->normalize($data);
        $parts = [];

        $definition = [];
        $changed = false;
        foreach (self::DEFINITION as $key) {
            $definition[$key] = array_key_exists($key, $data) ? $new[$key] : $old[$key];
            if (self::differs($definition[$key], $old[$key])) {
                $changed = true;
            }
        }
        if ($changed) {
            $parts[] = $ctx->render('create.sql', ['data' => [...$old, ...$definition], 'replace' => true]);
        }

        $changes = ['owner' => null, 'description' => null, 'name' => null, 'schema' => null];
        foreach (array_keys($changes) as $key) {
            if (array_key_exists($key, $data) && $new[$key] !== null && self::differs($new[$key], $old[$key])) {
                $changes[$key] = $new[$key];
            }
        }
        // A cleared comment is a change too: COMMENT … IS '' removes it.
        if (array_key_exists('description', $data) && $new['description'] === null && ($old['description'] ?? '') !== '') {
            $changes['description'] = '';
        }
        $parts[] = $ctx->render('update.sql', ['data' => $changes, 'o_data' => $old]);

        return Ddl::assemble($parts);
    }

    /**
     * Trimmed strings with blanks as null, and the flags as booleans.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function normalize(array $data): array
    {
        $out = [];
        foreach ([...self::DEFINITION, 'name', 'schema', 'owner', 'description', 'kind', 'input_types'] as $key) {
            $value = $data[$key] ?? null;
            if (in_array($key, self::FLAGS, true)) {
                $out[$key] = filter_var($value, FILTER_VALIDATE_BOOL);
                continue;
            }
            $value = $value === null || is_bool($value) ? null : trim((string) $value);
            $out[$key] = $value === '' ? null : $value;
        }

        return $out;
    }

    private static function differs(mixed $a, mixed $b): bool
    {
        if (is_bool($a) || is_bool($b)) {
            return (bool) $a !== (bool) $b;
        }

        return (string) ($a ?? '') !== (string) ($b ?? '');
    }

    /** @param array<string, mixed> $row */
    private function decorate(array $row): array
    {
        $row['signature'] = $row['name'] . '(' . $row['input_types'] . ')';
        $row['is_sys_obj'] = (int) $row['oid'] <= DatabaseController::LAST_SYSTEM_OID;
        foreach (self::FLAGS as $flag) {
            $row[$flag] = (bool) $row[$flag];
        }
        // The default modify setting says nothing in the DDL; only the others are spelled. It is
        // READ_ONLY for a normal aggregate and READ_WRITE for an ordered-set one.
        $default = $row['kind'] === 'normal' ? 'READ_ONLY' : 'READ_WRITE';
        if ($row['final_func_modify'] === $default || $row['final_func_modify'] === 'unknown') {
            $row['final_func_modify'] = null;
        }
        if ($row['moving_final_func_modify'] === 'READ_ONLY' || $row['moving_final_func_modify'] === 'unknown') {
            $row['moving_final_func_modify'] = null;
        }
        foreach (['state_data_size', 'moving_state_data_size'] as $key) {
            if ((int) $row[$key] === 0) {
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
