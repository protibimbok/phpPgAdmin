<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Dump;

use League\Route\Http\Exception\BadRequestException;

/**
 * The pg_dump or pg_dumpall command line for an export, after pgAdmin's backup argument
 * builder: pg_dumpall for the server, pg_dump for a database, a schema or a relation. The
 * connection is not on it; the process gets it as libpq's environment.
 *
 * phpMyAdmin's export page picks, per table, whether its structure and its data go in. pg_dump
 * dumps one set of objects with or without their data, and leaves the data of others out with
 * --exclude-table-data, so the choices map onto that: a dump of structure only (-s), of data
 * only (-a), or of both with the rows of what was unticked under "Data" excluded. Data without
 * structure next to objects with both is the one combination pg_dump cannot write.
 */
final class DumpCommand
{
    /** pg_dumpall takes these options; the others are pg_dump's. */
    private const array DUMPALL_FLAGS = [
        'owner', 'privileges', 'comments', 'tablespaces', 'publications', 'subscriptions', 'security_labels', 'policies', 'unlogged_data', 'role_passwords',
        'clean', 'if_exists', 'statistics', 'set_session_authorization', 'quote_all_identifiers', 'disable_dollar_quoting', 'disable_triggers', 'load_via_partition_root', 'on_conflict_do_nothing',
    ];

    /** pg_dump ignores these for an archive: pg_restore applies them when the archive is restored. */
    private const array PLAIN_ONLY_FLAGS = ['owner', 'create', 'clean', 'if_exists', 'set_session_authorization'];

    /** The tools' version each option needs, where it is newer than PostgreSQL 13's. */
    private const array SINCE = ['policies' => 180000, 'statistics' => 180000];

    /** Relation kinds with rows of their own for --exclude-table-data to leave out. */
    private const array WITH_DATA = ['r', 'p', 'm', 'S'];

    /**
     * @param ExportRequest $request
     * @param array<string, string> $objects what the scope offers: the server's databases, the database's schemas, or the schema's relations, each name with its kind (relkind for relations, '' otherwise)
     * @param list<array{0: string, 1: string, 2: string}> $oversized [schema, relation, relkind] of the tables over the request's size limit
     */
    public function __construct(
        private readonly ExportRequest $request,
        private readonly ClientTools $tools,
        private readonly array $objects,
        private readonly array $oversized = [],
        private readonly string $tableKind = 'r',
    ) {
    }

    public function program(): string
    {
        return $this->tools->path($this->request->scope === 'server' ? 'pg_dumpall' : 'pg_dump');
    }

