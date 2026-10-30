<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\RelationController;
use PhpPgAdmin\Modules\Tables\Ddl\ConstraintSql;
use PhpPgAdmin\Modules\Tables\Ddl\Constraints;
use PhpPgAdmin\Modules\Tables\Ddl\TableDdl;
use PhpPgAdmin\Modules\Tables\Ddl\TableSql;

/**
 * The table node, after pgAdmin's TableView: the tables of a schema (partitions are shown under
 * their parent), with pgAdmin's properties row per table, and the statements that create,
 * alter, truncate, copy and drop one.
 */
final class TableController extends RelationController
{
    protected function relkinds(): array
    {
        return ['r', 's', 't', 'p'];
    }

    /** The properties with privileges, columns and constraints, as pgAdmin's dialog reads them. */
    public function properties(NodeContext $ctx, int $oid): array
    {
        return TableDdl::properties($ctx, $oid, parent::properties($ctx, $oid));
    }

    /** The "SQL" tab: the DDL that recreates the table with its constraints, comments and indexes. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        return TableDdl::sql($ctx, $oid, parent::properties($ctx, $oid));
    }

    /** CREATE TABLE from the client's data, then its indexes; the new table's node. */
    public function create(NodeContext $ctx, array $data): array
    {
        $created = TableSql::create($ctx, $data);
        // All or nothing: a failing index or partition leaves no table behind.
        $ctx->conn->transaction(function () use ($ctx, $created): void {
            $this->execute($ctx, $created['sql']);
            foreach ($created['indexes'] as $index) {
                $this->execute($ctx, $index);
            }
        });

        return $this->node($ctx, $this->oidOf($ctx, $created['name']));
    }

