<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Tables\Ddl\ConstraintSql;

/**
 * Shared ground for the constraint nodes: the statements that add, alter and drop one come
 * from ConstraintSql by the node's type.
 */
abstract class ConstraintController extends TableChildController
{
    /** The constraint type ConstraintSql knows: primary_key, unique_constraint, foreign_key… */
    abstract protected function constraintKind(): string;

    public function create(NodeContext $ctx, array $data): array
    {
        [$schema, $table] = $this->parent($ctx);
        $this->execute($ctx, ConstraintSql::createSql($ctx, $this->constraintKind(), $schema, $table, $data));

        return $this->node($ctx, $this->oidOfCreated($ctx, $data));
    }

    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        [$schema, $table] = $this->parent($ctx);
        $this->execute($ctx, ConstraintSql::updateSql($ctx, $this->constraintKind(), (int) $ctx->id('tid'), $schema, $table, $oid, $data));

        return $this->node($ctx, $oid);
    }

    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        [$schema, $table] = $this->parent($ctx);
        $old = ConstraintSql::current($ctx, $this->constraintKind(), (int) $ctx->id('tid'), $oid);
        $this->execute($ctx, ConstraintSql::deleteSql($ctx, $this->constraintKind(), $schema, $table, (string) $old['name'], $cascade));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        [$schema, $table] = $this->parent($ctx);
        if ($oid === null) {
            return ConstraintSql::createSql($ctx, $this->constraintKind(), $schema, $table, $data);
        }

        return ConstraintSql::updateSql($ctx, $this->constraintKind(), (int) $ctx->id('tid'), $schema, $table, $oid, $data);
    }

    /** @return array{0: string, 1: string} */
    protected function parent(NodeContext $ctx): array
    {
        $row = $ctx->conn->row($ctx->renderFrom('foreign_key', 'get_parent.sql', ['tid' => $ctx->id('tid')])) ?? throw $this->notFound('Could not find the table.');

        return [(string) $row['schema'], (string) $row['table']];
    }

    /**
     * The OID of the constraint just added: by name when the client named it, else the newest
     * constraint of the type on the table.
     *
     * @param array<string, mixed> $data
     */
    private function oidOfCreated(NodeContext $ctx, array $data): int
    {
        $name = trim((string) ($data['name'] ?? ''));
        if ($name !== '') {
            $oid = ConstraintSql::oidOf($ctx, $this->constraintKind(), (int) $ctx->id('tid'), $name);
            if ($oid !== null) {
                return $oid;
            }
        }
        $contype = ConstraintSql::CONTYPES[$this->constraintKind()];
        $byIndex = in_array($contype, ['p', 'u', 'x'], true);
        $oid = $ctx->conn->scalar(
            sprintf('SELECT %s FROM pg_catalog.pg_constraint WHERE conrelid = $1 AND contype = $2 ORDER BY oid DESC LIMIT 1', $byIndex ? 'conindid' : 'oid'),
            [$ctx->id('tid'), $contype],
        );

        return (int) ($oid ?? throw $this->gone($ctx));
    }
}
