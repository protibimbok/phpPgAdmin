<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Ddl;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\GoneException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Acl;
use PhpPgAdmin\Core\Nodes\NodeContext;

/**
 * The statements that add, alter and drop a column: pgAdmin's ColumnsView.get_sql and the
 * column parts of BaseTableView.get_sql, on columns/create.sql, update.sql and delete.sql.
 *
 * A column from the client carries pgAdmin's field names: name, cltype (the type as the type
 * list names it, "character varying", with "[]" for an array), attlen, attprecision,
 * attnotnull, defval (an expression, as written in SQL), collspcname, description,
 * colconstype ('n', 'i' identity or 'g' generated), attidentity ('a' or 'd'), genexpr, the
 * identity sequence's seqstart, seqincrement, seqmin, seqmax, seqcache and seqcycle,
 * attacl, attoptions, attstattarget, attstorage ('p', 'm', 'e', 'x'), attcompression.
 */
final class ColumnSql
{
    /** The values the templates write into the statement as they are. */
    private const array STORAGE = ['p', 'm', 'e', 'x', 'd'];

    private const array COMPRESSION = ['pglz', 'lz4', 'default'];

    private const array IDENTITY = ['', 'a', 'd'];

    /** ALTER TABLE … ADD COLUMN and what follows it (comment, options, privileges). */
    public static function createSql(NodeContext $ctx, string $schema, string $table, array $column): string
    {
        $column = self::forTemplate($column);
        $column['schema'] = $schema;
        $column['table'] = $table;

        return $ctx->renderFrom('columns', 'create.sql', ['data' => $column]);
    }

    /**
     * The ALTER statements that take the column from what it is to what the client sent; only
     * the fields the client sends are compared, as in pgAdmin's partial PUT.
     */
    public static function updateSql(NodeContext $ctx, int $tid, string $schema, string $table, array $column, ?int $attnum = null): string
    {
        $attnum ??= isset($column['attnum']) ? (int) $column['attnum'] : null;
        if ($attnum === null) {
            throw new GoneException('Could not find the column in the table.');
        }

        $old = self::current($ctx, $tid, $attnum);
        $column = self::forTemplate($column);
        $column['schema'] = $schema;
        $column['table'] = $table;
        self::normaliseSerial($column, $old);
        self::dropCollationForType($ctx, $column, $old);

        return $ctx->renderFrom('columns', 'update.sql', ['data' => $column, 'o_data' => $old]) . self::generatedSql($ctx, $column, $old);
    }

    /**
     * What pgAdmin's update.sql leaves out for a generated column: DROP EXPRESSION when it
     * stops being one, SET EXPRESSION (PostgreSQL 17+) when its expression changes. PostgreSQL
     * cannot make an existing column generated.
     *
     * @param array<string, mixed> $column
     * @param array<string, mixed> $old
     */
    private static function generatedSql(NodeContext $ctx, array $column, array $old): string
    {
        if (!isset($column['colconstype'])) {
            return '';
        }
        $was = ($old['colconstype'] ?? 'n') === 'g';
        $becomes = $column['colconstype'] === 'g';
        $target = sprintf("ALTER TABLE IF EXISTS %s\n    ALTER COLUMN %s", Quoting::ident($column['schema'], $column['table']), Quoting::ident((string) (($column['name'] ?? '') !== '' ? $column['name'] : $old['name'])));

        if ($was && !$becomes) {
            return "\n" . $target . " DROP EXPRESSION;\n";
        }
        if (!$was && $becomes) {
            throw new BadRequestException('PostgreSQL cannot make an existing column generated; add a new column instead.');
        }
        $expression = trim((string) ($column['genexpr'] ?? ''));
        if (!$becomes || $expression === '' || $expression === trim((string) ($old['genexpr'] ?? ''))) {
            return '';
        }
        if ($ctx->version() < 170000) {
            throw new BadRequestException('Changing a generated column\'s expression needs PostgreSQL 17 or later; drop the column and add it again.');
        }

        return "\n" . $target . ' SET EXPRESSION AS (' . $expression . ");\n";
    }

    /**
     * The values the templates write unquoted, checked: storage and compression keywords, the
     * identity kind, and the statistics target as an integer.
     *
     * @param array<string, mixed> $column
     */
    private static function checkOptions(array &$column): void
    {
        foreach (['attstorage' => self::STORAGE, 'attcompression' => self::COMPRESSION, 'attidentity' => self::IDENTITY] as $key => $allowed) {
            if (isset($column[$key]) && $column[$key] !== '' && !in_array($column[$key], $allowed, true)) {
                throw new BadRequestException(sprintf('Invalid value for %s.', $key));
            }
        }
        if (isset($column['attstattarget']) && $column['attstattarget'] !== '') {
            if (!is_numeric($column['attstattarget'])) {
                throw new BadRequestException('The statistics target must be a number.');
            }
            $column['attstattarget'] = (int) $column['attstattarget'];
        }
        foreach (['seqstart', 'seqincrement', 'seqmin', 'seqmax', 'seqcache'] as $key) {
            if (isset($column[$key]) && $column[$key] !== '' && !is_numeric($column[$key])) {
                throw new BadRequestException(sprintf('Invalid value for %s.', $key));
            }
        }
    }

    /** ALTER TABLE … DROP COLUMN. */
    public static function deleteSql(NodeContext $ctx, string $schema, string $table, string $name): string
    {
        return $ctx->renderFrom('columns', 'delete.sql', ['data' => ['schema' => $schema, 'table' => $table, 'name' => $name]]);
    }

