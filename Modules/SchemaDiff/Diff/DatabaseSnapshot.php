<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\SchemaDiff\Diff;

/**
 * A database's own objects as pgAdmin's database-level schema diff compares them: its schemas
 * (the objects in them are compared schema by schema), extensions, languages, foreign data
 * wrappers with their servers and user mappings, casts, event triggers, publications and
 * subscriptions.
 */
final class DatabaseSnapshot extends Snapshot
{
    /** The types a script creates before the schemas' objects: what those objects may use. */
    public const array BEFORE = ['schema', 'extension', 'language', 'foreign_data_wrapper', 'foreign_server', 'user_mapping'];

    /** The types a script creates after them: what uses their types, functions and tables. */
    public const array AFTER = ['cast', 'event_trigger', 'publication', 'subscription'];

    public function types(): array
    {
        return [...self::BEFORE, ...self::AFTER];
    }

    protected function parent(): string
    {
        return 'database';
    }

    protected function containerIds(): array
    {
        return [];
    }

    protected function accepts(?string $parent, string $type): bool
    {
        return in_array($type, $this->types(), true);
    }

    protected function parentIds(string $type): array
    {
        return match ($type) {
            'foreign_server' => array_map(static fn (int $oid): array => ['fid' => $oid], array_values($this->objects('foreign_data_wrapper') ?? [])),
            'user_mapping' => array_map(fn (int $oid): array => ['fid' => $this->wrapperOf($oid), 'fsid' => $oid], array_values($this->objects('foreign_server') ?? [])),
            default => [[]],
        };
    }

    protected function name(string $type, array $node, array $ids): string
    {
        // A user mapping is named by its role; the server it is for tells two apart.
        if ($type === 'user_mapping') {
            $server = array_search($ids['fsid'], $this->objects('foreign_server') ?? [], true);

            return sprintf('%s SERVER %s', $node['label'], (string) $server);
        }

        return (string) $node['label'];
    }

    private function wrapperOf(int $serverOid): int
    {
        return (int) $this->conn->scalar('SELECT srvfdw FROM pg_catalog.pg_foreign_server WHERE oid = $1', [$serverOid]);
    }
}
