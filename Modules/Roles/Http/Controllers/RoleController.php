<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Roles\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\ConnectionException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Core\Nodes\Options;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * The role node, after pgAdmin's RoleView: login and group roles with their attributes,
 * memberships both ways, per-database settings and the statements that create, alter and drop
 * one, plus REASSIGN OWNED / DROP OWNED.
 *
 * The client's data carries pgAdmin's field names: rolname, rolcanlogin, rolsuper, rolcreatedb,
 * rolcreaterole, rolinherit, rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil,
 * rolpassword, description, rolmembership and rolmembers ([{role, admin, inherit, set}]),
 * variables ([{name, value, database}]). An update takes the whole form; what differs from the
 * role as it stands is what changes.
 */
final class RoleController extends NodeController
{
    /** The attributes ALTER ROLE ... WITH sets, as update.sql's alterKeys. */
    private const array ATTRIBUTES = ['rolcanlogin', 'rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolinherit', 'rolreplication', 'rolbypassrls'];

    private const array ALTER_KEYS = [...self::ATTRIBUTES, 'rolconnlimit', 'rolvaliduntil', 'rolpassword'];

    /** Every role with its memberships, and whether it has a password when the session may see that. */
    public function list(NodeContext $ctx): array
    {
        $passwords = $this->passwords($ctx);

        return array_map(function (array $row) use ($ctx, $passwords): array {
            $row = $this->transform($ctx, $row);
            $row['has_password'] = $passwords === null ? null : isset($passwords[$row['oid']]);

            return $row;
        }, $ctx->rows('properties.sql'));
    }

