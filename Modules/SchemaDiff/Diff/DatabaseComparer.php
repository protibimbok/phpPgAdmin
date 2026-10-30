<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\SchemaDiff\Diff;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use Psr\Http\Message\ServerRequestInterface;

/**
 * pgAdmin's schema diff between two whole databases: the database's own objects (schemas,
 * extensions, languages, foreign data wrappers, servers and user mappings, casts, event
 * triggers, publications, subscriptions), then the objects of each schema matched by name. A
 * schema only one side has makes each of its objects only in the source or only in the target.
 * Every result carries the schema it is in, null for a database-level object.
 *
 * @phpstan-type Item array{schema: string|null, type: string, source_oid: int|null, target_oid: int|null}
 */
final class DatabaseComparer
{
    private readonly SchemaComparer $database;

    /** @var array<string, SchemaComparer> */
    private array $schemas = [];

    private readonly DatabaseSnapshot $sourceDb;

    private readonly DatabaseSnapshot $targetDb;

    /** @param array{ignore_owner: bool, ignore_grants: bool, ignore_tablespace: bool, ignore_whitespace: bool} $flags */
    public function __construct(
        private readonly ConnectionPool $sourcePool,
        private readonly Connection $sourceConn,
        private readonly ConnectionPool $targetPool,
        private readonly Connection $targetConn,
        private readonly ServerRequestInterface $request,
        private readonly array $flags,
    ) {
        $this->sourceDb = new DatabaseSnapshot($sourcePool, $sourceConn, $request);
        $this->targetDb = new DatabaseSnapshot($targetPool, $targetConn, $request);
        $this->database = new SchemaComparer($this->sourceDb, $this->targetDb, $this->normalizer(''));
    }

    /** @return list<array<string, mixed>> */
    public function compare(): array
    {
        $results = array_map(static fn (array $r): array => [...$r, 'schema' => null], $this->database->compare());
        foreach ($this->schemaNames() as $schema) {
            foreach ($this->schema($schema)->compare() as $r) {
                $results[] = [...$r, 'schema' => $schema];
            }
        }

        return $results;
    }

    /** @return array{source_ddl: string, target_ddl: string, diff_ddl: string} */
    public function ddl(?string $schema, string $type, ?int $sourceOid, ?int $targetOid): array
    {
        return $this->comparer($schema, $type)->ddl($type, $sourceOid, $targetOid);
    }

    /**
     * The script for the objects chosen: the database-level drops of what uses the schemas'
     * objects and the creates of what they use, then each schema's part, then the creates of
     * what uses them and the drops of what they used, schemas last.
     *
     * @param list<Item> $items
     */
    public function script(array $items): string
    {
        $level = array_values(array_filter($items, static fn (array $i): bool => $i['schema'] === null));
        foreach ($level as $item) {
            if (!in_array($item['type'], $this->sourceDb->types(), true)) {
                throw new BadRequestException(sprintf('"%s" is not a database-level type.', $item['type']));
            }
        }
        $before = static fn (array $i): bool => in_array($i['type'], DatabaseSnapshot::BEFORE, true);
        $drop = static fn (array $i): bool => $i['source_oid'] === null;

        $parts = $this->database->parts(array_values(array_filter($level, static fn (array $i): bool => $before($i) ? !$drop($i) : $drop($i))));
        $bySchema = [];
        foreach ($items as $item) {
            if ($item['schema'] !== null) {
                $bySchema[$item['schema']][] = $item;
            }
        }
        foreach ($bySchema as $schema => $schemaItems) {
            array_push($parts, ...$this->schema((string) $schema)->parts($schemaItems));
        }
        array_push($parts, ...$this->database->parts(array_values(array_filter($level, static fn (array $i): bool => $before($i) ? $drop($i) : !$drop($i)))));

        return $parts === [] ? '' : "BEGIN;\n\n" . implode("\n\n", $parts) . "\n\nEND;";
    }

    private function comparer(?string $schema, string $type): SchemaComparer
    {
        if ($schema === null) {
            if (!in_array($type, $this->sourceDb->types(), true)) {
                throw new BadRequestException(sprintf('"%s" is not a database-level type.', $type));
            }

            return $this->database;
        }
        if (!in_array($type, SchemaSnapshot::TYPES, true)) {
            throw new BadRequestException(sprintf('"%s" is not a type the schema diff compares.', $type));
        }

        return $this->schema($schema);
    }

    /** @return list<string> the schemas of both databases, by name */
    private function schemaNames(): array
    {
        $names = array_unique([...array_keys($this->sourceDb->objects('schema') ?? []), ...array_keys($this->targetDb->objects('schema') ?? [])]);
        sort($names, SORT_STRING);

        return array_map('strval', $names);
    }

    private function schema(string $name): SchemaComparer
    {
        if (!isset($this->schemas[$name])) {
            $inSource = isset($this->sourceDb->objects('schema')[$name]);
            $inTarget = isset($this->targetDb->objects('schema')[$name]);
            if (!$inSource && !$inTarget) {
                throw new BadRequestException(sprintf('There is no schema "%s" in either database.', $name));
            }
            $this->schemas[$name] = new SchemaComparer(
                new SchemaSnapshot($this->sourcePool, $this->sourceConn, $name, $this->request, absent: !$inSource),
                new SchemaSnapshot($this->targetPool, $this->targetConn, $name, $this->request, absent: !$inTarget),
                $this->normalizer($name),
            );
        }

        return $this->schemas[$name];
    }

    private function normalizer(string $schema): DdlNormalizer
    {
        return new DdlNormalizer($schema, $schema, $this->flags['ignore_owner'], $this->flags['ignore_grants'], $this->flags['ignore_tablespace'], $this->flags['ignore_whitespace']);
    }
}
