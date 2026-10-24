<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Database;

use PhpPgAdmin\Core\Facades\Config;

/**
 * Opens connections to a PostgreSQL server for a given role, through libpq (ext-pgsql).
 */
final class Connector
{
    /**
     * Where a login connects when no database is asked for, in order: pgAdmin's default
     * maintenance database, the template every cluster has, and the role's own database,
     * which libpq itself would fall back to.
     */
    private const array MAINTENANCE_DATABASES = ['postgres', 'template1'];

    public readonly string $host;

    public readonly int $port;

    public function __construct(
        public readonly Server $server,
        private readonly int $timeout = 10,
    ) {
        $this->host = $server->host;
        $this->port = $server->port;
    }

    /** For the server in config/db.php. */
    public static function fromConfig(): self
    {
        return self::for(Server::fromConfig());
    }

    public static function for(Server $server): self
    {
        return new self($server, (int) Config::get('db.timeout', 10));
    }

    /**
     * Connect as the role to the first database that lets it in, and return the credentials
     * completed with that database's name, for the session to reuse.
     *
     * @return array{0: Connection, 1: Credentials}
     * @throws ConnectionException when the server cannot be reached, rejects the role, or no database lets it in
     */
    public function login(string $username, #[\SensitiveParameter] string $password): array
    {
        $candidates = array_values(array_unique(array_filter([$this->server->maintenanceDb, ...self::MAINTENANCE_DATABASES, $username])));
        $last = null;

        foreach ($candidates as $database) {
            try {
                return [$this->open($username, $password, $database), new Credentials($username, $password, $database)];
            } catch (ConnectionException $e) {
                if (!$e->databaseUnavailable()) {
                    throw $e;
                }
                $last = $e;
            }
        }

        throw $last ?? new \LogicException('No maintenance database to try.');
    }

    /**
     * A connection for a signed-in session, to its default database or the one given.
     *
     * @throws ConnectionException
     */
    public function connect(Credentials $credentials, ?string $database = null): Connection
    {
        return $this->open($credentials->username, $credentials->password, $database ?? $credentials->database);
    }

    /** @throws ConnectionException */
    private function open(string $username, #[\SensitiveParameter] string $password, string $database): Connection
    {
        $conninfo = $this->conninfo($username, $password, $database);
        $warning = null;

        // pg_connect reports a failure as a warning holding libpq's message; collect it instead of
        // logging it. With html_errors on (the default in web SAPIs) PHP would hand the handler an
        // HTML-escaped message, so it is turned off for the call.
        $htmlErrors = ini_set('html_errors', '0');
        set_error_handler(static function (int $severity, string $message) use (&$warning): bool {
            $warning = $message;

            return true;
        });

        try {
            $pg = pg_connect($conninfo, PGSQL_CONNECT_FORCE_NEW);
        } finally {
            restore_error_handler();
            if ($htmlErrors !== false) {
                ini_set('html_errors', $htmlErrors);
            }
        }

        if ($pg === false) {
            throw ConnectionException::fromLibpq($warning ?? 'could not connect to server');
        }

        return new Connection($pg, $database);
    }

    private function conninfo(string $username, #[\SensitiveParameter] string $password, string $database): string
    {
        $params = [
            'host' => $this->host,
            'port' => (string) $this->port,
            'dbname' => $database,
            'user' => $username,
            'password' => $password,
            'connect_timeout' => (string) $this->timeout,
            'application_name' => 'phpPgAdmin',
        ];

        // A UNIX socket directory takes no SSL; libpq would refuse "require" on it.
        if (!$this->server->isSocket()) {
            $params['sslmode'] = $this->server->sslmode;
        }

        return implode(' ', array_map(
            static fn (string $key, string $value): string => $key . '=' . self::quote($value),
            array_keys($params),
            $params,
        ));
    }

    /** libpq keyword syntax: a value with spaces or quotes is single-quoted, with \ and ' escaped; an empty value is ''. */
    private static function quote(string $value): string
    {
        if ($value !== '' && preg_match('/[\s\'\\\\]/', $value) !== 1) {
            return $value;
        }

        return "'" . addcslashes($value, "\\'") . "'";
    }
}
