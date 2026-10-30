<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\SchemaDiff\Diff;

use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Modules\Sql\Sql\Splitter;

/**
 * pgAdmin's schema diff between two schemas of the server, of one database or of two: each
 * object of each type is identical, different, only in the source or only in the target, and
 * for each the DDL that makes the target like the source. A table is altered (TableDiff), a
 * sequence altered; a routine, a view or anything whose DDL says CREATE OR REPLACE is replaced;
 * a database-level object is altered where PostgreSQL has an ALTER for the difference, and
 * anything that differs in its owner, grants or comment only gets those; anything else that
 * differs is dropped and created again, as pgAdmin does.
 *
 * @phpstan-type Result array{type: string, label: string, name: string, status: string, source_oid: int|null, target_oid: int|null}
 */
final class SchemaComparer
{
    public const string IDENTICAL = 'identical';
    public const string DIFFERENT = 'different';
    public const string SOURCE_ONLY = 'source_only';
    public const string TARGET_ONLY = 'target_only';

    /** The DROP a type takes when an object's DDL has no commented one to borrow. */
    private const array KINDS = [
        'collation' => 'COLLATION', 'type' => 'TYPE', 'domain' => 'DOMAIN', 'fts_parser' => 'TEXT SEARCH PARSER',
        'fts_template' => 'TEXT SEARCH TEMPLATE', 'fts_dictionary' => 'TEXT SEARCH DICTIONARY', 'fts_configuration' => 'TEXT SEARCH CONFIGURATION',
        'sequence' => 'SEQUENCE', 'function' => 'FUNCTION', 'procedure' => 'PROCEDURE', 'trigger_function' => 'FUNCTION',
        'aggregate' => 'AGGREGATE', 'operator' => 'OPERATOR', 'table' => 'TABLE', 'foreign_table' => 'FOREIGN TABLE',
        'view' => 'VIEW', 'mview' => 'MATERIALIZED VIEW',
        'schema' => 'SCHEMA', 'extension' => 'EXTENSION', 'language' => 'LANGUAGE', 'foreign_data_wrapper' => 'FOREIGN DATA WRAPPER',
        'foreign_server' => 'SERVER', 'cast' => 'CAST', 'event_trigger' => 'EVENT TRIGGER', 'publication' => 'PUBLICATION',
        'subscription' => 'SUBSCRIPTION',
    ];

    private readonly TableDiff $tables;

    /**
     * The source's sequences the script being written creates, by name; null outside a script,
     * where each object's DDL is shown on its own and every sequence only in the source is
     * taken to be created with it.
     *
     * @var array<string, true>|null
     */
    private ?array $creating = null;

    public function __construct(
        private readonly Snapshot $source,
        private readonly Snapshot $target,
        private readonly DdlNormalizer $normalizer,
    ) {
        $this->tables = new TableDiff($normalizer);
    }

    /** @return list<Result> every object of both schemas, in the order a script creates them */
    public function compare(): array
    {
        $results = [];
        foreach ($this->source->types() as $type) {
            $sourceObjects = $this->source->objects($type);
            $targetObjects = $this->target->objects($type);
            if ($sourceObjects === null || $targetObjects === null) {
                continue;
            }
            $label = Nodes::find($type)?->label ?? $type;
            // A routine's name holds its arguments' types, which may name the schema.
            $retargeted = [];
            foreach ($sourceObjects as $name => $oid) {
                $retargeted[$this->normalizer->retarget($name)] = $oid;
            }
            $names = array_unique([...array_keys($retargeted), ...array_keys($targetObjects)]);
            sort($names, SORT_STRING);
            foreach ($names as $name) {
                $name = (string) $name;
                $s = $retargeted[$name] ?? null;
                $t = $targetObjects[$name] ?? null;
                $status = match (true) {
                    $t === null => self::SOURCE_ONLY,
                    $s === null => self::TARGET_ONLY,
                    $this->same($type, $s, $t) => self::IDENTICAL,
                    default => self::DIFFERENT,
                };
                $results[] = ['type' => $type, 'label' => $label, 'name' => $name, 'status' => $status, 'source_oid' => $s, 'target_oid' => $t];
            }
        }

        return $results;
    }

    /**
     * An object's DDL on each side and the DDL that makes the target's like the source's.
     *
     * @return array{source_ddl: string, target_ddl: string, diff_ddl: string}
     */
    public function ddl(string $type, ?int $sourceOid, ?int $targetOid): array
    {
        $sourceDdl = $sourceOid === null ? '' : $this->source->ddl($type, $sourceOid);
        $targetDdl = $targetOid === null ? '' : $this->target->ddl($type, $targetOid);

        return ['source_ddl' => $sourceDdl, 'target_ddl' => $targetDdl, 'diff_ddl' => $this->diff($type, $sourceOid, $targetOid, $sourceDdl, $targetDdl)];
    }

    /**
     * The phases a script's statements fall in, in the order it runs them: the drops, the
     * objects (a new table without its foreign keys, indexes, triggers, rules and policies), the
     * views and materialized views, then the new tables' indexes, foreign keys, and triggers,
     * rules and policies, and last the sequences' OWNED BY. A table is so made before any
     * foreign key names it, whatever the order of the schemas or a cycle of references, and
     * Copy schema puts the rows in after the objects and before what fires on them.
     */
    public const array PHASES = ['drop', 'create', 'view', 'index', 'fkey', 'trigger', 'owned'];

    /**
     * The statement a script starts with, as pg_dump's does: a SQL function's body is checked
     * against tables only made further down, or in another schema's part.
     */
    public const string PRELUDE = 'SET LOCAL check_function_bodies = false;';

