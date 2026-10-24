<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Database;

use InvalidArgumentException;
use PhpPgAdmin\Core\Facades\Config;

/**
 * A PostgreSQL server to sign in to: where it listens and how to reach it. The one in
 * config/db.php is the default; the ones a login succeeded against are saved in the
 * application storage and offered again on the login page.
 */
final readonly class Server
{
    public const array SSL_MODES = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'];

    public function __construct(
        public string $host,
        public int $port,
        public string $sslmode = 'prefer',
        /** The database a login connects to first; null tries postgres, template1 and the role's own. */
        public ?string $maintenanceDb = null,
        /** Null until the server has been saved. */
        public ?int $id = null,
        public ?string $name = null,
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
     * make no server.
     *
     * @param array<string, mixed> $data
     */
    public static function fromArray(array $data): self
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
        );
    }

    public function withId(int $id, ?string $name): self
    {
        return new self($this->host, $this->port, $this->sslmode, $this->maintenanceDb, $id, $name);
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
