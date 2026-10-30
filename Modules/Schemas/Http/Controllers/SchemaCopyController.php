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
use PhpPgAdmin\Modules\SchemaDiff\Diff\Snapshot;
use Psr\Http\Message\ServerRequestInterface;

/**
 * phpMyAdmin's "Copy database to" card, for a schema: POST …/schemas/{scid}/copy with "name"
 * (the new schema), "what" ('structure', 'data', or 'dataonly' into an existing schema's tables
 * of the same names), "sequences" (set the copies' positions, phpMyAdmin's AUTO_INCREMENT
 * value; default on) and "preview". The copy is the schema diff's
 * script from the schema to one that does not exist yet (every object made again under the new
 * name, the references to the schema retargeted), after CREATE SCHEMA with the same owner, phase
 * by phase with the rows (for "data") after the tables and before the views, indexes, foreign
 * keys and triggers, then the positions of the sequences and identity columns. It runs in one
 * transaction, the definitions read with an empty search_path.
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

        // Every name the snapshot writes carries its schema, and the script itself names each.
        $searchPath = Snapshot::qualifyNames($conn);
        try {
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
        } finally {
            Snapshot::restoreSearchPath($conn, $searchPath);
        }

        return ['sql' => $sql, 'ok' => true];
    }

    /**
     * CREATE SCHEMA, then the schema diff's phases with the rows between: the types, routines
     * and tables (without their foreign keys, indexes and triggers), the rows, the views and
     * materialized views (which so hold the rows), the indexes, the foreign keys (checked
     * once, against all the rows, whatever cycle they make), the triggers, rules and policies
     * (which so never fire on the copied rows), the sequences' OWNED BY, and the positions of
     * the sequences and identity columns.
     */
    private function script(ConnectionPool $pool, Connection $conn, ServerRequestInterface $request, string $source, string $target, bool $withData, bool $sequences): string
    {
        $owner = (string) $conn->scalar('SELECT pg_catalog.pg_get_userbyid(nspowner) FROM pg_catalog.pg_namespace WHERE nspname = $1', [$source]);
        $comparer = new SchemaComparer(
            new SchemaSnapshot($pool, $conn, $source, $request),
            new SchemaSnapshot($pool, $conn, $target, $request, absent: true),
            new DdlNormalizer($source, $target, names: DdlNormalizer::objectNames($conn, $source)),
        );
        $items = array_values(array_map(
            static fn (array $r): array => ['type' => $r['type'], 'source_oid' => $r['source_oid'], 'target_oid' => null],
            array_filter($comparer->compare(), static fn (array $r): bool => $r['status'] === SchemaComparer::SOURCE_ONLY),
        ));
        $phased = $items === [] ? [] : $comparer->phased($items);
        $data = $withData ? $this->dataStatements($conn, $source, $target, $sequences, true) : [];
        [$rows, $positions] = [array_values(array_filter($data, static fn (string $s): bool => str_starts_with($s, 'INSERT'))), array_values(array_filter($data, static fn (string $s): bool => !str_starts_with($s, 'INSERT')))];
        $parts = [
            sprintf('CREATE SCHEMA %s AUTHORIZATION %s;', Quoting::ident($target), Quoting::ident($owner)),
            SchemaComparer::PRELUDE,
            ...($phased['create'] ?? []),
            ...$rows,
        ];
        foreach (array_diff(SchemaComparer::PHASES, ['drop', 'create']) as $phase) {
            array_push($parts, ...($phased[$phase] ?? []));
        }

        return implode("\n\n", [...$parts, ...$positions]);
    }

    /**
     * The rows of each table and the positions of the sequences and identity columns. Each
     * table's own rows (FROM ONLY: an inheritance child's are copied with the child) go in by
     * name, a column of a type of the schema's own (an enum, a composite, a domain, an array of
     * one) cast through text to the type of the same name in the target. A partitioned table
     * takes all its partitions' rows, which the partitions of the copy then hold.
     *
     * @return list<string>
     */
    private function dataStatements(Connection $conn, string $source, string $target, bool $sequences, bool $creating): array
    {
        // Into an existing schema, only the tables and sequences it has under the same names.
        $there = array_flip(array_column($conn->rows("SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = \$1 AND c.relkind IN ('r', 'p', 'S')", [$target]), 'relname'));
        $statements = [];
        $columns = $conn->rows(<<<'SQL'
            WITH members AS (SELECT objid FROM pg_catalog.pg_depend WHERE classid = 'pg_catalog.pg_type'::regclass AND deptype = 'e')
            SELECT c.relname, c.relkind, a.attname, a.attidentity,
                   CASE WHEN e.oid IS NOT NULL THEN CASE WHEN e.typnamespace = n.oid AND e.oid NOT IN (SELECT objid FROM members) THEN e.typname END
                        WHEN t.typnamespace = n.oid AND t.oid NOT IN (SELECT objid FROM members) THEN t.typname END AS own_type,
                   e.oid IS NOT NULL AS own_array,
                   pg_catalog.pg_get_serial_sequence(pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname), a.attname) AS identity_sequence
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
            JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
            LEFT JOIN pg_catalog.pg_type e ON e.oid = t.typelem AND t.typsubscript = 'pg_catalog.array_subscript_handler'::regproc
            WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND NOT c.relispartition
                AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
            ORDER BY c.relname, a.attnum
            SQL, [$source]);
        $tables = [];
        foreach ($columns as $column) {
            $table = (string) $column['relname'];
            $name = Quoting::ident((string) $column['attname']);
            $tables[$table]['relkind'] = (string) $column['relkind'];
            $tables[$table]['columns'][] = $name;
            $tables[$table]['values'][] = $column['own_type'] === null
                ? $name
                : sprintf('%s::text::%s%s', $name, Quoting::ident($target, (string) $column['own_type']), self::truthy($column['own_array']) ? '[]' : '');
            $tables[$table]['always'] = ($tables[$table]['always'] ?? false) || $column['attidentity'] === 'a';
            if ($column['attidentity'] !== '' && $column['identity_sequence'] !== null) {
                $tables[$table]['identities'][(string) $column['attname']] = (string) $column['identity_sequence'];
            }
        }
        // A table's rows go in after those of the tables its foreign keys reference, but for
        // the deferrable keys, checked at the end (into an existing schema, which has them).
        $references = [];
        foreach ($conn->rows(<<<'SQL'
            SELECT c.relname AS child, p.relname AS parent
            FROM pg_catalog.pg_constraint con
            JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
            JOIN pg_catalog.pg_class p ON p.oid = con.confrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.oid = p.relnamespace
            WHERE con.contype = 'f' AND n.nspname = $1 AND con.conrelid <> con.confrelid AND NOT con.condeferrable
            SQL, [$source]) as $row) {
            $references[(string) $row['child']][] = (string) $row['parent'];
        }
        $ordered = [];
        $visit = static function (string $name, array $path) use (&$visit, &$ordered, $references, $tables): void {
            if (isset($ordered[$name]) || in_array($name, $path, true) || !isset($tables[$name])) {
                return;
            }
            foreach ($references[$name] ?? [] as $parent) {
                $visit($parent, [...$path, $name]);
            }
            $ordered[$name] = $tables[$name];
        };
        foreach (array_keys($tables) as $name) {
            $visit((string) $name, []);
        }
        $positions = [];
        foreach ($ordered as $name => $table) {
            $name = (string) $name;
            if (!$creating && !isset($there[$name])) {
                continue;
            }
            $statements[] = sprintf(
                'INSERT INTO %s (%s)%s SELECT %s FROM %s%s;',
                Quoting::ident($target, $name),
                implode(', ', $table['columns']),
                $table['always'] ? ' OVERRIDING SYSTEM VALUE' : '',
                implode(', ', $table['values']),
                $table['relkind'] === 'r' ? 'ONLY ' : '',
                Quoting::ident($source, $name),
            );
            foreach ($sequences ? $table['identities'] ?? [] : [] as $column => $sequence) {
                $positions[] = sprintf(
                    'SELECT pg_catalog.setval(pg_catalog.pg_get_serial_sequence(%s, %s), last_value, is_called) FROM %s;',
                    Quoting::literal(Quoting::ident($target, $name)),
                    Quoting::literal($column),
                    $sequence,
                );
            }
        }
        // The other sequences; an identity column's is its table's, an extension's is not copied.
        foreach ($sequences ? $conn->rows(<<<'SQL'
            SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND c.relkind = 'S'
                AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND (d.deptype = 'e' OR d.deptype = 'i'))
            ORDER BY 1
            SQL, [$source]) : [] as $sequence) {
            $name = (string) $sequence['relname'];
            if (!$creating && !isset($there[$name])) {
                continue;
            }
            $positions[] = sprintf(
                'SELECT pg_catalog.setval(%s, last_value, is_called) FROM %s;',
                Quoting::literal(Quoting::ident($target, $name)),
                Quoting::ident($source, $name),
            );
        }

        return [...(!$creating && $statements !== [] ? ['SET CONSTRAINTS ALL DEFERRED;'] : []), ...$statements, ...$positions];
    }

    private static function truthy(mixed $value): bool
    {
        return $value === true || $value === 't';
    }
}
