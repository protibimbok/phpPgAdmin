<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\SchemaDiff\Diff;

use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\Quoting;

/**
 * The statements that make a target table like its source, as pgAdmin's schema diff alters a
 * table rather than recreating it: the columns (added, dropped, retyped, with their default,
 * NOT NULL, identity or generation and comment), the constraints and indexes (dropped and made
 * again where their definition differs), the triggers and the table's comment. The definitions
 * are the catalog's own (format_type, pg_get_constraintdef, pg_get_indexdef,
 * pg_get_triggerdef), written in the target schema; anything else that differs (rules,
 * policies, storage options) is named in a comment for the user to settle.
 */
final readonly class TableDiff
{
    public function __construct(private DdlNormalizer $normalizer)
    {
    }

    /** @return list<string> */
    public function statements(Connection $source, int $sourceOid, Connection $target, int $targetOid, string $table): array
    {
        $src = $this->describe($source, $sourceOid, true);
        $tgt = $this->describe($target, $targetOid, false);
        $drop = $add = $alter = $after = [];

        foreach ($tgt['triggers'] as $name => $def) {
            if (($src['triggers'][$name] ?? null) !== $def) {
                $drop[] = sprintf('DROP TRIGGER IF EXISTS %s ON %s;', Quoting::ident($name), $table);
            }
        }
        foreach ($tgt['constraints'] as $name => $def) {
            if (($src['constraints'][$name] ?? null) !== $def) {
                $drop[] = sprintf('ALTER TABLE IF EXISTS %s DROP CONSTRAINT IF EXISTS %s;', $table, Quoting::ident($name));
            }
        }
        foreach ($tgt['indexes'] as $name => $def) {
            if (($src['indexes'][$name] ?? null) !== $def) {
                $drop[] = sprintf('DROP INDEX IF EXISTS %s;', $this->qualified($name));
            }
        }

        foreach ($tgt['columns'] as $name => $column) {
            if (!isset($src['columns'][$name])) {
                $drop[] = sprintf('ALTER TABLE IF EXISTS %s DROP COLUMN IF EXISTS %s;', $table, Quoting::ident($name));
            }
        }
        foreach ($src['columns'] as $name => $column) {
            $was = $tgt['columns'][$name] ?? null;
            if ($was === null) {
                $add[] = sprintf('ALTER TABLE IF EXISTS %s ADD COLUMN %s;', $table, $this->columnDefinition($name, $column));
            } else {
                array_push($alter, ...$this->columnChanges($table, $name, $column, $was));
            }
            if ($column['comment'] !== ($was['comment'] ?? null)) {
                $after[] = sprintf('COMMENT ON COLUMN %s.%s IS %s;', $table, Quoting::ident($name), Quoting::literal($column['comment']));
            }
        }

        // Constraints after the columns they name; foreign keys last, once the keys they reference exist.
        $constraints = $src['constraints'];
        uksort($constraints, static fn (string $a, string $b): int => (int) str_starts_with($src['constraints'][$a], 'FOREIGN KEY') <=> (int) str_starts_with($src['constraints'][$b], 'FOREIGN KEY'));
        foreach ($constraints as $name => $def) {
            if (($tgt['constraints'][$name] ?? null) !== $def) {
                $after[] = sprintf('ALTER TABLE IF EXISTS %s ADD CONSTRAINT %s %s;', $table, Quoting::ident($name), $def);
            }
        }
        foreach ($src['indexes'] as $name => $def) {
            if (($tgt['indexes'][$name] ?? null) !== $def) {
                $after[] = $def . ';';
            }
        }
        foreach ($src['triggers'] as $name => $def) {
            if (($tgt['triggers'][$name] ?? null) !== $def) {
                $after[] = $def . ';';
            }
        }
        if ($src['comment'] !== $tgt['comment']) {
            $after[] = sprintf('COMMENT ON TABLE %s IS %s;', $table, Quoting::literal($src['comment']));
        }

        return [...$drop, ...$add, ...$alter, ...$after];
    }

    /**
     * A column added, as ADD COLUMN writes it.
     *
     * @param array{type: string, collation: string|null, default: string|null, notnull: bool, identity: string, generated: string} $column
     */
    private function columnDefinition(string $name, array $column): string
    {
        $sql = Quoting::ident($name) . ' ' . $column['type'];
        if ($column['collation'] !== null) {
            $sql .= ' COLLATE ' . $column['collation'];
        }
        if ($column['generated'] === 's' || $column['generated'] === 'v') {
            $sql .= ' GENERATED ALWAYS AS (' . $column['default'] . ') ' . ($column['generated'] === 'v' ? 'VIRTUAL' : 'STORED');
        } elseif ($column['identity'] !== '') {
            $sql .= ' GENERATED ' . ($column['identity'] === 'a' ? 'ALWAYS' : 'BY DEFAULT') . ' AS IDENTITY';
        } elseif ($column['default'] !== null) {
            $sql .= ' DEFAULT ' . $column['default'];
        }

        return $sql . ($column['notnull'] ? ' NOT NULL' : '');
    }

    /**
     * What turns a target column into its source.
     *
     * @return list<string>
     */
    private function columnChanges(string $table, string $name, array $column, array $was): array
    {
        $col = Quoting::ident($name);
        $prefix = sprintf('ALTER TABLE IF EXISTS %s ALTER COLUMN %s', $table, $col);
        $sql = [];
        if ($column['generated'] !== $was['generated'] || ($column['generated'] !== '' && $column['default'] !== $was['default'])) {
            // A generation expression cannot be changed in place: the column is made again.
            return [
                sprintf('ALTER TABLE IF EXISTS %s DROP COLUMN IF EXISTS %s;', $table, $col),
                sprintf('ALTER TABLE IF EXISTS %s ADD COLUMN %s;', $table, $this->columnDefinition($name, $column)),
            ];
        }
        if ($column['type'] !== $was['type'] || $column['collation'] !== $was['collation']) {
            $sql[] = sprintf('%s TYPE %s%s USING %s::%s;', $prefix, $column['type'], $column['collation'] !== null ? ' COLLATE ' . $column['collation'] : '', $col, $column['type']);
        }
        if ($column['identity'] !== $was['identity']) {
            if ($was['identity'] !== '') {
                $sql[] = sprintf('%s DROP IDENTITY IF EXISTS;', $prefix);
            }
            if ($column['identity'] !== '') {
                $sql[] = sprintf('%s ADD GENERATED %s AS IDENTITY;', $prefix, $column['identity'] === 'a' ? 'ALWAYS' : 'BY DEFAULT');
            }
        }
        if ($column['identity'] === '' && $column['default'] !== $was['default']) {
            $sql[] = $column['default'] === null ? sprintf('%s DROP DEFAULT;', $prefix) : sprintf('%s SET DEFAULT %s;', $prefix, $column['default']);
        }
        if ($column['notnull'] !== $was['notnull']) {
            $sql[] = sprintf('%s %s NOT NULL;', $prefix, $column['notnull'] ? 'SET' : 'DROP');
        }

        return $sql;
    }

    /**
     * A table as compared: its columns, constraints, indexes (those no constraint owns) and
     * triggers by name with their definitions, and its comment; the source's in the target schema.
     *
     * @return array{columns: array<string, array{type: string, collation: string|null, default: string|null, notnull: bool, identity: string, generated: string, comment: string|null}>, constraints: array<string, string>, indexes: array<string, string>, triggers: array<string, string>, comment: string|null}
     */
    private function describe(Connection $conn, int $oid, bool $retarget): array
    {
        $r = $retarget ? $this->normalizer->retarget(...) : static fn (string $s): string => $s;
        $columns = [];
        foreach ($conn->rows(<<<'SQL'
            SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
                   pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS def, a.attidentity::text AS identity,
                   a.attgenerated::text AS generated, pg_catalog.col_description(a.attrelid, a.attnum) AS comment,
                   CASE WHEN a.attcollation <> t.typcollation THEN pg_catalog.quote_ident(cn.nspname) || '.' || pg_catalog.quote_ident(co.collname) END AS collation
            FROM pg_catalog.pg_attribute a
            JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
            LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            LEFT JOIN pg_catalog.pg_collation co ON co.oid = a.attcollation
            LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid = co.collnamespace
            WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
            ORDER BY a.attnum
            SQL, [$oid]) as $row) {
            $columns[(string) $row['attname']] = [
                'type' => $r((string) $row['type']),
                'collation' => $row['collation'] === null ? null : (string) $row['collation'],
                'default' => $row['def'] === null ? null : $r((string) $row['def']),
                'notnull' => (bool) $row['attnotnull'],
                'identity' => (string) $row['identity'],
                'generated' => (string) $row['generated'],
                'comment' => $row['comment'] === null ? null : (string) $row['comment'],
            ];
        }

        $constraints = [];
        // NOT NULL is a column's; PostgreSQL 18 also keeps it as a constraint.
        foreach ($conn->rows("SELECT conname, pg_catalog.pg_get_constraintdef(oid) AS def FROM pg_catalog.pg_constraint WHERE conrelid = \$1 AND contype <> 'n' ORDER BY conname", [$oid]) as $row) {
            $constraints[(string) $row['conname']] = $r((string) $row['def']);
        }
        $indexes = [];
        foreach ($conn->rows(<<<'SQL'
            SELECT i.relname, pg_catalog.pg_get_indexdef(x.indexrelid) AS def
            FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
            WHERE x.indrelid = $1 AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conindid = x.indexrelid AND c.conrelid = x.indrelid)
            ORDER BY i.relname
            SQL, [$oid]) as $row) {
            $indexes[(string) $row['relname']] = $r((string) $row['def']);
        }
        $triggers = [];
        foreach ($conn->rows('SELECT tgname, pg_catalog.pg_get_triggerdef(oid) AS def FROM pg_catalog.pg_trigger WHERE tgrelid = $1 AND NOT tgisinternal ORDER BY tgname', [$oid]) as $row) {
            $triggers[(string) $row['tgname']] = $r((string) $row['def']);
        }
        $comment = $conn->scalar("SELECT pg_catalog.obj_description(\$1::oid, 'pg_class')", [$oid]);

        return ['columns' => $columns, 'constraints' => $constraints, 'indexes' => $indexes, 'triggers' => $triggers, 'comment' => $comment === null ? null : (string) $comment];
    }

    private function qualified(string $name): string
    {
        return $this->normalizer->targetSchemaIdent() . '.' . Quoting::ident($name);
    }
}