    /**
     * The script for the objects chosen: the drops of what is only in the target first, in the
     * reverse of the creation order, then the rest in creation order, phase by phase.
     *
     * @param list<array{type: string, source_oid: int|null, target_oid: int|null}> $items
     */
    public function script(array $items): string
    {
        $parts = $this->parts($items);

        return $parts === [] ? '' : "BEGIN;\n\n" . self::PRELUDE . "\n\n" . implode("\n\n", $parts) . "\n\nEND;";
    }

    /**
     * The statements of the script for the objects chosen, without the transaction around them.
     *
     * @param list<array{type: string, source_oid: int|null, target_oid: int|null}> $items
     * @return list<string>
     */
    public function parts(array $items): array
    {
        return array_merge(...array_values($this->phased($items)));
    }

    /**
     * The statements of the script for the objects chosen, by phase (PHASES, in order).
     *
     * @param list<array{type: string, source_oid: int|null, target_oid: int|null}> $items
     * @return array<string, list<string>>
     */
    public function phased(array $items): array
    {
        $pieces = $this->pieces($items);
        $phased = array_fill_keys(self::PHASES, []);
        foreach (self::order($this->source->conn, $this->target->conn, $items, $this->source->types()) as $key) {
            foreach ($pieces[$key] as [$phase, $sql]) {
                $phased[$phase][] = $sql;
            }
        }

        return $phased;
    }

    /**
     * Each item's statements, keyed as the items are, each with the phase it runs in.
     *
     * @param array<array-key, array{type: string, source_oid: int|null, target_oid: int|null}> $items
     * @return array<array-key, list<array{0: string, 1: string}>>
     */
    public function pieces(array $items): array
    {
        $sequences = array_flip($this->source->objects('sequence') ?? []);
        $this->creating = [];
        foreach ($items as $item) {
            if ($item['type'] === 'sequence' && $item['source_oid'] !== null && $item['target_oid'] === null && isset($sequences[$item['source_oid']])) {
                $this->creating[$this->normalizer->retarget((string) $sequences[$item['source_oid']])] = true;
            }
        }
        $pieces = [];
        try {
            foreach ($items as $key => $item) {
                $pieces[$key] = $this->itemPieces($item);
            }
        } finally {
            $this->creating = null;
        }

        return $pieces;
    }

    /**
     * The keys of the items in the order a script takes them: the drops in the reverse of the
     * order the target's objects would be made in, then the rest in the source's: by type, and
     * among the relations (tables and foreign tables, views and materialized views) each after
     * those it inherits from, references or selects from, in whatever schema.
     *
     * @param array<array-key, array{type: string, source_oid: int|null, target_oid: int|null}> $items
     * @param list<string> $types
     * @return list<array-key>
     */
    public static function order(Connection $sourceConn, Connection $targetConn, array $items, array $types): array
    {
        $drops = array_filter($items, static fn (array $i): bool => $i['source_oid'] === null);
        $rest = array_filter($items, static fn (array $i): bool => $i['source_oid'] !== null);

        return [...array_reverse(self::byDependency($targetConn, $drops, $types, 'target_oid')), ...self::byDependency($sourceConn, $rest, $types, 'source_oid')];
    }

    /**
     * @param array<array-key, array{type: string, source_oid: int|null, target_oid: int|null}> $items
     * @param list<string> $types
     * @return list<array-key>
     */
    private static function byDependency(Connection $conn, array $items, array $types, string $oidKey): array
    {
        $rank = array_flip($types);
        // A view may select from a materialized view, a table inherit from a foreign table.
        foreach (['foreign_table' => 'table', 'mview' => 'view'] as $type => $like) {
            if (isset($rank[$type], $rank[$like])) {
                $rank[$type] = $rank[$like];
            }
        }
        $keys = array_keys($items);
        $position = array_flip($keys);
        usort($keys, static fn (int|string $a, int|string $b): int => [$rank[$items[$a]['type']] ?? PHP_INT_MAX, $position[$a]] <=> [$rank[$items[$b]['type']] ?? PHP_INT_MAX, $position[$b]]);

        $relations = [];
        foreach ($keys as $key) {
            if (in_array($items[$key]['type'], ['table', 'foreign_table', 'view', 'mview'], true) && $items[$key][$oidKey] !== null) {
                $relations[(int) $items[$key][$oidKey]] = $key;
            }
        }
        if (count($relations) < 2) {
            return $keys;
        }
        $uses = [];
        foreach ($conn->rows(<<<'SQL'
            SELECT DISTINCT dep, ref FROM (
                SELECT r.ev_class AS dep, d.refobjid AS ref
                FROM pg_catalog.pg_rewrite r
                JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_rewrite'::regclass AND d.objid = r.oid AND d.refclassid = 'pg_catalog.pg_class'::regclass
                UNION ALL SELECT inhrelid, inhparent FROM pg_catalog.pg_inherits
                UNION ALL SELECT conrelid, confrelid FROM pg_catalog.pg_constraint WHERE contype = 'f'
            ) uses
            WHERE dep = ANY($1::oid[]) AND ref = ANY($1::oid[]) AND dep <> ref
            SQL, ['{' . implode(',', array_keys($relations)) . '}']) as $row) {
            $uses[(int) $row['dep']][] = (int) $row['ref'];
        }

        // Depth first, within a rank only: a cycle (two tables that reference each other) is cut.
        $sorted = [];
        $done = [];
        $visit = static function (int|string $key, array $path) use (&$visit, &$sorted, &$done, $items, $uses, $relations, $rank, $oidKey): void {
            if (isset($done[$key]) || isset($path[$key])) {
                return;
            }
            $path[$key] = true;
            foreach ($uses[(int) $items[$key][$oidKey]] ?? [] as $ref) {
                $other = $relations[$ref] ?? null;
                if ($other !== null && ($rank[$items[$other]['type']] ?? null) === ($rank[$items[$key]['type']] ?? null)) {
                    $visit($other, $path);
                }
            }
            $done[$key] = true;
            $sorted[] = $key;
        };
        foreach ($keys as $key) {
            $visit($key, []);
        }

        return $sorted;
    }

