<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Types\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Core\Nodes\Options;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * The domain node, after pgAdmin's DomainView: the domains of a schema with their base type,
 * default, NOT NULL, collation and check constraints, and the statements that create, alter
 * and drop one. The constraints are edited with the domain (pgAdmin's domain_constraints
 * node is folded in).
 *
 * The client's data carries pgAdmin's field names: name, basensp, basetype, typlen,
 * precision, typdefault, typnotnull, collname, owner, description, constraints [{conoid?,
 * conname, consrc, convalidated, description}], seclabels.
 */
final class DomainController extends NodeController
{
    public function list(NodeContext $ctx): array
    {
        $rows = [];
        foreach ($ctx->rows('properties.sql') as $row) {
            $row['sysdomain'] = (int) $row['oid'] <= DatabaseController::LAST_SYSTEM_OID;
            $row['constraints'] = $ctx->rows('get_constraints.sql', ['doid' => (int) $row['oid']]);
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
        $row = $ctx->row('node.sql', ['scid' => null, 'doid' => $oid]) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    /** The properties with the length and precision parsed, the constraints and the security labels. */
    public function properties(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('properties.sql', ['doid' => $oid]) ?? throw $this->gone($ctx);
        [$row['typlen'], $row['precision']] = $this->parseType((string) $row['fulltype']);
        $row['constraints'] = $ctx->rows('get_constraints.sql', ['doid' => $oid]);
        $row['seclabels'] = Options::parseSecurityLabels($row['seclabels'] ?? null);
        $row['sysdomain'] = $oid <= DatabaseController::LAST_SYSTEM_OID;

        return $row;
    }

    /** The "SQL" tab: the commented header and DROP, then CREATE DOMAIN with its constraints, owner, comment and labels. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        $data = $this->properties($ctx, $oid);
        $header = sprintf("-- DOMAIN: %s.%s\n\n-- DROP DOMAIN IF EXISTS %s;", $data['basensp'], $data['name'], Quoting::ident((string) $data['basensp'], (string) $data['name']));

        return Ddl::assemble([$header, $ctx->render('create.sql', ['data' => $data])]);
    }

    /** CREATE DOMAIN; the new domain's node. */
    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($ctx, $data);
        $this->execute($ctx, $ctx->render('create.sql', ['data' => $data]));

        $oid = $ctx->conn->scalar($ctx->render('get_oid.sql', ['doid' => null, 'basensp' => $data['basensp'], 'name' => $data['name']])) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $oid);
    }

