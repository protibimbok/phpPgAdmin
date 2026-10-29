<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Import\Restore;

use PhpPgAdmin\Modules\Export\Dump\ClientTools;

/**
 * The command line of an import, after pgAdmin's restore tool: psql runs an SQL file, and
 * pg_restore restores a custom or tar archive. The connection comes from libpq's environment,
 * which the caller supplies; what this adds to it is the file's character set
 * (PGCLIENTENCODING), the search path of a schema's import, and foreign key checks switched off
 * as session_replication_role = replica, the PostgreSQL counterpart of phpMyAdmin's
 * FOREIGN_KEY_CHECKS = 0 (it takes a superuser).
 *
 * psql runs in restricted mode, with a key the file cannot know: a meta-command in the file
 * (\! runs a shell on the web server, \o and \w write its files) is refused.
 */
final readonly class RestoreCommand
{
    public function __construct(
        private ImportRequest $request,
        private ClientTools $tools,
        private FileFormat $file,
        /** The database pg_restore connects to; an archive imported on the server creates its own from there. */
        private string $database,
    ) {
    }

    /** psql's \restrict, in 18 and in the minor releases of August 2025. */
    public static function restricts(ClientTools $tools): bool
    {
        $minimum = [13 => 22, 14 => 19, 15 => 14, 16 => 10, 17 => 6];
        $major = $tools->major();

        return $major >= 18 || (isset($minimum[$major]) && $tools->version % 10000 >= $minimum[$major]);
    }

    public function program(): string
    {
        return $this->tools->path($this->file->isArchive() ? 'pg_restore' : 'psql');
    }

    /** pg_restore reads the archive from the file itself when it runs parallel jobs; otherwise it comes on stdin. */
    public function readsFile(): bool
    {
        return $this->file->isArchive() && $this->request->jobs > 1;
    }

    /** @return list<string> */
    public function arguments(string $file): array
    {
        return $this->file->isArchive() ? $this->restoreArguments($file) : $this->sqlArguments();
    }

    /** @return array<string, string> */
    public function environment(): array
    {
        $r = $this->request;
        $options = [];
        if ($r->scope === 'schema' && !$this->file->isArchive()) {
            $options[] = '-c search_path=' . self::optionValue('"' . str_replace('"', '""', (string) $r->schema) . '"');
        }
        if (!$r->foreignKeyChecks) {
            $options[] = '-c session_replication_role=replica';
        }
        $environment = $options === [] ? [] : ['PGOPTIONS' => implode(' ', $options)];
        if ($r->charset !== null && !$this->file->isArchive()) {
            $environment['PGCLIENTENCODING'] = $r->charset;
        }

        return $environment;
    }

    /** @return list<string> */
    private function sqlArguments(): array
    {
        $args = ['--no-psqlrc', '--no-password'];
        if ($this->request->stopOnError) {
            $args[] = '--set=ON_ERROR_STOP=1';
        }
        if ($this->request->sqlSingleTransaction) {
            $args[] = '--single-transaction';
        }
        $args[] = '--command=\\restrict ' . bin2hex(random_bytes(16));
        $args[] = '--file=-';

        return $args;
    }

    /** @return list<string> */
    private function restoreArguments(string $file): array
    {
        $r = $this->request;
        $args = ['--no-password', '--dbname=' . self::conninfo($this->database)];
        if ($r->scope === 'server') {
            // The archive names its database: CREATE DATABASE from the maintenance database.
            $args[] = '--create';
        }
        if ($r->scope === 'schema') {
            $args[] = '--schema=' . $r->schema;
        }
        if ($r->contents === 'structure') {
            $args[] = '--schema-only';
        } elseif ($r->contents === 'data') {
            $args[] = '--data-only';
        }
        foreach (ImportRequest::INCLUDE_FLAGS as $name => $flag) {
            if (!$r->flag($name) && $this->applies($name)) {
                $args[] = $flag;
            }
        }
        foreach (ImportRequest::ADD_FLAGS as $name => $flag) {
            if ($r->flag($name) && $this->applies($name)) {
                $args[] = $flag;
            }
        }
        if ($r->jobs > 1) {
            $args[] = '--jobs=' . $r->jobs;
            $args[] = $file;
        }

        return $args;
    }

    /** Whether an option means anything for what is restored, and the tools have it. */
    private function applies(string $name): bool
    {
        $r = $this->request;
        $version = $this->tools->version;

        return match ($name) {
            // What leaves out definitions has nothing to leave out of data.
            'owner', 'privileges', 'tablespaces', 'comments', 'publications', 'subscriptions', 'security_labels' => $r->contents !== 'data',
            'policies' => $r->contents !== 'data' && $version >= 180000,
            'table_access_method' => $r->contents !== 'data' && $version >= 150000,
            'clean' => $r->contents !== 'data',
            'if_exists' => $r->contents !== 'data' && $r->flag('clean'),
            'disable_triggers' => $r->contents === 'data',
            'no_data_for_failed_tables' => $r->contents === 'both',
            'statistics' => $version >= 180000,
            'single_transaction' => $r->jobs === 1,
            default => true,
        };
    }

    /** A database name as a connection string, so that a name holding "=" is not read as one. */
    private static function conninfo(string $database): string
    {
        return "dbname='" . addcslashes($database, "'\\") . "'";
    }

    /** A value in PGOPTIONS, where a space separates options unless a backslash escapes it. */
    private static function optionValue(string $value): string
    {
        return addcslashes($value, " \\");
    }
}
