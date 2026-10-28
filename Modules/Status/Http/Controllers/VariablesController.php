<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Status\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\ForbiddenException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use Psr\Http\Message\ServerRequestInterface;

/**
 * phpMyAdmin's Server variables and settings for PostgreSQL: the run-time parameters of
 * pg_settings, and ALTER SYSTEM SET / RESET where phpMyAdmin runs SET GLOBAL, followed by
 * pg_reload_conf() so a parameter that does not need a restart takes effect at once.
 */
final class VariablesController
{
    /**
     * Each parameter with its value as SHOW prints it (with its unit), and whether this role
     * may change it: superusers, and from PostgreSQL 15 the roles granted ALTER SYSTEM on it.
     * "internal" parameters are fixed when the server is built or the cluster initialised.
     */
    private const string SETTINGS = <<<'SQL'
        SELECT name, pg_catalog.current_setting(name) AS value, setting, unit, category, short_desc, extra_desc,
               context, vartype, source, min_val, max_val, pg_catalog.array_to_json(enumvals)::text AS enumvals, boot_val, reset_val, pending_restart,
               context <> 'internal' AND %s AS editable
        FROM pg_catalog.pg_settings
        %s
        ORDER BY name
        SQL;

    /**
     * The parameters whose value is a list of names, each of which ALTER SYSTEM takes as its
     * own literal (GUC_LIST_QUOTE in guc_tables.c); quoting the whole list would make it one name.
     */
    private const array LISTS = ['search_path', 'temp_tablespaces', 'shared_preload_libraries', 'session_preload_libraries', 'local_preload_libraries', 'unix_socket_directories', 'synchronized_standby_slots'];

    /**
     * Every parameter, the values that wait for a restart (read from pg_file_settings when
     * this role may), and whether this role is a superuser.
     *
     * @return array{variables: list<array<string, mixed>>, superuser: bool}
     */
    public function index(ServerRequestInterface $request): array
    {
        $conn = ConnectionPool::from($request)->maintenance();
        $variables = $conn->rows(sprintf(self::SETTINGS, $this->mayAlter($conn), ''));
        $pending = $this->pending($conn);

        return [
            'variables' => array_map(fn (array $row): array => $this->shape($row, $pending), $variables),
            'superuser' => $this->superuser($conn),
        ];
    }

    /** One parameter, for the editor: what it holds and what it accepts. */
    public function show(ServerRequestInterface $request, array $args): array
    {
        $conn = ConnectionPool::from($request)->maintenance();

        return ['variable' => $this->variable($conn, (string) $args['name'])];
    }

    /**
     * ALTER SYSTEM SET name = value (or RESET name when "reset" is true), then pg_reload_conf().
     * Answers with the statement, the parameter as it now reads (with the value waiting for a
     * restart when its context is postmaster) and whether it needs one.
     *
     * @return array{sql: string, variable: array<string, mixed>, restart: bool}
     */
    public function update(ServerRequestInterface $request, array $args): array
    {
        $conn = ConnectionPool::from($request)->maintenance();
        $variable = $this->variable($conn, (string) $args['name']);
        if (!$variable['editable']) {
            throw new ForbiddenException(sprintf('The parameter "%s" can not be changed by this role.', $variable['name']));
        }
        $body = (array) $request->getParsedBody();
        $sql = ($body['reset'] ?? false) === true
            ? sprintf('ALTER SYSTEM RESET %s;', $conn->escapeIdentifier($variable['name']))
            : sprintf('ALTER SYSTEM SET %s TO %s;', $conn->escapeIdentifier($variable['name']), $this->value($conn, $variable['name'], (string) ($body['value'] ?? throw new BadRequestException('Give the parameter a value.'))));

        // ALTER SYSTEM refuses to run inside a transaction block, so it is never wrapped in one.
        $conn->exec($sql);
        if ($this->superuser($conn) || (bool) $conn->scalar("SELECT pg_catalog.has_function_privilege('pg_catalog.pg_reload_conf()', 'EXECUTE')")) {
            $this->reload($conn);
            $sql .= "\nSELECT pg_catalog.pg_reload_conf();";
        }

        $variable = $this->variable($conn, $variable['name']);

        return ['sql' => $sql, 'variable' => $variable, 'restart' => $variable['context'] === 'postmaster'];
    }

    /**
     * pg_reload_conf() only signals the postmaster, which signals every backend; this one
     * rereads the files between statements, so wait (up to a second) until its
     * pg_conf_load_time() moves and the new value can be read back.
     */
    private function reload(Connection $conn): void
    {
        $loaded = $conn->scalar('SELECT pg_catalog.pg_conf_load_time()');
        $conn->scalar('SELECT pg_catalog.pg_reload_conf()');
        for ($i = 0; $i < 20 && $conn->scalar('SELECT pg_catalog.pg_conf_load_time()') === $loaded; $i++) {
            usleep(50_000);
        }
    }

    /** @return array<string, mixed> the row of SETTINGS, with "pending" */
    private function variable(Connection $conn, string $name): array
    {
        $row = $conn->row(sprintf(self::SETTINGS, $this->mayAlter($conn), 'WHERE name = $1'), [$name])
            ?? throw new NotFoundException(sprintf('There is no parameter "%s".', $name));

        return $this->shape($row, $this->pending($conn));
    }

    /**
     * @param array<string, mixed> $row
     * @param array<string, string> $pending
     * @return array<string, mixed> with enumvals as a list and "pending"
     */
    private function shape(array $row, array $pending): array
    {
        return [...$row, 'enumvals' => $row['enumvals'] === null ? null : json_decode((string) $row['enumvals'], true, flags: JSON_THROW_ON_ERROR), 'pending' => $pending[$row['name']] ?? null];
    }

    /**
     * The value each parameter waiting for a restart (pending_restart) will have: its last
     * entry in pg_file_settings (whose error says it "could not be applied"), or its built-in
     * default once the entry is gone (PostgreSQL keeps the flag until the restart), which
     * superusers and pg_read_all_settings members may read.
     *
     * @return array<string, string>
     */
    private function pending(Connection $conn): array
    {
        if (!(bool) $conn->scalar("SELECT pg_catalog.pg_has_role('pg_read_all_settings', 'MEMBER')")) {
            return [];
        }
        $rows = $conn->rows(<<<'SQL'
            SELECT DISTINCT ON (s.name) s.name, COALESCE(f.setting, s.boot_val) AS setting
            FROM pg_catalog.pg_settings s LEFT JOIN pg_catalog.pg_file_settings f ON f.name = s.name
            WHERE s.pending_restart
            ORDER BY s.name, f.seqno DESC NULLS LAST
            SQL);

        return array_column($rows, 'setting', 'name');
    }

    /** The value as ALTER SYSTEM takes it: a literal, or for a list parameter one per element. */
    private function value(Connection $conn, string $name, string $value): string
    {
        if (!in_array($name, self::LISTS, true) || trim($value) === '') {
            return $conn->escapeLiteral($value);
        }
        $items = array_map(static fn (string $item): string => trim(trim($item), '"'), str_getcsv($value, ',', '"', ''));

        return implode(', ', array_map($conn->escapeLiteral(...), $items));
    }

    /** The SQL that tells, per pg_settings row, whether this role may ALTER SYSTEM it. */
    private function mayAlter(Connection $conn): string
    {
        return $conn->version() >= 150000
            ? "pg_catalog.has_parameter_privilege(name, 'ALTER SYSTEM')"
            : '(SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user)';
    }

    private function superuser(Connection $conn): bool
    {
        return (bool) $conn->scalar('SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user');
    }
}