    /** @return list<string> */
    public function arguments(): array
    {
        $r = $this->request;
        $args = ['--no-password'];
        if ($r->scope !== 'server') {
            $args[] = '--format=' . $r->format;
            if ($r->format === 'custom') {
                $args[] = '--compress=' . ($r->compression === 'none' ? '0' : 'gzip');
            }
        }
        if ($r->encoding !== null) {
            $args[] = '--encoding=' . $r->encoding;
        }

        [$contents, $selection, $excluded] = match ($r->scope) {
            'server' => $this->serverSelection(),
            'database' => $this->databaseSelection(),
            'schema' => $this->schemaSelection(),
            'table' => $this->tableSelection(),
        };
        if ($contents === 'structure') {
            $args[] = '--schema-only';
        } elseif ($contents === 'data') {
            $args[] = '--data-only';
        }
        if ($r->scope === 'server' && $r->globals !== 'all') {
            $args[] = '--' . $r->globals . '-only';
        }

        foreach (ExportRequest::INCLUDE_FLAGS as $name => $flag) {
            if (!$r->flag($name) && $this->applies($name, $contents)) {
                $args[] = $flag;
            }
        }
        foreach (ExportRequest::ADD_FLAGS as $name => $flag) {
            if ($r->flag($name) && $this->applies($name, $contents)) {
                $args[] = $flag;
            }
        }

        if ($contents !== 'structure' && $r->dataStyle === 'insert') {
            if ($r->insertSyntax === 'columns' || $r->insertSyntax === 'both') {
                $args[] = '--column-inserts';
            }
            if ($r->insertSyntax === 'multi' || $r->insertSyntax === 'both') {
                $args[] = '--rows-per-insert=' . $r->rowsPerInsert;
            }
            if ($r->insertSyntax === 'neither') {
                $args[] = '--inserts';
            }
        }

        if ($r->scope !== 'server' && $contents !== 'structure') {
            // pg_dump includes large objects in a whole-database dump and leaves them out of one
            // narrowed by -n or -t; either way the request decides.
            if (!$r->largeObjects) {
                $args[] = $this->tools->version >= 160000 ? '--no-large-objects' : '--no-blobs';
            } elseif ($selection !== []) {
                $args[] = $this->tools->version >= 160000 ? '--large-objects' : '--blobs';
            }
        }

        foreach ($excluded as $pattern) {
            $args[] = $pattern;
        }
        if ($contents !== 'structure') {
            foreach ($this->oversized as [$schema, $name, $kind]) {
                $args[] = $this->excludeData(self::qualified($schema, $name), $kind);
            }
        }
        foreach ($selection as $pattern) {
            $args[] = $pattern;
        }
        if ($r->scope === 'server') {
            $args[] = '--database=' . ($r->database ?? 'postgres');
        }

        return array_values(array_unique($args));
    }

    /** Patterns pg_dump reads as the exact name: within double quotes nothing is special. */
    public static function quote(string $name): string
    {
        return '"' . str_replace('"', '""', $name) . '"';
    }

    public static function qualified(string $schema, string $name): string
    {
        return self::quote($schema) . '.' . self::quote($name);
    }

    private function applies(string $name, string $contents): bool
    {
        $r = $this->request;
        if (isset(self::SINCE[$name]) && $this->tools->version < self::SINCE[$name]) {
            return false;
        }
        if ($r->scope === 'server') {
            if (!in_array($name, self::DUMPALL_FLAGS, true)) {
                return false;
            }
        } elseif ($name === 'role_passwords') {
            return false;
        }
        if ($r->isArchive() && in_array($name, self::PLAIN_ONLY_FLAGS, true)) {
            return false;
        }

        return match ($name) {
            'create' => $r->scope === 'database' && $contents !== 'data',
            'if_exists' => $r->flag('clean') && $contents !== 'data',
            'statistics' => $contents === 'both',
            'disable_triggers' => $contents === 'data',
            'on_conflict_do_nothing' => $contents !== 'structure' && $r->dataStyle === 'insert',
            'serializable_deferrable', 'load_via_partition_root', 'unlogged_data' => $contents !== 'structure',
            default => true,
        };
    }

    /**
     * pg_dumpall dumps every database it can connect to; the ones not picked are excluded.
     *
     * @return array{0: string, 1: list<string>, 2: list<string>}
     */
    private function serverSelection(): array
    {
        $r = $this->request;
        $excluded = [];
        if ($r->databases !== null) {
            $this->known($r->databases, 'database');
            if ($r->databases === [] && $r->globals === 'all') {
                throw new BadRequestException('Select at least one database.');
            }
            foreach (array_keys($this->objects) as $database) {
                if (!in_array((string) $database, $r->databases, true)) {
                    $excluded[] = '--exclude-database=' . self::quote((string) $database);
                }
            }
        }

        return [$r->contents, [], $excluded];
    }

    /** @return array{0: string, 1: list<string>, 2: list<string>} */
    private function databaseSelection(): array
    {
        [$contents, $structure, $data] = $this->split();
        $all = array_map('strval', array_keys($this->objects));
        $chosen = array_values(array_unique([...$structure, ...$data]));
        sort($chosen);
        $everything = $all;
        sort($everything);

        // Every schema chosen dumps the database as a whole, with its extensions, publications,
        // event triggers and the rest; otherwise only the schemas chosen.
        $selection = $chosen === $everything ? [] : array_map(static fn (string $s): string => '--schema=' . self::quote($s), $chosen);
        $excluded = [];
        if ($contents === 'both') {
            foreach (array_diff($structure, $data) as $schema) {
                $excluded[] = '--exclude-table-data=' . self::quote($schema) . '.*';
            }
        }

        return [$contents, $selection, $excluded];
    }

