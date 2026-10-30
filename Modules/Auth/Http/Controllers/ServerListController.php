<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Auth\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Database\Server;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Auth\Servers;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The saved servers' management, for a signed-in user: rename and remove one, and export and
 * import the list in pgAdmin's import_export_servers JSON:
 *
 *     {"Servers": {"1": {"Name": "Production", "Group": "Servers", "Host": "db.example.com",
 *       "Port": 5432, "MaintenanceDB": "postgres", "Username": "app", "SSLMode": "require"}}}
 *
 * The import also reads pgAdmin 7's newer layout, the SSL mode under
 * "ConnectionParameters": {"sslmode": …}. Groups are not kept: phpPgAdmin has one list. No
 * password is ever exported or imported.
 */
final class ServerListController
{
    private const int NAME_LENGTH = 128;

    /** @return array{ok: true} */
    public function update(ServerRequestInterface $request, array $args): array
    {
        $servers = Servers::make();
        $id = (int) $args['id'];
        $servers->find($id) ?? throw new NotFoundException(__('auth::errors.unknown_server'));
        $name = trim(self::text(((array) $request->getParsedBody())['name'] ?? null, 'name'));
        if (mb_strlen($name) > self::NAME_LENGTH) {
            throw new BadRequestException(__('auth::errors.name_too_long', ['max' => self::NAME_LENGTH]));
        }
        $servers->rename($id, $name === '' ? null : $name);

        return ['ok' => true];
    }

    /**
     * A saved server's connection options as the signed-in role sees them: the server's, and
     * its own role and post-connection SQL (another role's are never shown), with the files
     * the SSL options can name (null when no SSL directory is configured).
     *
     * @return array{options: array<string, string>, ssl_files: list<string>|null}
     */
    public function options(ServerRequestInterface $request, array $args): array
    {
        $server = Servers::make()->find((int) $args['id']) ?? throw new NotFoundException(__('auth::errors.unknown_server'));
        $options = $server->optionsFor(self::username($request));

        return ['options' => (object) $options, 'ssl_files' => Server::sslFiles()];
    }

    /**
     * Set a saved server's connection options: service, application_name, sslcert, sslkey,
     * sslrootcert and sslcrl for everyone who signs in to it, role and post_connection_sql for
     * the signed-in role only. An empty value takes an option away. The session's own server
     * takes the new options from its next request.
     *
     * @return array{ok: true}
     */
    public function updateOptions(ServerRequestInterface $request, array $args): array
    {
        $servers = Servers::make();
        $id = (int) $args['id'];
        $server = $servers->find($id) ?? throw new NotFoundException(__('auth::errors.unknown_server'));
        $body = (array) ($request->getParsedBody() ?? []);
        $username = self::username($request);

        $options = $server->options;
        foreach (Server::SERVER_OPTIONS as $key) {
            $value = trim(self::text($body[$key] ?? null, $key));
            if (mb_strlen($value) > 256 || preg_match('/[\x00-\x1f]/', $value) === 1) {
                throw new BadRequestException(sprintf('%s is not a valid value.', $key));
            }
            if ($value !== '' && in_array($key, Server::SSL_FILES, true) && Server::sslPath($value) === null) {
                throw new BadRequestException(Server::sslDirectory() === null
                    ? 'No SSL certificate directory is configured (PGADMIN_SSL_DIRECTORY).'
                    : sprintf('"%s" is not a file of the SSL certificate directory.', $value));
            }
            if ($value === '') {
                unset($options[$key]);
            } else {
                $options[$key] = $value;
            }
        }
        $own = [];
        $role = trim(self::text($body['role'] ?? null, 'role'));
        if ($role !== '') {
            if (strlen($role) > 63 || preg_match('/[\x00-\x1f]/', $role) === 1) {
                throw new BadRequestException('role is not a valid role name.');
            }
            // On the server the session is signed in to, a role the login role cannot become is
            // refused here, rather than at every later sign-in.
            $session = Authenticate::sessionServer();
            if ($session !== null && $session->id === $id) {
                $member = ConnectionPool::from($request)->maintenance()->scalar("SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = \$1) THEN pg_catalog.pg_has_role(session_user, \$1, 'MEMBER') END", [$role]);
                if ($member !== true) {
                    throw new BadRequestException($member === null ? sprintf('There is no role "%s" on this server.', $role) : sprintf('%s cannot SET ROLE to "%s".', $username, $role));
                }
            }
            $own['role'] = $role;
        }
        $sql = self::text($body['post_connection_sql'] ?? null, 'post_connection_sql');
        if (trim($sql) !== '') {
            $own['post_connection_sql'] = $sql;
        }
        $roles = is_array($options['roles'] ?? null) ? $options['roles'] : [];
        if ($own === []) {
            unset($roles[$username]);
        } else {
            $roles[$username] = $own;
        }
        if ($roles === []) {
            unset($options['roles']);
        } else {
            $options['roles'] = $roles;
        }
        $servers->setOptions($id, $options);

        // The session's server is read from the session: it gets the new options at once.
        $session = Authenticate::sessionServer();
        if ($session !== null && $session->id === $id) {
            $_SESSION[Authenticate::SERVER] = $session->withOptions($options)->toSessionArray();
        }

        return ['ok' => true];
    }