    /**
     * The column as it stands, formatted the way the update template compares it: the type
     * split from its brackets and modifiers, the length and precision read out of it, and the
     * identity sequence's position left unknown (pgAdmin's add_identity_sequence_state reads it
     * only to decide a RESTART).
     *
     * @return array<string, mixed>
     */
    public static function current(NodeContext $ctx, int $tid, int $attnum): array
    {
        $old = $ctx->conn->row($ctx->renderFrom('columns', 'properties.sql', ['tid' => $tid, 'clid' => $attnum, 'show_sys_objects' => true]))
            ?? throw new GoneException('Could not find the column in the table.');

        [$old['cltype'], $old['hasSqrBracket']] = ColumnTypes::split((string) $old['cltype']);
        ColumnTypes::fetchLengthPrecision($old);
        $old['cltype'] = ColumnTypes::parseTypeName((string) $old['cltype']);
        $old['seqlastvalue'] = null;
        $old['seqiscalled'] = null;

        return $old;
    }

    /**
     * The client's column as the templates take it: type split from its brackets, lengths as
     * strings, privileges as template rows. pgAdmin's parse_format_columns for one column.
     *
     * @param array<string, mixed> $column
     * @return array<string, mixed>
     */
    public static function forTemplate(array $column): array
    {
        if (isset($column['cltype'])) {
            [$column['cltype'], $column['hasSqrBracket']] = ColumnTypes::split((string) $column['cltype']);
        }
        ColumnTypes::normaliseLengths($column);
        self::checkOptions($column);

        if (isset($column['attacl']) && is_array($column['attacl'])) {
            if (array_is_list($column['attacl'])) {
                $column['attacl'] = Acl::toDb($column['attacl'], ColumnFormatter::ACL);
            } else {
                foreach (['added', 'changed', 'deleted'] as $mode) {
                    if (isset($column['attacl'][$mode])) {
                        $column['attacl'][$mode] = Acl::toDb($column['attacl'][$mode], ColumnFormatter::ACL);
                    }
                }
            }
        }

        return $column;
    }

    /**
     * A SERIAL pseudo-type is a declaration, not a type ALTER COLUMN accepts: compare and alter
     * the integer type behind it, and create or drop the owned sequence when the column becomes
     * or stops being SERIAL (pgAdmin's _normalise_serial_column).
     *
     * @param array<string, mixed> $column
     * @param array<string, mixed> $old
     */
    private static function normaliseSerial(array &$column, array $old): void
    {
        $cltype = $column['cltype'] ?? null;
        $becomesSerial = is_string($cltype) && isset(ColumnTypes::SERIAL_TYPES[$cltype]);
        $wasSerial = self::isSerial($old);
        $leavingSerial = $wasSerial && !$becomesSerial && array_key_exists('cltype', $column) && array_key_exists('defval', $column) && $column['defval'] !== ($old['defval'] ?? null);

        if (!$becomesSerial && !$leavingSerial) {
            return;
        }

        if ($becomesSerial) {
            $column['cltype'] = ColumnTypes::SERIAL_TYPES[$cltype];
            if ($wasSerial) {
                unset($column['defval']);
            } else {
                // A new sequence, named as PostgreSQL would name it, owned by the column and set as its default.
                $sequence = sprintf('%s.%s', \PhpPgAdmin\Core\Database\Quoting::ident($column['schema']), \PhpPgAdmin\Core\Database\Quoting::ident(sprintf('%s_%s_seq', $column['table'], $column['name'] ?? $old['name'])));
                $column['defval'] = sprintf("nextval('%s'::regclass)", str_replace("'", "''", $sequence));
                $column['serial_seq_create'] = ['name' => $sequence, 'data_type' => $column['cltype'], 'increment' => null, 'start' => null, 'minimum' => null, 'maximum' => null, 'cache' => null, 'cycled' => false];
            }
        } elseif ($leavingSerial && preg_match("/nextval\\('(.+)'::regclass\\)$/", (string) $old['defval'], $m) === 1) {
            $column['serial_seq_drop'] = str_replace("''", "'", $m[1]);
        }

        foreach (['seqincrement', 'seqstart', 'seqmin', 'seqmax', 'seqcache', 'seqcycle', 'seqtypname'] as $key) {
            unset($column[$key]);
        }
    }

    /**
     * The update template repeats the column's collation after a new type; a type without
     * collation support (integer, a date) rejects any COLLATE clause, so a column changing to
     * one leaves its old collation behind.
     *
     * @param array<string, mixed> $column
     * @param array<string, mixed> $old
     */
    private static function dropCollationForType(NodeContext $ctx, array &$column, array &$old): void
    {
        $cltype = $column['cltype'] ?? null;
        if (!is_string($cltype) || $cltype === '' || $cltype === $old['cltype']) {
            return;
        }

        $collatable = $ctx->conn->scalar('SELECT t.typcollation <> 0 FROM pg_catalog.pg_type t WHERE t.oid = pg_catalog.to_regtype($1)', [$cltype]);
        if ($collatable === false || $collatable === 'f') {
            unset($column['collspcname']);
            $old['collspcname'] = '';
        }
    }

    /** @param array<string, mixed> $column */
    private static function isSerial(array $column): bool
    {
        return !empty($column['seqrelid'])
            && str_starts_with((string) ($column['defval'] ?? ''), "nextval('")
            && empty($column['attidentity'])
            && $column['seqrelid'] == ($column['defseqrelid'] ?? null)
            && in_array($column['typname'] ?? '', ColumnTypes::SERIAL_TYPES, true);
    }
}