    /**
     * An item's statements with their phases: a drop; a new table split into its CREATE (its
     * foreign keys taken out), its indexes, foreign keys and triggers, rules and policies; a
     * view; a sequence's OWNED BY, which names a column its table may not have yet; the rest.
     *
     * @param array{type: string, source_oid: int|null, target_oid: int|null} $item
     * @return list<array{0: string, 1: string}>
     */
    private function itemPieces(array $item): array
    {
        $ddl = trim($this->ddl($item['type'], $item['source_oid'], $item['target_oid'])['diff_ddl']);
        if ($ddl === '') {
            return [];
        }
        if ($item['source_oid'] === null) {
            return [['drop', $ddl]];
        }
        if ($item['type'] === 'table' && $item['target_oid'] === null) {
            return self::tablePieces($ddl);
        }
        $pieces = [];
        if ($item['type'] === 'sequence') {
            $ddl = trim((string) preg_replace_callback('/^ALTER\s+SEQUENCE\s+[^;]*?\sOWNED\s+BY\s[^;]*;\n*/mi', static function (array $m) use (&$pieces): string {
                $pieces[] = ['owned', rtrim($m[0])];

                return '';
            }, $ddl));
        }
        if ($ddl !== '') {
            array_unshift($pieces, [in_array($item['type'], ['view', 'mview'], true) ? 'view' : 'create', $ddl]);
        }

        return $pieces;
    }

    /**
     * A new table's DDL by phase, its statements in their order within each.
     *
     * @return list<array{0: string, 1: string}>
     */
    private static function tablePieces(string $ddl): array
    {
        $byPhase = [];
        foreach (Splitter::split($ddl) as $statement) {
            $sql = trim($statement->sql);
            $bare = (string) preg_replace('/^(?:\s*--[^\n]*(?:\n|$))*\s*/', '', $sql);
            if ($bare === '') {
                continue;
            }
            if (preg_match('/^CREATE\s+(?:UNLOGGED\s+)?TABLE\s/i', $bare) === 1) {
                [$sql, $foreignKeys] = self::withoutForeignKeys($sql);
                $byPhase['create'][] = $sql . ';';
                foreach ($foreignKeys as $foreignKey) {
                    $byPhase['fkey'][] = $foreignKey;
                }
                continue;
            }
            $byPhase[self::tablePhase($bare)][] = $sql . ';';
        }
        $pieces = [];
        foreach (self::PHASES as $phase) {
            if (isset($byPhase[$phase])) {
                $pieces[] = [$phase, implode("\n\n", $byPhase[$phase])];
            }
        }

        return $pieces;
    }

    /** The phase of a statement of a new table's DDL other than its CREATE TABLE. */
    private static function tablePhase(string $sql): string
    {
        return match (true) {
            preg_match('/^(CREATE\s+(UNIQUE\s+)?INDEX|ALTER\s+INDEX|COMMENT\s+ON\s+INDEX|CREATE\s+STATISTICS|ALTER\s+STATISTICS|COMMENT\s+ON\s+STATISTICS)\s/i', $sql) === 1 => 'index',
            preg_match('/^COMMENT\s+ON\s+CONSTRAINT\s/i', $sql) === 1,
            preg_match('/^ALTER\s+TABLE\s[^;]*?\sADD\s+CONSTRAINT\s+\S+\s+FOREIGN\s+KEY\s/is', $sql) === 1 => 'fkey',
            preg_match('/^(CREATE\s+(OR\s+REPLACE\s+)?(CONSTRAINT\s+)?TRIGGER|COMMENT\s+ON\s+TRIGGER|ALTER\s+TRIGGER|CREATE\s+(OR\s+REPLACE\s+)?RULE|COMMENT\s+ON\s+RULE|CREATE\s+POLICY|COMMENT\s+ON\s+POLICY)\s/i', $sql) === 1,
            preg_match('/^ALTER\s+TABLE\s[^;]*?\s((ENABLE|DISABLE)(\s+(ALWAYS|REPLICA))?\s+(TRIGGER|RULE)|(ENABLE|DISABLE|FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY|REPLICA\s+IDENTITY|CLUSTER\s+ON)\b/is', $sql) === 1 => 'trigger',
            preg_match('/^ALTER\s+SEQUENCE\s[^;]*?\sOWNED\s+BY\s/is', $sql) === 1 => 'owned',
            default => 'create',
        };
    }

