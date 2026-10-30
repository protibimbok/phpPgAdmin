<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\SchemaDiff\Diff;

use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Modules\Sql\Sql\Splitter;

/**
 * What pgAdmin's schema diff ignores when it compares two objects: the schema they are in (the
 * source's is written as the target's), and on request the owner, the privileges, the
 * tablespace and the whitespace. An object's DDL becomes a text that is equal for two objects
 * that differ in nothing else.
 */
final readonly class DdlNormalizer
{
    public function __construct(
        private string $sourceSchema,
        private string $targetSchema,
        private bool $ignoreOwner = false,
        private bool $ignoreGrants = false,
        private bool $ignoreTablespace = false,
        private bool $ignoreWhitespace = false,
        private ?array $names = null,
    ) {
    }

    /** The target schema as a statement names it. */
    public function targetSchemaIdent(): string
    {
        return Quoting::ident($this->targetSchema);
    }

    /**
     * The source's DDL or name as it reads in the target schema: a reference to an object of the
     * source schema ("src".x, src.x, 'src.x'::regclass) becomes one to the target's, and a
     * routine's SET search_path names the target instead. String literals, comments' quotes and
     * dollar-quoted text (a routine's body) are left as they are: a body is opaque text, and
     * what it names cannot be told from what it merely says. With the names of the source's own
     * objects given, a reference to anything else in the source schema (an extension's member,
     * which the copy does not make) keeps naming the source.
     */
    public function retarget(string $text): string
    {
        if ($this->sourceSchema === $this->targetSchema) {
            return $text;
        }

        return (string) preg_replace_callback(self::TOKENS, function (array $m): string {
            if (($m['setpath'] ?? '') !== '') {
                return $this->retargetSearchPath($m['setpath']);
            }
            if (($m['lit'] ?? '') !== '') {
                if (($m['cast'] ?? '') === '') {
                    return $m[0];
                }
                // An object named by its text: nextval('src.seq'::regclass).
                $escaped = $m['lit'][0] === 'E' || $m['lit'][0] === 'e';
                $inner = substr($m['lit'], $escaped ? 2 : 1, -1);
                $inner = $escaped ? stripcslashes(str_replace("''", "'", $inner)) : str_replace("''", "'", $inner);

                return Quoting::literal($this->retarget($inner)) . $m['cast'];
            }
            if (($m['dollar'] ?? '') !== '') {
                return $m[0];
            }
            if (($m['comment'] ?? '') !== '') {
                // pgAdmin's header and the "Inherited from table src.p" notes.
                return $this->retargetPlain($m['comment']);
            }
            if (($m['chain'] ?? '') !== '') {
                return $this->retargetChain($m['chain']);
            }

            return $m[0];
        }, $text);
    }

    /**
     * The names of a schema's own objects (relations, types, routines, operators, collations,
     * text search objects), without the members of extensions: the objects a copy of the schema
     * makes, the only ones a reference may be retargeted to.
     *
     * @return list<string>
     */
    public static function objectNames(Connection $conn, string $schema): array
    {
        return array_map('strval', array_column($conn->rows(<<<'SQL'
            WITH ns AS (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = $1),
            members AS (SELECT classid, objid FROM pg_catalog.pg_depend WHERE deptype = 'e')
            SELECT relname AS name FROM pg_catalog.pg_class WHERE relnamespace = (SELECT oid FROM ns)
                AND (tableoid, oid) NOT IN (SELECT * FROM members)
            UNION SELECT typname FROM pg_catalog.pg_type WHERE typnamespace = (SELECT oid FROM ns)
                AND (tableoid, oid) NOT IN (SELECT * FROM members)
                AND (typelem = 0 OR ('pg_catalog.pg_type'::regclass, typelem) NOT IN (SELECT * FROM members))
            UNION SELECT proname FROM pg_catalog.pg_proc WHERE pronamespace = (SELECT oid FROM ns)
                AND (tableoid, oid) NOT IN (SELECT * FROM members)
            UNION SELECT oprname FROM pg_catalog.pg_operator WHERE oprnamespace = (SELECT oid FROM ns)
                AND (tableoid, oid) NOT IN (SELECT * FROM members)
            UNION SELECT collname FROM pg_catalog.pg_collation WHERE collnamespace = (SELECT oid FROM ns)
                AND (tableoid, oid) NOT IN (SELECT * FROM members)
            UNION SELECT cfgname FROM pg_catalog.pg_ts_config WHERE cfgnamespace = (SELECT oid FROM ns)
                AND (tableoid, oid) NOT IN (SELECT * FROM members)
            UNION SELECT dictname FROM pg_catalog.pg_ts_dict WHERE dictnamespace = (SELECT oid FROM ns)
                AND (tableoid, oid) NOT IN (SELECT * FROM members)
            UNION SELECT prsname FROM pg_catalog.pg_ts_parser WHERE prsnamespace = (SELECT oid FROM ns)
                AND (tableoid, oid) NOT IN (SELECT * FROM members)
            UNION SELECT tmplname FROM pg_catalog.pg_ts_template WHERE tmplnamespace = (SELECT oid FROM ns)
                AND (tableoid, oid) NOT IN (SELECT * FROM members)
            SQL, [$schema]), 'name'));
    }

    /**
     * What the text is made of, as far as retargeting cares: a SET search_path, a 'literal'
     * (with the reg* cast that makes it name an object), a $tag$ dollar-quoted text $tag$, a
     * -- comment, or a dotted chain of names (a.b, "a".b.c, OPERATOR(a.+)).
     */
    private const string TOKENS = <<<'RE'
        /(?<setpath>(?<![\w$])SET\s+search_path\s*(?:=|\bTO\b)[^\n;$']*)
        |(?<lit>(?<![\w$])[Ee]'(?:\\.|''|[^'\\])*'|'(?:''|[^'])*')(?<cast>::(?:pg_catalog\.)?reg[a-z]+\b)?
        |(?<dollar>(?<![\w$])\$(?<tag>(?:[A-Za-z_\x80-\xff][\w\x80-\xff]*)?)\$[\s\S]*?\$\k<tag>\$)
        |(?<comment>--[^\n]*)
        |(?<chain>(?<![\w$."])(?:"(?:""|[^"])*"|[A-Za-z_\x80-\xff][\w$\x80-\xff]*)(?:\.(?:"(?:""|[^"])*"|[A-Za-z_\x80-\xff][\w$\x80-\xff]*|[-+*\/<>=~!@\#%^&|`?]+))+)
        /x
        RE;

    /** A chain whose first name is the source schema's, and whose second one of its objects. */
    private function retargetChain(string $chain): string
    {
        if (preg_match('/^("(?:""|[^"])*"|[^."]+)\.("(?:""|[^"])*"|[^."]+)/', $chain, $m) !== 1) {
            return $chain;
        }
        $schema = $m[1][0] === '"' ? Quoting::unquoteIdent($m[1]) : $m[1];
        if ($schema !== $this->sourceSchema || ($m[1][0] !== '"' && strtolower($m[1]) !== $m[1])) {
            return $chain;
        }
        $object = $m[2][0] === '"' ? Quoting::unquoteIdent($m[2]) : $m[2];
        if ($this->names !== null && !in_array($object, $this->names, true)) {
            return $chain;
        }

        return Quoting::ident($this->targetSchema) . substr($chain, strlen($m[1]));
    }

    /** The source schema in a SET search_path list becomes the target. */
    private function retargetSearchPath(string $clause): string
    {
        if (preg_match('/^(SET\s+search_path\s*(?:=|TO)\s*)(.*?)(\s*)$/is', $clause, $m) !== 1) {
            return $clause;
        }
        $items = array_map(function (string $item): string {
            $name = trim($item);
            $bare = $name !== '' && $name[0] === '"' ? Quoting::unquoteIdent($name) : $name;

            return $bare === $this->sourceSchema ? Quoting::ident($this->targetSchema) : $name;
        }, explode(',', $m[2]));

        return $m[1] . implode(', ', $items) . $m[3];
    }

    /** A comment's text: "src".x and src.x become the target's, wherever they are. */
    private function retargetPlain(string $text): string
    {
        $from = Quoting::ident($this->sourceSchema);
        $to = Quoting::ident($this->targetSchema);
        $text = str_replace($from . '.', $to . '.', $text);
        if ($from === $this->sourceSchema) {
            $text = (string) preg_replace('/(?<![\w$".])' . preg_quote($this->sourceSchema, '/') . '\./', $to . '.', $text);
            $text = str_replace('"' . $this->sourceSchema . '".', $to . '.', $text);
        }

        return $text;
    }

    /** The DDL as compared: its statements, the ignored ones left out, one after the other. */
    public function normalize(string $ddl, bool $retarget): string
    {
        return implode("\n;\n", $this->statements($ddl, $retarget));
    }

    /**
     * The DDL's statements as compared, without its header and the ignored ones.
     *
     * @return list<string>
     */
    public function statements(string $ddl, bool $retarget): array
    {
        $text = $retarget ? $this->retarget($ddl) : $ddl;
        $kept = [];
        foreach (Splitter::split(self::withoutHeader($text)) as $statement) {
            $sql = trim($statement->sql);
            if ($sql === '' || $this->ignored($sql)) {
                continue;
            }
            if ($this->ignoreOwner) {
                // A schema's owner is in its CREATE.
                $sql = (string) preg_replace('/^(CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?\S+)\s+AUTHORIZATION\s+\S+/i', '$1', $sql);
            }
            if ($this->ignoreTablespace) {
                $sql = (string) preg_replace('/\s+TABLESPACE\s+("[^"]+"|\w+)/i', '', $sql);
            }
            $kept[] = $this->ignoreWhitespace ? (string) preg_replace('/\s+/', ' ', $sql) : $sql;
        }

        return $kept;
    }

    /**
     * The DDL without pgAdmin's header, the comment lines it starts with ("-- Table: …",
     * "-- DROP …"); comments further down, in a routine's body, are part of the object.
     */
    public static function withoutHeader(string $ddl): string
    {
        $lines = explode("\n", $ddl);
        while ($lines !== [] && (trim($lines[0]) === '' || str_starts_with(ltrim($lines[0]), '--'))) {
            array_shift($lines);
        }

        return trim(implode("\n", $lines));
    }

    /** The DROP statement the DDL's header holds, commented out: "-- DROP TABLE IF EXISTS app.t;". */
    public static function dropStatement(string $ddl): ?string
    {
        return preg_match('/^--\s*(DROP\s+.+?;)\s*$/mi', $ddl, $m) === 1 ? $m[1] : null;
    }

    private function ignored(string $sql): bool
    {
        if ($this->ignoreOwner && preg_match('/^ALTER\s.+\sOWNER\s+TO\s/is', $sql) === 1) {
            return true;
        }
        if ($this->ignoreGrants && preg_match('/^(GRANT|REVOKE)\s/i', $sql) === 1) {
            return true;
        }

        return $this->ignoreTablespace && preg_match('/^ALTER\s.+\sSET\s+TABLESPACE\s/is', $sql) === 1;
    }
}
