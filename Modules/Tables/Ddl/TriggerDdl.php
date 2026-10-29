<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Ddl;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\GoneException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\Options;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * The statements behind a trigger, after pgAdmin's triggers/utils.py: the properties with the
 * firing definition decoded from tgtype, the function with its schema, the arguments and the
 * UPDATE OF columns (get_trigger_function_and_columns, trigger_definition); CREATE from the
 * client's data; the rename, CREATE OR REPLACE and ENABLE / DISABLE of an update; the "SQL"
 * tab with its header and, for a disabled trigger, the ALTER TABLE that disables it.
 *
 * The client's data carries pgAdmin's field names: name, fires ('BEFORE', 'AFTER', 'INSTEAD
 * OF'), evnt_insert / evnt_update / evnt_delete / evnt_truncate, columns [names] for UPDATE OF,
 * is_row_trigger, is_constraint_trigger, tgdeferrable, tginitdeferred, tfunction
 * ("schema.function"), tgargs (the literals as written), whenclause, tgoldtable, tgnewtable,
 * description, is_enable_trigger ('O', 'D', 'R', 'A').
 */
final class TriggerDdl
{
    private const int TYPE_ROW = 1;
    private const int TYPE_BEFORE = 2;
    private const int TYPE_INSERT = 4;
    private const int TYPE_DELETE = 8;
    private const int TYPE_UPDATE = 16;
    private const int TYPE_TRUNCATE = 32;
    private const int TYPE_INSTEAD = 64;

    /**
     * The properties row with the function, arguments, columns and firing definition filled in.
     *
     * @param array<string, mixed> $row the row of properties.sql
     * @return array<string, mixed>
     */
    public static function properties(NodeContext $ctx, int $tid, array $row): array
    {
        // Rendered from the triggers folder by name: the context may be the table's own when its DDL is built.
        $function = $ctx->conn->row($ctx->renderFrom('triggers', 'get_triggerfunctions.sql', ['tgfoid' => $row['tgfoid'], 'show_system_objects' => true, 'without_schema' => false]));
        if ($function !== null) {
            $row['tfunction'] = $function['tfunctions'];
        }
        $args = Options::list($row['custom_tgargs'] ?? null);
        $row['custom_tgargs'] = $args;
        $row['tgargs'] = $args === [] ? null : implode(', ', array_map(static fn (string $a): string => Quoting::literal($a), $args));

        $row['columns'] = [];
        $attnums = trim((string) ($row['tgattr'] ?? ''));
        if ($attnums !== '') {
            $row['columns'] = array_column($ctx->conn->rows($ctx->renderFrom('triggers', 'get_columns.sql', ['tid' => $tid, 'clist' => implode(', ', preg_split('/\s+/', $attnums) ?: [])])), 'name');
        }

        return self::definition($row);
    }

    /** pgAdmin's trigger_definition: the firing time, level and events from the tgtype bits. */
    public static function definition(array $row): array
    {
        $type = (int) ($row['tgtype'] ?? 0);
        $row['fires'] = $type & self::TYPE_BEFORE ? 'BEFORE' : ($type & self::TYPE_INSTEAD ? 'INSTEAD OF' : 'AFTER');
        $row['is_row_trigger'] = (bool) ($type & self::TYPE_ROW);
        $row['evnt_insert'] = (bool) ($type & self::TYPE_INSERT);
        $row['evnt_delete'] = (bool) ($type & self::TYPE_DELETE);
        $row['evnt_update'] = (bool) ($type & self::TYPE_UPDATE);
        $row['evnt_truncate'] = (bool) ($type & self::TYPE_TRUNCATE);

        return $row;
    }

    /** The "SQL" tab: "-- Trigger: name", the commented DROP, CREATE TRIGGER and, when disabled, the DISABLE. */
    public static function sql(NodeContext $ctx, string $schema, string $table, int $tid, int $trid, bool $withHeader = true): string
    {
        $data = self::properties($ctx, $tid, self::row($ctx, $tid, $trid));
        $data['schema'] = $schema;
        $data['table'] = $table;

        $parts = [];
        if ($withHeader) {
            $parts[] = "-- Trigger: {$data['name']}\n\n-- " . $ctx->renderFrom('triggers', 'delete.sql', ['data' => $data, 'cascade' => false]);
        }
        $parts[] = $ctx->renderFrom('triggers', 'create.sql', ['data' => $data]);
        if (($data['is_enable_trigger'] ?? 'O') !== 'O') {
            $parts[] = $ctx->renderFrom('triggers', 'enable_disable_trigger.sql', ['data' => $data]);
        }

        return Ddl::assemble($parts);
    }

    /** CREATE TRIGGER from the client's data on the given relation. */
    public static function createSql(NodeContext $ctx, string $schema, string $table, array $data): string
    {
        foreach (['name', 'tfunction'] as $key) {
            if (trim((string) ($data[$key] ?? '')) === '') {
                throw new BadRequestException(sprintf('Could not find the required parameter (%s).', $key === 'tfunction' ? 'Trigger function' : 'Name'));
            }
        }
        $data = self::normalise($data, forCreate: true);
        $data['schema'] = $schema;
        $data['table'] = $table;
        if (!($data['evnt_insert'] ?? false) && !($data['evnt_update'] ?? false) && !($data['evnt_delete'] ?? false) && !($data['evnt_truncate'] ?? false)) {
            throw new BadRequestException('A trigger needs at least one event.');
        }

        $sql = $ctx->renderFrom('triggers', 'create.sql', ['data' => $data]);
        // A new trigger is enabled ('O'); any other state is an ALTER TABLE after it.
        if (($data['is_enable_trigger'] ?? 'O') !== 'O') {
            $sql .= "\n" . $ctx->renderFrom('triggers', 'enable_disable_trigger.sql', ['data' => $data]);
        }

        return $sql;
    }

    /**
     * The statements for what the client's data changes: a rename, a CREATE OR REPLACE when
     * the definition changes, the comment, ENABLE / DISABLE. pgAdmin's get_sql in edit mode;
     * fields equal to the trigger as it stands are dropped so a full form can be sent.
     *
     * @param array<string, mixed> $data
     */
    public static function updateSql(NodeContext $ctx, string $schema, string $table, int $tid, int $trid, array $data): string
    {
        $old = self::properties($ctx, $tid, self::row($ctx, $tid, $trid));
        $data = self::normalise($data);
        $data['schema'] = $schema;
        $data['table'] = $table;
        if (trim((string) ($data['name'] ?? '')) === '') {
            $data['name'] = $old['name'];
        }
        foreach (['fires', 'is_row_trigger', 'evnt_insert', 'evnt_update', 'evnt_delete', 'evnt_truncate', 'is_constraint_trigger', 'tgdeferrable', 'tginitdeferred', 'tfunction', 'tgargs', 'whenclause', 'tgoldtable', 'tgnewtable', 'description', 'is_enable_trigger'] as $key) {
            if (!array_key_exists($key, $data)) {
                continue;
            }
            $was = $old[$key] ?? null;
            $same = is_bool($was) || is_bool($data[$key]) ? (bool) $data[$key] === (bool) $was : trim((string) ($data[$key] ?? '')) === trim((string) ($was ?? ''));
            if ($same) {
                unset($data[$key]);
            }
        }
        if (array_key_exists('columns', $data) && array_values((array) $data['columns']) === array_values((array) ($old['columns'] ?? []))) {
            unset($data['columns']);
        } elseif (array_key_exists('columns', $data)) {
            // The template reads the events from the old row when the form did not change them.
            $data['evnt_update'] ??= $old['evnt_update'];
        }
        // A CREATE OR REPLACE restates the whole definition; a new one is written from the form.
        // A constraint trigger has no CREATE OR REPLACE (and its deferrability is part of its
        // definition): it is dropped and created again, in the same batch.
        $isConstraint = (bool) ($data['is_constraint_trigger'] ?? $old['is_constraint_trigger']) || (bool) $old['is_constraint_trigger'];
        $definition = ['fires', 'is_row_trigger', 'evnt_insert', 'evnt_update', 'evnt_delete', 'evnt_truncate', 'tfunction', 'tgargs', 'whenclause', 'columns', 'is_constraint_trigger', ...($isConstraint ? ['tgdeferrable', 'tginitdeferred'] : [])];
        if (array_intersect_key($data, array_flip($definition)) !== []) {
            $data['restate'] = true;
            $data['recreate'] = $isConstraint;
            foreach (['fires', 'is_row_trigger', 'evnt_insert', 'evnt_update', 'evnt_delete', 'evnt_truncate', 'tfunction', 'is_constraint_trigger'] as $key) {
                $data[$key] ??= $old[$key];
            }
            $data['tgargs'] = array_key_exists('tgargs', $data) ? $data['tgargs'] : $old['tgargs'];
            $data['whenclause'] = array_key_exists('whenclause', $data) ? $data['whenclause'] : $old['whenclause'];
            $data['columns'] = array_key_exists('columns', $data) ? $data['columns'] : $old['columns'];
            $data['tgdeferrable'] ??= $old['tgdeferrable'];
            $data['tginitdeferred'] ??= $old['tginitdeferred'];
        }
        $old['tgoldtable'] ??= null;
        $old['tgnewtable'] ??= null;

        return $ctx->renderFrom('triggers', 'update.sql', ['data' => $data, 'o_data' => $old]);
    }

    /** @return array<string, mixed> the row of properties.sql */
    public static function row(NodeContext $ctx, int $tid, int $trid): array
    {
        return $ctx->conn->row($ctx->renderFrom('triggers', 'properties.sql', ['tid' => $tid, 'trid' => $trid, 'datlastsysoid' => DatabaseController::LAST_SYSTEM_OID]))
            ?? throw new GoneException('Could not find the trigger in the table.');
    }

    /**
     * The client's data as the templates take it: booleans as booleans, blank optionals
     * dropped, the UPDATE OF columns as a list of names.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private static function normalise(array $data, bool $forCreate = false): array
    {
        foreach (['is_row_trigger', 'evnt_insert', 'evnt_update', 'evnt_delete', 'evnt_truncate', 'is_constraint_trigger', 'tgdeferrable', 'tginitdeferred'] as $key) {
            if (array_key_exists($key, $data)) {
                $data[$key] = filter_var($data[$key], FILTER_VALIDATE_BOOL);
            }
        }
        foreach (['tgargs', 'whenclause', 'tgoldtable', 'tgnewtable'] as $key) {
            if (array_key_exists($key, $data) && trim((string) ($data[$key] ?? '')) === '') {
                $data[$key] = null;
            }
        }
        // The catalog keeps the WHEN condition in parentheses and update.sql prints it as it is;
        // create.sql adds the parentheses itself, so a new trigger's condition goes bare.
        if (isset($data['whenclause'])) {
            $when = trim((string) $data['whenclause']);
            $bare = str_starts_with($when, '(') && str_ends_with($when, ')') ? substr($when, 1, -1) : $when;
            $data['whenclause'] = $forCreate ? $bare : '(' . $bare . ')';
        }
        if (isset($data['fires'])) {
            $data['fires'] = strtoupper(trim((string) $data['fires']));
        }
        if (array_key_exists('columns', $data)) {
            $data['columns'] = array_values(array_filter(array_map(static fn ($c): string => trim((string) (is_array($c) ? ($c['column'] ?? '') : $c)), (array) $data['columns']), static fn (string $c): bool => $c !== ''));
        }

        return $data;
    }
}
