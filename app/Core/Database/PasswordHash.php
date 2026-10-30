<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Database;

/**
 * A password as PostgreSQL stores it, computed here so that ALTER ROLE … PASSWORD carries the
 * verifier and not the password itself, which would otherwise reach the server's log with
 * log_statement = ddl. libpq's PQencryptPasswordConn does the same; ext-pgsql does not offer it.
 */
final class PasswordHash
{
    private const int SCRAM_ITERATIONS = 4096;

    /**
     * The verifier for the method (scram-sha-256 or md5), or null when it cannot be computed
     * here exactly: SCRAM prepares a password with SASLprep, which only leaves printable ASCII
     * alone, so another password is sent as it is for the server to hash.
     */
    public static function verifier(#[\SensitiveParameter] string $password, string $username, string $method): ?string
    {
        if ($method === 'md5') {
            return 'md5' . md5($password . $username);
        }
        if ($method !== 'scram-sha-256' || preg_match('/^[\x20-\x7e]*$/', $password) !== 1) {
            return null;
        }

        $salt = random_bytes(16);
        $salted = hash_pbkdf2('sha256', $password, $salt, self::SCRAM_ITERATIONS, 32, true);
        $clientKey = hash_hmac('sha256', 'Client Key', $salted, true);
        $storedKey = hash('sha256', $clientKey, true);
        $serverKey = hash_hmac('sha256', 'Server Key', $salted, true);

        return sprintf('SCRAM-SHA-256$%d:%s$%s:%s', self::SCRAM_ITERATIONS, base64_encode($salt), base64_encode($storedKey), base64_encode($serverKey));
    }
}
