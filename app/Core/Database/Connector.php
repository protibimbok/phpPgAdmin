<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Database;

use PDO;
use PDOException;
use PhpPgAdmin\Core\Facades\Config;

/**
 * Opens connections to the configured PostgreSQL server (config/db.php) for a given role.
 */
final class Connector
{
    /**
     * Where a login connects when no database is asked for, in order: pgAdmin's default
     * maintenance database, the template every cluster has, and the role's own database,
     * which libpq itself would fall back to.
     */
    private const array MAINTENANCE_DATABASES = ['postgres', 'template1'];

    public function __construct(
        public readonly string $host,
        public readonly int $port,
        private readonly int $timeout = 10,
    ) {
    }

    public static function fromConfig(): self
    {
        return new self(
            (string) Config::get('db.host', 'localhost'),
            (int) Config::get('db.port', 5432),
            (int) Config::get('db.timeout', 10),
        );
    }

    /**
     * Connect as the role to the first database that lets it in, and return the credentials
     * completed with that database's name, for the session to reuse.
     *
     * @return array{0: PDO, 1: Credentials}
     * @throws ConnectionException when the server cannot be reached, rejects the role, or no database lets it in
     */
    public function login(string $username, #[\SensitiveParameter] string $password): array
    {
        $candidates = array_values(array_unique([...self::MAINTENANCE_DATABASES, $username]));
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
    public function connect(Credentials $credentials, ?string $database = null): PDO
    {
        return $this->open($credentials->username, $credentials->password, $database ?? $credentials->database);
    }

    /** @throws ConnectionException */
    private function open(string $username, #[\SensitiveParameter] string $password, string $database): PDO
    {
        try {
            return new PDO($this->dsn($database), $username, $password, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_TIMEOUT => $this->timeout,
            ]);
        } catch (PDOException $e) {
            throw ConnectionException::fromPdo($e);
        }
    }

    private function dsn(string $database): string
    {
        return sprintf(
            "pgsql:host=%s;port=%d;dbname=%s;application_name='phpPgAdmin'",
            self::quote($this->host),
            $this->port,
            self::quote($database),
        );
    }

    /** libpq keyword syntax: a value with spaces or quotes is single-quoted, with \ and ' escaped. */
    private static function quote(string $value): string
    {
        if ($value !== '' && preg_match('/[\s\'\\\\]/', $value) !== 1) {
            return $value;
        }

        return "'" . addcslashes($value, "\\'") . "'";
    }
}
