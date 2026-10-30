<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Types\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Acl;
use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Core\Nodes\Options;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;
use PhpPgAdmin\Modules\Tables\Ddl\ColumnTypes;

/**
 * The type node, after pgAdmin's TypeView: the composite, enum, range, base and shell types of
 * a schema (domains have their own node), with the members, labels or range settings pgAdmin
 * adds to the properties, and the statements that create, alter and drop one.
 *
 * The client's data carries pgAdmin's field names: name, schema, typtype ('c', 'e', 'r', 'b',
 * 'p'), typeowner, description, composite [{attnum?, member_name, type, tlength, precision,
 * collation}], enum [{label, old_label?}], typname (a range's subtype), opcname, collname,
 * rngcanonical, rngsubdiff, rngmultirangetype, typacl, seclabels.
 */
final class TypeController extends NodeController
{
    /** The privilege codes a type accepts. */
    private const array ACL = ['U'];

    private const array STORAGE = ['p' => 'PLAIN', 'e' => 'EXTERNAL', 'm' => 'MAIN', 'x' => 'EXTENDED'];

    private const array ALIGN = ['c' => 'char', 's' => 'int2', 'i' => 'int4', 'd' => 'double'];

    /** A base type's functions ALTER TYPE … SET (…) can change. */
    private const array ALTERABLE_FUNCTIONS = ['typreceive', 'typsend', 'typmodin', 'typmodout', 'typanalyze', 'typsubscript'];

    /** A base type's functions, as CREATE TYPE names them. */
    private const array BASE_FUNCTIONS = ['typinput', 'typoutput', ...self::ALTERABLE_FUNCTIONS];

    /** A function name the templates write as it is: name or schema.name, plain or quoted. */
    private const string FUNCTION_NAME = '/^(?:"(?:[^"]|"")+"|[\p{L}_][\p{L}\p{N}_$]*)(?:\.(?:"(?:[^"]|"")+"|[\p{L}_][\p{L}\p{N}_$]*))?$/u';

    /** A type name the templates write as it is (ELEMENT, LIKE): identifiers, dots, spaces, quotes, brackets. */
    private const string TYPE_NAME = '/^[\p{L}\p{N}_$ ."\[\]]+$/u';

    /** @return array<string, mixed> */
    private function vars(NodeContext $ctx, ?int $oid = null): array
    {
        $vars = ['datlastsysoid' => DatabaseController::LAST_SYSTEM_OID, 'show_system_objects' => $ctx->flag('system_objects')];
        if ($oid !== null) {
            $vars['tid'] = $oid;
        }

        return $vars;
    }

    /** Every type of the schema, each with the summary of its members, labels or subtype. */
    public function list(NodeContext $ctx): array
    {
        $rows = [];
        foreach ($ctx->rows('properties.sql', $this->vars($ctx)) as $row) {
            $rows[] = [...$row, ...$this->additional($ctx, $row, (int) $row['oid'])];
        }

        return $rows;
    }

    public function nodes(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->toNode($ctx, $row), $ctx->rows('nodes.sql', $this->vars($ctx)));
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('nodes.sql', [...$this->vars($ctx, $oid), 'show_system_objects' => true]) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    /** The properties with the privileges and, by kind, the members, labels or range settings. */
    public function properties(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('properties.sql', [...$this->vars($ctx, $oid), 'show_system_objects' => true]) ?? throw $this->gone($ctx);
        $row['typacl'] = [];
        foreach ($ctx->rows('acl.sql', ['scid' => $ctx->id('scid'), 'tid' => $oid]) as $acl) {
            $row[$acl['deftype']][] = Acl::fromDb($acl);
        }

        return [...$row, ...$this->additional($ctx, $row, $oid)];
    }

    /** The "SQL" tab: "-- Type: name", the commented DROP, then CREATE TYPE as pgAdmin's sql() renders it. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        $data = $this->properties($ctx, $oid);
        foreach ($data as $key => $value) {
            if ($value === '-') {
                $data[$key] = null;
            }
        }
        $data['typacl'] = Acl::toDb($data['typacl'], self::ACL);
        $data = $this->convertForSql($data);
        if (isset($data['composite'])) {
            $this->formatMembers($data['composite']);
            $data['composite'] = array_values($data['composite']);
        }

        $header = "-- Type: {$data['name']}\n\n-- " . $ctx->render('delete.sql', ['data' => $data, 'cascade' => false]);

        return Ddl::assemble([$header, $ctx->render('create.sql', ['data' => $data, 'is_sql' => true])]);
    }

    /** CREATE TYPE from the client's data; the new type's node. */
    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($ctx, $data);
        $this->execute($ctx, $ctx->render('create.sql', ['data' => $data]));

