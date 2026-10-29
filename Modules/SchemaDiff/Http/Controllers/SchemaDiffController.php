<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\SchemaDiff\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Modules\SchemaDiff\Diff\DdlNormalizer;
use PhpPgAdmin\Modules\SchemaDiff\Diff\SchemaComparer;
use PhpPgAdmin\Modules\SchemaDiff\Diff\SchemaSnapshot;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The Schema diff page's backend, after pgAdmin's schema_diff views: the databases and schemas
 * to choose from (GET /api/schema-diff/options), the comparison (POST …/compare), one object's
 * DDL on both sides with the difference (POST …/ddl), and the script for the objects chosen
 * (POST …/script). Each request names the source and the target, {database, schema}, and the
 * options: ignore_owner, ignore_grants, ignore_tablespace, ignore_whitespace.
 */
final class SchemaDiffController
{
    /** @return array{databases: list<string>, schemas: list<string>|null} the schemas of ?database= when one is named */
    public function options(ServerRequestInterface $request): array
    {
        $pool = ConnectionPool::from($request);
        $database = (string) ($request->getQueryParams()['database'] ?? '');

        return [
            'databases' => array_column($pool->maintenance()->rows('SELECT datname FROM pg_catalog.pg_database WHERE datallowconn AND NOT datistemplate AND has_database_privilege(datname, \'CONNECT\') ORDER BY datname'), 'datname'),
            'schemas' => $database === '' ? null : Catalog::schemas($pool->for($database)),
        ];
    }

    /** @return array{results: list<array<string, mixed>>} */
    public function compare(ServerRequestInterface $request): array
    {
        return ['results' => $this->comparer($request)->compare()];
    }

    /** @return array{source_ddl: string, target_ddl: string, diff_ddl: string} */
    public function ddl(ServerRequestInterface $request): array
    {
        $body = (array) ($request->getParsedBody() ?? []);
        [$type, $source, $target] = self::item($body);

        return $this->comparer($request)->ddl($type, $source, $target);
    }

    /** @return array{script: string} */
    public function script(ServerRequestInterface $request): array
    {
        $body = (array) ($request->getParsedBody() ?? []);
        $items = [];
        foreach (is_array($body['items'] ?? null) ? $body['items'] : [] as $entry) {
            [$type, $source, $target] = self::item(is_array($entry) ? $entry : []);
            $items[] = ['type' => $type, 'source_oid' => $source, 'target_oid' => $target];
        }
        if ($items === []) {
            throw new BadRequestException('Select the objects to write the script for.');
        }

        return ['script' => $this->comparer($request)->script($items)];
    }

    private function comparer(ServerRequestInterface $request): SchemaComparer
    {
        $body = (array) ($request->getParsedBody() ?? []);
        $pool = ConnectionPool::from($request);
        [$sourceDb, $sourceSchema] = self::side($body, 'source');
        [$targetDb, $targetSchema] = self::side($body, 'target');
        if ($sourceDb === $targetDb && $sourceSchema === $targetSchema) {
            throw new BadRequestException('The source and the target are the same schema.');
        }
        $flag = static fn (string $key): bool => filter_var($body[$key] ?? false, FILTER_VALIDATE_BOOL);
        $normalizer = new DdlNormalizer($sourceSchema, $targetSchema, $flag('ignore_owner'), $flag('ignore_grants'), $flag('ignore_tablespace'), $flag('ignore_whitespace'));

        return new SchemaComparer(
            new SchemaSnapshot($pool, $pool->for($sourceDb), $sourceSchema, $request),
            new SchemaSnapshot($pool, $pool->for($targetDb), $targetSchema, $request),
            $normalizer,
        );
    }

    /** @return array{0: string, 1: string} the database and schema of one side */
    private static function side(array $body, string $key): array
    {
        $side = is_array($body[$key] ?? null) ? $body[$key] : [];
        $database = trim((string) ($side['database'] ?? ''));
        $schema = trim((string) ($side['schema'] ?? ''));
        if ($database === '' || $schema === '') {
            throw new BadRequestException(sprintf('Choose the %s database and schema.', $key));
        }

        return [$database, $schema];
    }

    /** @return array{0: string, 1: int|null, 2: int|null} an object: its type and its OID on each side */
    private static function item(array $entry): array
    {
        $type = (string) ($entry['type'] ?? '');
        if (!in_array($type, SchemaSnapshot::TYPES, true)) {
            throw new BadRequestException(sprintf('"%s" is not a type the schema diff compares.', $type));
        }
        $oid = static fn (mixed $v): ?int => is_numeric($v) && (int) $v > 0 ? (int) $v : null;
        $source = $oid($entry['source_oid'] ?? null);
        $target = $oid($entry['target_oid'] ?? null);
        if ($source === null && $target === null) {
            throw new BadRequestException('The object is in neither schema.');
        }

        return [$type, $source, $target];
    }
}
