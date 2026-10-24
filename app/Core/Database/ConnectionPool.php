<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Database;

use LogicException;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The connections of one request to the server the session is signed in to, one per database,
 * opened on first use and closed when the request ends. The Authenticate middleware attaches it
 * to the request; controllers take connections from it and never see the credentials.
 */
final class ConnectionPool
{
    public const string ATTRIBUTE = 'connections';

    /** @var array<string, Connection> keyed by database name */
    private array $connections = [];

    public function __construct(
        private readonly Connector $connector,
        private readonly Credentials $credentials,
    ) {
    }

    /** The pool the Authenticate middleware attached to the request. */
    public static function from(ServerRequestInterface $request): self
    {
        $pool = $request->getAttribute(self::ATTRIBUTE);

        return $pool instanceof self ? $pool : throw new LogicException('No connection pool on the request: the Authenticate middleware must run first.');
    }

    public function connector(): Connector
    {
        return $this->connector;
    }

    /** The role the session is signed in as. */
    public function username(): string
    {
        return $this->credentials->username;
    }

    /**
     * A connection to the given database, or to the session's maintenance database when none
     * is named. The same connection is handed out for the same database within the request.
     *
     * @throws ConnectionException
     */
    public function for(?string $database = null): Connection
    {
        $database ??= $this->credentials->database;

        return $this->connections[$database] ??= $this->connector->connect($this->credentials, $database);
    }

    /** The connection to the database the login landed in, for server-wide catalog queries. */
    public function maintenance(): Connection
    {
        return $this->for();
    }

    /** The server's version number, 150004 for 15.4; it is the same whichever database is open. */
    public function version(): int
    {
        foreach ($this->connections as $connection) {
            return $connection->version();
        }

        return $this->maintenance()->version();
    }

    public function closeAll(): void
    {
        foreach ($this->connections as $connection) {
            $connection->close();
        }

        $this->connections = [];
    }
}