        $oid = $ctx->conn->scalar($ctx->render('get_oid.sql', ['scid' => $ctx->id('scid'), 'data' => $data])) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $oid);
    }

    /** The ALTERs for what the client's data changes; a new subtype or collation drops and recreates the type. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));

        return $this->node($ctx, $oid);
    }

    /** DROP TYPE, CASCADE on request. */
    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = $ctx->row('properties.sql', [...$this->vars($ctx, $oid), 'show_system_objects' => true]) ?? throw $this->gone($ctx);
        $this->execute($ctx, $ctx->render('delete.sql', ['data' => $row, 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid === null) {
            return $ctx->render('create.sql', ['data' => $this->forCreate($ctx, $data)]);
        }

        return $this->updateSql($ctx, $oid, $data);
    }

    /**
     * What the editor offers: the types a member or a domain may have, the collations, the
     * subtypes a range may be built on (with the operator classes of the one asked for), the
     * roles and schemas.
     *
     * @return array<string, mixed>
     */
    public function options(NodeContext $ctx, string $subtype = ''): array
    {
        return [
            'types' => array_map(static fn (array $r): array => ['name' => $r['typname'], 'schema' => $r['nspname'], 'is_collatable' => (bool) $r['is_collatable']], $ctx->conn->rows($ctx->render('get_types.sql'))),
            'collations' => array_column($ctx->conn->rows($ctx->render('get_collations.sql')), 'collation'),
            'subtypes' => array_map(static fn (array $r): array => ['name' => $r['stype'], 'is_collatable' => (bool) $r['is_collate']], $ctx->conn->rows($ctx->render('get_subtypes.sql', ['subtype' => true]))),
            'opclasses' => $subtype === '' ? [] : array_column($ctx->conn->rows($ctx->render('get_subtypes.sql', ['subtype_opclass' => true, 'data' => ['typname' => $subtype]])), 'opcname'),
            'roles' => Catalog::roles($ctx->conn),
            'schemas' => Catalog::schemas($ctx->conn),
            'functions' => array_column($ctx->conn->rows($ctx->render('get_external_functions.sql', ['extfunc' => true])), 'func'),
            'typmodin' => array_column($ctx->conn->rows($ctx->render('get_external_functions.sql', ['typemodin' => true])), 'func'),
            'typmodout' => array_column($ctx->conn->rows($ctx->render('get_external_functions.sql', ['typemodout' => true])), 'func'),
            'version' => $ctx->version(),
        ];
    }

    /** A type by schema and name: resolve('type', {schema, name}) → {scid, tid}. */
    public function resolve(NodeContext $ctx, array $params): ?array
    {
        $schema = (string) ($params['schema'] ?? '');
        $name = (string) ($params['name'] ?? '');
        if ($schema === '' || $name === '') {
            return null;
        }
        $row = $ctx->conn->row(
            "SELECT t.oid, t.typnamespace FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = $1 AND t.typname = $2 AND t.typtype <> 'd'",
            [$schema, $name],
        );

        return $row === null ? null : ['scid' => (int) $row['typnamespace'], 'tid' => (int) $row['oid']];
    }

    /**
     * update.sql (or type_schema_diff.sql when the subtype, collation or conversion functions
     * change) against the type as it stands: pgAdmin's get_sql in edit mode. Full member and
     * label lists from the editor are turned into the change lists the templates take.
     *
     * @param array<string, mixed> $data
     */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $old = $this->convertForSql($this->properties($ctx, $oid));
        if (isset($data['composite']) && is_array($data['composite']) && array_is_list($data['composite'])) {
            $data['composite'] = $this->memberChanges($data['composite'], (array) ($old['composite'] ?? []));
        }
        if (isset($data['enum']) && is_array($data['enum']) && array_is_list($data['enum'])) {
            $data['enum'] = $this->labelChanges($data['enum'], (array) ($old['enum'] ?? []));
        }
        foreach (['typeowner', 'description', 'name'] as $key) {
            if (array_key_exists($key, $data) && (string) ($data[$key] ?? '') === (string) ($old[$key] ?? '')) {
                unset($data[$key]);
            }
        }
        if (array_key_exists('typeowner', $data) && trim((string) $data['typeowner']) === '') {
            unset($data['typeowner']);
        }
        // A range's settings and a base type's functions only change through a recreation.
        foreach (['typname', 'collname', 'typinput', 'typoutput', 'opcname', 'rngcanonical', 'rngsubdiff'] as $key) {
            if (array_key_exists($key, $data) && (string) ($data[$key] ?? '') === (string) ($old[$key] ?? '')) {
                unset($data[$key]);
            }
        }
        if (($old['typtype'] ?? '') === 'b') {
            $data = $this->alterableBaseSettings($data, $old);
        }
        if (isset($data['typtype']) && $data['typtype'] === $old['typtype'] && !isset($data['typname']) && !isset($data['collname']) && !isset($data['typinput']) && !isset($data['typoutput'])) {
            unset($data['typtype']);
        }
        $data = $this->convertForSql($data);
        if (isset($data['typacl']) && is_array($data['typacl']) && !array_is_list($data['typacl'])) {
            foreach (['added', 'changed', 'deleted'] as $mode) {
                if (isset($data['typacl'][$mode])) {
                    $data['typacl'][$mode] = Acl::toDb($data['typacl'][$mode], self::ACL);
                }
            }
        }
        foreach (['added', 'changed', 'deleted'] as $mode) {
            if (isset($data['composite'][$mode])) {
                $this->formatMembers($data['composite'][$mode]);
            }
        }

        $recreate = array_intersect_key($data, array_flip(['typtype', 'typname', 'collname', 'typinput', 'typoutput'])) !== [];
        if ($recreate) {
            // type_schema_diff.sql rebuilds the type from the change lists: the full lists stand in.
            $data['typtype'] ??= $old['typtype'];
            if ($data['typtype'] === 'c') {
                $members = $this->mergedMembers($data['composite'] ?? null, (array) ($old['composite'] ?? []));
                $this->formatMembers($members);
                $data['composite'] = ['added' => $members];
            }
            if ($data['typtype'] === 'e') {
                $data['enum'] = ['added' => $this->mergedLabels($data['enum'] ?? null, (array) ($old['enum'] ?? []))];
            }
        }

        return $ctx->render($recreate ? 'type_schema_diff.sql' : 'update.sql', ['data' => $data, 'o_data' => $old]);
    }

    /**
     * The client's data as create.sql takes it, in the route's schema: pgAdmin's
     * _checks_for_create_type, _convert_for_sql and member formatting.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function forCreate(NodeContext $ctx, array $data): array
    {
        $data['name'] = $this->requireName($data);
        $kind = (string) ($data['typtype'] ?? '');
        if (!in_array($kind, ['c', 'e', 'r', 'b', 'p'], true)) {
            throw new BadRequestException('Could not find the required parameter (typtype).');
        }
        if ($kind === 'r' && trim((string) ($data['typname'] ?? '')) === '') {
            throw new BadRequestException('Subtype must be defined for range types.');
        }
        if ($kind === 'b' && (trim((string) ($data['typinput'] ?? '')) === '' || trim((string) ($data['typoutput'] ?? '')) === '')) {
            throw new BadRequestException('External types require both input and output conversion functions.');
        }
        if ($kind === 'b') {
            $data = $this->baseSettings($data);
        }
        $data['schema'] = (string) ($ctx->conn->scalar('SELECT nspname FROM pg_catalog.pg_namespace WHERE oid = $1', [$ctx->id('scid')]) ?? throw $this->notFound('Could not find the schema.'));
        foreach (['typeowner', 'description', 'collname', 'opcname', 'rngcanonical', 'rngsubdiff', 'rngmultirangetype'] as $key) {
            if (array_key_exists($key, $data) && trim((string) ($data[$key] ?? '')) === '') {
                unset($data[$key]);
            }
        }
        if (isset($data['typacl']) && is_array($data['typacl'])) {
            $data['typacl'] = Acl::toDb($data['typacl'], self::ACL);
        }
        $data = $this->convertForSql($data);
        $data['composite'] = array_values(array_filter((array) ($data['composite'] ?? []), static fn ($m): bool => is_array($m) && trim((string) ($m['member_name'] ?? '')) !== '' && trim((string) ($m['type'] ?? '')) !== ''));
        $this->formatMembers($data['composite']);
        $data['enum'] = array_values(array_filter((array) ($data['enum'] ?? []), static fn ($e): bool => is_array($e) && trim((string) ($e['label'] ?? '')) !== ''));
        if ($kind === 'c' && $data['composite'] === []) {
            throw new BadRequestException('A composite type needs at least one member.');
        }
        if ($kind === 'e' && $data['enum'] === []) {
            throw new BadRequestException('An enum type needs at least one label.');
        }

        return $data;
    }

    /**
     * pgAdmin's additional_properties: the members of a composite type (with their type split
     * into name, length, precision and array flag for the editor), the labels of an enum, the
     * settings of a range, and the security labels as objects.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function additional(NodeContext $ctx, array $row, int $tid): array
    {
        $kind = (string) ($row['typtype'] ?? '');
        $result = ['seclabels' => Options::parseSecurityLabels($row['seclabels'] ?? null)];

        if ($kind === 'c') {
            $members = [];
            $texts = [];
            foreach ($ctx->rows('additional_properties.sql', ['typtype' => 'c', 'typrelid' => $row['typrelid']]) as $member) {
                $noCollation = empty($member['collname']) || ($member['collname'] === 'default' && $member['collnspname'] === 'pg_catalog');
                $collation = $noCollation ? '' : Quoting::ident((string) $member['collnspname'], (string) $member['collname']);
                $texts[] = $member['attname'] . ' ' . $member['fulltype'] . ($collation === '' ? '' : ' COLLATE ' . $collation);

                $typeName = ColumnTypes::parseTypeName((string) $member['typname']);
                $takes = ColumnTypes::lengthPrecision((string) $member['typname']);
                [$length, $precision] = $this->lengthPrecision((string) $member['fulltype'], $takes['length'], $takes['precision']);
                [$cltype, $isArray] = ColumnTypes::split($typeName);
                $members[] = [
                    'attnum' => (int) $member['attnum'],
                    'member_name' => $member['attname'],
                    'type' => $typeName,
                    'collation' => $collation,
                    'cltype' => $cltype,
                    'tlength' => $length,
                    'precision' => $precision,
                    'is_tlength' => $takes['length'],
                    'is_precision' => $takes['precision'],
                    'hasSqrBracket' => $isArray,
                    'fulltype' => $member['fulltype'],
                ];
            }
            $result['member_list'] = implode(', ', $texts);
            $result['composite'] = $members;
        } elseif ($kind === 'e') {
            $labels = array_column($ctx->rows('additional_properties.sql', ['typtype' => 'e', 'tid' => $tid]), 'enumlabel');
            $result['enum_list'] = implode(', ', $labels);
            $result['enum'] = array_map(static fn (string $label): array => ['label' => $label, 'old_label' => $label], $labels);
        } elseif ($kind === 'r') {
            $result = [...$result, ...($ctx->row('additional_properties.sql', ['typtype' => 'r', 'tid' => $tid]) ?? [])];
        }

        return $result;
    }

    /**
     * The length and precision inside a full type, by what the type takes: pgAdmin's
     * parse_length_precision.
     *
     * @return array{0: string|null, 1: string|null}
     */
    private function lengthPrecision(string $fullType, bool $takesLength, bool $takesPrecision): array
    {
        if ($takesLength && $takesPrecision && preg_match('/(\d+),(\d+)/', $fullType, $m)) {
            return [$m[1], $m[2]];
        }
        if ($takesLength && preg_match('/(\d+)/', $fullType, $m)) {
            return [$m[1], null];
        }

        return [null, null];
    }

    /**
     * The members as the templates take them: cltype without the array brackets and the
     * hasSqrBracket flag, length and precision as strings (a 0 must survive).
     *
     * @param list<array<string, mixed>> $members
     */
    private function formatMembers(array &$members): void
    {
        foreach ($members as &$member) {
            if (!is_array($member)) {
                continue;
            }
            foreach (['tlength', 'precision'] as $key) {
                if (array_key_exists($key, $member)) {
                    $member[$key] = $member[$key] === null || $member[$key] === '' ? null : (string) $member[$key];
                }
            }
            if (isset($member['type'])) {
                [$member['cltype'], $member['hasSqrBracket']] = ColumnTypes::split((string) $member['type']);
                $takes = ColumnTypes::lengthPrecision((string) $member['type']);
                $member['is_tlength'] = $takes['length'];
                $member['is_precision'] = $takes['precision'];
                if (!$takes['length']) {
                    $member['tlength'] = null;
                    $member['precision'] = null;
                }
            }
        }
        unset($member);
    }

    /**
     * A full member list from the editor against the old members, as {added, changed,
     * deleted}: matched by attnum.
     *
     * @param list<array<string, mixed>> $new
     * @param list<array<string, mixed>> $old
     * @return array{added: list<array<string, mixed>>, changed: list<array<string, mixed>>, deleted: list<array<string, mixed>>}
     */
    private function memberChanges(array $new, array $old): array
    {
        $changes = ['added' => [], 'changed' => [], 'deleted' => []];
        $seen = [];
        foreach ($new as $member) {
            if (!is_array($member) || trim((string) ($member['member_name'] ?? '')) === '') {
                continue;
            }
            $attnum = $member['attnum'] ?? null;
            $was = $attnum === null ? null : (array_values(array_filter($old, static fn (array $o): bool => (int) $o['attnum'] === (int) $attnum))[0] ?? null);
            if ($was === null) {
                $changes['added'][] = $member;
                continue;
            }
            $seen[] = (int) $attnum;
            foreach (['member_name', 'type', 'tlength', 'precision', 'collation'] as $key) {
                if (array_key_exists($key, $member) && (string) ($member[$key] ?? '') !== (string) ($was[$key] ?? '')) {
                    $changes['changed'][] = [...$member, 'attnum' => (int) $attnum];
                    break;
                }
            }
        }
        foreach ($old as $member) {
            if (!in_array((int) $member['attnum'], $seen, true)) {
                $changes['deleted'][] = $member;
            }
        }

        return $changes;
    }

    /**
     * A full label list from the editor against the old labels: new labels are added (in
     * order, after the last), a label whose old_label differs is renamed.
     *
     * @param list<array<string, mixed>> $new
     * @param list<array<string, mixed>> $old
     * @return array{added: list<array<string, mixed>>, changed: list<array<string, mixed>>}
     */
    private function labelChanges(array $new, array $old): array
    {
        $changes = ['added' => [], 'changed' => []];
        $oldLabels = array_column($old, 'label');
        foreach ($new as $entry) {
            if (!is_array($entry) || trim((string) ($entry['label'] ?? '')) === '') {
                continue;
            }
            $previous = (string) ($entry['old_label'] ?? '');
            if ($previous === '' || !in_array($previous, $oldLabels, true)) {
                if (!in_array($entry['label'], $oldLabels, true)) {
                    $changes['added'][] = ['label' => $entry['label']];
                }
            } elseif ($previous !== $entry['label']) {
                $changes['changed'][] = ['label' => $entry['label'], 'old_label' => $previous];
            }
        }

        return $changes;
    }

    /**
     * The members a recreated composite type gets: the old ones with the change lists applied.
     *
     * @param array<string, mixed>|null $changes
     * @param list<array<string, mixed>> $old
     * @return list<array<string, mixed>>
     */
    private function mergedMembers(?array $changes, array $old): array
    {
        if ($changes === null) {
            return $old;
        }
        $deleted = array_map(static fn (array $m): int => (int) $m['attnum'], (array) ($changes['deleted'] ?? []));
        $members = [];
        foreach ($old as $member) {
            if (in_array((int) $member['attnum'], $deleted, true)) {
                continue;
            }
            foreach ((array) ($changes['changed'] ?? []) as $change) {
                if ((int) ($change['attnum'] ?? -1) === (int) $member['attnum']) {
                    $member = [...$member, ...$change];
                }
            }
            $members[] = $member;
        }

        return [...$members, ...(array) ($changes['added'] ?? [])];
    }

    /**
     * @param array<string, mixed>|null $changes
     * @param list<array<string, mixed>> $old
     * @return list<array<string, mixed>>
     */
    private function mergedLabels(?array $changes, array $old): array
    {
        $labels = [];
        foreach ($old as $entry) {
            $label = $entry['label'];
            foreach ((array) ($changes['changed'] ?? []) as $change) {
                if (($change['old_label'] ?? null) === $label) {
                    $label = $change['label'];
                }
            }
            $labels[] = ['label' => $label];
        }

        return [...$labels, ...array_map(static fn (array $e): array => ['label' => $e['label']], (array) ($changes['added'] ?? []))];
    }

    /**
     * A new base type's settings, checked: the empty ones left out, the function and type
     * names (written into the statement as they are) checked, the codes known, the flags as
     * CREATE TYPE writes them.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function baseSettings(array $data): array
    {
        foreach ([...self::BASE_FUNCTIONS, 'typlen', 'typalign', 'typstorage', 'typlike', 'typcategory', 'typdefault', 'element', 'typdelim'] as $key) {
            if (array_key_exists($key, $data)) {
                $data[$key] = trim((string) ($data[$key] ?? ''));
                if ($data[$key] === '') {
                    unset($data[$key]);
                }
            }
        }
        foreach (self::BASE_FUNCTIONS as $key) {
            if (isset($data[$key])) {
                $this->checkFunctionName((string) $data[$key]);
            }
        }
        foreach (['typlike', 'element'] as $key) {
            if (isset($data[$key]) && preg_match(self::TYPE_NAME, (string) $data[$key]) !== 1) {
                throw new BadRequestException(sprintf('"%s" is not a data type.', $data[$key]));
            }
        }
        if (isset($data['typlen']) && filter_var($data['typlen'], FILTER_VALIDATE_INT, ['options' => ['min_range' => -2]]) === false) {
            throw new BadRequestException('The internal length is a number of bytes, or -1 for a variable-length type.');
        }
        if (isset($data['typalign']) && !isset(self::ALIGN[$data['typalign']])) {
            throw new BadRequestException(sprintf('"%s" is not an alignment.', $data['typalign']));
        }
        if (isset($data['typstorage']) && !isset(self::STORAGE[$data['typstorage']])) {
            throw new BadRequestException(sprintf('"%s" is not a storage.', $data['typstorage']));
        }
        if (isset($data['typcategory']) && preg_match('/^[A-Z]$/', (string) $data['typcategory']) !== 1) {
            throw new BadRequestException('The category is one upper-case ASCII letter.');
        }
        if (isset($data['typdelim']) && mb_strlen((string) $data['typdelim']) !== 1) {
            throw new BadRequestException('The delimiter is a single character.');
        }
        foreach (['typbyval', 'typispreferred', 'is_collatable'] as $key) {
            $data[$key] = filter_var($data[$key] ?? false, FILTER_VALIDATE_BOOL) ? 'true' : null;
        }

        return $data;
    }

    /**
     * An existing base type's receive, send, typmod, analyze and subscript functions and
     * storage, as update.sql's ALTER TYPE … SET (…) takes them: the unchanged ones left out, a
     * function cleared as NONE.
     *
     * @param array<string, mixed> $data
     * @param array<string, mixed> $old the properties, with the storage as a word
     * @return array<string, mixed>
     */
    private function alterableBaseSettings(array $data, array $old): array
    {
        foreach (self::ALTERABLE_FUNCTIONS as $key) {
            if (!array_key_exists($key, $data)) {
                continue;
            }
            $value = trim((string) ($data[$key] ?? ''));
            $was = (string) ($old[$key] ?? '');
            if ($value === $was || ($value === '' && $was === '-')) {
                unset($data[$key]);
                continue;
            }
            if ($value !== '') {
                $this->checkFunctionName($value);
            }
            $data[$key] = $value === '' ? 'NONE' : $value;
        }
        if (array_key_exists('typstorage', $data)) {
            $code = (string) ($data['typstorage'] ?? '');
            if ($code === '' || (self::STORAGE[$code] ?? null) === $old['typstorage']) {
                unset($data['typstorage']);
            } elseif (!isset(self::STORAGE[$code])) {
                throw new BadRequestException(sprintf('"%s" is not a storage.', $code));
            }
        }
        foreach (['typinput', 'typoutput'] as $key) {
            unset($data[$key]);
        }

        return $data;
    }

    private function checkFunctionName(string $name): void
    {
        if (preg_match(self::FUNCTION_NAME, $name) !== 1) {
            throw new BadRequestException(sprintf('"%s" is not a function name.', $name));
        }
    }

    /** pgAdmin's _convert_for_sql: the storage and alignment codes as the words CREATE TYPE takes. */
    private function convertForSql(array $data): array
    {
        if (isset($data['typstorage']) && isset(self::STORAGE[$data['typstorage']])) {
            $data['typstorage'] = self::STORAGE[$data['typstorage']];
        }
        if (isset($data['typalign']) && isset(self::ALIGN[$data['typalign']])) {
            $data['typalign'] = self::ALIGN[$data['typalign']];
        }
        // A flag CREATE TYPE writes as PREFERRED = true, COLLATABLE = true.
        foreach (['typispreferred', 'is_collatable'] as $key) {
            if (($data[$key] ?? null) === true) {
                $data[$key] = 'true';
            }
        }

        return $data;
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, $row);
        $node['inode'] = false;

        return $node;
    }
}
