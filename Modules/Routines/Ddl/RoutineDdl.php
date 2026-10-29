<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Routines\Ddl;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\GoneException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Acl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\Options;
use PhpPgAdmin\Core\Sql\SqlTemplates;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * The statements behind a function, procedure or trigger function, after pgAdmin's
 * FunctionView (functions/__init__.py and utils.py): the properties with their arguments laid
 * out as the dialog edits them, CREATE from the client's data, the ALTERs (or the CREATE OR
 * REPLACE) for what differs from the routine as it stands, and the "SQL" tab.
 *
 * The client's data carries pgAdmin's field names: name, pronamespace (the schema's name),
 * arguments [{argid, argmode, argname, argtype, argdefval}], prorettypename, proretset,
 * lanname, prosrc (probin and prosrc_c for C), provolatile ('i', 's', 'v'), proisstrict,
 * prosecdef, proleakproof, proparallel ('u', 's', 'r'), procost, prorows, prosupportfunc,
 * funcowner, description, variables, acl, seclabels.
 */
final class RoutineDdl
{
    /** The node types, by the folder their templates are in and the object word their DDL uses. */
    public const array KINDS = [
        'function' => ['dir' => 'functions', 'word' => 'FUNCTION'],
        'procedure' => ['dir' => 'procedures', 'word' => 'PROCEDURE'],
        'trigger_function' => ['dir' => 'trigger_functions', 'word' => 'FUNCTION'],
    ];

    private const array VOLATILITY = ['v' => 'VOLATILE', 's' => 'STABLE', 'i' => 'IMMUTABLE'];

    private const array PARALLEL = ['u' => 'UNSAFE', 's' => 'SAFE', 'r' => 'RESTRICTED'];

    private const array MODES = ['i' => 'IN', 'o' => 'OUT', 'b' => 'INOUT', 'v' => 'VARIADIC', 't' => 'TABLE'];

    /** A change to any of these needs CREATE OR REPLACE rather than an ALTER. */
    private const array REPLACE_FIELDS = ['lanname', 'prosrc', 'probin', 'prosrc_c', 'provolatile', 'proisstrict', 'prosecdef', 'proparallel', 'procost', 'proleakproof', 'arguments', 'prorows', 'prosupportfunc', 'prorettypename'];

    /**
     * The properties row as pgAdmin's _fetch_properties returns it: the arguments as a list and
     * as text, the privileges, the security labels and configuration variables, a procedure's
     * cost / volatility / parallel setting cleared, a pure-SQL body under prosrc.
     *
     * @param array<string, mixed> $row the row of properties.sql
     * @return array<string, mixed>
     */
    public static function properties(NodeContext $ctx, string $kind, int $fnid, array $row): array
    {
        $row = [...$row, ...self::formatArguments($ctx, $row)];
        $row['acl'] = array_map(Acl::fromDb(...), $ctx->rows('acl.sql', ['fnid' => $fnid]));
        $row['sysfunc'] = $fnid <= DatabaseController::LAST_SYSTEM_OID;
        $row['sysproc'] = $row['sysfunc'];
        $row['seclabels'] = Options::parseSecurityLabels($row['seclabels'] ?? null);
        $row['variables'] = Options::parseVariables([['setconfig' => $row['proconfig'] ?? null]]);
        $row['dependsonextensions'] = Options::list($row['dependsonextensions'] ?? null);
        $row['pronamespace_oid'] = (int) $row['pronamespace'];

        if ($kind === 'procedure' && ($row['lanname'] ?? '') !== 'edbspl') {
            $row['procost'] = null;
            $row['provolatile'] = null;
            $row['proparallel'] = null;
        }
        // A function written in the SQL standard's BEGIN ATOMIC form keeps its body in prosqlbody.
        if (!empty($row['is_pure_sql'])) {
            $row['prosrc'] = rtrim((string) $row['prosrc_sql']);
            if (!str_ends_with($row['prosrc'], ';')) {
                $row['prosrc'] .= ';';
            }
        } else {
            $row['is_pure_sql'] = false;
        }

        return $row;
    }

    /**
     * The "SQL" tab: the commented header and DROP, then CREATE OR REPLACE with the signature
     * pg_get_function_arguments gives (defaults included, one argument per line), the owner,
     * grants, comment and labels. pgAdmin's sql().
     *
     * @param array<string, mixed> $row the row of properties.sql
     */
    public static function sql(NodeContext $ctx, string $kind, int $fnid, array $row): string
    {
        $data = self::properties($ctx, $kind, $fnid, $row);
        $data['args'] = $data['arguments'];
        [$data['func_args'], $data['func_args_without']] = self::argumentStrings($data['arguments']);
        self::reformatSource($data);
        if ($kind === 'procedure' && isset($data['provolatile'])) {
            $data['provolatile'] = self::VOLATILITY[$data['provolatile']] ?? '';
        }
        $data['pronamespace'] = self::schemaName($ctx, (int) $data['pronamespace']);
        self::parsePrivileges($data);

        $definition = $ctx->row('get_definition.sql', ['fnid' => $fnid, 'scid' => $data['pronamespace_oid'], 'data' => $data]) ?? throw new GoneException('Could not find the function in the database.');
        $funcDef = Quoting::ident((string) $definition['nspname'], (string) $definition['proname']) . "(\n\t" . str_replace(', ', ",\n\t", (string) $definition['func_args']) . ')';

        $body = $ctx->render('create.sql', ['data' => $data, 'query_type' => 'create', 'func_def' => $funcDef, 'query_for' => 'sql_panel', 'add_replace_clause' => true]);

        $word = self::KINDS[$kind]['word'];
        $argTypes = trim((string) ($data['proargtypenames'] ?? ''), '()');
        $header = sprintf("-- %s: %s.%s(%s)\n\n-- DROP %s IF EXISTS %s(%s);\n\n", $word, $data['pronamespace'], $data['proname'], $argTypes, $word, Quoting::ident((string) $data['pronamespace'], (string) $data['proname']), $argTypes);

        return SqlTemplates::tidy($header . $body);
    }

    /**
     * CREATE FUNCTION / PROCEDURE from the client's data, in the route's schema: pgAdmin's
     * _get_sql in create mode.
     *
     * @param array<string, mixed> $data
     */
    public static function createSql(NodeContext $ctx, string $kind, array $data): string
    {
        $data['name'] = self::required($data, 'name');
        if ($kind !== 'procedure') {
            $data['prorettypename'] = $kind === 'trigger_function' ? ($data['prorettypename'] ?? 'trigger') : self::required($data, 'prorettypename');
        }
        $data['lanname'] = self::required($data, 'lanname');
        if (($data['lanname'] ?? '') !== 'c') {
            $data['prosrc'] = self::required($data, 'prosrc');
        }
        $data['pronamespace'] = self::schemaName($ctx, (int) $ctx->id('scid'));
        self::parsePrivileges($data);
        $data['arguments'] = array_values(array_filter((array) ($data['arguments'] ?? []), static fn ($a): bool => is_array($a) && trim((string) ($a['argtype'] ?? '')) !== ''));
        [$data['func_args'], $data['func_args_without']] = self::argumentStrings($data['arguments']);
        $data['variables'] = array_values(array_filter((array) ($data['variables'] ?? []), static fn ($v): bool => is_array($v) && trim((string) ($v['name'] ?? '')) !== ''));
        foreach (['procost', 'prorows', 'prosupportfunc', 'funcowner', 'description', 'probin', 'prosrc_c'] as $key) {
            if (array_key_exists($key, $data) && ($data[$key] === null || trim((string) $data[$key]) === '')) {
                unset($data[$key]);
            }
        }
        self::markPureSql($data, (string) $data['lanname']);
        self::reformatSource($data);

        return $ctx->render('create.sql', ['data' => $data, 'is_sql' => false]);
    }

    /**
     * The statements for what the client's data changes against the routine as it stands: a
     * rename, a CREATE OR REPLACE when the body, arguments or options change, else the ALTERs
     * for the owner, privileges, variables, labels, comment and schema. pgAdmin's
     * _get_sql_for_edit_mode.
     *
     * @param array<string, mixed> $data
     * @param array<string, mixed> $old the formatted properties (self::properties)
     */
    public static function updateSql(NodeContext $ctx, string $kind, array $data, array $old): string
    {
        if (array_key_exists('provolatile', $data)) {
            $data['provolatile'] = $data['provolatile'] ? (self::VOLATILITY[$data['provolatile']] ?? (string) $data['provolatile']) : '';
        }
        if (array_key_exists('proparallel', $data) && $data['proparallel']) {
            $data['proparallel'] = self::PARALLEL[$data['proparallel']] ?? (string) $data['proparallel'];
        }
        if (isset($data['pronamespace']) && (string) $data['pronamespace'] === self::schemaName($ctx, (int) $old['pronamespace'])) {
            unset($data['pronamespace']);
        }
        $old['pronamespace'] = self::schemaName($ctx, (int) $old['pronamespace']);
        if (isset($old['provolatile'])) {
            $old['provolatile'] = self::VOLATILITY[$old['provolatile']] ?? $old['provolatile'];
        }
        if (isset($old['proparallel'])) {
            $old['proparallel'] = self::PARALLEL[$old['proparallel']] ?? $old['proparallel'];
        }
        if ($kind !== 'trigger_function') {
            $old['dependsonextensions'] = (array) ($old['dependsonextensions'] ?? []);
            if (array_key_exists('dependsonextensions', $data)) {
                $data['dependsonextensions'] = (array) ($data['dependsonextensions'] ?? []);
            }
        }
        // Rows is only set for a set-returning function; the catalog keeps 0 where the form has none.
        if (($data['prorows'] ?? null) === '' && (string) ($old['prorows'] ?? '0') === '0') {
            unset($data['prorows']);
        }
        // Fields equal to the current value are no change; the client may send the whole form.
        foreach (['lanname', 'prosrc', 'probin', 'prosrc_c', 'proisstrict', 'prosecdef', 'proleakproof', 'procost', 'prorows', 'prosupportfunc', 'prorettypename', 'provolatile', 'proparallel', 'funcowner', 'description'] as $key) {
            if (array_key_exists($key, $data) && self::same($data[$key], $old[$key] ?? null)) {
                unset($data[$key]);
            }
        }
        if (isset($data['arguments']) && is_array($data['arguments']) && array_is_list($data['arguments'])) {
            $data['arguments'] = self::argumentChanges($data['arguments'], (array) ($old['arguments'] ?? []));
        }
        if (isset($data['arguments']) && is_array($data['arguments']) && ($data['arguments']['added'] ?? []) !== []) {
            $modes = array_map(static fn (array $a): string => (string) ($a['argmode'] ?? 'IN') ?: 'IN', $data['arguments']['added']);
            throw new BadRequestException(in_array('OUT', $modes, true) && count(array_unique($modes)) === 1
                ? 'Adding a new OUT argument to an existing function/procedure is not supported, as it would change the shape of the returned row. Please create a new function/procedure instead.'
                : 'Adding a new IN/INOUT/VARIADIC argument to an existing function/procedure is not supported, as PostgreSQL would create a separate, overloaded routine rather than replacing this one. Please create a new function/procedure instead.');
        }
        if (isset($data['arguments']) && is_array($data['arguments']) && ($data['arguments']['changed'] ?? []) === [] && ($data['arguments']['deleted'] ?? []) === []) {
            unset($data['arguments']);
        }

        $data['change_func'] = false;
        foreach (self::REPLACE_FIELDS as $field) {
            if (array_key_exists($field, $data) && ($field !== 'arguments' || $data[$field] !== [])) {
                $data['change_func'] = true;
            }
        }

        // The arguments of a CREATE OR REPLACE: the old ones with the changes merged in.
        if (!empty($data['arguments']) && is_array($data['arguments'])) {
            $merged = $old['arguments'];
            foreach ((array) ($data['arguments']['changed'] ?? []) as $change) {
                foreach ($merged as &$arg) {
                    if (($arg['argid'] ?? null) === ($change['argid'] ?? -1)) {
                        $arg = [...$arg, ...$change];
                        break;
                    }
                }
                unset($arg);
            }
            $data['arguments'] = $merged;
        } elseif ($data['change_func']) {
            $data['arguments'] = $old['arguments'];
        }

        if (isset($data['acl']) && is_array($data['acl'])) {
            foreach (['added', 'changed', 'deleted'] as $mode) {
                if (isset($data['acl'][$mode])) {
                    $data['acl'][$mode] = Acl::toDb($data['acl'][$mode], ['X']);
                }
            }
        }

        // Variables: a CREATE OR REPLACE restates them all (old ones merged with the changes);
        // an ALTER only sets the added and changed ones and resets the deleted.
        $data['merged_variables'] = [];
        $changed = [];
        $deleted = [];
        $variables = $data['variables'] ?? null;
        if (is_array($variables) && array_is_list($variables)) {
            $variables = self::variableChanges($variables, (array) ($old['variables'] ?? []));
            $data['variables'] = $variables;
        }
        if ($data['change_func']) {
            foreach ((array) ($variables['deleted'] ?? []) as $v) {
                $deleted[$v['name']] = $v['value'] ?? null;
            }
            foreach ([...(array) ($variables['changed'] ?? []), ...(array) ($variables['added'] ?? [])] as $v) {
                $changed[$v['name']] = $v['value'];
            }
            foreach ((array) ($old['variables'] ?? []) as $v) {
                if (!array_key_exists($v['name'], $changed) && !array_key_exists($v['name'], $deleted)) {
                    $changed[$v['name']] = $v['value'];
                }
            }
            foreach ($changed as $name => $value) {
                $data['merged_variables'][] = ['name' => $name, 'value' => $value];
            }
        } else {
            foreach ([...(array) ($variables['changed'] ?? []), ...(array) ($variables['added'] ?? [])] as $v) {
                $data['merged_variables'][] = $v;
            }
        }
        if ($variables !== null && $variables !== []) {
            $data['variables'] = $variables;
        } else {
            unset($data['variables']);
        }

        self::markPureSql($data, (string) $old['lanname']);
        self::reformatSource($data);
        if ($data['change_func'] && !array_key_exists('prosrc', $data)) {
            // The CREATE OR REPLACE restates the old body: lay it out as a new one would be.
            self::reformatSource($old);
        }

        return SqlTemplates::tidy($ctx->render('update.sql', ['data' => $data, 'o_data' => $old]));
    }

    /**
     * The statement that calls the routine, with a placeholder per argument: pgAdmin's
     * select_sql / exec_sql scripts. "SELECT s.f(\n\t<a integer>,\n\t<b text>\n)" or "CALL …",
     * a procedure's OUT arguments passed as NULL.
     *
     * @param array<string, mixed> $properties the formatted properties
     */
    public static function callSql(string $kind, array $properties, string $schema): string
    {
        $args = [];
        foreach ((array) ($properties['arguments'] ?? []) as $arg) {
            $label = trim(implode(' ', array_filter([$arg['argname'] ?? '', $arg['argtype'] ?? ''])));
            if (($arg['argmode'] ?? 'IN') === 'OUT') {
                // A function's OUT arguments are its result; CALL takes a procedure's (PostgreSQL 14+) as NULL.
                if ($kind === 'procedure') {
                    $args[] = "\n\tNULL /* OUT " . $label . ' */';
                }
                continue;
            }
            $args[] = "\n\t<" . $label . '>';
        }
        $name = Quoting::ident($schema, (string) $properties['name']) . '(' . implode(',', $args) . ($args === [] ? '' : "\n") . ')';

        return ($kind === 'procedure' ? 'CALL ' : 'SELECT ') . $name;
    }

    /**
     * pgAdmin's format_arguments_from_db: the arguments as the dialog lists them, from the
     * catalog's parallel columns (types, modes, names, defaults), with the OUT arguments'
     * types looked up and the TABLE columns of a RETURNS TABLE left out.
     *
     * @param array<string, mixed> $row
     * @return array{arguments: list<array{argid: int, argtype: string, argmode: string, argname: string, argdefval: string}>, proargs: string}
     */
    private static function formatArguments(NodeContext $ctx, array $row): array
    {
        $types = trim((string) ($row['proargtypenames'] ?? '')) === '' ? [] : array_map(trim(...), explode(',', (string) $row['proargtypenames']));
        $modes = Options::list($row['proargmodes'] ?? null);
        if ($modes === []) {
            $modes = array_fill(0, count($types), 'i');
        }
        $names = Options::list($row['proargnames'] ?? null);
        $defaults = trim((string) ($row['proargdefaultvals'] ?? '')) === '' ? [] : preg_split('/,(?=(?:[^"\']*["\'][^"\']*["\'])*[^"\']*$)/', (string) $row['proargdefaultvals']);
        $defaults = array_map(trim(...), $defaults ?: []);
        $allTypes = Options::list($row['proallargtypes'] ?? null);

        // Defaults belong to the last arguments: pad the front.
        $missing = count($types) - count($defaults);
        if (count($defaults) > 0 && $missing > 0) {
            $defaults = [...array_fill(0, $missing, ''), ...$defaults];
        }

        $filteredModes = $modes;
        $tableNames = [];
        foreach ($modes as $i => $mode) {
            if ($mode === 'o') {
                $type = (string) $ctx->conn->scalar($ctx->render('get_out_types.sql', ['out_arg_oid' => $allTypes[$i] ?? 0]));
                array_splice($types, $i, 0, [$type]);
                array_splice($defaults, $i, 0, ['']);
            } elseif ($mode === 'v') {
                array_splice($defaults, $i, 0, ['']);
            } elseif ($mode === 't') {
                $at = array_search('t', $filteredModes, true);
                if ($at !== false) {
                    array_splice($filteredModes, $at, 1);
                }
                $tableNames[] = $names[$i] ?? null;
            }
        }
        $filteredModes = array_map(static fn (string $m): string => self::MODES[$m] ?? $m, $filteredModes);
        foreach ($tableNames as $name) {
            $at = array_search($name, $names, true);
            if ($at !== false) {
                array_splice($names, $at, 1);
            }
        }

        $arguments = [];
        $texts = [];
        foreach ($types as $i => $type) {
            $mode = $filteredModes[$i] ?? '';
            $default = $defaults[$i] ?? '';
            if ($mode === 'INOUT' && trim($default) === '-') {
                $default = '';
            }
            $arguments[] = ['argid' => $i, 'argtype' => trim($type), 'argmode' => $mode, 'argname' => $names[$i] ?? '', 'argdefval' => $default];
            $texts[] = trim(implode(' ', array_filter([$mode, $names[$i] ?? '', trim($type)])) . ($default !== '' ? '  DEFAULT ' . $default : ''));
        }

        return ['arguments' => $arguments, 'proargs' => implode(', ', $texts)];
    }

    /**
     * The argument list as a signature ("IN a integer, b text") and as the bare types the
     * ALTER / GRANT / COMMENT statements name ("integer, text"); OUT arguments left out.
     *
     * @param list<array<string, mixed>> $arguments
     * @return array{0: string, 1: string}
     */
    private static function argumentStrings(array $arguments): array
    {
        $full = [];
        $types = [];
        foreach ($arguments as $arg) {
            if (($arg['argmode'] ?? null) === 'OUT') {
                continue;
            }
            $parts = [];
            if (!empty($arg['argmode'])) {
                $parts[] = $arg['argmode'];
            }
            if (!empty($arg['argname'])) {
                $parts[] = Quoting::ident((string) $arg['argname']);
            }
            if (!empty($arg['argtype'])) {
                $parts[] = $arg['argtype'];
                $types[] = $arg['argtype'];
            }
            $full[] = implode(' ', $parts);
        }

        return [implode(', ', $full), implode(', ', $types)];
    }

    /**
     * A full argument list from the client against the old one, as the {changed, added,
     * deleted} lists pgAdmin's dialog sends: matched by argid.
     *
     * @param list<array<string, mixed>> $new
     * @param list<array<string, mixed>> $old
     * @return array{added: list<array<string, mixed>>, changed: list<array<string, mixed>>, deleted: list<array<string, mixed>>}
     */
    private static function argumentChanges(array $new, array $old): array
    {
        $changes = ['added' => [], 'changed' => [], 'deleted' => []];
        $seen = [];
        foreach ($new as $arg) {
            if (!is_array($arg)) {
                continue;
            }
            $id = $arg['argid'] ?? null;
            $was = $id === null ? null : array_values(array_filter($old, static fn (array $o): bool => ($o['argid'] ?? null) === $id))[0] ?? null;
            if ($was === null) {
                $changes['added'][] = $arg;
                continue;
            }
            $seen[] = $id;
            foreach (['argmode', 'argname', 'argtype', 'argdefval'] as $key) {
                if (array_key_exists($key, $arg) && (string) ($arg[$key] ?? '') !== (string) ($was[$key] ?? '')) {
                    $changes['changed'][] = $arg;
                    break;
                }
            }
        }
        foreach ($old as $arg) {
            if (!in_array($arg['argid'] ?? null, $seen, true)) {
                $changes['deleted'][] = $arg;
            }
        }

        return $changes;
    }

    /**
     * A full list of configuration variables from the client against the old one, as the
     * {added, changed, deleted} lists the templates take.
     *
     * @param list<array<string, mixed>> $new
     * @param list<array<string, mixed>> $old
     * @return array{added: list<array<string, mixed>>, changed: list<array<string, mixed>>, deleted: list<array<string, mixed>>}
     */
    private static function variableChanges(array $new, array $old): array
    {
        $changes = ['added' => [], 'changed' => [], 'deleted' => []];
        $oldByName = array_column($old, null, 'name');
        $seen = [];
        foreach ($new as $v) {
            if (!is_array($v) || trim((string) ($v['name'] ?? '')) === '') {
                continue;
            }
            $seen[] = $v['name'];
            if (!isset($oldByName[$v['name']])) {
                $changes['added'][] = ['name' => $v['name'], 'value' => $v['value'] ?? ''];
            } elseif ((string) ($oldByName[$v['name']]['value'] ?? '') !== (string) ($v['value'] ?? '')) {
                $changes['changed'][] = ['name' => $v['name'], 'value' => $v['value'] ?? ''];
            }
        }
        foreach ($old as $v) {
            if (!in_array($v['name'], $seen, true)) {
                $changes['deleted'][] = $v;
            }
        }

        return $changes;
    }

    /** pgAdmin's _parse_privilege_data: REVOKE ALL FROM PUBLIC unless PUBLIC is among the grantees. */
    private static function parsePrivileges(array &$data): void
    {
        if (!isset($data['acl']) || !is_array($data['acl']) || !array_is_list($data['acl'])) {
            return;
        }
        $data['revoke_all'] = $data['acl'] !== [] && !in_array('PUBLIC', array_column($data['acl'], 'grantee'), true);
        $data['acl'] = Acl::toDb($data['acl'], ['X']);
    }

    /**
     * pgAdmin's _format_prosrc_for_pure_sql in edit/create mode: a body in the SQL standard's
     * form (BEGIN ATOMIC … END or RETURN …) is written as it is rather than inside $BODY$.
     */
    private static function markPureSql(array &$data, string $language): void
    {
        $source = $data['prosrc'] ?? null;
        if ($language !== 'sql' || !is_string($source) || $source === '') {
            return;
        }
        $lower = trim(strtolower($source), "\n\t");
        foreach (['/^.*(?:\'|")?.*(?=.*?atomic).*(?:\'|").*$/m', '/^.*(?:"|\')(?=.*(atomic)).*$/m'] as $invalid) {
            if (preg_match($invalid, $lower)) {
                return;
            }
        }
        foreach (['/(?=.*begin)(.+?(\n)+)(?=.*atomic)|(?=.*begin)(?=.*atomic)/m', '/\A\s*return\b/m'] as $valid) {
            if (preg_match($valid, $lower)) {
                $data['is_pure_sql'] = true;
                if (!str_ends_with($source, ';')) {
                    $data['prosrc'] = $source . ';';
                }

                return;
            }
        }
    }

    /** pgAdmin's reformat_prosrc_code: the body on lines of its own inside $BODY$. */
    private static function reformatSource(array &$data): void
    {
        if (!isset($data['prosrc']) || !is_string($data['prosrc'])) {
            return;
        }
        if (!str_starts_with($data['prosrc'], "\n")) {
            $data['prosrc'] = "\n" . $data['prosrc'];
        }
        if (!str_ends_with($data['prosrc'], "\n")) {
            $data['prosrc'] .= "\n";
        }
    }

    /** Whether a form value equals the stored one, allowing for strings standing in for numbers and booleans. */
    private static function same(mixed $new, mixed $old): bool
    {
        if (is_bool($old) || is_bool($new)) {
            return filter_var($new, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) === filter_var($old, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);
        }
        if (is_numeric($new) && is_numeric($old)) {
            return (float) $new === (float) $old;
        }

        return trim((string) ($new ?? '')) === trim((string) ($old ?? ''));
    }

    private static function schemaName(NodeContext $ctx, int $scid): string
    {
        return (string) ($ctx->conn->scalar($ctx->render('get_schema.sql', ['scid' => $scid])) ?? throw new GoneException('Could not find the schema in the database.'));
    }

    /** @param array<string, mixed> $data */
    private static function required(array $data, string $key): string
    {
        $value = trim((string) ($data[$key] ?? ''));
        if ($value === '') {
            throw new BadRequestException(sprintf('Could not find the required parameter (%s).', $key));
        }

        return $value;
    }
}
