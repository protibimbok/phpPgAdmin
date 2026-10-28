<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Core\Nodes\Options;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * The extended statistics node, after pgAdmin's StatisticsView: a statistics object belongs
 * to a schema and describes columns and expressions of one table (CREATE STATISTICS … ON …
 * FROM table), with the kinds it collects (ndistinct, dependencies, mcv) and a statistics
 * target. The schema's objects are listed by scid; a table's by its OID (forTable), which is
 * how the structure page reaches them.
 *
 * The client's data carries pgAdmin's field names: name (optional on PostgreSQL 16+), owner,
 * table (with table_schema), columns [...], expression_list, stat_types [...], stattarget
 * (-1 or 'DEFAULT' for the default), comment.
 */
final class StatisticsController extends NodeController
{
    private const array STAT_TYPES = ['ndistinct', 'dependencies', 'mcv'];

    public function list(NodeContext $ctx): array
    {
        return array_map($this->decorate(...), $ctx->rows('properties.sql'));
    }

    /**
     * The statistics objects defined on one table, whichever schema they live in.
     *
     * @return list<array<string, mixed>>
     */
    public function forTable(NodeContext $ctx, int $tid): array
    {
        return array_map($this->decorate(...), $ctx->rows('properties.sql', ['scid' => null, 'tid' => $tid]));
    }

