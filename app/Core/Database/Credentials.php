<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Database;

/**
 * The role a session connects to the server as, plus the database its connections open by
 * default: the one the login found it could connect to, since PostgreSQL has no connection
 * without a database. Kept in the session between requests.
 */
final readonly class Credentials
{
    public function __construct(
        public string $username,
        #[\SensitiveParameter] public string $password,
        public string $database,
    ) {
    }

    /** @param array<string, mixed> $data */
    public static function fromArray(array $data): ?self
    {
        $username = $data['username'] ?? null;
        $password = $data['password'] ?? null;
        $database = $data['database'] ?? null;

        if (!is_string($username) || !is_string($password) || !is_string($database)) {
            return null;
        }

        return new self($username, $password, $database);
    }

    /** @return array{username: string, password: string, database: string} */
    public function toArray(): array
    {
        return ['username' => $this->username, 'password' => $this->password, 'database' => $this->database];
    }
}
