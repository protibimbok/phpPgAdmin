<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sequences\Http\Controllers;

use PhpPgAdmin\Core\Nodes\Acl;
use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\Options;
use PhpPgAdmin\Core\Nodes\RelationController;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * The sequence node, after pgAdmin's SequenceView: the sequences of a schema with their
 * definition (current value, increment, bounds, cache, cycle, owning column), and the
 * statements that create, alter and drop one.
 *
 * The client's data carries pgAdmin's field names: name, schema, seqowner, comment,
 * current_value, increment, start, minimum, maximum, cache, cycled, relpersistence (true
 * for UNLOGGED), owned_table, owned_column, relacl, securities.
 */
final class SequenceController extends RelationController
{
    /** The privilege codes a sequence accepts. */
    private const array ACL = ['r', 'w', 'U'];

    private const array DEFINITION = ['current_value' => 'last_value', 'minimum' => 'min_value', 'maximum' => 'max_value', 'increment' => 'increment_by', 'start' => 'start_value', 'cache' => 'cache_value', 'cycled' => 'is_cycled'];

    protected function relkinds(): array
    {
        return ['S'];
    }

    /** Every sequence of the schema with its definition read from pg_sequence. */
    public function list(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->withDefinition($ctx, $row), parent::list($ctx));
    }

    /** The properties with the definition, privileges and security labels, as pgAdmin's dialog reads them. */
    public function properties(NodeContext $ctx, int $oid): array
    {
        return $this->format($ctx, $this->withDefinition($ctx, parent::properties($ctx, $oid)), $oid);
    }

    /** The "SQL" tab: the commented header and DROP, CREATE SEQUENCE IF NOT EXISTS with the definition, then owner, comment, labels and grants. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        $data = $this->properties($ctx, $oid);
        $data['relacl'] = Acl::toDb($data['relacl'], self::ACL);

        $header = sprintf("-- SEQUENCE: %s.%s\n\n-- DROP SEQUENCE IF EXISTS %s;", $data['schema'], $data['name'], \PhpPgAdmin\Core\Database\Quoting::ident((string) $data['schema'], (string) $data['name']));

        return Ddl::assemble([$header, $ctx->render('create.sql', ['data' => $data, 'add_not_exists_clause' => true]), $ctx->render('grant.sql', ['data' => $data])]);
    }

    /** CREATE SEQUENCE, then its owner, comment, labels and grants; the new sequence's node. */
    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($ctx, $data);
        // CREATE cannot share a statement batch with what follows it; the grants run apart.
        $this->execute($ctx, $ctx->render('create.sql', ['data' => $data]));
        $this->execute($ctx, $ctx->render('grant.sql', ['data' => $data]));

        $row = $ctx->row('get_oid.sql', ['name' => $data['name'], 'schema' => $data['schema']]) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $row['oid']);
    }

    /** The ALTERs for what the client's data changes; the node is read in the schema the sequence is in afterwards. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));
        $scid = (int) $ctx->conn->scalar('SELECT relnamespace FROM pg_catalog.pg_class WHERE oid = $1', [$oid]);
        $row = $ctx->row('nodes.sql', [...$this->vars($ctx, $oid), 'scid' => $scid]) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    /** DROP SEQUENCE, CASCADE on request. */
    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = parent::properties($ctx, $oid);
        $this->execute($ctx, $ctx->render('delete.sql', ['data' => $row, 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid === null) {
            $data = $this->forCreate($ctx, $data);

            return Ddl::assemble([$ctx->render('create.sql', ['data' => $data]), $ctx->render('grant.sql', ['data' => $data])]);
        }

        return $this->updateSql($ctx, $oid, $data);
    }

    /**
     * ALTER SEQUENCE … RESTART, at the given value or the sequence's start: the classic
     * phpPgAdmin's "Reset" and "Restart".
     */
    public function restart(NodeContext $ctx, int $oid, ?string $value): void
    {
        if ($value !== null && filter_var($value, FILTER_VALIDATE_INT) === false && preg_match('/^-?\d+$/', $value) !== 1) {
            throw new \League\Route\Http\Exception\BadRequestException('A sequence restarts at a whole number.');
        }
        $row = parent::properties($ctx, $oid);
        $this->execute($ctx, sprintf('ALTER SEQUENCE %s RESTART%s;', \PhpPgAdmin\Core\Database\Quoting::ident((string) $row['schema'], (string) $row['name']), $value === null ? '' : ' WITH ' . $value));
    }

    /** nextval(): the classic phpPgAdmin's "Next value", which advances the sequence and returns the value. */
    public function nextValue(NodeContext $ctx, int $oid): string
    {
        return (string) $ctx->conn->scalar('SELECT pg_catalog.nextval($1::oid::regclass)::text', [$oid]);
    }

    /** pg_statio_all_sequences for one sequence, or for every one of the schema. */
    public function statistics(NodeContext $ctx, ?int $oid): array
    {
        $result = $oid === null
            ? $ctx->query('coll_stats.sql', ['schema_name' => $this->schemaName($ctx)])
            : $ctx->query('stats.sql', ['seid' => $oid]);

        return [
            'columns' => array_map(static fn ($c): array => ['name' => $c->name, 'type' => $c->typeName], $result->columns()),
            'rows' => $result->rows(),
        ];
    }

    /**
     * What the editor offers: the roles, the schemas, and the schema's tables with their
     * columns for OWNED BY.
     *
     * @return array{roles: list<string>, schemas: list<string>, tables: list<array{name: string, columns: list<string>}>}
     */
    public function options(NodeContext $ctx): array
    {
        $tables = [];
        $rows = $ctx->conn->rows(
            "SELECT c.relname, a.attname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
             WHERE c.relnamespace = $1 AND c.relkind IN ('r', 'p') ORDER BY c.relname, a.attnum",
            [$ctx->id('scid')],
        );
        foreach ($rows as $row) {
            $tables[$row['relname']][] = $row['attname'];
        }

        return [
            'roles' => Catalog::roles($ctx->conn),
            'schemas' => Catalog::schemas($ctx->conn),
            'tables' => array_map(static fn (string $name, array $columns): array => ['name' => $name, 'columns' => $columns], array_keys($tables), $tables),
        ];
    }

    /**
     * update.sql against the sequence as it stands: pgAdmin's get_SQL in edit mode, with the
     * RESTART it adds when new bounds would leave the sequence outside them.
     *
     * @param array<string, mixed> $data
     */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $old = $this->properties($ctx, $oid);
        if (trim((string) ($data['name'] ?? '')) === '') {
            $data['name'] = $old['name'];
        }
        if (isset($data['relacl']) && is_array($data['relacl']) && !array_is_list($data['relacl'])) {
            foreach (['added', 'changed', 'deleted'] as $mode) {
                if (isset($data['relacl'][$mode])) {
                    $data['relacl'][$mode] = Acl::toDb($data['relacl'][$mode], self::ACL);
                }
            }
        }
        // A value equal to the current one is no change; the editor may send the whole form.
        foreach (['seqowner', 'comment', 'increment', 'start', 'minimum', 'maximum', 'cache', 'cycled', 'relpersistence', 'current_value', 'schema'] as $key) {
            if (!array_key_exists($key, $data)) {
                continue;
            }
            if ($data[$key] === '' || $data[$key] === null) {
                if (in_array($key, ['increment', 'start', 'minimum', 'maximum', 'cache', 'current_value'], true)) {
                    unset($data[$key]);
                }
                continue;
            }
            $same = is_bool($old[$key] ?? null) ? filter_var($data[$key], FILTER_VALIDATE_BOOL) === $old[$key] : (string) $data[$key] === (string) ($old[$key] ?? '');
            if ($same) {
                unset($data[$key]);
            }
        }
        if (array_key_exists('owned_table', $data) && (string) ($data['owned_table'] ?? '') === (string) ($old['owned_table'] ?? '') && (string) ($data['owned_column'] ?? '') === (string) ($old['owned_column'] ?? '')) {
            unset($data['owned_table'], $data['owned_column']);
        }

        // PostgreSQL refuses bounds that leave the sequence outside them: move it onto the nearest.
        if (isset($data['minimum']) || isset($data['maximum'])) {
            $current = $data['current_value'] ?? $old['current_value'] ?? null;
            if ($current !== null) {
                if (isset($data['minimum']) && (int) $data['minimum'] > (int) $current) {
                    $data['restart'] = (int) $data['minimum'];
                } elseif (isset($data['maximum']) && (int) $data['maximum'] < (int) $current) {
                    $data['restart'] = (int) $data['maximum'];
                }
            }
        }

        return $ctx->render('update.sql', ['data' => $data, 'o_data' => $old]);
    }

    /**
     * The client's data as create.sql and grant.sql take it: in the route's schema, blank
     * numbers dropped, the privileges as template rows.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function forCreate(NodeContext $ctx, array $data): array
    {
        $data['name'] = $this->requireName($data);
        $data['schema'] = $this->schemaName($ctx);
        foreach (['increment', 'start', 'minimum', 'maximum', 'cache', 'current_value'] as $key) {
            if (array_key_exists($key, $data) && ($data[$key] === '' || $data[$key] === null)) {
                unset($data[$key]);
            }
        }
        foreach (['seqowner', 'comment', 'owned_table', 'owned_column'] as $key) {
            if (array_key_exists($key, $data) && trim((string) ($data[$key] ?? '')) === '') {
                unset($data[$key]);
            }
        }
        if (isset($data['relacl']) && is_array($data['relacl'])) {
            $data['relacl'] = Acl::toDb($data['relacl'], self::ACL);
        }

        return $data;
    }

    /** The definition columns of pg_sequence merged into the row, as pgAdmin's _fetch_properties does. */
    private function withDefinition(NodeContext $ctx, array $row): array
    {
        $definition = $ctx->row('get_def.sql', ['data' => $row]) ?? [];
        // The bigint values go out as strings: a JSON number loses digits above 2^53 in the browser.
        foreach (self::DEFINITION as $key => $column) {
            $value = $definition[$column] ?? null;
            $row[$key] = is_int($value) ? (string) $value : $value;
        }
        $row['is_called'] = $definition['is_called'] ?? null;
        $row['is_sys_obj'] = (int) $row['oid'] <= DatabaseController::LAST_SYSTEM_OID;

        return $row;
    }

    /** pgAdmin's _formatter: the security labels as objects and the privileges under relacl. */
    private function format(NodeContext $ctx, array $row, int $oid): array
    {
        $row['securities'] = Options::parseSecurityLabels($row['securities'] ?? null);
        $row['relacl'] = [];
        foreach ($ctx->rows('acl.sql', ['scid' => $ctx->id('scid'), 'seid' => $oid]) as $acl) {
            $row[$acl['deftype']][] = Acl::fromDb($acl);
        }

        return $row;
    }

    private function schemaName(NodeContext $ctx): string
    {
        return (string) ($ctx->conn->scalar('SELECT nspname FROM pg_catalog.pg_namespace WHERE oid = $1', [$ctx->id('scid')]) ?? throw $this->notFound('Could not find the schema.'));
    }

    protected function icon(NodeContext $ctx, array $row): string
    {
        return 'b_events';
    }
}
