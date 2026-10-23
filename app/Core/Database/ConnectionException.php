<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Database;

use PDOException;
use RuntimeException;

/**
 * A connection to the PostgreSQL server could not be opened. The message is the server's
 * (or libpq's) own, the way pgAdmin and phpMyAdmin show it, with the driver's prefix removed.
 */
final class ConnectionException extends RuntimeException
{
    private function __construct(string $message, private readonly bool $credentialsRejected, private readonly bool $databaseUnavailable, ?PDOException $previous)
    {
        parent::__construct($message, 0, $previous);
    }

    public static function fromPdo(PDOException $e): self
    {
        $message = self::serverMessage($e->getMessage());

        return new self($message, self::isCredentialsRejected($message), self::isDatabaseUnavailable($message), $e);
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

    /** The HTTP status that fits the failure: 401 for rejected credentials, 503 for everything else. */
    public function httpStatus(): int
    {
        return $this->credentialsRejected ? 401 : 503;
    }

    /** Strip PDO's "SQLSTATE[08006] [7] " framing. */
    private static function serverMessage(string $message): string
    {
        $message = preg_replace('/^SQLSTATE\[\w+\]\s*(\[\d+\]\s*)?/', '', $message) ?? $message;

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