    /** @return array{0: string, 1: list<string>, 2: list<string>} */
    private function schemaSelection(): array
    {
        $schema = (string) $this->request->schema;
        [$contents, $structure, $data] = $this->split();
        $chosen = array_values(array_unique([...$structure, ...$data]));
        $whole = count($chosen) === count($this->objects);

        // The whole schema takes its functions, types and the rest along; a choice of relations
        // is those relations only, as with pg_dump -t.
        $selection = $whole
            ? ['--schema=' . self::quote($schema)]
            : array_map(fn (string $name): string => $this->table(self::qualified($schema, $name), $this->objects[$name]), $chosen);
        $excluded = [];
        if ($contents === 'both') {
            foreach (array_diff($structure, $data) as $name) {
                if (in_array($this->objects[$name], self::WITH_DATA, true)) {
                    $excluded[] = $this->excludeData(self::qualified($schema, $name), $this->objects[$name]);
                }
            }
        }

        return [$contents, $selection, $excluded];
    }

    /** @return array{0: string, 1: list<string>, 2: list<string>} */
    private function tableSelection(): array
    {
        $r = $this->request;

        return [$r->contents, [$this->table(self::qualified((string) $r->schema, (string) $r->table), $this->tableKind)], []];
    }

    /**
     * The request's structure and data lists, checked against the scope, and what they add up
     * to: structure only, data only, or both.
     *
     * @return array{0: string, 1: list<string>, 2: list<string>}
     */
    private function split(): array
    {
        $r = $this->request;
        $all = array_map('strval', array_keys($this->objects));
        $structure = $r->structure ?? ($r->contents === 'data' ? [] : $all);
        $data = $r->data ?? ($r->contents === 'structure' ? [] : $all);
        $what = $r->scope === 'database' ? 'schema' : 'relation';
        $this->known($structure, $what);
        $this->known($data, $what);
        if ($r->scope === 'schema') {
            // A view has no rows of its own: ticking its data alone selects its definition.
            $data = array_values(array_filter($data, fn (string $name): bool => in_array($this->objects[$name], self::WITH_DATA, true) || in_array($name, $structure, true)));
        }

        if ($structure === [] && $data === []) {
            throw new BadRequestException(sprintf('Select at least one %s to export.', $what));
        }
        if ($data === []) {
            return ['structure', $structure, []];
        }
        if ($structure === []) {
            return ['data', [], $data];
        }
        $orphans = array_diff($data, $structure);
        if ($orphans !== []) {
            throw new BadRequestException(sprintf(
                'pg_dump cannot export the data of %s without its structure in a dump that has structure; export it separately with only "Data" ticked.',
                implode(', ', array_map(self::quote(...), $orphans)),
            ));
        }

        return ['both', $structure, $data];
    }

    /** @param list<string> $names */
    private function known(array $names, string $what): void
    {
        foreach ($names as $name) {
            if (!array_key_exists($name, $this->objects)) {
                throw new BadRequestException(sprintf('There is no %s "%s" to export.', $what, $name));
            }
        }
    }

    /** -t for a relation; a partitioned table takes its partitions along where pg_dump can. */
    private function table(string $pattern, string $kind): string
    {
        return ($kind === 'p' && $this->tools->version >= 160000 ? '--table-and-children=' : '--table=') . $pattern;
    }

    private function excludeData(string $pattern, string $kind): string
    {
        return ($kind === 'p' && $this->tools->version >= 160000 ? '--exclude-table-data-and-children=' : '--exclude-table-data=') . $pattern;
    }
}