    /**
     * A CREATE TABLE without the foreign keys between its parentheses, and an ALTER TABLE … ADD
     * for each.
     *
     * @return array{0: string, 1: list<string>}
     */
    private static function withoutForeignKeys(string $sql): array
    {
        $ident = '(?:"(?:""|[^"])*"|[^\s(."]+)';
        if (preg_match('/^((?:\s*--[^\n]*\n)*\s*CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(' . $ident . '(?:\.' . $ident . ')?)\s*)\(/i', $sql, $m) !== 1) {
            return [$sql, []];
        }
        $table = $m[2];
        $length = strlen($sql);
        $start = strlen($m[1]) + 1;
        $elements = [];
        $depth = 1;
        $close = null;
        for ($i = $start, $from = $start; $i < $length; $i++) {
            $c = $sql[$i];
            if ($c === "'" || $c === '"') {
                $end = $i + 1;
                while ($end < $length && ($sql[$end] !== $c || ($sql[$end + 1] ?? '') === $c)) {
                    $end += $sql[$end] === $c ? 2 : 1;
                }
                $i = $end;
            } elseif ($c === '-' && ($sql[$i + 1] ?? '') === '-') {
                $i = ($newline = strpos($sql, "\n", $i)) === false ? $length : $newline;
            } elseif ($c === '(') {
                $depth++;
            } elseif ($c === ')' && --$depth === 0) {
                $elements[] = substr($sql, $from, $i - $from);
                $close = $i;
                break;
            } elseif ($c === ',' && $depth === 1) {
                $elements[] = substr($sql, $from, $i - $from);
                $from = $i + 1;
            }
        }
        if ($close === null) {
            return [$sql, []];
        }
        $kept = [];
        $foreignKeys = [];
        foreach ($elements as $element) {
            $bare = trim((string) preg_replace('/^(?:\s*--[^\n]*\n)*/', '', $element));
            if (preg_match('/^CONSTRAINT\s+' . $ident . '\s+FOREIGN\s+KEY\b/i', $bare) === 1) {
                $foreignKeys[] = sprintf("ALTER TABLE IF EXISTS %s\n    ADD %s;", $table, $bare);
            } else {
                $kept[] = $element;
            }
        }
        if ($foreignKeys === []) {
            return [$sql, []];
        }

        return [substr($sql, 0, $start) . rtrim(implode(',', $kept)) . "\n" . substr($sql, $close), $foreignKeys];
    }

    private function same(string $type, int $sourceOid, int $targetOid): bool
    {
        $source = $this->normalizer->normalize($this->source->ddl($type, $sourceOid), true);
        $target = $this->normalizer->normalize($this->target->ddl($type, $targetOid), false);
        if (in_array($type, ['table', 'foreign_table'], true)) {
            // Columns are compared by name, as pgAdmin compares them: a column added to a
            // table goes last, wherever the source has it.
            return self::unordered($source) === self::unordered($target);
        }

        return $source === $target;
    }

    /** A CREATE TABLE with the lines between its parentheses (columns, constraints) sorted. */
    private static function unordered(string $ddl): string
    {
        return (string) preg_replace_callback('/^(CREATE\s+(?:FOREIGN\s+)?TABLE[^\n]*\n\(\n)(.*?)(\n\))/ms', static function (array $m): string {
            $lines = array_map(static fn (string $line): string => rtrim(trim($line), ','), explode("\n", $m[2]));
            sort($lines, SORT_STRING);

            return $m[1] . implode("\n", $lines) . $m[3];
        }, $ddl);
    }

    private function diff(string $type, ?int $sourceOid, ?int $targetOid, string $sourceDdl, string $targetDdl): string
    {
        if ($sourceOid === null) {
            return $this->dropOf($type, $targetDdl);
        }
        $create = DdlNormalizer::withoutHeader($this->normalizer->retarget($sourceDdl));
        if (in_array($type, ['function', 'procedure', 'trigger_function'], true)) {
            $create = $this->withSourceBody($sourceOid, $create);
        }
        if ($targetOid === null) {
            return $type === 'table' ? $this->withSequenceDefaults($sourceOid, $create) : $create;
        }
        if ($this->same($type, $sourceOid, $targetOid)) {
            return '';
        }

        $statements = match ($type) {
            'schema' => [...$this->schemaOwner($sourceDdl, $targetDdl), ...$this->comments($sourceDdl, $targetDdl)],
            'extension' => $this->extension($sourceOid, $targetOid),
            'table' => $this->tables->statements($this->source->conn, $sourceOid, $this->target->conn, $targetOid, $this->targetName($type, $targetDdl)),
            'sequence' => $this->sequence($sourceOid, $targetOid, $this->targetName($type, $targetDdl)),
            default => null,
        };
        if ($statements !== null) {
            return implode("\n", [...$statements, ...$this->otherStatements($sourceDdl, $targetDdl)]);
        }
        // What PostgreSQL alters in place, rather than dropping it and what depends on it.
        $altered = match ($type) {
            'foreign_data_wrapper' => $this->wrapper($sourceOid, $targetOid),
            'foreign_server' => $this->server($sourceOid, $targetOid),
            'user_mapping' => $this->userMapping($sourceOid, $targetOid),
            'event_trigger' => $this->eventTrigger($sourceOid, $targetOid),
            'publication' => $this->publication($sourceDdl, $targetDdl),
            'subscription' => $this->subscription($sourceDdl, $targetDdl),
            default => null,
        };
        if ($altered !== null || $this->onlyMetadataDiffers($sourceDdl, $targetDdl)) {
            return implode("\n\n", [...($altered ?? []), ...$this->otherStatements($sourceDdl, $targetDdl), ...$this->comments($sourceDdl, $targetDdl)]);
        }
        // A routine or a view is replaced in place; what has no CREATE OR REPLACE is made again.
        if (preg_match('/^\s*CREATE\s+OR\s+REPLACE\s/im', $create) === 1 && $type !== 'mview') {
            return $create;
        }

        return $this->dropOf($type, $targetDdl) . "\n\n" . $create;
    }

