<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Database;

use InvalidArgumentException;
use PhpPgAdmin\Core\Facades\Config;

/**
 * A PostgreSQL server to sign in to: where it listens and how to reach it. The one in
 * config/db.php is the default; the ones a login succeeded against are saved in the
 * application storage and offered again on the login page.
 *
 * A saved server can carry pgAdmin's connection options. Those of the server, for everyone who
 * signs in to it: the pg_service.conf service, the application name, and the client
 * certificate, its key, the root certificate and the revocation list, each the name of a file
 * in the directory db.ssl_directory names (never a path the client chose). Those of a role,
 * kept under its username and used only when that role signs in: the role to SET ROLE to
 * (sent as the startup option "-c role=…") and the post-connection SQL run on each new
 * connection. The options never leave the server through toArray(), which the login page
 * lists the saved servers with.
 */
final readonly class Server
{
    public const array SSL_MODES = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'];

    /** The options of the server, as libpq names them. */
    public const array SERVER_OPTIONS = ['service', 'application_name', 'sslcert', 'sslkey', 'sslrootcert', 'sslcrl'];

    /** The options of one role on the server. */
    public const array ROLE_OPTIONS = ['role', 'post_connection_sql'];

    /** The options naming a file of the SSL directory. */
    public const array SSL_FILES = ['sslcert', 'sslkey', 'sslrootcert', 'sslcrl'];

    /** The libpq environment variable of each server option, for client programs. */
    private const array ENVIRONMENT = ['service' => 'PGSERVICE', 'application_name' => 'PGAPPNAME', 'sslcert' => 'PGSSLCERT', 'sslkey' => 'PGSSLKEY', 'sslrootcert' => 'PGSSLROOTCERT', 'sslcrl' => 'PGSSLCRL'];

    public function __construct(
        public string $host,
        public int $port,
        public string $sslmode = 'prefer',
        /** The database a login connects to first; null tries postgres, template1 and the role's own. */
        public ?string $maintenanceDb = null,
        /** Null until the server has been saved. */
        public ?int $id = null,
        public ?string $name = null,
        /**
         * The connection options: the server's by libpq name, and the roles' under "roles",
         * username → {role, post_connection_sql}.
         *
         * @var array<string, mixed>
         */
        public array $options = [],
    ) {
        if ($host === '') {
            throw new InvalidArgumentException('A server needs a host.');
        }
        if ($port < 1 || $port > 65535) {
            throw new InvalidArgumentException('A server port is between 1 and 65535.');
        }
        if (!in_array($sslmode, self::SSL_MODES, true)) {
            throw new InvalidArgumentException(sprintf('Unknown SSL mode "%s".', $sslmode));
        }
    }

    public static function fromConfig(): self
    {
        return new self(
            (string) Config::get('db.host', 'localhost'),
            (int) Config::get('db.port', 5432),
            (string) Config::get('db.sslmode', 'prefer'),
            self::nullable(Config::get('db.database')),
        );
    }

    /**
     * From the login form or a stored row. Throws InvalidArgumentException for values that
     * make no server. The connection options are read only with $withOptions, from storage or
     * the session: never from what a client sent.
     *
     * @param array<string, mixed> $data
     */
    public static function fromArray(array $data, bool $withOptions = false): self
    {
        $port = $data['port'] ?? 5432;
        if (!is_numeric($port)) {
            throw new InvalidArgumentException('A server port is a number.');
        }

        $id = $data['id'] ?? null;

        return new self(
            trim((string) ($data['host'] ?? '')),
            (int) $port,
            self::nullable($data['sslmode'] ?? null) ?? 'prefer',
            self::nullable($data['maintenance_db'] ?? null),
            is_numeric($id) ? (int) $id : null,
            self::nullable($data['name'] ?? null),
            $withOptions ? self::decodeOptions($data['options'] ?? null) : [],
        );
    }

    public function withId(int $id, ?string $name): self
    {
        return new self($this->host, $this->port, $this->sslmode, $this->maintenanceDb, $id, $name, $this->options);
    }

    /** @param array<string, mixed> $options */
    public function withOptions(array $options): self
    {
        return new self($this->host, $this->port, $this->sslmode, $this->maintenanceDb, $this->id, $this->name, $options);
    }

    /**
     * The options that apply when the given role signs in: the server's and the role's own.
     *
     * @return array<string, string>
     */
    public function optionsFor(string $username): array
    {
        $own = is_array($this->options['roles'][$username] ?? null) ? $this->options['roles'][$username] : [];
        $options = [];
        foreach (self::SERVER_OPTIONS as $key) {
            if (is_string($this->options[$key] ?? null) && $this->options[$key] !== '') {
                $options[$key] = $this->options[$key];
            }
        }
        foreach (self::ROLE_OPTIONS as $key) {
            if (is_string($own[$key] ?? null) && $own[$key] !== '') {
                $options[$key] = $own[$key];
            }
        }

        return $options;
    }

    /**
     * The libpq connection parameters the options make for a role: the service, the
     * application name, the SSL files as paths of the SSL directory, and the role as a startup
     * option.
     *
     * @return array<string, string>
     */
    public function libpqParameters(string $username): array
    {
        $options = $this->optionsFor($username);
        $params = [];
        foreach (['service', 'application_name'] as $key) {
            if (isset($options[$key])) {
                $params[$key] = $options[$key];
            }
        }
        if (!$this->isSocket()) {
            foreach (self::SSL_FILES as $key) {
                if (isset($options[$key]) && ($path = self::sslPath($options[$key])) !== null) {
                    $params[$key] = $path;
                }
            }
        }
        if (isset($options['role'])) {
            $params['options'] = self::startupOption('role', $options['role']);
        }

        return $params;
    }

    /**
     * The same for a client program (pg_dump, psql): the libpq environment variables.
     *
     * @return array<string, string>
     */
    public function libpqEnvironment(string $username): array
    {
        $env = [];
        foreach ($this->libpqParameters($username) as $key => $value) {
            if ($key === 'options') {
                $env['PGOPTIONS'] = $value;
            } elseif (isset(self::ENVIRONMENT[$key])) {
                $env[self::ENVIRONMENT[$key]] = $value;
            }
        }

        return $env;
    }

    /** The role's post-connection SQL, null when it has none. */
    public function postConnectionSql(string $username): ?string
    {
        $sql = $this->optionsFor($username)['post_connection_sql'] ?? null;

        return $sql === null || trim($sql) === '' ? null : $sql;
    }

    /** "-c name=value", the value's spaces and backslashes escaped as libpq's options want them. */
    public static function startupOption(string $name, string $value): string
    {
        return '-c ' . $name . '=' . addcslashes($value, " \\\t");
    }

    /** The directory the SSL file options are names in, or null when none is configured. */
    public static function sslDirectory(): ?string
    {
        $dir = Config::get('db.ssl_directory');
        if (!is_string($dir) || $dir === '') {
            return null;
        }
        $real = realpath($dir);

        return $real !== false && is_dir($real) ? $real : null;
    }

    /**
     * The files of the SSL directory, by name; null when there is none.
     *
     * @return list<string>|null
     */
    public static function sslFiles(): ?array
    {
        $dir = self::sslDirectory();
        if ($dir === null) {
            return null;
        }
        $files = [];
        foreach (scandir($dir) ?: [] as $name) {
            if (self::sslPath($name) !== null) {
                $files[] = $name;
            }
        }

        return $files;
    }

    /** The path of a file of the SSL directory, or null when the name is not one of its files. */
    public static function sslPath(string $name): ?string
    {
        $dir = self::sslDirectory();
        if ($dir === null || preg_match('/^[A-Za-z0-9_][A-Za-z0-9._-]*$/', $name) !== 1) {
            return null;
        }
        $path = realpath($dir . DIRECTORY_SEPARATOR . $name);

        return $path !== false && is_file($path) && dirname($path) === $dir ? $path : null;
    }

    /** @return array<string, mixed> */
    private static function decodeOptions(mixed $options): array
    {
        if (is_array($options)) {
            return $options;
        }
        $decoded = is_string($options) && $options !== '' ? json_decode($options, true) : null;

        return is_array($decoded) ? $decoded : [];
    }

    /** "host:port", the key the preferences of a role on this server are stored under. */
    public function key(): string
    {
        return sprintf('%s:%d', $this->host, $this->port);
    }

    /** True when libpq would connect over a UNIX socket: the host is a directory. */
    public function isSocket(): bool
    {
        return str_starts_with($this->host, '/');
    }

    /**
     * The server with its connection options, for the PHP session; toArray() leaves them out.
     *
     * @return array<string, mixed>
     */
    public function toSessionArray(): array
    {
        return [...$this->toArray(), 'options' => $this->options];
    }

    /** @return array{id: int|null, name: string|null, host: string, port: int, sslmode: string, maintenance_db: string|null} */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'host' => $this->host,
            'port' => $this->port,
            'sslmode' => $this->sslmode,
            'maintenance_db' => $this->maintenanceDb,
        ];
    }

    private static function nullable(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }
}