    /** The ALTERs for what the client's data changes; a new base type or collation drops and recreates the domain. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));

        return $this->node($ctx, $oid);
    }

    /** DROP DOMAIN, CASCADE on request. */
    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = $ctx->row('delete.sql', ['scid' => $ctx->id('scid'), 'doid' => $oid]) ?? throw $this->gone($ctx);
        $this->execute($ctx, $ctx->render('delete.sql', ['scid' => null, 'doid' => null, 'name' => $row['name'], 'basensp' => $row['basensp'], 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid === null) {
            return $ctx->render('create.sql', ['data' => $this->forCreate($ctx, $data)]);
        }

        return $this->updateSql($ctx, $oid, $data);
    }

    /**
     * What the editor offers: the types a domain may be based on, the collations and the roles.
     *
     * @return array<string, mixed>
     */
    public function options(NodeContext $ctx): array
    {
        return [
            'types' => array_map(static fn (array $r): array => ['name' => $r['typname'], 'schema' => $r['nspname'], 'is_collatable' => (bool) $r['is_collatable']], $ctx->conn->rows($ctx->renderFrom('types', 'get_types.sql'))),
            'collations' => array_column($ctx->conn->rows($ctx->render('get_collations.sql')), 'copy_collation'),
            'roles' => Catalog::roles($ctx->conn),
        ];
    }

    /** A domain by schema and name: resolve('domain', {schema, name}) → {scid, doid}. */
    public function resolve(NodeContext $ctx, array $params): ?array
    {
        $schema = (string) ($params['schema'] ?? '');
        $name = (string) ($params['name'] ?? '');
        if ($schema === '' || $name === '') {
            return null;
        }
        $row = $ctx->conn->row(
            "SELECT t.oid, t.typnamespace FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = $1 AND t.typname = $2 AND t.typtype = 'd'",
            [$schema, $name],
        );

        return $row === null ? null : ['scid' => (int) $row['typnamespace'], 'doid' => (int) $row['oid']];
    }

    /**
     * update.sql (or domain_schema_diff.sql when the base type or collation changes) against
     * the domain as it stands: pgAdmin's get_sql in edit mode. A full constraint list from the
     * editor is turned into the change lists the template takes.
     *
     * @param array<string, mixed> $data
     */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $old = $this->properties($ctx, $oid);
        $byOid = [];
        foreach ($old['constraints'] as $constraint) {
            $byOid[(int) $constraint['conoid']] = $constraint;
        }
        $oldForTemplate = [...$old, 'constraints' => $byOid];

        foreach (['name', 'owner', 'description', 'typdefault', 'collname'] as $key) {
            if (array_key_exists($key, $data) && (string) ($data[$key] ?? '') === (string) ($old[$key] ?? '')) {
                unset($data[$key]);
            }
        }
        if (array_key_exists('owner', $data) && trim((string) $data['owner']) === '') {
            unset($data['owner']);
        }
        if (array_key_exists('typnotnull', $data)) {
            $data['typnotnull'] = filter_var($data['typnotnull'], FILTER_VALIDATE_BOOL);
            if ($data['typnotnull'] === (bool) $old['typnotnull']) {
                unset($data['typnotnull']);
            }
        }
        if (array_key_exists('basensp', $data) && (string) $data['basensp'] === (string) $old['basensp']) {
            unset($data['basensp']);
        }
        // The base type only changes through a recreation: compare the full type.
        $newType = $this->fullType($data);
        if ($newType !== null && $newType === $this->fullType($old)) {
            unset($data['basetype'], $data['typlen'], $data['precision'], $data['fulltype']);
        }
        if (isset($data['constraints']) && is_array($data['constraints']) && array_is_list($data['constraints'])) {
            $data['constraints'] = $this->constraintChanges($data['constraints'], $old['constraints']);
        }

        $recreate = isset($data['basetype']) || isset($data['fulltype']) || isset($data['collname']);
        if ($recreate) {
            // domain_schema_diff.sql rebuilds the domain from the full type and the "added" constraints.
            $merged = $this->mergedConstraints($data['constraints'] ?? null, $old['constraints']);
            $data = [...$old, ...$data, 'constraints' => ['added' => $merged]];
            $data['fulltype'] = $this->fullType($data) ?? $old['fulltype'];
        }

        return $ctx->render($recreate ? 'domain_schema_diff.sql' : 'update.sql', ['data' => $data, 'o_data' => $oldForTemplate]);
    }