    /** Whether the two DDLs differ in no more than owners, privileges and comments. */
    private function onlyMetadataDiffers(string $sourceDdl, string $targetDdl): bool
    {
        $rest = static fn (array $statements): array => array_values(array_filter($statements, static fn (string $s): bool => preg_match('/^(COMMENT\s+ON\s|GRANT\s|REVOKE\s|ALTER\s.+\sOWNER\s+TO\s)/is', $s) !== 1));

        return $rest($this->normalizer->statements($sourceDdl, true)) === $rest($this->normalizer->statements($targetDdl, false));
    }

    /**
     * A routine's CREATE with its body as the source has it: the SQL tab, as pgAdmin's, sets
     * it on lines of its own, which adds a newline before and after it to prosrc.
     */
    private function withSourceBody(int $oid, string $create): string
    {
        $row = $this->source->conn->row(<<<'SQL'
            SELECT p.prosrc, p.prosqlbody IS NOT NULL AS atomic, l.lanname
            FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
            WHERE p.oid = $1
            SQL, [$oid]);
        if ($row === null || $row['atomic'] === true || $row['atomic'] === 't' || $row['lanname'] === 'c') {
            return $create;
        }
        $body = (string) $row['prosrc'];
        $tag = '$BODY$';
        for ($n = 1; str_contains($body, $tag); $n++) {
            $tag = '$BODY' . $n . '$';
        }

        return (string) preg_replace_callback('/\bAS\s+\$BODY\$.*\$BODY\$/s', static fn (): string => 'AS ' . $tag . $body . $tag, $create, 1);
    }

    /**
     * An object's options as a map, from an options array column: srvoptions, umoptions, ….
     *
     * @return array<string, string|null>
     */
    private static function options(Connection $conn, string $query, int $oid): array
    {
        $options = [];
        foreach ($conn->rows('SELECT option_name, option_value FROM pg_catalog.pg_options_to_table((' . $query . '))', [$oid]) as $row) {
            $options[(string) $row['option_name']] = $row['option_value'] === null ? null : (string) $row['option_value'];
        }

        return $options;
    }

    /**
     * OPTIONS (ADD …, SET …, DROP …) turning the target's options into the source's, or null.
     *
     * @param array<string, string|null> $source
     * @param array<string, string|null> $target
     */
    private static function optionsClause(array $source, array $target): ?string
    {
        $changes = [];
        foreach ($source as $name => $value) {
            if (!array_key_exists($name, $target)) {
                $changes[] = sprintf('ADD %s %s', Quoting::ident($name), Quoting::literal($value));
            } elseif ($target[$name] !== $value) {
                $changes[] = sprintf('SET %s %s', Quoting::ident($name), Quoting::literal($value));
            }
        }
        foreach (array_keys(array_diff_key($target, $source)) as $name) {
            $changes[] = 'DROP ' . Quoting::ident((string) $name);
        }

        return $changes === [] ? null : 'OPTIONS (' . implode(', ', $changes) . ')';
    }

    /** @return list<string> ALTER FOREIGN DATA WRAPPER for its handler, validator and options */
    private function wrapper(int $sourceOid, int $targetOid): array
    {
        $query = "SELECT fdwname, CASE WHEN fdwhandler = 0 THEN NULL ELSE fdwhandler::regproc::text END AS handler, CASE WHEN fdwvalidator = 0 THEN NULL ELSE fdwvalidator::regproc::text END AS validator FROM pg_catalog.pg_foreign_data_wrapper WHERE oid = \$1";
        $s = $this->source->conn->row($query, [$sourceOid]) ?? [];
        $t = $this->target->conn->row($query, [$targetOid]) ?? [];
        $name = Quoting::ident((string) ($t['fdwname'] ?? ''));
        $statements = [];
        foreach (['handler' => 'HANDLER', 'validator' => 'VALIDATOR'] as $key => $word) {
            if (($s[$key] ?? null) !== ($t[$key] ?? null)) {
                $statements[] = sprintf('ALTER FOREIGN DATA WRAPPER %s %s;', $name, $s[$key] === null ? 'NO ' . $word : $word . ' ' . $s[$key]);
            }
        }
        $optionsQuery = 'SELECT fdwoptions FROM pg_catalog.pg_foreign_data_wrapper WHERE oid = $1';
        if (($clause = self::optionsClause(self::options($this->source->conn, $optionsQuery, $sourceOid), self::options($this->target->conn, $optionsQuery, $targetOid))) !== null) {
            $statements[] = sprintf('ALTER FOREIGN DATA WRAPPER %s %s;', $name, $clause);
        }

        return $statements;
    }

    /**
     * ALTER SERVER for its version and options; null for another wrapper or type, which only
     * CREATE SERVER sets.
     *
     * @return list<string>|null
     */
    private function server(int $sourceOid, int $targetOid): ?array
    {
        $query = 'SELECT s.srvname, w.fdwname, s.srvtype, s.srvversion FROM pg_catalog.pg_foreign_server s JOIN pg_catalog.pg_foreign_data_wrapper w ON w.oid = s.srvfdw WHERE s.oid = $1';
        $s = $this->source->conn->row($query, [$sourceOid]) ?? [];
        $t = $this->target->conn->row($query, [$targetOid]) ?? [];
        if (($s['fdwname'] ?? null) !== ($t['fdwname'] ?? null) || ($s['srvtype'] ?? null) !== ($t['srvtype'] ?? null) || (($s['srvversion'] ?? null) === null && ($t['srvversion'] ?? null) !== null)) {
            return null;
        }
        $name = Quoting::ident((string) $t['srvname']);
        $statements = [];
        if ($s['srvversion'] !== $t['srvversion']) {
            $statements[] = sprintf('ALTER SERVER %s VERSION %s;', $name, Quoting::literal((string) $s['srvversion']));
        }
        $optionsQuery = 'SELECT srvoptions FROM pg_catalog.pg_foreign_server WHERE oid = $1';
        if (($clause = self::optionsClause(self::options($this->source->conn, $optionsQuery, $sourceOid), self::options($this->target->conn, $optionsQuery, $targetOid))) !== null) {
            $statements[] = sprintf('ALTER SERVER %s %s;', $name, $clause);
        }

        return $statements;
    }

