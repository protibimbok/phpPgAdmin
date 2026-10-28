<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Dump;

use PhpPgAdmin\Core\Facades\Config;

/**
 * Where pg_dump and pg_dumpall are, and their version: the directory config/tools.php names,
 * or else the newest of the ones on the PATH and in the packages' own directories, as
 * pgAdmin's binary paths do for each server version.
 */
final readonly class ClientTools
{
    private function __construct(
        public string $directory,
        /** The programs' version number, 180006 for 18.6. */
        public int $version,
    ) {
    }

    /** The tools to use, or null when no directory holds a pg_dump that runs. */
    public static function locate(): ?self
    {
        $configured = Config::get('tools.bin_dir');
        $candidates = is_string($configured) && $configured !== '' ? [$configured] : self::candidates();
        $best = null;
        foreach ($candidates as $directory) {
            $version = self::versionIn($directory);
            if ($version !== null && ($best === null || $version > $best->version)) {
                $best = new self(rtrim($directory, '/'), $version);
            }
        }

        return $best;
    }

    public function path(string $program): string
    {
        return $this->directory . '/' . $program;
    }

    /** "18.6" */
    public function versionString(): string
    {
        return sprintf('%d.%d', intdiv($this->version, 10000), $this->version % 10000);
    }

    public function major(): int
    {
        return intdiv($this->version, 10000);
    }

    /** @return list<string> */
    private static function candidates(): array
    {
        $directories = array_filter(explode(PATH_SEPARATOR, (string) getenv('PATH')));
        foreach (['/usr/lib/postgresql/*/bin', '/usr/pgsql-*/bin', '/opt/homebrew/opt/postgresql@*/bin', '/usr/local/opt/postgresql@*/bin', '/usr/local/pgsql/bin', '/usr/bin', '/usr/local/bin'] as $pattern) {
            array_push($directories, ...(glob($pattern, GLOB_ONLYDIR) ?: []));
        }

        return array_values(array_unique($directories));
    }

    private static function versionIn(string $directory): ?int
    {
        $program = rtrim($directory, '/') . '/pg_dump';
        if (!is_file($program) || !is_executable($program)) {
            return null;
        }
        $output = [];
        exec(escapeshellarg($program) . ' --version 2>/dev/null', $output, $status);
        // "pg_dump (PostgreSQL) 18.6", "pg_dump (PostgreSQL) 16.4 (Debian 16.4-1)", "17beta1"
        if ($status !== 0 || preg_match('/\)\s+(\d+)(?:\.(\d+))?/', implode("\n", $output), $m) !== 1) {
            return null;
        }

        return (int) $m[1] * 10000 + (int) ($m[2] ?? 0);
    }
}
