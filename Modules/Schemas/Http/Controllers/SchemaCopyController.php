<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Schemas\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Database\QueryException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Http\ApiException;
use PhpPgAdmin\Modules\SchemaDiff\Diff\DdlNormalizer;
use PhpPgAdmin\Modules\SchemaDiff\Diff\SchemaComparer;
use PhpPgAdmin\Modules\SchemaDiff\Diff\SchemaSnapshot;
use Psr\Http\Message\ServerRequestInterface;

/**
 * phpMyAdmin's "Copy database to" card, for a schema: POST …/schemas/{scid}/copy with "name"
 * (the new schema), "what" ('structure', 'data', or 'dataonly' into an existing schema's tables
 * of the same names), "sequences" (set the copies' positions, phpMyAdmin's AUTO_INCREMENT
 * value; default on) and "preview". The copy is the schema diff's
 * script from the schema to one that does not exist yet (every object made again under the new
 * name, the references to the schema retargeted), after CREATE SCHEMA with the same owner, then
 * for "data" each table's rows (INSERT … SELECT of the columns that are not generated, OVERRIDING
 * SYSTEM VALUE for identity columns) and the sequences' positions. It runs in one transaction.
 */
final class SchemaCopyController
{
    /** @return array{sql: string, ok?: true} */
    public function copySchema(ServerRequestInterface $request, array $args): array
    {
        $db = rawurldecode((string) ($args['db'] ?? ''));
        $pool = ConnectionPool::from($request);
        $conn = $pool->for($db);
        $source = (string) ($conn->scalar('SELECT nspname FROM pg_catalog.pg_namespace WHERE oid = $1', [(int) $args['scid']]) ?? throw new BadRequestException('Unknown schema.'));
        $body = (array) ($request->getParsedBody() ?? []);
        $target = trim((string) ($body['name'] ?? ''));
        if ($target === '' || strlen($target) > 63) {
            throw new BadRequestException('Give the new schema a name of at most 63 bytes.');
        }
        $what = (string) ($body['what'] ?? 'structure');
        if (!in_array($what, ['structure', 'data', 'dataonly'], true)) {
            throw new BadRequestException('Copy the structure, the structure and data, or the data only.');
        }
        $exists = $conn->scalar('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1', [$target]) !== null;
        if ($what !== 'dataonly' && $exists) {
            throw new BadRequestException(sprintf('There is already a schema "%s" in this database.', $target));
        }
        if ($what === 'dataonly' && (!$exists || $target === $source)) {
            throw new BadRequestException('Data only copies the rows into the tables of another schema that exists already.');
        }
        $sequences = filter_var($body['sequences'] ?? true, FILTER_VALIDATE_BOOL);

        $sql = $what === 'dataonly'
            ? implode("\n\n", $this->dataStatements($conn, $source, $target, $sequences, false))
            : $this->script($pool, $conn, $request, $source, $target, $what === 'data', $sequences);
        if (trim($sql) === '') {
            throw new BadRequestException(sprintf('No table of "%s" has a table of the same name in "%s".', $source, $target));
        }
        if (filter_var($body['preview'] ?? false, FILTER_VALIDATE_BOOL)) {
            return ['sql' => $sql];
        }
        try {
            $conn->transaction(static fn () => $conn->queryMulti($sql));
        } catch (QueryException $e) {
            throw new ApiException(422, $e->getMessage());
        }

        return ['sql' => $sql, 'ok' => true];
    }