    /**
     * The client's data as create.sql takes it, in the route's schema.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function forCreate(NodeContext $ctx, array $data): array
    {
        $data['name'] = $this->requireName($data);
        $data['basetype'] = $this->requireName($data, 'basetype');
        $data['basensp'] = (string) ($ctx->conn->scalar('SELECT nspname FROM pg_catalog.pg_namespace WHERE oid = $1', [$ctx->id('scid')]) ?? throw $this->notFound('Could not find the schema.'));
        foreach (['owner', 'description', 'collname', 'typdefault', 'typlen', 'precision'] as $key) {
            if (array_key_exists($key, $data) && trim((string) ($data[$key] ?? '')) === '') {
                unset($data[$key]);
            }
        }
        $data['typnotnull'] = filter_var($data['typnotnull'] ?? false, FILTER_VALIDATE_BOOL);
        $data['constraints'] = array_values(array_filter((array) ($data['constraints'] ?? []), static fn ($c): bool => is_array($c) && trim((string) ($c['consrc'] ?? '')) !== ''));
        foreach ($data['constraints'] as $i => $constraint) {
            $data['constraints'][$i]['convalidated'] = filter_var($constraint['convalidated'] ?? true, FILTER_VALIDATE_BOOL);
            if (trim((string) ($constraint['conname'] ?? '')) === '') {
                throw new BadRequestException('Each domain constraint needs a name.');
            }
        }

        return $data;
    }

    /**
     * A full constraint list from the editor against the old ones, as {added, changed,
     * deleted}: matched by conoid. A changed check expression is a drop and an add, since
     * PostgreSQL cannot alter one.
     *
     * @param list<array<string, mixed>> $new
     * @param list<array<string, mixed>> $old
     * @return array{added: list<array<string, mixed>>, changed: list<array<string, mixed>>, deleted: list<array<string, mixed>>}
     */
    private function constraintChanges(array $new, array $old): array
    {
        $changes = ['added' => [], 'changed' => [], 'deleted' => []];
        $seen = [];
        foreach ($new as $constraint) {
            if (!is_array($constraint) || trim((string) ($constraint['consrc'] ?? '')) === '') {
                continue;
            }
            $constraint['convalidated'] = filter_var($constraint['convalidated'] ?? true, FILTER_VALIDATE_BOOL);
            $conoid = $constraint['conoid'] ?? null;
            $was = $conoid === null ? null : (array_values(array_filter($old, static fn (array $o): bool => (int) $o['conoid'] === (int) $conoid))[0] ?? null);
            if ($was === null) {
                $changes['added'][] = $constraint;
                continue;
            }
            if (trim((string) $constraint['consrc']) !== trim((string) $was['consrc'])) {
                $changes['deleted'][] = ['conoid' => (int) $conoid];
                $changes['added'][] = $constraint;
                continue;
            }
            $seen[] = (int) $conoid;
            if ((string) ($constraint['conname'] ?? '') !== (string) $was['conname'] || ($constraint['convalidated'] && !$was['convalidated'])) {
                $changes['changed'][] = [...$constraint, 'conoid' => (int) $conoid];
            }
        }
        foreach ($old as $constraint) {
            if (!in_array((int) $constraint['conoid'], $seen, true) && !in_array(['conoid' => (int) $constraint['conoid']], $changes['deleted'], true)) {
                $changes['deleted'][] = ['conoid' => (int) $constraint['conoid']];
            }
        }

        return $changes;
    }

    /**
     * The constraints a recreated domain gets: the old ones with the change lists applied.
     *
     * @param array<string, mixed>|null $changes
     * @param list<array<string, mixed>> $old
     * @return list<array<string, mixed>>
     */
    private function mergedConstraints(?array $changes, array $old): array
    {
        if ($changes === null) {
            return $old;
        }
        $deleted = array_map(static fn (array $c): int => (int) $c['conoid'], (array) ($changes['deleted'] ?? []));
        $result = [];
        foreach ($old as $constraint) {
            if (in_array((int) $constraint['conoid'], $deleted, true)) {
                continue;
            }
            foreach ((array) ($changes['changed'] ?? []) as $change) {
                if ((int) ($change['conoid'] ?? -1) === (int) $constraint['conoid']) {
                    $constraint = [...$constraint, ...$change];
                }
            }
            $result[] = $constraint;
        }

        return [...$result, ...(array) ($changes['added'] ?? [])];
    }

    /** "numeric(10,2)" as the base type, length and precision spell it, for comparing a change. */
    private function fullType(array $data): ?string
    {
        if (!isset($data['basetype'])) {
            return null;
        }
        $type = (string) $data['basetype'];
        $length = trim((string) ($data['typlen'] ?? ''));
        $precision = trim((string) ($data['precision'] ?? ''));
        if ($length !== '') {
            $type .= '(' . $length . ($precision !== '' ? ',' . $precision : '') . ')';
        }

        return $type;
    }

    /**
     * The length and precision of "numeric(10,2)": pgAdmin's _parse_type.
     *
     * @return array{0: string, 1: string}
     */
    private function parseType(string $fullType): array
    {
        $open = strpos($fullType, '(');
        if ($open === false || $open === 0) {
            return ['', ''];
        }
        $parts = explode(',', substr($fullType, $open + 1, -1));

        return [trim($parts[0]), isset($parts[1]) ? trim($parts[1]) : ''];
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, $row);
        $node['inode'] = false;

        return $node;
    }
}