    /** ALTER TABLE for what the client's data changes, with its columns, constraints and indexes. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $old = $this->properties($ctx, $oid);
        $this->execute($ctx, TableSql::update($ctx, $oid, $data, $old));

        // A table moved to another schema is no longer under this route's schema.
        $schema = $ctx->conn->row($ctx->renderFrom('tables', 'get_schema_oid.sql', ['tid' => $oid]));
        if ($schema !== null && (int) $schema['scid'] !== $ctx->id('scid')) {
            return ['id' => 'table_' . $oid, 'oid' => $oid, 'label' => (string) ($data['name'] ?? $old['name']), 'type' => 'table', 'icon' => 's_tbl', 'inode' => true, 'meta' => ['schema' => $schema['nspname'], 'scid' => (int) $schema['scid']]];
        }

        return $this->node($ctx, $oid);
    }

    /** DROP TABLE, CASCADE on request. */
    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = parent::properties($ctx, $oid);
        $this->execute($ctx, $ctx->render('delete.sql', ['data' => $row, 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid === null) {
            $created = TableSql::create($ctx, $data);

            return Ddl::assemble([$created['sql'], ...$created['indexes']]);
        }

        return TableSql::update($ctx, $oid, $data, $this->properties($ctx, $oid));
    }

    /** TRUNCATE TABLE, with RESTART IDENTITY and CASCADE on request (pgAdmin's truncate). */
    public function truncate(NodeContext $ctx, int $oid, bool $cascade, bool $identity): string
    {
        $row = parent::properties($ctx, $oid);
        $sql = $ctx->render('truncate.sql', ['data' => $row, 'cascade' => $cascade, 'identity' => $identity]);
        $this->execute($ctx, $sql);

        return $sql;
    }

    /**
     * The statements that copy the table to another name (and schema): CREATE TABLE … (LIKE …
     * INCLUDING ALL) for the structure, INSERT … SELECT for the data, the foreign keys when
     * asked, DROP TABLE IF EXISTS first when asked. phpMyAdmin's "Copy table to".
     *
     * @param array{schema?: string, name?: string, what?: string, drop_if_exists?: bool, add_constraints?: bool} $data
     */
    public function copySql(NodeContext $ctx, int $oid, array $data): string
    {
        $source = parent::properties($ctx, $oid);
        $name = trim((string) ($data['name'] ?? ''));
        if ($name === '') {
            throw new BadRequestException('Could not find the required parameter (name).');
        }
        $schema = trim((string) ($data['schema'] ?? '')) ?: (string) $source['schema'];
        $what = (string) ($data['what'] ?? 'data');
        $from = Quoting::ident((string) $source['schema'], (string) $source['name']);
        $to = Quoting::ident($schema, $name);

        $parts = [];
        if (!empty($data['drop_if_exists']) && $what !== 'dataonly') {
            $parts[] = sprintf('DROP TABLE IF EXISTS %s;', $to);
        }
        if ($what !== 'dataonly') {
            $parts[] = sprintf("CREATE TABLE %s\n    (LIKE %s INCLUDING ALL);", $to, $from);
        }
        if ($what !== 'structure') {
            $parts[] = sprintf("INSERT INTO %s\n    SELECT * FROM %s;", $to, $from);
        }
        // LIKE copies a SERIAL column's default as it is, pointing at the source table's sequence;
        // the copy gets sequences of its own, moved past the rows it received.
        if ($what !== 'dataonly') {
            foreach ($this->serialColumns($ctx, $oid) as $column) {
                $sequence = Quoting::ident($schema, sprintf('%s_%s_seq', $name, $column['attname']));
                $parts[] = sprintf("CREATE SEQUENCE %s AS %s OWNED BY %s.%s;", $sequence, $column['typname'], $to, Quoting::ident($column['attname']));
                $parts[] = sprintf("ALTER TABLE %s\n    ALTER COLUMN %s SET DEFAULT nextval('%s'::regclass);", $to, Quoting::ident($column['attname']), str_replace("'", "''", $sequence));
                if ($what !== 'structure') {
                    $parts[] = sprintf("SELECT setval('%s', max(%s)) FROM %s HAVING max(%s) IS NOT NULL;", str_replace("'", "''", $sequence), Quoting::ident($column['attname']), $to, Quoting::ident($column['attname']));
                }
            }
        }
        if (!empty($data['add_constraints']) && $what !== 'dataonly') {
            foreach (Constraints::foreignKeys($ctx, $oid) as $fk) {
                $parts[] = ConstraintSql::createSql($ctx, 'foreign_key', $schema, $name, [...$fk, 'name' => null, 'comment' => null, 'autoindex' => false]);
            }
        }

        return Ddl::assemble($parts);
    }

    /**
     * The columns whose default draws on a sequence the table owns: SERIAL columns.
     *
     * @return list<array{attname: string, typname: string}>
     */
    private function serialColumns(NodeContext $ctx, int $oid): array
    {
        return $ctx->conn->rows(
            'SELECT a.attname, pg_catalog.format_type(a.atttypid, NULL) AS typname
             FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
             JOIN pg_catalog.pg_depend dep ON dep.classid = \'pg_class\'::regclass AND dep.refobjid = a.attrelid AND dep.refobjsubid = a.attnum AND dep.deptype = \'a\'
             JOIN pg_catalog.pg_class s ON s.oid = dep.objid AND s.relkind = \'S\'
             WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped AND a.attidentity = \'\'
               AND pg_catalog.pg_get_expr(d.adbin, d.adrelid) LIKE \'nextval(%\'
             ORDER BY a.attnum',
            [$oid],
        );
    }

    /**
     * The table's relations to others, as the classic phpPgAdmin's table Info page shows them:
     * the foreign keys that reference it, the tables it inherits from and the tables (or
     * partitions, with their bounds) that inherit from it.
     *
     * @return array{referenced_by: list<array<string, mixed>>, parents: list<array<string, mixed>>, children: list<array<string, mixed>>}
     */
    public function relations(NodeContext $ctx): array
    {
        $tid = (int) $ctx->id('tid');

        return [
            'referenced_by' => $ctx->rows('referenced_by.sql', ['tid' => $tid]),
            'parents' => $ctx->rows('inheritance.sql', ['tid' => $tid, 'parents' => true]),
            'children' => $ctx->rows('inheritance.sql', ['tid' => $tid, 'parents' => false]),
        ];
    }

    /**
     * What the create and alter forms offer: the types, collations, roles, tablespaces, schemas
     * and table access methods, and the index access methods.
     *
     * @return array<string, mixed>
     */
    public function options(NodeContext $ctx): array
    {
        return [
            'types' => array_map(static fn (array $r): array => ['name' => $r['typname'], 'schema' => $r['nspname'], 'kind' => $r['typtype']], $ctx->conn->rows($ctx->renderFrom('columns', 'get_types.sql'))),
            'collations' => Catalog::collations($ctx->conn),
            'roles' => Catalog::roles($ctx->conn),
            'tablespaces' => Catalog::tablespaces($ctx->conn),
            'schemas' => Catalog::schemas($ctx->conn),
            'access_methods' => array_column($ctx->conn->rows($ctx->render('get_access_methods.sql')), 'amname'),
            // pgAdmin's get_am.sql lists every access method, table ones included; the dialogs want the index ones,
            // and the exclusion form only those that can back an exclusion constraint (gin and brin cannot).
            'index_methods' => array_column($ctx->conn->rows("SELECT amname FROM pg_catalog.pg_am WHERE amtype = 'i' ORDER BY amname"), 'amname'),
            'exclusion_methods' => array_column($ctx->conn->rows("SELECT amname FROM pg_catalog.pg_am WHERE amtype = 'i' AND pg_catalog.pg_indexam_has_property(oid, 'can_exclude') ORDER BY amname"), 'amname'),
            // The index methods that take INCLUDE columns (btree, gist, spgist).
            'include_methods' => array_column($ctx->conn->rows("SELECT amname FROM pg_catalog.pg_am WHERE amtype = 'i' AND pg_catalog.pg_indexam_has_property(oid, 'can_include') ORDER BY amname"), 'amname'),
            // The tables a table may inherit from, as the INHERITS clause names them (schema-qualified
            // outside the search path's catalogs), with their OIDs so a table leaves itself out.
            'inherits' => array_map(
                static fn (array $r): array => ['oid' => (int) $r['oid'], 'schema' => $r['nspname'], 'name' => $r['relname'], 'inherits' => $r['inherits']],
                $ctx->conn->rows($ctx->render('get_inherits.sql', ['show_system_objects' => false, 'server_type' => 'pg'])),
            ),
        ];
    }

    /**
     * What the exclusion constraint form offers for an access method and the types of the
     * columns picked: the method's non-default operator classes and, per type, the operators
     * that have a commutator (pgAdmin's get_oper_class and get_operator).
     *
     * @param list<string> $types
     * @return array{oper_classes: list<string>, operators: array<string, list<string>>}
     */
    public function exclusionOptions(NodeContext $ctx, string $am, array $types): array
    {
        $operators = [];
        foreach (array_unique(array_filter($types, static fn (string $t): bool => $t !== '')) as $type) {
            // The type's own operators first, then those of the polymorphic pseudo-type it fits (&& for a range is anyrange's).
            $own = array_column($ctx->conn->rows($ctx->renderFrom('exclusion_constraint', 'get_operator.sql', ['type' => $type, 'show_sysobj' => false])), 'oprname');
            $any = array_column($ctx->conn->rows($ctx->renderFrom('exclusion_constraint', 'get_operator_any.sql', ['type' => $type])), 'oprname');
            $operators[$type] = array_values(array_unique([...$own, ...$any]));
        }

        return [
            'oper_classes' => $am === '' ? [] : array_column($ctx->conn->rows($ctx->renderFrom('exclusion_constraint', 'get_oper_class.sql', ['indextype' => $am])), 'opcname'),
            'operators' => $operators,
        ];
    }

    /** The exact row count, which the structure page asks for on demand (pgAdmin's count_rows). */
    public function countRows(NodeContext $ctx, int $oid): int
    {
        $row = $ctx->row('nodes.sql', $this->vars($ctx, $oid)) ?? throw $this->gone($ctx);
        $schema = (string) $ctx->conn->scalar('SELECT nspname FROM pg_catalog.pg_namespace WHERE oid = $1', [$ctx->id('scid')]);

        return (int) $ctx->conn->scalar($ctx->render('get_table_row_count.sql', ['data' => ['schema' => $schema, 'name' => $row['name']]]));
    }

    private function oidOf(NodeContext $ctx, string $name): int
    {
        return (int) ($ctx->conn->scalar($ctx->render('get_oid.sql', ['data' => ['name' => $name]])) ?? throw $this->gone($ctx));
    }

    protected function icon(NodeContext $ctx, array $row): string
    {
        return 's_tbl';
    }
}