    public function nodes(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->toNode($ctx, $row), $ctx->rows('nodes.sql'));
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        return $this->toNode($ctx, $ctx->row('nodes.sql', ['rid' => $oid]) ?? throw $this->gone($ctx));
    }

    /** The row with its members, settings, and whether the session may manage its membership. */
    public function properties(NodeContext $ctx, int $oid): array
    {
        $row = $this->transform($ctx, $ctx->row('properties.sql', ['rid' => $oid]) ?? throw $this->gone($ctx));
        $row['variables'] = $ctx->rows('variables.sql', ['rid' => $oid]);
        $row['has_admin_option'] = (bool) ($ctx->row('permission.sql', ['rid' => $oid])['has_admin_option'] ?? false);
        $passwords = $this->passwords($ctx);
        $row['has_password'] = $passwords === null ? null : isset($passwords[$oid]);
        $row['is_current'] = $row['rolname'] === $ctx->conn->scalar('SELECT current_user');

        return $row;
    }

    /** sql.sql: CREATE ROLE with the attributes, then the grants, settings, comment and labels. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        $sql = $ctx->conn->scalar($ctx->render('sql.sql', ['rid' => $oid, 'show_password' => $this->isSuperuser($ctx)])) ?? throw $this->gone($ctx);

        return trim((string) $sql, "\n");
    }

    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($ctx, $data);
        $this->execute($ctx, $ctx->render('create.sql', ['data' => $data, 'dummy' => false]));

        $oid = $ctx->conn->scalar('SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1', [$data['rolname']]) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $oid);
    }

    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data, dummy: false));

        return $this->node($ctx, $oid);
    }

    /** DROP ROLE; the objects it owns must have been reassigned or dropped first. */
    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $name = $this->name($ctx, $oid);
        $ctx->conn->query(sprintf('DROP ROLE %s;', Quoting::ident($name)));
    }

    /** What create() or update() would run, the password masked as pgAdmin's msql masks it. */
    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid === null) {
            return Ddl::assemble([$ctx->render('create.sql', ['data' => $this->forCreate($ctx, $data), 'dummy' => true])]);
        }

        return Ddl::assemble([$this->updateSql($ctx, $oid, $data, dummy: true)]);
    }

    /** A role by name: resolve('role', {name}) → {rid}. */
    public function resolve(NodeContext $ctx, array $params): ?array
    {
        $oid = $ctx->conn->scalar('SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1', [(string) ($params['name'] ?? '')]);

        return $oid === null ? null : ['rid' => (int) $oid];
    }

    /**
     * What the editor offers: the other roles to be a member of or to have as members, the
     * databases a setting may be limited to, the settings a role may set (pgAdmin's voptions),
     * and whether a membership carries INHERIT and SET options of its own (16 and later).
     *
     * @return array{roles: list<string>, databases: list<string>, variables: list<array<string, mixed>>, membership_options: bool}
     */
    public function options(NodeContext $ctx): array
    {
        return [
            'membership_options' => $ctx->version() >= 160000,
            'roles' => array_column($ctx->conn->rows('SELECT rolname FROM pg_catalog.pg_roles ORDER BY rolname'), 'rolname'),
            'databases' => Catalog::databases($ctx->conn),
            'variables' => $ctx->conn->rows(
                "SELECT name, vartype, min_val, max_val, enumvals, short_desc FROM pg_catalog.pg_settings WHERE context IN ('user', 'superuser') ORDER BY name",
            ),
        ];
    }

    /**
     * REASSIGN OWNED BY the role TO another, or DROP OWNED BY it, in one database: pgAdmin's
     * role_reassign_own. Both work on the database they run in, so the statement goes through a
     * connection to it.
     *
     * @param array{database?: string, operation?: string, new_role?: string, cascade?: bool} $data
     */
    public function reassign(NodeContext $ctx, int $oid, array $data, bool $run): string
    {
        $database = trim((string) ($data['database'] ?? ''));
        if ($database === '') {
            throw new BadRequestException('A database is required.');
        }
        $reassign = ($data['operation'] ?? 'reassign') === 'reassign';
        $newRole = trim((string) ($data['new_role'] ?? ''));
        if ($reassign && $newRole === '') {
            throw new BadRequestException('The role to reassign the objects to is required.');
        }

        $sql = trim($ctx->render('reassign_own.sql', ['rid' => null, 'data' => [
            'is_reassign' => $reassign,
            'old_role_name' => $this->name($ctx, $oid),
            'new_role_name' => $newRole,
            'drop_with_cascade' => (bool) ($data['cascade'] ?? false),
        ]])) . ';';

        if ($run) {
            try {
                $ctx->pool->for($database)->query($sql);
            } catch (ConnectionException $e) {
                throw new BadRequestException($e->getMessage());
            }
        }

        return $sql;
    }

    /**
     * pgAdmin's transform: the memberships as [{role, admin, inherit, set}] ("111name" before
     * 16 is "1name"), the security labels as objects, the password never sent back.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function transform(NodeContext $ctx, array $row): array
    {
        $row['oid'] = (int) $row['oid'];
        $row['rolpassword'] = '';
        $row['rolmembership'] = $this->memberships($ctx, $row['rolmembership'] ?? null);
        if (array_key_exists('rolmembers', $row)) {
            $row['rolmembers'] = $this->memberships($ctx, $row['rolmembers']);
        }
        $row['seclabels'] = Options::parseSecurityLabels($row['seclabels'] ?? null);
        $row['rolconfig'] = Options::list($row['rolconfig'] ?? null);
        $row['is_sys_obj'] = $row['oid'] <= DatabaseController::LAST_SYSTEM_OID;

        return $row;
    }

    /** @return list<array{role: string, admin: bool, inherit: bool, set: bool}> */
    private function memberships(NodeContext $ctx, mixed $encoded): array
    {
        $flags = $ctx->version() >= 160000 ? 3 : 1;
        $result = [];
        foreach (Options::list($encoded) as $entry) {
            if (preg_match('/^([01]{' . $flags . '})(.+)$/s', $entry, $m) !== 1) {
                continue;
            }
            // Before 16 a membership is always inherited (per the member's INHERIT) and SET-able.
            $result[] = ['role' => $m[2], 'admin' => $m[1][0] === '1', 'inherit' => $flags === 1 || $m[1][1] === '1', 'set' => $flags === 1 || $m[1][2] === '1'];
        }

        return $result;
    }

    /**
     * The OIDs of the roles with a password, or null when the session may not read pg_authid.
     *
     * @return array<int, true>|null
     */
    private function passwords(NodeContext $ctx): ?array
    {
        if (!$this->isSuperuser($ctx)) {
            return null;
        }

        return array_fill_keys(array_map(intval(...), array_column($ctx->conn->rows('SELECT oid FROM pg_catalog.pg_authid WHERE rolpassword IS NOT NULL'), 'oid')), true);
    }

    private function isSuperuser(NodeContext $ctx): bool
    {
        return (bool) $ctx->conn->scalar('SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user');
    }

    /**
     * The client's data as create.sql takes it: pgAdmin's validate_request for a new role.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function forCreate(NodeContext $ctx, array $data): array
    {
        $data['rolname'] = $this->requireName($data, 'rolname');
        foreach (self::ATTRIBUTES as $key) {
            $data[$key] = self::truthy($data[$key] ?? ($key === 'rolinherit'));
        }
        $data['rolconnlimit'] = self::connectionLimit($data['rolconnlimit'] ?? null);
        $data['rolvaliduntil'] = self::blankToNull($data['rolvaliduntil'] ?? null);
        $data['rolpassword'] = self::blankToNull($data['rolpassword'] ?? null);
        $data['description'] = self::blankToNull($data['description'] ?? null);
        $data['rolmembership_list'] = $this->membershipList($ctx, $data['rolmembership'] ?? []);
        $data['rol_members_list'] = $this->membershipList($ctx, $data['rolmembers'] ?? []);
        $data['variables'] = self::variableList($data['variables'] ?? []);

        return $data;
    }

    /**
     * update.sql for what the form changes against the role as it stands.
     *
     * @param array<string, mixed> $data
     */
    private function updateSql(NodeContext $ctx, int $oid, array $data, bool $dummy): string
    {
        $old = $this->properties($ctx, $oid);
        $changes = [];

        $name = trim((string) ($data['rolname'] ?? ''));
        if ($name !== '' && $name !== $old['rolname']) {
            $changes['rolname'] = $name;
        }
        foreach (self::ATTRIBUTES as $key) {
            if (array_key_exists($key, $data) && self::truthy($data[$key]) !== (bool) $old[$key]) {
                $changes[$key] = self::truthy($data[$key]);
            }
        }
        if (array_key_exists('rolconnlimit', $data) && self::connectionLimit($data['rolconnlimit']) !== (int) $old['rolconnlimit']) {
            $changes['rolconnlimit'] = self::connectionLimit($data['rolconnlimit']);
        }
        if (array_key_exists('rolvaliduntil', $data) && !self::sameTimestamp($ctx, self::blankToNull($data['rolvaliduntil']), $old['rolvaliduntil'])) {
            $changes['rolvaliduntil'] = self::blankToNull($data['rolvaliduntil']);
        }
        // A password is sent only to set one ('' keeps it); null removes one the role has.
        if (array_key_exists('rolpassword', $data) && $data['rolpassword'] !== '' && ($data['rolpassword'] !== null || $old['has_password'] !== false)) {
            $changes['rolpassword'] = $data['rolpassword'];
        }
        if (array_key_exists('description', $data) && (string) $data['description'] !== (string) ($old['description'] ?? '')) {
            $changes['description'] = (string) $data['description'];
        }
        if (isset($data['rolmembership']) && is_array($data['rolmembership'])) {
            $this->membershipChanges($ctx, $changes, 'rolmembership', $this->membershipList($ctx, $data['rolmembership']), $old['rolmembership']);
        }
        if (isset($data['rolmembers']) && is_array($data['rolmembers'])) {
            $this->membershipChanges($ctx, $changes, 'rol_members', $this->membershipList($ctx, $data['rolmembers']), $old['rolmembers'] ?? []);
        }
        if (isset($data['variables']) && is_array($data['variables'])) {
            $variables = self::variableChanges(self::variableList($data['variables']), $old['variables']);
            if ($variables !== ['added' => [], 'changed' => [], 'deleted' => []]) {
                $changes['variables'] = $variables;
            }
        }

        return $ctx->render('update.sql', ['data' => $changes, 'role' => $old['rolname'], 'alterKeys' => self::ALTER_KEYS, 'dummy' => $dummy]);
    }

    /**
     * pgAdmin's _process_rolemembership / _process_rolmembers: GRANT for the added and changed
     * memberships and REVOKE for the removed ones; before 16 a changed one is a re-GRANT WITH
     * ADMIN OPTION or a REVOKE ADMIN OPTION FOR.
     *
     * @param array<string, mixed> $changes
     * @param list<array<string, mixed>> $new
     * @param list<array<string, mixed>> $old
     */
    private function membershipChanges(NodeContext $ctx, array &$changes, string $prefix, array $new, array $old): void
    {
        $oldByRole = array_column($old, null, 'role');
        $newByRole = array_column($new, null, 'role');
        $grant = [];
        $revokedAdmins = [];
        foreach ($newByRole as $role => $membership) {
            $was = $oldByRole[$role] ?? null;
            if ($was === null) {
                $grant[] = $membership;
            } elseif ($ctx->version() >= 160000) {
                if ([$was['admin'], $was['inherit'], $was['set']] !== [$membership['admin'], $membership['inherit'], $membership['set']]) {
                    $grant[] = $membership;
                }
            } elseif ($was['admin'] !== $membership['admin']) {
                if ($membership['admin']) {
                    $grant[] = $membership;
                } else {
                    $revokedAdmins[] = $membership;
                }
            }
        }
        $revoked = array_values(array_map(static fn (string $role): array => ['role' => $role], array_diff(array_keys($oldByRole), array_keys($newByRole))));

        $changes[$prefix . '_list'] = $grant;
        $changes[$prefix . '_revoked_list'] = $revoked;
        $changes[$prefix . '_revoked_admins'] = $revokedAdmins;
    }

    /**
     * Memberships as the templates take them: one per role, every option spelled out.
     *
     * @return list<array{role: string, admin: bool, inherit: bool, set: bool}>
     */
    private function membershipList(NodeContext $ctx, mixed $memberships): array
    {
        $list = [];
        foreach (is_array($memberships) ? $memberships : [] as $membership) {
            $role = trim((string) ($membership['role'] ?? ''));
            if ($role === '') {
                continue;
            }
            $list[$role] = [
                'role' => $role,
                'admin' => self::truthy($membership['admin'] ?? false),
                'inherit' => $ctx->version() >= 160000 ? self::truthy($membership['inherit'] ?? true) : true,
                'set' => $ctx->version() >= 160000 ? self::truthy($membership['set'] ?? true) : true,
            ];
        }

        return array_values($list);
    }

    /**
     * @return list<array{name: string, value: string, database: string|null}>
     */
    private static function variableList(mixed $variables): array
    {
        $list = [];
        foreach (is_array($variables) ? $variables : [] as $variable) {
            $name = trim((string) ($variable['name'] ?? ''));
            if ($name !== '') {
                $list[] = ['name' => $name, 'value' => (string) ($variable['value'] ?? ''), 'database' => self::blankToNull($variable['database'] ?? null)];
            }
        }

        return $list;
    }

    /**
     * The settings matched by name and database.
     *
     * @param list<array<string, mixed>> $new
     * @param list<array<string, mixed>> $old
     * @return array{added: list<array<string, mixed>>, changed: list<array<string, mixed>>, deleted: list<array<string, mixed>>}
     */
    private static function variableChanges(array $new, array $old): array
    {
        $key = static fn (array $v): string => ($v['database'] ?? '') . "\0" . $v['name'];
        $oldByKey = [];
        foreach ($old as $v) {
            $oldByKey[$key($v)] = $v;
        }
        $changes = ['added' => [], 'changed' => [], 'deleted' => []];
        $seen = [];
        foreach ($new as $v) {
            $seen[$key($v)] = true;
            if (!isset($oldByKey[$key($v)])) {
                $changes['added'][] = $v;
            } elseif ((string) $oldByKey[$key($v)]['value'] !== $v['value']) {
                $changes['changed'][] = $v;
            }
        }
        foreach ($oldByKey as $k => $v) {
            if (!isset($seen[$k])) {
                $changes['deleted'][] = $v;
            }
        }

        return $changes;
    }

    private function name(NodeContext $ctx, int $oid): string
    {
        return (string) ($ctx->conn->scalar('SELECT rolname FROM pg_catalog.pg_roles WHERE oid = $1', [$oid]) ?? throw $this->gone($ctx));
    }

    private static function connectionLimit(mixed $value): int
    {
        if ($value === null || $value === '') {
            return -1;
        }
        if (!is_numeric($value) || (int) $value < -1) {
            throw new BadRequestException('Connection limit must be an integer value or equal to -1.');
        }

        return (int) $value;
    }

    /** Whether two timestamps name the same moment; the form's value is local time without a zone. */
    private static function sameTimestamp(NodeContext $ctx, ?string $new, mixed $old): bool
    {
        $old = $old === 'infinity' ? null : $old;
        if ($new === null || $old === null) {
            return $new === $old;
        }

        return (bool) $ctx->conn->scalar('SELECT $1::timestamptz = $2::timestamptz', [$new, (string) $old]);
    }

    private static function blankToNull(mixed $value): ?string
    {
        return $value === null || trim((string) $value) === '' ? null : (string) $value;
    }

    private static function truthy(mixed $value): bool
    {
        return $value === true || $value === 1 || $value === '1' || $value === 'true' || $value === 'on';
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        return parent::toNode($ctx, ['name' => $row['rolname'], ...$row]);
    }

    /** A login role is phpMyAdmin's user; a group role its user group. */
    protected function icon(NodeContext $ctx, array $row): string
    {
        return ($row['rolcanlogin'] ?? false) ? 'user' : 'b_usrlist';
    }
}
