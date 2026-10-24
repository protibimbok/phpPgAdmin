<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Databases\Http\Controllers;

use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Nodes\Acl;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Core\Nodes\Options;

/**
 * The database node, after pgAdmin's DatabaseView: the databases of the server, their
 * properties with privileges, default privileges and settings, and the DDL that recreates one.
 */
final class DatabaseController extends NodeController
{
    /** pgAdmin's DATABASE_LAST_SYSTEM_OID: databases with lower OIDs are system objects. */
    public const int LAST_SYSTEM_OID = 16383;

    /** The ACL columns of the properties, each read by its own catalog query. */
    private const array ACL_COLUMNS = ['datacl', 'deftblacl', 'defseqacl', 'deffuncacl', 'deftypeacl'];

    /**
     * Every database the role may see, with the properties pgAdmin's list shows plus the
     * size, for the "Databases" page. The database the session landed in cannot be dropped.
     */
    public function list(NodeContext $ctx): array
    {
        $rows = [];
        foreach ($ctx->rows('properties.sql', ['last_system_oid' => $this->lastSystemOid($ctx)]) as $row) {
            $row['is_sys_obj'] = (int) $row['did'] <= self::LAST_SYSTEM_OID;
            if ($this->skip($ctx, $row)) {
                continue;
            }
            $row['can_drop'] = $row['name'] !== $ctx->conn->database();
            $rows[] = $row;
        }

        return $rows;
    }

    public function nodes(NodeContext $ctx): array
    {
        $nodes = [];
        foreach ($ctx->rows('nodes.sql', ['last_system_oid' => $this->lastSystemOid($ctx)]) as $row) {
            $row['is_sys_obj'] = (int) $row['did'] <= self::LAST_SYSTEM_OID;
            if (!$this->skip($ctx, $row)) {
                $nodes[] = $this->toNode($ctx, $row);
            }
        }

        return $nodes;
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('nodes.sql', ['did' => $oid, 'last_system_oid' => 0]) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    /**
     * The properties pgAdmin's dialog shows: the catalog row, the privileges and default
     * privileges grouped by column, the settings and the security labels. The default
     * privileges are per database, so they are read through a connection to it.
     */
    public function properties(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('properties.sql', ['did' => $oid, 'last_system_oid' => 0]) ?? throw $this->gone($ctx);

        return $this->complete($ctx, $row, $oid, grantRevoke: false);
    }

    /**
     * The DDL that recreates the database: pgAdmin's header and commented DROP, the CREATE from
     * create.sql, then the comment, settings, privileges and default privileges from grant.sql.
     */
    public function sql(NodeContext $ctx, int $oid): string
    {
        $row = $ctx->row('properties.sql', ['did' => $oid, 'last_system_oid' => 0]) ?? throw $this->gone($ctx);
        $data = $this->complete($ctx, $row, $oid, grantRevoke: true);

        // delete.sql also looks the name up when "did" is set; here the name is known.
        $header = Ddl::header('Database', $data['name'], $ctx->render('delete.sql', ['did' => null, 'datname' => $data['name']]));

        return Ddl::assemble([$header, $this->createSql($ctx, $data)]);
    }

    public function statistics(NodeContext $ctx, ?int $oid): array
    {
        $result = $ctx->query('stats.sql', ['did' => $oid, 'last_system_oid' => $this->lastSystemOid($ctx)]);

        return [
            'columns' => array_map(static fn ($c): array => ['name' => $c->name, 'type' => $c->typeName], $result->columns()),
            'rows' => $result->rows(),
        ];
    }

    /** A database by name: resolve('database', {name}) → {did}. */
    public function resolve(NodeContext $ctx, array $params): ?array
    {
        $name = (string) ($params['name'] ?? '');
        if ($name === '') {
            return null;
        }

        $oid = $ctx->conn->scalar('SELECT oid FROM pg_catalog.pg_database WHERE datname = $1', [$name]);

        return $oid === null ? null : ['did' => (int) $oid];
    }

    /**
     * CREATE DATABASE plus the statements that cannot share its transaction (grant.sql), with
     * the ACL columns turned into template rows per allowed_privs.json: pgAdmin's get_new_sql.
     *
     * @param array<string, mixed> $data
     */
    private function createSql(NodeContext $ctx, array $data): string
    {
        /** @var array<string, array{type: string, acl: list<string>}> $allowed */
        $allowed = json_decode($ctx->render('allowed_privs.json'), true, flags: JSON_THROW_ON_ERROR);

        foreach ($allowed as $column => $spec) {
            if (isset($data[$column]) && is_array($data[$column])) {
                $data[$column] = Acl::toDb($data[$column], $spec['acl']);
            }
        }

        // Jinja prints a boolean as True/False where Twig prints 1 or nothing; the template writes it out.
        $data['is_template'] = ($data['is_template'] ?? false) ? 'true' : 'false';

        return Ddl::assemble([$ctx->render('create.sql', ['data' => $data]), $ctx->render('grant.sql', ['data' => $data])]);
    }

    /**
     * Add to a properties row what pgAdmin's formatdbacl and the variable/label parsers add.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function complete(NodeContext $ctx, array $row, int $oid, bool $grantRevoke): array
    {
        $own = $this->connectionTo($ctx, (string) $row['name']);

        foreach ($ctx->conn->rows($ctx->render('acl.sql', ['did' => $oid])) as $acl) {
            $row[$acl['deftype']][] = Acl::fromDb($acl);
        }

        // Default privileges live in the database itself; the maintenance connection sees only its own.
        if ($own !== null) {
            foreach ($own->rows($ctx->render('defacl.sql', ['did' => $oid, 'grant_reovke_sql' => $grantRevoke])) as $acl) {
                $row[$acl['deftype']][] = Acl::fromDb($acl);
            }
        }

        foreach (self::ACL_COLUMNS as $column) {
            $row[$column] ??= [];
        }

        $row['is_sys_obj'] = (int) $row['oid'] <= self::LAST_SYSTEM_OID;
        $row['variables'] = Options::parseVariables($ctx->conn->rows($ctx->render('get_variables.sql', ['did' => $oid])));
        $row['seclabels'] = Options::parseSecurityLabels($row['seclabels'] ?? null);

        return $row;
    }

    /** A connection to the database itself, or null when the role may not open one. */
    private function connectionTo(NodeContext $ctx, string $name): ?Connection
    {
        if ($name === $ctx->conn->database()) {
            return $ctx->conn;
        }

        try {
            return $ctx->pool->for($name);
        } catch (\PhpPgAdmin\Core\Database\ConnectionException) {
            return null;
        }
    }

    /** pgAdmin hides system databases and templates unless asked to; "postgres" always shows. */
    private function lastSystemOid(NodeContext $ctx): int
    {
        return $ctx->flag('system_objects') ? 0 : self::LAST_SYSTEM_OID;
    }

    /** @param array<string, mixed> $row */
    private function skip(NodeContext $ctx, array $row): bool
    {
        if (in_array($row['name'], ['postgres', 'edb'], true)) {
            return false;
        }

        $showSystem = $ctx->flag('system_objects');
        $showTemplates = $ctx->flag('templates');

        if ((!$showSystem || !$showTemplates) && $row['is_sys_obj']) {
            return true;
        }

        return !$showTemplates && $row['is_template'] && !$row['is_sys_obj'];
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, ['oid' => $row['did'], ...$row]);
        $node['inode'] = (bool) ($row['datallowconn'] ?? true);

        return $node;
    }

    protected function icon(NodeContext $ctx, array $row): string
    {
        return ($row['is_template'] ?? false) ? 's_db' : 's_db';
    }
}