    private function script(ConnectionPool $pool, Connection $conn, ServerRequestInterface $request, string $source, string $target, bool $withData, bool $sequences): string
    {
        $owner = (string) $conn->scalar('SELECT pg_catalog.pg_get_userbyid(nspowner) FROM pg_catalog.pg_namespace WHERE nspname = $1', [$source]);
        $comparer = new SchemaComparer(
            new SchemaSnapshot($pool, $conn, $source, $request),
            new SchemaSnapshot($pool, $conn, $target, $request, absent: true),
            new DdlNormalizer($source, $target),
        );
        $items = array_values(array_map(
            static fn (array $r): array => ['type' => $r['type'], 'source_oid' => $r['source_oid'], 'target_oid' => null],
            array_filter($comparer->compare(), static fn (array $r): bool => $r['status'] === SchemaComparer::SOURCE_ONLY),
        ));
        $parts = [sprintf('CREATE SCHEMA %s AUTHORIZATION %s;', Quoting::ident($target), Quoting::ident($owner)), ...($items === [] ? [] : $comparer->parts($items))];
        if ($withData) {
            array_push($parts, ...$this->dataStatements($conn, $source, $target, $sequences, true));
        }

        return implode("\n\n", $parts);
    }

    /**
     * The rows of each table and the sequences' positions.
     *
     * @return list<string>
     */
    private function dataStatements(Connection $conn, string $source, string $target, bool $sequences, bool $creating): array
    {
        // Into an existing schema, only the tables and sequences it has under the same names.
        $there = array_flip(array_column($conn->rows("SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = \$1 AND c.relkind IN ('r', 'p', 'S')", [$target]), 'relname'));
        $statements = [];
        $tables = $conn->rows(<<<'SQL'
            SELECT c.relname,
                   pg_catalog.array_to_string(pg_catalog.array_agg(pg_catalog.quote_ident(a.attname) ORDER BY a.attnum) FILTER (WHERE a.attgenerated = ''), ', ') AS columns,
                   bool_or(a.attidentity = 'a') AS always_identity
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND NOT c.relispartition
            GROUP BY c.relname
            ORDER BY c.relname
            SQL, [$source]);
        // A table's rows go in after those of the tables its foreign keys reference.
        $references = [];
        foreach ($conn->rows(<<<'SQL'
            SELECT c.relname AS child, p.relname AS parent
            FROM pg_catalog.pg_constraint con
            JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
            JOIN pg_catalog.pg_class p ON p.oid = con.confrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.oid = p.relnamespace
            WHERE con.contype = 'f' AND n.nspname = $1 AND con.conrelid <> con.confrelid
            SQL, [$source]) as $row) {
            $references[(string) $row['child']][] = (string) $row['parent'];
        }
        $byName = array_column($tables, null, 'relname');
        $ordered = [];
        $visit = static function (string $name, array $path) use (&$visit, &$ordered, $references, $byName): void {
            if (isset($ordered[$name]) || in_array($name, $path, true) || !isset($byName[$name])) {
                return;
            }
            foreach ($references[$name] ?? [] as $parent) {
                $visit($parent, [...$path, $name]);
            }
            $ordered[$name] = $byName[$name];
        };
        foreach (array_keys($byName) as $name) {
            $visit((string) $name, []);
        }
        foreach ($ordered as $table) {
            if ((string) $table['columns'] === '' || (!$creating && !isset($there[(string) $table['relname']]))) {
                continue;
            }
            $statements[] = sprintf(
                'INSERT INTO %s (%s)%s SELECT %s FROM %s;',
                Quoting::ident($target, (string) $table['relname']),
                $table['columns'],
                $table['always_identity'] ? ' OVERRIDING SYSTEM VALUE' : '',
                $table['columns'],
                Quoting::ident($source, (string) $table['relname']),
            );
        }
        foreach ($sequences ? $conn->rows("SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = \$1 AND c.relkind = 'S' ORDER BY 1", [$source]) : [] as $sequence) {
            $name = (string) $sequence['relname'];
            if (!$creating && !isset($there[$name])) {
                continue;
            }
            $statements[] = sprintf(
                'SELECT pg_catalog.setval(%s, last_value, is_called) FROM %s;',
                Quoting::literal(Quoting::ident($target, $name)),
                Quoting::ident($source, $name),
            );
        }

        return $statements;
    }
}