    /** @return list<string> ALTER USER MAPPING for its options */
    private function userMapping(int $sourceOid, int $targetOid): array
    {
        $row = $this->target->conn->row("SELECT CASE WHEN umuser = 0 THEN 'PUBLIC' ELSE pg_catalog.quote_ident(usename) END AS role, srvname FROM pg_catalog.pg_user_mappings WHERE umid = \$1", [$targetOid]);
        $optionsQuery = 'SELECT umoptions FROM pg_catalog.pg_user_mappings WHERE umid = $1';
        $clause = self::optionsClause(self::options($this->source->conn, $optionsQuery, $sourceOid), self::options($this->target->conn, $optionsQuery, $targetOid));

        return $row === null || $clause === null ? [] : [sprintf('ALTER USER MAPPING FOR %s SERVER %s %s;', $row['role'], Quoting::ident((string) $row['srvname']), $clause)];
    }

    /**
     * ALTER EVENT TRIGGER … ENABLE / DISABLE; null for another event, function or tags, which
     * only CREATE EVENT TRIGGER sets (nothing depends on an event trigger).
     *
     * @return list<string>|null
     */
    private function eventTrigger(int $sourceOid, int $targetOid): ?array
    {
        $query = 'SELECT evtname, evtevent, evtfoid::regprocedure::text AS function, evttags::text AS tags, evtenabled FROM pg_catalog.pg_event_trigger WHERE oid = $1';
        $s = $this->source->conn->row($query, [$sourceOid]) ?? [];
        $t = $this->target->conn->row($query, [$targetOid]) ?? [];
        foreach (['evtevent', 'function', 'tags'] as $key) {
            if (($s[$key] ?? null) !== ($t[$key] ?? null)) {
                return null;
            }
        }
        if (($s['evtenabled'] ?? null) === ($t['evtenabled'] ?? null)) {
            return [];
        }
        $state = ['O' => 'ENABLE', 'D' => 'DISABLE', 'R' => 'ENABLE REPLICA', 'A' => 'ENABLE ALWAYS'][(string) $s['evtenabled']] ?? 'ENABLE';

        return [sprintf('ALTER EVENT TRIGGER %s %s;', Quoting::ident((string) $t['evtname']), $state)];
    }

    /**
     * ALTER PUBLICATION … SET for its tables and schemas and its options; null when one side
     * publishes all tables, which only CREATE PUBLICATION sets.
     *
     * @return list<string>|null
     */
    private function publication(string $sourceDdl, string $targetDdl): ?array
    {
        $parse = static function (array $statements): ?array {
            foreach ($statements as $statement) {
                if (preg_match('/^CREATE\s+PUBLICATION\s+(\S+)(?:\s+FOR\s+(.*?))?(?:\s+WITH\s+\((.*)\))?$/is', $statement, $m) === 1) {
                    return [$m[1], (string) preg_replace('/\s+/', ' ', trim($m[2] ?? '')), (string) preg_replace('/\s+/', ' ', trim($m[3] ?? ''))];
                }
            }

            return null;
        };
        $s = $parse($this->normalizer->statements($sourceDdl, true));
        $t = $parse($this->normalizer->statements($targetDdl, false));
        if ($s === null || $t === null) {
            return null;
        }
        [$name, $for, $with] = $t;
        $statements = [];
        if ($s[1] !== $for) {
            if (preg_match('/^ALL\s+TABLES\b/i', $s[1]) === 1 || preg_match('/^ALL\s+TABLES\b/i', $for) === 1) {
                return null;
            }
            $statements[] = $s[1] === '' ? sprintf('ALTER PUBLICATION %s DROP %s;', $name, $for) : sprintf('ALTER PUBLICATION %s SET %s;', $name, $s[1]);
        }
        if ($s[2] !== $with && $s[2] !== '') {
            $statements[] = sprintf('ALTER PUBLICATION %s SET (%s);', $name, $s[2]);
        }

        return $statements;
    }

