<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Database;

use RuntimeException;

/**
 * A connection to the PostgreSQL server could not be opened. The message is the server's
 * (or libpq's) own, the way pgAdmin and phpMyAdmin show it, with the driver's framing removed.
 */
final class ConnectionException extends RuntimeException
{
    private function __construct(string $message, private readonly bool $credentialsRejected, private readonly bool $databaseUnavailable)
    {
        parent::__construct($message);
    }

    /** From the warning pg_connect() raises, which wraps libpq's message. */
    public static function fromLibpq(string $warning): self
    {
        $message = self::serverMessage($warning);

        return new self($message, self::isCredentialsRejected($message), self::isDatabaseUnavailable($message));
    }

    /**
     * True when the server was reached and turned the role or password down; false when it
     * could not be reached at all or the database could not be opened.
     */
    public function credentialsRejected(): bool
    {
        return $this->credentialsRejected;
    }

    /** True when the server was reached but the database does not exist or the role may not connect to it. */
    public function databaseUnavailable(): bool
    {
        return $this->databaseUnavailable;
    }

    /**
     * The HTTP status that fits the failure: 401 when the role or password itself is turned down
     * (the client takes it as the end of the session), 403 when the server refuses this
     * connection only (pg_hba.conf, the role's connection limit), 503 for everything else.
     */
    public function httpStatus(): int
    {
        if (!$this->credentialsRejected) {
            return 503;
        }

        return preg_match('/no pg_hba\.conf entry|too many connections for role/i', $this->getMessage()) === 1 ? 403 : 401;
    }

    /** Strip ext-pgsql's "pg_connect(): Unable to connect to PostgreSQL server: " framing. */
    private static function serverMessage(string $message): string
    {
        $message = preg_replace('/^(pg_connect\(\):\s*)?(Unable to connect to PostgreSQL server:\s*)?/i', '', $message) ?? $message;

        return trim($message);
    }

    private static function isCredentialsRejected(string $message): bool
    {
        return preg_match(
            '/authentication failed|role "[^"]*" does not exist|no pg_hba\.conf entry|is not permitted to log in|too many connections for role/i',
            $message,
        ) === 1;
    }

    private static function isDatabaseUnavailable(string $message): bool
    {
        return preg_match('/database "[^"]*" does not exist|permission denied for database|is not currently accepting connections/i', $message) === 1;
    }
}
