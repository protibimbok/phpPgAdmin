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
 * OPERATOR that describes one, and DROP. pgAdmin's node is read-only; this one also creates
 * and alters. ALTER OPERATOR changes only the estimators, owner, schema and comment, so a new
 * name, function, operand, commutator, negator, HASHES or MERGES drops the operator and
 * creates it again, as the collation editor does for a new definition.
 */
final class OperatorController extends NodeController
{
    /** The fields only DROP and CREATE change. */
    private const array DEFINITION = ['name', 'operproc', 'lefttype', 'righttype', 'commutator', 'negator', 'support_hash', 'support_merge'];

    private const array FIELDS = [...self::DEFINITION, 'restrproc', 'joinproc', 'owner', 'description', 'schema'];

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

    /** CREATE OPERATOR from the client's data, then its owner and comment; the new operator's node. */
    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($ctx, $data);
        $this->execute($ctx, $this->createSql($ctx, $data));

        return $this->node($ctx, $this->oidOf($ctx, $data));
    }

    /** The ALTERs, or DROP and CREATE, for what the client's data changes; the operator's node, which may have a new OID. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        [$sql, $identity] = $this->updateSql($ctx, $oid, $data);
        $this->execute($ctx, $sql);

        return $this->node($ctx, $this->oidOf($ctx, $identity, $identity['scid'] ?? null));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        return $oid === null ? $this->createSql($ctx, $this->forCreate($ctx, $data)) : $this->updateSql($ctx, $oid, $data)[0];
    }

    /** @param array<string, mixed> $data */
    private function createSql(NodeContext $ctx, array $data): string
    {
        $extra = ['owner' => $data['owner'], 'description' => $data['description'], 'restrproc' => null, 'joinproc' => null, 'schema' => null];

        return Ddl::assemble([$ctx->render('create.sql', ['data' => $data]), $ctx->render('update.sql', ['data' => $extra, 'o_data' => $data])]);
    }

    /**
     * The client's data with the route's schema, a name, a function and at least the right
     * operand (PostgreSQL 14 dropped postfix operators).
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function forCreate(NodeContext $ctx, array $data): array
    {
        $data = $this->normalize($data);
        $data['name'] = $this->requireName($data);
        $data['schema'] = $this->schemaName($ctx, $ctx->id('scid'));
        if ($data['operproc'] === null || $data['righttype'] === null) {
            throw $this->incomplete('definition: the function and the right operand type are required');
        }

        return $data;
    }

    /**
     * The statements an edit runs and the operator's identity after them. A changed definition
     * is DROP and CREATE with the old owner and comment carried over unless they change too;
     * otherwise update.sql runs the ALTERs for what differs.
     *
     * @param array<string, mixed> $data
     * @return array{0: string, 1: array<string, mixed>}
     */
    private function updateSql(NodeContext $ctx, int $oid, array $data): array
    {
        $old = $this->properties($ctx, $oid);
        $new = $this->normalize($data);
        $merged = $old;
        foreach (self::FIELDS as $key) {
            if (array_key_exists($key, $data)) {
                $merged[$key] = $new[$key];
            }
        }
        $merged['schema'] ??= $old['schema'];
        $merged['name'] ??= $old['name'];
        if ($merged['operproc'] === null || $merged['righttype'] === null) {
            throw $this->incomplete('definition: the function and the right operand type are required');
        }

        $recreate = false;
        foreach (self::DEFINITION as $key) {
            $recreate = $recreate || self::differs($merged[$key], $old[$key]);
        }

        if ($recreate) {
            $created = [...$merged, 'schema' => $old['schema']];
            $parts = [
                "-- WARNING:\n-- ALTER OPERATOR cannot change the name, function, operands, commutator, negator,\n-- HASHES or MERGES, so the operator is dropped and created again.",
                $this->dropSql($ctx, $old),
                $ctx->render('create.sql', ['data' => $created]),
                $ctx->render('update.sql', ['data' => [
                    'owner' => $merged['owner'],
                    'description' => $merged['description'],
                    'restrproc' => null,
                    'joinproc' => null,
                    'schema' => self::differs($merged['schema'], $old['schema']) ? $merged['schema'] : null,
                ], 'o_data' => $created]),
            ];
        } else {
            $changes = [];
            foreach (['restrproc', 'joinproc', 'description'] as $key) {
                // null means unchanged here, so a cleared value is '' (NONE, or no comment).
                $changes[$key] = self::differs($merged[$key], $old[$key]) ? (string) ($merged[$key] ?? '') : null;
            }
            foreach (['owner', 'schema'] as $key) {
                $changes[$key] = $merged[$key] !== null && self::differs($merged[$key], $old[$key]) ? $merged[$key] : null;
            }
            $parts = [$ctx->render('update.sql', ['data' => $changes, 'o_data' => $old])];
        }

        $identity = ['name' => $merged['name'], 'lefttype' => $merged['lefttype'], 'righttype' => $merged['righttype'], 'scid' => null];
        if (self::differs($merged['schema'], $old['schema'])) {
            $identity['scid'] = (int) ($ctx->conn->scalar('SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = $1', [$merged['schema']]) ?? $ctx->id('scid'));
        }

        return [Ddl::assemble($parts), $identity];
    }

    /** @param array<string, mixed> $data the operator's name and operand types */
    private function oidOf(NodeContext $ctx, array $data, ?int $scid = null): int
    {
        $vars = ['scid' => $scid ?? $ctx->id('scid'), 'name' => $data['name'], 'lefttype' => $data['lefttype'], 'righttype' => $data['righttype']];

        return (int) ($ctx->conn->scalar($ctx->render('get_oid.sql', $vars)) ?? throw $this->gone($ctx));
    }

    private function schemaName(NodeContext $ctx, int $scid): string
    {
        return (string) ($ctx->conn->scalar('SELECT nspname FROM pg_catalog.pg_namespace WHERE oid = $1', [$scid]) ?? throw $this->notFound('Could not find the schema.'));
    }

    /**
     * Trimmed strings with blanks as null, and HASHES and MERGES as booleans.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function normalize(array $data): array
    {
        $out = [];
        foreach (self::FIELDS as $key) {
            $value = $data[$key] ?? null;
            if ($key === 'support_hash' || $key === 'support_merge') {
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