    /**
     * ALTER SUBSCRIPTION for its connection, publications, options and whether it is enabled,
     * as pgAdmin's subscription dialog alters one: a subscription made again would drop and
     * create its replication slot. The publications are set WITH (refresh = false).
     *
     * @return list<string>|null
     */
    private function subscription(string $sourceDdl, string $targetDdl): ?array
    {
        $parse = static function (array $statements): ?array {
            foreach ($statements as $statement) {
                if (preg_match('/^CREATE\s+SUBSCRIPTION\s+(\S+)\s+CONNECTION\s+(\'(?:\'\'|[^\'])*\')\s+PUBLICATION\s+(.*?)(?:\s+WITH\s+\((.*)\))?$/is', $statement, $m) === 1) {
                    preg_match_all('/(\w+)\s*=\s*(\'(?:\'\'|[^\'])*\'|[^,\s]+)/', $m[4] ?? '', $pairs, PREG_SET_ORDER);
                    $options = [];
                    foreach ($pairs as $pair) {
                        $options[strtolower($pair[1])] = $pair[2];
                    }

                    return ['name' => $m[1], 'connection' => $m[2], 'publications' => (string) preg_replace('/\s+/', ' ', trim($m[3])), 'options' => $options];
                }
            }

            return null;
        };
        $s = $parse($this->normalizer->statements($sourceDdl, true));
        $t = $parse($this->normalizer->statements($targetDdl, false));
        if ($s === null || $t === null) {
            return null;
        }
        $name = $t['name'];
        $enabled = static fn (array $sub): bool => strtolower($sub['options']['enabled'] ?? 'true') !== 'false';
        $statements = [];
        if (!$enabled($s) && $enabled($t)) {
            $statements[] = sprintf('ALTER SUBSCRIPTION %s DISABLE;', $name);
        }
        $set = [];
        foreach (['slot_name', 'synchronous_commit', 'binary', 'streaming', 'two_phase', 'disable_on_error', 'password_required', 'run_as_owner', 'origin', 'failover', 'retain_dead_tuples', 'max_retention_duration'] as $option) {
            if (isset($s['options'][$option]) && $s['options'][$option] !== ($t['options'][$option] ?? null)) {
                $set[] = $option . ' = ' . $s['options'][$option];
            }
        }
        if ($set !== []) {
            $statements[] = sprintf('ALTER SUBSCRIPTION %s SET (%s);', $name, implode(', ', $set));
        }
        if ($s['connection'] !== $t['connection']) {
            $statements[] = sprintf('ALTER SUBSCRIPTION %s CONNECTION %s;', $name, $s['connection']);
        }
        if ($s['publications'] !== $t['publications']) {
            $statements[] = sprintf('ALTER SUBSCRIPTION %s SET PUBLICATION %s WITH (refresh = false);', $name, $s['publications']);
        }
        if ($enabled($s) && !$enabled($t)) {
            $statements[] = sprintf('ALTER SUBSCRIPTION %s ENABLE;', $name);
        }

        return $statements;
    }

    /**
     * A new table's CREATE with each serial column written as its type and a DEFAULT nextval()
     * of the sequence the script creates (or the target has), as pgAdmin's schema diff does: a
     * serial would make a second sequence (name_seq1) beside it. The sequence is then made the
     * column's with OWNED BY after the table, by the sequence's own DDL or, for one the target
     * already has, here.
     */
    private function withSequenceDefaults(int $sourceOid, string $create): string
    {
        $columns = $this->source->conn->rows(<<<'SQL'
            SELECT a.attname, pg_catalog.format_type(a.atttypid, NULL) AS type, s.relname AS sequence
            FROM pg_catalog.pg_attribute a
            JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            JOIN pg_catalog.pg_depend dep ON dep.refclassid = 'pg_catalog.pg_class'::regclass AND dep.refobjid = a.attrelid AND dep.refobjsubid = a.attnum
                AND dep.classid = 'pg_catalog.pg_class'::regclass AND dep.deptype = 'a'
            JOIN pg_catalog.pg_class s ON s.oid = dep.objid AND s.relkind = 'S'
            WHERE a.attrelid = $1 AND a.attidentity = '' AND NOT a.attisdropped
                AND pg_catalog.pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%'
                AND pg_catalog.format_type(a.atttypid, NULL) IN ('integer', 'smallint', 'bigint')
            SQL, [$sourceOid]);
        if ($columns === []) {
            return $create;
        }

        $inTarget = $this->target->objects('sequence') ?? [];
        $inSource = $this->source->objects('sequence') ?? [];
        $schema = $this->normalizer->targetSchemaIdent();
        $table = $this->targetTableName($create);
        $ownedBy = [];
        foreach ($columns as $column) {
            $sequence = (string) $column['sequence'];
            $exists = isset($inTarget[$sequence]);
            $created = !$exists && ($this->creating === null ? isset($inSource[$sequence]) : isset($this->creating[$sequence]));
            if (!$exists && !$created) {
                continue; // serial makes it
            }
            $name = Quoting::ident((string) $column['attname']);
            $default = sprintf('DEFAULT nextval(%s::regclass)', Quoting::literal($schema . '.' . Quoting::ident($sequence)));
            $create = (string) preg_replace('/^(\s+' . preg_quote($name, '/') . ')\s+(?:small|big)?serial\b/m', '$1 ' . $column['type'] . ' ' . addcslashes($default, '\\$'), $create, 1);
            if (!$created && $table !== null) {
                $ownedBy[] = sprintf("ALTER SEQUENCE %s.%s\n    OWNED BY %s.%s;", $schema, Quoting::ident($sequence), $table, $name);
            }
        }

        return $ownedBy === [] ? $create : rtrim($create) . "\n\n" . implode("\n\n", $ownedBy);
    }

    /** The table a CREATE TABLE makes: "app.t1". */
    private function targetTableName(string $create): ?string
    {
        $ident = '(?:"(?:""|[^"])*"|[^\s(."]+)';

        return preg_match('/^CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(' . $ident . '(?:\.' . $ident . ')?)/mi', $create, $m) === 1 ? $m[1] : null;
    }

    /**
     * The owner, privileges and comments the source's DDL sets and the target's lacks: what a
     * table's or a sequence's ALTERs leave out. A grant only the target has is revoked first,
     * privilege for privilege, so the object ends with the source's privileges and no more.
     *
     * @return list<string>
     */
    private function otherStatements(string $sourceDdl, string $targetDdl): array
    {
        $target = $this->normalizer->statements($targetDdl, false);
        $source = $this->normalizer->statements($sourceDdl, true);
        $statements = [];
        foreach ($target as $statement) {
            if (!in_array($statement, $source, true) && preg_match('/^GRANT\s+(.+?)\s+ON\s+(.+)\s+TO\s+(.+?)(?:\s+WITH\s+GRANT\s+OPTION)?$/is', $statement, $m) === 1) {
                $statements[] = sprintf('REVOKE %s ON %s FROM %s;', $m[1], $m[2], $m[3]);
            }
        }
        foreach ($source as $statement) {
            if (preg_match('/^(ALTER\s.+\sOWNER\s+TO\s|GRANT\s|REVOKE\s)/is', $statement) === 1 && !in_array($statement, $target, true)) {
                $statements[] = $statement . ';';
            }
        }

        return $statements;
    }

