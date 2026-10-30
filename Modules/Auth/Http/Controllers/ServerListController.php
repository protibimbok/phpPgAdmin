<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Auth\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Server;
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
