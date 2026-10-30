<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\SchemaDiff\Diff;

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
    ) {
    }

    /** The target schema as a statement names it. */
    public function targetSchemaIdent(): string
    {
        return Quoting::ident($this->targetSchema);
    }

    /** The source's DDL or name as it reads in the target schema: "src".x and src.x become the target's. */
    public function retarget(string $text): string
    {
        if ($this->sourceSchema === $this->targetSchema) {
            return $text;
        }
        $from = Quoting::ident($this->sourceSchema);
        $to = Quoting::ident($this->targetSchema);
        $text = str_replace($from . '.', $to . '.', $text);
        if ($from === $this->sourceSchema) {
            // An unquoted name also stands quoted ("app".t) in what pg_get_*def writes.
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