    /**
     * The COMMENT ON statements of the source's DDL that the target's lacks, and a comment set
     * to NULL for one only the target has: what changes in a schema besides its owner and its
     * privileges.
     *
     * @return list<string>
     */
    private function comments(string $sourceDdl, string $targetDdl): array
    {
        $comments = static function (array $statements): array {
            $found = [];
            foreach ($statements as $statement) {
                if (preg_match('/^(COMMENT\s+ON\s+.+?)\s+IS\s/is', $statement, $m) === 1) {
                    $found[(string) preg_replace('/\s+/', ' ', $m[1])] = $statement;
                }
            }

            return $found;
        };
        $source = $comments($this->normalizer->statements($sourceDdl, true));
        $target = $comments($this->normalizer->statements($targetDdl, false));
        $statements = [];
        foreach ($source as $on => $statement) {
            if (($target[$on] ?? null) !== $statement) {
                $statements[] = $statement . ';';
            }
        }
        foreach (array_diff_key($target, $source) as $on => $statement) {
            $statements[] = $on . ' IS NULL;';
        }

        return $statements;
    }

    /**
     * ALTER SCHEMA … OWNER TO when the AUTHORIZATION of the source's CREATE SCHEMA differs.
     *
     * @return list<string>
     */
    private function schemaOwner(string $sourceDdl, string $targetDdl): array
    {
        $owner = static function (array $statements): ?array {
            foreach ($statements as $statement) {
                if (preg_match('/^CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)\s+AUTHORIZATION\s+(\S+)/is', $statement, $m) === 1) {
                    return [$m[1], $m[2]];
                }
            }

            return null;
        };
        $source = $owner($this->normalizer->statements($sourceDdl, true));
        $target = $owner($this->normalizer->statements($targetDdl, false));

        return $source !== null && $target !== null && $source[1] !== $target[1] ? [sprintf('ALTER SCHEMA %s OWNER TO %s;', $target[0], $source[1])] : [];
    }

    /**
     * ALTER EXTENSION for a different version or schema: an extension is never dropped and
     * created again, which would drop what uses its types and functions.
     *
     * @return list<string>
     */
    private function extension(int $sourceOid, int $targetOid): array
    {
        $read = static fn ($conn, int $oid): array => $conn->row('SELECT e.extname, e.extversion, n.nspname FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace WHERE e.oid = $1', [$oid]) ?? [];
        $s = $read($this->source->conn, $sourceOid);
        $t = $read($this->target->conn, $targetOid);
        if ($s === [] || $t === []) {
            return [];
        }
        $name = Quoting::ident((string) $t['extname']);
        $statements = [];
        if ($s['extversion'] !== $t['extversion']) {
            $statements[] = sprintf('ALTER EXTENSION %s UPDATE TO %s;', $name, Quoting::literal((string) $s['extversion']));
        }
        if ($s['nspname'] !== $t['nspname']) {
            $statements[] = sprintf('ALTER EXTENSION %s SET SCHEMA %s;', $name, Quoting::ident((string) $s['nspname']));
        }

        return $statements;
    }

    /** ALTER SEQUENCE for what differs among the type, increment, bounds, start, cache and cycle. */
    private function sequence(int $sourceOid, int $targetOid, string $name): array
    {
        $read = static fn ($conn, int $oid): array => $conn->row('SELECT pg_catalog.format_type(seqtypid, NULL) AS type, seqincrement, seqmin, seqmax, seqstart, seqcache, seqcycle FROM pg_catalog.pg_sequence WHERE seqrelid = $1', [$oid]) ?? [];
        $s = $read($this->source->conn, $sourceOid);
        $t = $read($this->target->conn, $targetOid);
        $clauses = [];
        foreach (['type' => 'AS %s', 'seqincrement' => 'INCREMENT BY %s', 'seqmin' => 'MINVALUE %s', 'seqmax' => 'MAXVALUE %s', 'seqstart' => 'START WITH %s', 'seqcache' => 'CACHE %s'] as $key => $format) {
            if (($s[$key] ?? null) !== ($t[$key] ?? null)) {
                $clauses[] = sprintf($format, $s[$key]);
            }
        }
        if (($s['seqcycle'] ?? null) !== ($t['seqcycle'] ?? null)) {
            $clauses[] = $s['seqcycle'] ? 'CYCLE' : 'NO CYCLE';
        }

        return $clauses === [] ? [] : [sprintf('ALTER SEQUENCE %s %s;', $name, implode(' ', $clauses))];
    }

    /** The DROP an object's DDL holds in its header, or one written for its type and name. */
    private function dropOf(string $type, string $ddl): string
    {
        return DdlNormalizer::dropStatement($ddl) ?? sprintf('DROP %s IF EXISTS %s;', self::KINDS[$type] ?? strtoupper($type), $this->targetName($type, $ddl));
    }

    /** The target object's qualified name, from its DDL header: "-- Table: app.t1". */
    private function targetName(string $type, string $ddl): string
    {
        if (preg_match('/^--\s*[\w ]+:\s*(.+?)\s*$/m', $ddl, $m) === 1) {
            return $m[1];
        }

        return $this->normalizer->targetSchemaIdent() . '.?';
    }
}