    private static function username(ServerRequestInterface $request): string
    {
        $user = $request->getAttribute(Authenticate::USER);

        return is_array($user) ? (string) ($user['username'] ?? '') : '';
    }

    /** @return array{ok: true} */
    public function destroy(ServerRequestInterface $request, array $args): array
    {
        $servers = Servers::make();
        $id = (int) $args['id'];
        $servers->find($id) ?? throw new NotFoundException(__('auth::errors.unknown_server'));
        $servers->forget($id);

        return ['ok' => true];
    }

    /** @return array{Servers: object} */
    public function exportList(ServerRequestInterface $request): array
    {
        $servers = Servers::make();
        $list = [];
        foreach ($servers->all() as $i => $server) {
            $list[(string) ($i + 1)] = [
                'Name' => $server->name ?? sprintf('%s:%d', $server->host, $server->port),
                'Group' => 'Servers',
                'Host' => $server->host,
                'Port' => $server->port,
                'MaintenanceDB' => $server->maintenanceDb ?? 'postgres',
                'Username' => ($server->id === null ? null : $servers->lastUsername($server->id)) ?? '',
                'SSLMode' => $server->sslmode,
            ];
        }

        return ['Servers' => (object) $list];
    }

    /**
     * Add the servers of an exported list, or update the ones saved at the same host and port.
     * The whole list is checked before anything is saved.
     *
     * @return array{added: int, updated: int}
     */
    public function importList(ServerRequestInterface $request): array
    {
        $body = (array) ($request->getParsedBody() ?? []);
        $entries = $body['Servers'] ?? null;
        if (!is_array($entries) || $entries === []) {
            throw new BadRequestException(__('auth::errors.import_invalid'));
        }

        $parsed = [];
        foreach ($entries as $key => $entry) {
            if (!is_array($entry)) {
                throw new BadRequestException(__('auth::errors.import_entry', ['key' => (string) $key, 'reason' => __('auth::errors.import_not_object')]));
            }
            $parameters = is_array($entry['ConnectionParameters'] ?? null) ? $entry['ConnectionParameters'] : [];
            $sslmode = $entry['SSLMode'] ?? $parameters['sslmode'] ?? 'prefer';
            $name = trim(self::text($entry['Name'] ?? null, sprintf('Servers.%s.Name', $key)));
            $username = trim(self::text($entry['Username'] ?? null, sprintf('Servers.%s.Username', $key)));
            try {
                $server = Server::fromArray([
                    'host' => is_scalar($entry['Host'] ?? null) ? (string) $entry['Host'] : '',
                    'port' => $entry['Port'] ?? 5432,
                    'sslmode' => is_string($sslmode) ? $sslmode : 'prefer',
                    'maintenance_db' => is_scalar($entry['MaintenanceDB'] ?? null) ? (string) $entry['MaintenanceDB'] : null,
                    'name' => mb_substr($name, 0, self::NAME_LENGTH),
                ]);
            } catch (\InvalidArgumentException $e) {
                throw new BadRequestException(__('auth::errors.import_entry', ['key' => (string) $key, 'reason' => $e->getMessage()]));
            }
            $parsed[] = [$server, $username === '' ? null : $username];
        }

        $servers = Servers::make();
        $added = 0;
        foreach ($parsed as [$server, $username]) {
            $added += $servers->import($server, $username) ? 1 : 0;
        }

        return ['added' => $added, 'updated' => count($parsed) - $added];
    }

    /** A string field of the body: absent is empty, anything but a string or a number is refused. */
    private static function text(mixed $value, string $field): string
    {
        if ($value !== null && !is_string($value) && !is_int($value) && !is_float($value)) {
            throw new BadRequestException(sprintf('%s must be text.', $field));
        }

        return (string) $value;
    }
}
