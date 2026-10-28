<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\VacuumSettings;
use PhpPgAdmin\Modules\Tables\Ddl\PartitionDdl;
use PhpPgAdmin\Modules\Tables\Ddl\TableDdl;

/**
 * The partition node, after pgAdmin's PartitionsView: the partitions of a partitioned table
 * with their bounds, and the statements that create or attach, detach and drop one. A
 * partition is a table of its own as well: the table node answers for it by OID (structure,
 * browse, operations), and its "SQL" is the table's DDL with CREATE TABLE … PARTITION OF.
 */
final class PartitionController extends TableChildController
{
    /** Every partition with its bounds, storage and autovacuum settings. */
    public function list(NodeContext $ctx): array
    {
        $rows = [];
        foreach ($ctx->rows('properties.sql', $this->vars($ctx)) as $row) {
            VacuumSettings::flags($row);
            $rows[] = $row;
        }

        return $rows;
    }

    public function nodes(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->toNode($ctx, $row), $ctx->rows('nodes.sql', $this->vars($ctx)));
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('nodes.sql', $this->vars($ctx, $oid)) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('properties.sql', $this->vars($ctx, $oid)) ?? throw $this->gone($ctx);
        VacuumSettings::flags($row);

        return $row;
    }

    /** The partition's DDL: CREATE TABLE … PARTITION OF with its own constraints, indexes, policies and triggers. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        return PartitionDdl::partitionSql($ctx, $this->tableOid($ctx), $oid, $this->parent($ctx), withHeader: true);
    }

    /** CREATE TABLE … PARTITION OF, or ATTACH PARTITION when is_attach; the partition's node. */
    public function create(NodeContext $ctx, array $data): array
    {
        $parent = $this->parent($ctx);
        $sql = PartitionDdl::createSql($ctx, (string) $parent['schema'], (string) $parent['name'], PartitionDdl::type((string) $parent['partition_scheme']), $data);
        $this->execute($ctx, $sql);

        $name = trim((string) ($data['partition_name'] ?? $data['name'] ?? ''));
        if (!empty($data['is_attach'])) {
            [, $name] = PartitionDdl::splitQualified($name, (string) $parent['schema']);
        }
        $row = $ctx->conn->row('SELECT rel.oid FROM pg_catalog.pg_inherits inh JOIN pg_catalog.pg_class rel ON rel.oid = inh.inhrelid WHERE inh.inhparent = $1 AND rel.relname = $2 ORDER BY rel.oid DESC LIMIT 1', [$this->tableOid($ctx), $name]) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $row['oid']);
    }

    /** The partition as a table: its ALTERs go through the table node by its OID. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        throw new BadRequestException('A partition is altered as a table: use the table routes with its OID.');
    }

    /** DROP TABLE on the partition, CASCADE on request. */
    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = $this->properties($ctx, $oid);
        $this->execute($ctx, $ctx->renderFrom('tables', 'delete.sql', ['data' => ['schema' => $row['schema'], 'name' => $row['name']], 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid !== null) {
            throw new BadRequestException('A partition is altered as a table: use the table routes with its OID.');
        }
        $parent = $this->parent($ctx);

        return PartitionDdl::createSql($ctx, (string) $parent['schema'], (string) $parent['name'], PartitionDdl::type((string) $parent['partition_scheme']), $data);
    }

    /** ALTER TABLE … DETACH PARTITION; the statement run comes back. */
    public function detach(NodeContext $ctx, int $oid, string $mode): string
    {
        $parent = $this->parent($ctx);
        $row = $this->properties($ctx, $oid);
        $sql = PartitionDdl::detachSql($ctx, (string) $parent['schema'], (string) $parent['name'], (string) $row['schema'], (string) $row['name'], $mode);
        $this->execute($ctx, $sql);

        return $sql;
    }

    /**
     * The tables whose columns match the parent's, which may be attached as partitions, as
     * "schema.table" with their OIDs (get_attach_tables.sql).
     *
     * @return list<array{oid: int, table_name: string}>
     */
    public function attachCandidates(NodeContext $ctx): array
    {
        return array_map(static fn (array $r): array => ['oid' => (int) $r['oid'], 'table_name' => $r['table_name']], $ctx->rows('get_attach_tables.sql', ['tid' => $this->tableOid($ctx)]));
    }

    /** @return array<string, mixed> the parent's properties row, with its partitioning scheme */
    private function parent(NodeContext $ctx): array
    {
        $tid = $this->tableOid($ctx);

        return $ctx->conn->row($ctx->renderFrom('tables', 'properties.sql', ['tid' => $tid, 'scid' => $ctx->id('scid'), 'datlastsysoid' => TableDdl::lastSystemOid()]))
            ?? throw $this->notFound('Could not find the table.');
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, $row);
        // A partition that is itself partitioned has partitions of its own under it.
        $node['inode'] = (bool) ($row['is_partitioned'] ?? false);

        return $node;
    }

    protected function icon(NodeContext $ctx, array $row): string
    {
        return 's_tbl';
    }
}
