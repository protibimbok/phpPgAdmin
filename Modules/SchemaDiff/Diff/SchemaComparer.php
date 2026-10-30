<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\SchemaDiff\Diff;

use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Facades\Nodes;

/**
 * pgAdmin's schema diff between two schemas of the server, of one database or of two: each
 * object of each type is identical, different, only in the source or only in the target, and
 * for each the DDL that makes the target like the source. A table is altered (TableDiff), a
 * sequence altered; a routine, a view or anything whose DDL says CREATE OR REPLACE is replaced;
 * anything else that differs is dropped and created again, as pgAdmin does.
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
     * The script for the objects chosen: the drops of what is only in the target first, in the
     * reverse of the creation order, then the rest in creation order.
     *
     * @param list<array{type: string, source_oid: int|null, target_oid: int|null}> $items
     */
    public function script(array $items): string
    {
        $parts = $this->parts($items);

        return $parts === [] ? '' : "BEGIN;\n\n" . implode("\n\n", $parts) . "\n\nEND;";
    }

    /**
     * The statements of the script for the objects chosen, without the transaction around them.
     *
     * @param list<array{type: string, source_oid: int|null, target_oid: int|null}> $items
     * @return list<string>
     */
    public function parts(array $items): array
    {
        $rank = array_flip($this->source->types());
        $drops = array_values(array_filter($items, static fn (array $i): bool => $i['source_oid'] === null));
        $rest = array_values(array_filter($items, static fn (array $i): bool => $i['source_oid'] !== null));
        usort($drops, static fn (array $a, array $b): int => ($rank[$b['type']] ?? 0) <=> ($rank[$a['type']] ?? 0));
        usort($rest, static fn (array $a, array $b): int => ($rank[$a['type']] ?? 0) <=> ($rank[$b['type']] ?? 0));
        $rest = $this->tablesAfterReferenced($rest);

        $sequences = array_flip($this->source->objects('sequence') ?? []);
        $this->creating = [];
        foreach ($rest as $item) {
            if ($item['type'] === 'sequence' && $item['target_oid'] === null && isset($sequences[$item['source_oid']])) {
                $this->creating[$this->normalizer->retarget((string) $sequences[$item['source_oid']])] = true;
            }
        }

        // A new sequence's OWNED BY names a column its table may not have yet: it goes last.
        $parts = [];
        $ownedBy = [];
        try {
            foreach ([...$drops, ...$rest] as $item) {
                $ddl = $this->ddl($item['type'], $item['source_oid'], $item['target_oid'])['diff_ddl'];
                if ($item['type'] === 'sequence') {
                    $ddl = (string) preg_replace_callback('/^ALTER\s+SEQUENCE\s+[^;]*?\sOWNED\s+BY\s[^;]*;\n*/mi', static function (array $m) use (&$ownedBy): string {
                        $ownedBy[] = rtrim($m[0]);

                        return '';
                    }, $ddl);
                }
                if (trim($ddl) !== '') {
                    $parts[] = trim($ddl);
                }
            }
        } finally {
            $this->creating = null;
        }
        array_push($parts, ...$ownedBy);

        return $parts;
    }

    /**
     * The items with the source's tables reordered so that a table follows the tables its
     * foreign keys reference, which a new table's CREATE names.
     *
     * @param list<array{type: string, source_oid: int|null, target_oid: int|null}> $items
     * @return list<array{type: string, source_oid: int|null, target_oid: int|null}>
     */
    private function tablesAfterReferenced(array $items): array
    {
        $tables = array_values(array_filter($items, static fn (array $i): bool => $i['type'] === 'table'));
        if (count($tables) < 2) {
            return $items;
        }
        $oids = array_map(static fn (array $i): int => (int) $i['source_oid'], $tables);
        $references = [];
        foreach ($this->source->conn->rows("SELECT conrelid, confrelid FROM pg_catalog.pg_constraint WHERE contype = 'f' AND conrelid = ANY(\$1::oid[]) AND confrelid <> conrelid", ['{' . implode(',', $oids) . '}']) as $row) {
            $references[(int) $row['conrelid']][] = (int) $row['confrelid'];
        }
        $ordered = [];
        $visit = static function (int $oid, array $seen) use (&$visit, &$ordered, $references, $oids): void {
            if (in_array($oid, $ordered, true) || in_array($oid, $seen, true)) {
                return;
            }
            foreach ($references[$oid] ?? [] as $referenced) {
                if (in_array($referenced, $oids, true)) {
                    $visit($referenced, [...$seen, $oid]);
                }
            }
            $ordered[] = $oid;
        };
        foreach ($oids as $oid) {
            $visit($oid, []);
        }
        $byOid = array_column($tables, null, 'source_oid');
        $sorted = array_map(static fn (int $oid): array => $byOid[$oid], $ordered);
        $first = array_search('table', array_column($items, 'type'), true);
        $others = array_values(array_filter($items, static fn (array $i): bool => $i['type'] !== 'table'));

        return [...array_slice($others, 0, (int) $first), ...$sorted, ...array_slice($others, (int) $first)];
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
        // A routine or a view is replaced in place; what has no CREATE OR REPLACE is made again.
        if (preg_match('/^\s*CREATE\s+OR\s+REPLACE\s/im', $create) === 1 && $type !== 'mview') {
            return $create;
        }

        return $this->dropOf($type, $targetDdl) . "\n\n" . $create;
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
        return preg_match('/^CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/mi', $create, $m) === 1 ? $m[1] : null;
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
