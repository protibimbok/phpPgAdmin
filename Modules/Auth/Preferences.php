<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Auth;

use PDO;
use PhpPgAdmin\Core\Database\Credentials;
use PhpPgAdmin\Core\Database\Server;
use PhpPgAdmin\Core\Facades\Storage;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;

/**
 * The preferences of one role on one server, kept in the application storage the way
 * phpMyAdmin keeps a user's settings in its configuration storage. Values are any JSON value.
 */
final class Preferences
{
    public const string LOCALE = 'locale';

    public function __construct(
        private readonly PDO $db,
        public readonly string $server,
        public readonly string $username,
    ) {
    }

    /** The preferences of the role the session is signed in as, or null when nobody is. */
    public static function forSession(): ?self
    {
        $credentials = Credentials::fromArray((array) ($_SESSION[Authenticate::CREDENTIALS] ?? []));
        $server = Authenticate::sessionServer();

        return $credentials === null || $server === null ? null : self::for($server, $credentials->username);
    }

    public static function for(Server $server, string $username): self
    {
        return new self(Storage::connection(), $server->key(), $username);
    }

    /** @return array<string, mixed> */
    public function all(): array
    {
        $statement = $this->db->prepare('SELECT key, value FROM preferences WHERE server = ? AND username = ? ORDER BY key');
        $statement->execute([$this->server, $this->username]);

        $all = [];
        foreach ($statement as $row) {
            $all[$row['key']] = json_decode($row['value'], true, flags: JSON_THROW_ON_ERROR);
        }

        return $all;
    }

    public function get(string $key, mixed $default = null): mixed
    {
        $statement = $this->db->prepare('SELECT value FROM preferences WHERE server = ? AND username = ? AND key = ?');
        $statement->execute([$this->server, $this->username, $key]);
        $value = $statement->fetchColumn();

        return $value === false ? $default : json_decode($value, true, flags: JSON_THROW_ON_ERROR);
    }

    /** Store a value; null removes the key. */
    public function set(string $key, mixed $value): void
    {
        if ($value === null) {
            $this->forget($key);

            return;
        }

        $statement = $this->db->prepare(<<<'SQL'
            INSERT INTO preferences (server, username, key, value, updated_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (server, username, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            SQL);
        $statement->execute([$this->server, $this->username, $key, json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), gmdate('Y-m-d\TH:i:s\Z')]);
    }

    /** @param array<string, mixed> $values */
    public function merge(array $values): void
    {
        $this->db->beginTransaction();
        try {
            foreach ($values as $key => $value) {
                $this->set($key, $value);
            }
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    public function forget(string $key): void
    {
        $statement = $this->db->prepare('DELETE FROM preferences WHERE server = ? AND username = ? AND key = ?');
        $statement->execute([$this->server, $this->username, $key]);
    }
}
