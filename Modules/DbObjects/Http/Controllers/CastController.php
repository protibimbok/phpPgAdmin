<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\DbObjects\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * The cast node, after pgAdmin's CastView: the casts the database's users made (the system's
 * own, below pgAdmin's last system OID, are left out), and CREATE CAST with a function or
 * WITHOUT FUNCTION, as IMPLICIT, ASSIGNMENT or EXPLICIT, COMMENT ON CAST and DROP CAST. Only
 * a cast's comment can change.
 *
 * The client's data carries pgAdmin's field names: srctyp, trgtyp, proname ("name(args)" of
 * the schema pronspname, or empty for binary compatible), castcontext, description.
 */
final class CastController extends NodeController
{
    public const array CONTEXTS = ['IMPLICIT', 'ASSIGNMENT', 'EXPLICIT'];

    public function list(NodeContext $ctx): array
    {
        return $ctx->rows('properties.sql', ['datlastsysoid' => DatabaseController::LAST_SYSTEM_OID]);
    }

    public function nodes(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->toNode($ctx, $row), $ctx->rows('nodes.sql', ['datlastsysoid' => DatabaseController::LAST_SYSTEM_OID]));
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        return $this->toNode($ctx, $this->properties($ctx, $oid));
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        return $ctx->row('properties.sql', ['cid' => $oid, 'datlastsysoid' => DatabaseController::LAST_SYSTEM_OID, 'showsysobj' => true]) ?? throw $this->gone($ctx);
    }

    public function sql(NodeContext $ctx, int $oid): string
    {
        $data = $this->properties($ctx, $oid);
        if ($data['castfunc'] !== null && (int) $data['castfunc'] !== 0) {
            $data['proname'] = self::qualified((string) $data['pronspname'], (string) $data['proname']);
        }
        $drop = sprintf('DROP CAST IF EXISTS (%s AS %s);', $data['srctyp'], $data['trgtyp']);

        return Ddl::assemble([Ddl::header('Cast', sprintf('(%s AS %s)', $data['srctyp'], $data['trgtyp']), $drop), $ctx->render('create.sql', ['data' => $data])]);
    }

    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($ctx, $data);
        $this->execute($ctx, $ctx->render('create.sql', ['data' => $data]));
        $oid = $ctx->conn->scalar($ctx->render('properties.sql', ['srctyp' => $data['srctyp'], 'trgtyp' => $data['trgtyp']])) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $oid);
    }

    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));

        return $this->node($ctx, $oid);
    }

    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = $ctx->row('delete.sql', ['cid' => $oid]) ?? throw $this->gone($ctx);
        $this->execute($ctx, $ctx->render('delete.sql', ['cid' => null, 'castsource' => $row['castsource'], 'casttarget' => $row['casttarget'], 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        return $oid === null ? $ctx->render('create.sql', ['data' => $this->forCreate($ctx, $data)]) : $this->updateSql($ctx, $oid, $data);
    }

    /**
     * The types a cast may convert between, and with srctyp and trgtyp the functions that can
     * do it, as "schema.name(args)".
     *
     * @return array{types: list<string>, functions: list<string>}
     */
    public function options(NodeContext $ctx, string $source = '', string $target = ''): array
    {
        $functions = $source === '' || $target === '' ? [] : array_map(
            static fn (array $row): string => self::qualified((string) $row['nspname'], (string) $row['proname']),
            $ctx->rows('functions.sql', ['srctyp' => $source, 'trgtyp' => $target]),
        );

        return ['types' => array_values(array_unique(array_column($ctx->rows('getsrcandtrgttype.sql'), 'typname'))), 'functions' => $functions];
    }

    /** "name(args)" in a schema as CREATE CAST names it: "schema"."name"(args). */
    private static function qualified(string $schema, string $signature): string
    {
        $paren = strpos($signature, '(');
        $name = $paren === false ? $signature : substr($signature, 0, $paren);

        return Quoting::ident($schema, $name) . ($paren === false ? '()' : substr($signature, $paren));
    }

    /**
     * The client's data as create.sql takes it. The types go into the statement as the catalog
     * spells them (format_type, quoted where they need it), so they must be types it lists; the
     * function must be one that converts between them.
     *
     * @param array<string, mixed> $data
     */
    private function forCreate(NodeContext $ctx, array $data): array
    {
        $source = trim((string) ($data['srctyp'] ?? ''));
        $target = trim((string) ($data['trgtyp'] ?? ''));
        if ($source === '' || $target === '') {
            throw new BadRequestException('A cast needs a source type and a target type.');
        }
        $options = $this->options($ctx, $source, $target);
        foreach ([$source, $target] as $type) {
            if (!in_array($type, $options['types'], true)) {
                throw new BadRequestException(sprintf('"%s" is not a type a cast can convert.', $type));
            }
        }
        $function = trim((string) ($data['proname'] ?? ''));
        if ($function !== '' && !in_array($function, $options['functions'], true)) {
            throw new BadRequestException(sprintf('%s does not convert %s to %s.', $function, $source, $target));
        }
        $context = strtoupper((string) ($data['castcontext'] ?? 'EXPLICIT'));
        if (!in_array($context, self::CONTEXTS, true)) {
            throw new BadRequestException('A cast is IMPLICIT, ASSIGNMENT or EXPLICIT.');
        }

        return [
            'srctyp' => $source,
            'trgtyp' => $target,
            'proname' => $function,
            'castcontext' => $context,
            'description' => trim((string) ($data['description'] ?? '')),
        ];
    }

    /** @param array<string, mixed> $data */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $old = $this->properties($ctx, $oid);
        $changes = array_key_exists('description', $data) ? ['description' => (string) ($data['description'] ?? '')] : [];

        return $ctx->render('update.sql', ['data' => $changes, 'o_data' => $old]);
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, $row);
        $node['inode'] = false;

        return $node;
    }
}