    public function nodes(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->toNode($ctx, $row), $ctx->rows('nodes.sql'));
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('nodes.sql', ['scid' => null, 'stid' => $oid]) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        return $this->decorate($ctx->row('properties.sql', ['stid' => $oid]) ?? throw $this->gone($ctx));
    }

    /** The "SQL" tab: the commented header and DROP, then CREATE STATISTICS with the owner, target and comment. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        $data = $this->properties($ctx, $oid);
        $drop = $ctx->render('delete.sql', ['schema' => $data['schema'], 'name' => $data['name']]);

        return Ddl::assemble([Ddl::header('Statistics', Quoting::ident((string) $data['schema'], (string) $data['name']), $drop), $ctx->render('create.sql', ['data' => $data])]);
    }

    /** CREATE STATISTICS; the new object's node, found by name or, when the server named it, as the table's newest. */
    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($ctx, $data);
        $this->execute($ctx, $ctx->render('create.sql', ['data' => $data]));
        $row = $ctx->conn->row($ctx->render('get_oid.sql', ['schema' => $data['schema'], 'name' => $data['name'] ?? null, 'table_schema' => $data['table_schema'], 'table' => $data['table']])) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $row['oid']);
    }

    /** ALTER STATISTICS for a new name, owner, target or comment. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));

        return $this->node($ctx, $oid);
    }

    /** DROP STATISTICS, CASCADE on request. */
    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = $ctx->row('get_name.sql', ['stid' => $oid]) ?? throw $this->gone($ctx);
        $this->execute($ctx, $ctx->render('delete.sql', ['schema' => $row['schema'], 'name' => $row['name'], 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid === null) {
            return $ctx->render('create.sql', ['data' => $this->forCreate($ctx, $data)]);
        }

        return $this->updateSql($ctx, $oid, $data);
    }

    /** A statistics object by schema and name: resolve('statistic', {schema, name}) → {scid, stid}. */
    public function resolve(NodeContext $ctx, array $params): ?array
    {
        $schema = (string) ($params['schema'] ?? '');
        $name = (string) ($params['name'] ?? '');
        if ($schema === '' || $name === '') {
            return null;
        }
        $row = $ctx->conn->row('SELECT s.oid, s.stxnamespace FROM pg_catalog.pg_statistic_ext s JOIN pg_catalog.pg_namespace n ON n.oid = s.stxnamespace WHERE n.nspname = $1 AND s.stxname = $2', [$schema, $name]);

        return $row === null ? null : ['scid' => (int) $row['stxnamespace'], 'stid' => (int) $row['oid']];
    }

    /**
     * A properties row as pgAdmin's _fetch_properties shapes it: the kinds as a list, the
     * columns as a list, the target with -1 for the default.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function decorate(array $row): array
    {
        $row['is_sys_obj'] = (int) $row['oid'] <= DatabaseController::LAST_SYSTEM_OID;
        $row['stat_types'] = array_values(array_filter(self::STAT_TYPES, static fn (string $kind): bool => (bool) $row['has_' . $kind]));
        $row['columns'] = Options::list($row['columns'] ?? null);
        $row['stattarget'] = $row['stattarget'] === null ? -1 : (int) $row['stattarget'];
        foreach (['has_ndistinct', 'has_dependencies', 'has_mcv', 'has_ext_data_access', 'has_mcv_values'] as $flag) {
            $row[$flag] = (bool) $row[$flag];
        }

        return $row;
    }

    /**
     * The client's data as create.sql takes it: the table named with its schema, the kinds
     * checked, at least two columns unless an expression is given (pgAdmin's create checks).
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function forCreate(NodeContext $ctx, array $data): array
    {
        $data['schema'] = (string) ($ctx->conn->scalar('SELECT nspname FROM pg_catalog.pg_namespace WHERE oid = $1', [$ctx->id('scid')]) ?? throw $this->notFound('Could not find the schema.'));
        $data['name'] = trim((string) ($data['name'] ?? ''));
        if ($data['name'] === '') {
            if ($ctx->version() < 160000) {
                throw new BadRequestException('Could not find the required parameter (name).');
            }
            unset($data['name']);
        }
        $data['table'] = $this->requireName($data, 'table');
        $data['table_schema'] = trim((string) ($data['table_schema'] ?? '')) ?: $data['schema'];
        $data['columns'] = array_values(array_filter(array_map(static fn ($c): string => trim((string) $c), (array) ($data['columns'] ?? [])), static fn (string $c): bool => $c !== ''));
        $data['expression_list'] = trim((string) ($data['expression_list'] ?? ''));
        if ($data['columns'] === [] && $data['expression_list'] === '') {
            throw new BadRequestException('Either columns or expressions must be specified.');
        }
        if ($data['expression_list'] === '' && count($data['columns']) < 2) {
            throw new BadRequestException('At least 2 columns must be specified for multi-column statistics.');
        }
        $data['stat_types'] = array_values(array_intersect(self::STAT_TYPES, array_map(strval(...), (array) ($data['stat_types'] ?? []))));
        $data['stattarget'] = $this->target($data['stattarget'] ?? null);
        foreach (['owner', 'comment'] as $key) {
            if (array_key_exists($key, $data) && trim((string) ($data[$key] ?? '')) === '') {
                unset($data[$key]);
            }
        }

        return $data;
    }

    /** @param array<string, mixed> $data */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $old = $this->properties($ctx, $oid);
        $changes = [];
        foreach (['name', 'owner', 'comment'] as $key) {
            if (array_key_exists($key, $data) && (string) ($data[$key] ?? '') !== (string) ($old[$key] ?? '')) {
                $changes[$key] = $data[$key];
            }
        }
        if (isset($changes['owner']) && trim((string) $changes['owner']) === '') {
            unset($changes['owner']);
        }
        if (isset($changes['name']) && trim((string) $changes['name']) === '') {
            unset($changes['name']);
        }
        if (array_key_exists('stattarget', $data)) {
            $target = $this->target($data['stattarget']);
            if (($target === null ? -1 : $target) !== $old['stattarget']) {
                $changes['stattarget'] = $target ?? -1;
            }
        }

        return $ctx->render('update.sql', ['data' => $changes, 'o_data' => $old]);
    }

    /** The statistics target as an integer, or null for the default ('', -1 or DEFAULT). */
    private function target(mixed $value): ?int
    {
        $value = trim((string) ($value ?? ''));
        if ($value === '' || $value === '-1' || strtoupper($value) === 'DEFAULT') {
            return null;
        }
        if (!is_numeric($value)) {
            throw new BadRequestException('Statistics target must be an integer.');
        }

        return (int) $value;
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, $row);
        $node['inode'] = false;

        return $node;
    }
}
