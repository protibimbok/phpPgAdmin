<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Replication\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\ConnectionException;
use PhpPgAdmin\Core\Database\Connector;
use PhpPgAdmin\Core\Database\Credentials;
use PhpPgAdmin\Core\Database\Server;
use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Core\Nodes\Options;
use PhpPgAdmin\Modules\Replication\Conninfo;
use PhpPgAdmin\Modules\Sql\Sql\Splitter;

/**
 * The subscription node, after pgAdmin's SubscriptionView: the subscriptions of a database
 * with their connection, publications and options, the state of their apply workers, the
 * statements that create, alter and drop one, and pgAdmin's get_publications, which connects
 * to the publisher to list what it publishes.
 *
 * The client's data carries pgAdmin's field names: name, subowner, description, the connection
 * (host, port, username, password, db, connect_timeout, passfile, sslmode, sslcompression,
 * sslcert, sslkey, sslrootcert, sslcrl), pub (names), connect, enabled, copy_data, create_slot,
 * slot_name, sync, binary, streaming, two_phase, disable_on_error, password_required,
 * run_as_owner, origin, failover, and for an update refresh_pub and copy_data_after_refresh.
 * pgAdmin's slot_name "None" is slot_none here. An option the server is too old for is left out.
 *
 * subconninfo is read as libpq reads it and written back quoted (see Conninfo); its password is
 * never sent to the client, and the DDL shows it as pgAdmin's "xxxxxx". Only a superuser may
 * read subconninfo; for anyone else the connection is unknown and is only written when the form
 * gives a new one. CREATE SUBSCRIPTION that creates a slot, DROP SUBSCRIPTION with one, and
 * ALTER SUBSCRIPTION ... REFRESH may not run in a transaction block, so the statements run one
 * at a time.
 */
final class SubscriptionController extends NodeController
{
    /** The password pgAdmin's DDL shows in place of the real one. */
    private const string MASK = 'xxxxxx';

    private const array SYNC = ['off', 'local', 'remote_write', 'remote_apply', 'on'];

    /** Each option by the server version that has it. */
    private const array SINCE = [
        'binary' => 140000,
        'streaming' => 140000,
        'two_phase' => 150000,
        'disable_on_error' => 150000,
        'password_required' => 160000,
        'run_as_owner' => 160000,
        'origin' => 160000,
        'failover' => 170000,
    ];

    private const array BOOLEANS = ['binary', 'two_phase', 'disable_on_error', 'password_required', 'run_as_owner', 'failover'];

    public function list(NodeContext $ctx): array
    {
        $status = array_column($ctx->rows('status.sql'), null, 'oid');

        return array_map(function (array $row) use ($status): array {
            $row = $this->transform($row);
            $worker = $status[$row['oid']] ?? null;
            unset($worker['oid']);
            $row['worker'] = $worker === null || $worker['pid'] === null && $worker['apply_error_count'] === null ? null : $worker;

            return $row;
        }, $ctx->rows('properties.sql', $this->scope($ctx)));
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        return $this->transform($this->old($ctx, $oid));
    }

    /** pgAdmin's sql(): the header with the DROP, then CREATE SUBSCRIPTION with connect = false and the password masked. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        $old = $this->old($ctx, $oid);
        $data = $this->transform($old);
        $data['connect'] = $data['enabled'];
        $data['create_slot'] = false;
        $data['copy_data'] = null;
        $data['slot_none'] = $data['slot_name'] === null;

        return Ddl::assemble([
            Ddl::header('Subscription', $data['name'], $ctx->render('delete.sql', ['subid' => null, 'subname' => $data['name']])),
            $ctx->render('create.sql', ['data' => $data, 'conninfo' => $this->storedConninfo($old, true)]),
        ]);
    }

    public function create(NodeContext $ctx, array $data): array
    {
        [$create, $fields] = $this->forCreate($ctx, $data);
        $this->runEach($ctx, $ctx->render('create.sql', ['data' => $create, 'conninfo' => Conninfo::fromFields($fields)]));
        $oid = $ctx->conn->scalar($ctx->render('get_position.sql', ['subname' => $create['name']])) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $oid);
    }

    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->runEach($ctx, $this->updateSql($ctx, $oid, $data, false));

        return $this->node($ctx, $oid);
    }

    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $name = $ctx->conn->scalar($ctx->render('delete.sql', ['subid' => $oid])) ?? throw $this->gone($ctx);
        $ctx->conn->query(trim($ctx->render('delete.sql', ['subid' => null, 'subname' => (string) $name, 'cascade' => $cascade])));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid === null) {
            [$create, $fields] = $this->forCreate($ctx, $data);
            if (($fields['password'] ?? '') !== '') {
                $fields['password'] = self::MASK;
            }

            return Ddl::assemble([$ctx->render('create.sql', ['data' => $create, 'conninfo' => Conninfo::fromFields($fields)])]);
        }

        return Ddl::assemble([$this->updateSql($ctx, $oid, $data, true)]);
    }

    public function statistics(NodeContext $ctx, ?int $oid): array
    {
        $result = $ctx->query('stats.sql', ['subid' => $oid]);

        return [
            'columns' => array_map(static fn ($c): array => ['name' => $c->name, 'type' => $c->typeName], $result->columns()),
            'rows' => $result->rows(),
        ];
    }

    /** A subscription by name: resolve('subscription', {name}) → {subid}. */
    public function resolve(NodeContext $ctx, array $params): ?array
    {
        $oid = $ctx->conn->scalar($ctx->render('get_position.sql', ['subname' => (string) ($params['name'] ?? '')]));

        return $oid === null ? null : ['subid' => (int) $oid];
    }

    /**
     * What the form offers: the owners, the server version (which options exist), whether the
     * connection of a subscription can be read, and the publications of this database, which a
     * subscription to the same server would name.
     *
     * @return array{roles: list<string>, version: int, conninfo_visible: bool}
     */
    public function options(NodeContext $ctx): array
    {
        return [
            'roles' => Catalog::roles($ctx->conn),
            'version' => $ctx->version(),
            'conninfo_visible' => $this->conninfoVisible($ctx),
        ];
    }

    /**
     * pgAdmin's get_publications: connect to the publisher with the form's connection (that of
     * the subscription $oid filling what the form leaves blank, its password included) and list
     * pg_publication there. Only host, port, user, password, dbname, sslmode and connect_timeout
     * are used: the file paths name files on the publisher's subscriber, not on this web server.
     *
     * @param array<string, mixed> $data
     * @return list<string>
     */
    public function publications(NodeContext $ctx, ?int $oid, array $data): array
    {
        $fields = [];
        foreach (array_keys(Conninfo::FIELDS) as $field) {
            $fields[$field] = trim((string) ($data[$field] ?? ''));
        }
        if ($oid !== null && $this->conninfoVisible($ctx)) {
            $stored = Conninfo::toFields((string) ($this->old($ctx, $oid)['conninfo'] ?? ''));
            foreach ($fields as $field => $value) {
                if ($value === '') {
                    $fields[$field] = (string) $stored[$field];
                }
            }
        }
        if ($fields['host'] === '' || $fields['db'] === '') {
            throw new BadRequestException('A host and a database are needed to reach the publisher.');
        }
        $sslmode = $fields['sslmode'] !== '' ? $fields['sslmode'] : 'prefer';
        try {
            $server = new Server($fields['host'], $fields['port'] !== '' ? (int) $fields['port'] : 5432, $sslmode);
        } catch (\InvalidArgumentException $e) {
            throw new BadRequestException($e->getMessage());
        }
        $timeout = (int) $fields['connect_timeout'];
        $connector = new Connector($server, $timeout > 0 ? min($timeout, 30) : 10);
        try {
            $remote = $connector->connect(new Credentials($fields['username'] !== '' ? $fields['username'] : $ctx->pool->username(), $fields['password'], $fields['db']));
        } catch (ConnectionException $e) {
            throw new BadRequestException($e->getMessage());
        }
        try {
            return array_column($remote->rows('SELECT pubname FROM pg_catalog.pg_publication ORDER BY pubname'), 'pubname');
        } finally {
            $remote->close();
        }
    }

    /**
     * pgAdmin's two_phase_mapping and streaming_mapping: two_phase as a boolean (pending counts
     * as on), streaming as off / on / parallel; the publications as a list, the connection as
     * the form's fields without the password.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function transform(array $row): array
    {
        $row['oid'] = (int) $row['oid'];
        $row['pub'] = Options::list($row['pub'] ?? null);
        if (array_key_exists('two_phase', $row)) {
            $row['two_phase'] = in_array($row['two_phase'], ['p', 'e'], true);
        }
        if (array_key_exists('streaming', $row)) {
            $row['streaming'] = match ($row['streaming']) {
                true, 't' => 'on',
                'p' => 'parallel',
                default => 'off',
            };
        }
        $conninfo = $row['conninfo'] ?? null;
        unset($row['conninfo']);
        $row['conninfo_visible'] = $conninfo !== null;
        $fields = Conninfo::toFields((string) $conninfo);
        $row['has_password'] = $fields['password'] !== '';
        unset($fields['password'], $fields['other']);

        return [...$row, ...$fields];
    }

    /** @return array<string, mixed> the catalog row, its connection string included */
    private function old(NodeContext $ctx, int $oid): array
    {
        return $ctx->row('properties.sql', [...$this->scope($ctx), 'subid' => $oid]) ?? throw $this->gone($ctx);
    }

    /** @return array{conninfo_visible: bool} */
    private function scope(NodeContext $ctx): array
    {
        return ['conninfo_visible' => $this->conninfoVisible($ctx)];
    }

    /** subconninfo is revoked from PUBLIC; only roles granted it (superusers) may read it. */
    private function conninfoVisible(NodeContext $ctx): bool
    {
        return (bool) $ctx->conn->scalar("SELECT pg_catalog.has_column_privilege('pg_catalog.pg_subscription', 'subconninfo', 'SELECT')");
    }

    /** @param array<string, mixed> $old */
    private function storedConninfo(array $old, bool $mask): string
    {
        $params = Conninfo::parse((string) ($old['conninfo'] ?? ''));
        if ($mask && ($params['password'] ?? '') !== '') {
            $params['password'] = self::MASK;
        }

        return Conninfo::build($params);
    }

    /**
     * The client's data as create.sql takes it, and the connection fields.
     *
     * @param array<string, mixed> $data
     * @return array{0: array<string, mixed>, 1: array<string, string>}
     */
    private function forCreate(NodeContext $ctx, array $data): array
    {
        $fields = $this->connectionFields($data);
        if ($fields['host'] === '' && $fields['db'] === '') {
            throw $this->incomplete('connection');
        }
        $pub = $this->publicationList($data['pub'] ?? []);
        if ($pub === []) {
            throw new BadRequestException('Name at least one publication to subscribe to.');
        }
        $create = [
            'name' => $this->requireName($data),
            'subowner' => self::blankToNull($data['subowner'] ?? null),
            'description' => self::blankToNull($data['description'] ?? null),
            'pub' => $pub,
            'connect' => self::boolOrNull($data['connect'] ?? null),
            'enabled' => ($data['enabled'] ?? true) === true,
            'copy_data' => self::boolOrNull($data['copy_data'] ?? null),
            'create_slot' => self::boolOrNull($data['create_slot'] ?? null),
            'slot_none' => ($data['slot_none'] ?? false) === true,
            'slot_name' => self::blankToNull($data['slot_name'] ?? null),
            'sync' => $this->sync($data['sync'] ?? null),
        ];

        return [[...$create, ...$this->versionedOptions($ctx, $data)], $fields];
    }

    /**
     * update.sql for what the form changes against the subscription as it stands.
     *
     * @param array<string, mixed> $data
     */
    private function updateSql(NodeContext $ctx, int $oid, array $data, bool $mask): string
    {
        $stored = $this->old($ctx, $oid);
        $old = $this->transform($stored);
        $old['slot_name'] ??= null;

        $changes = [
            'name' => trim((string) ($data['name'] ?? '')) ?: $old['name'],
            'subowner' => self::blankToNull($data['subowner'] ?? null),
            'description' => array_key_exists('description', $data) ? (string) $data['description'] : null,
            'enabled' => self::boolOrNull($data['enabled'] ?? null),
            'slot_none' => self::boolOrNull($data['slot_none'] ?? null),
            'slot_name' => self::blankToNull($data['slot_name'] ?? null),
            'sync' => $this->sync($data['sync'] ?? null),
            'refresh_pub' => ($data['refresh_pub'] ?? false) === true,
            'copy_data_after_refresh' => ($data['copy_data_after_refresh'] ?? false) === true,
            'pub' => null,
            ...$this->versionedOptions($ctx, $data),
        ];
        if ($changes['slot_none'] === false && $changes['slot_name'] === null) {
            $changes['slot_none'] = null;
        }
        if (array_key_exists('pub', $data)) {
            $pub = $this->publicationList($data['pub']);
            if ($pub === []) {
                throw new BadRequestException('A subscription needs at least one publication.');
            }
            if ($pub !== $old['pub']) {
                $changes['pub'] = $pub;
            }
        }
        if ($changes['refresh_pub'] && !($changes['enabled'] ?? $old['enabled'])) {
            throw new BadRequestException('Only an enabled subscription can refresh its publications.');
        }

        return $ctx->render('update.sql', ['data' => $changes, 'o_data' => $old, 'conninfo' => $this->changedConninfo($stored, $data, $mask)]);
    }

    /**
     * The new connection string when the form changes any of the connection, null when it does
     * not. A blank password keeps the stored one; the keywords the form does not edit are kept.
     * When the stored connection cannot be read, only a connection the form gives in full is
     * written.
     *
     * @param array<string, mixed> $stored
     * @param array<string, mixed> $data
     */
    private function changedConninfo(array $stored, array $data, bool $mask): ?string
    {
        $given = array_intersect_key($data, Conninfo::FIELDS);
        if ($given === []) {
            return null;
        }
        if ($stored['conninfo'] === null) {
            $fields = $this->connectionFields($data);
            if ($fields['host'] === '' && $fields['db'] === '') {
                return null;
            }
            if ($mask && $fields['password'] !== '') {
                $fields['password'] = self::MASK;
            }

            return Conninfo::fromFields($fields);
        }

        $was = Conninfo::toFields((string) $stored['conninfo']);
        $fields = $was;
        foreach ($given as $field => $value) {
            $value = trim((string) $value);
            if ($field !== 'password' || $value !== '') {
                $fields[$field] = $value;
            }
        }
        $this->checkSslmode($fields['sslmode']);
        unset($fields['other'], $was['other']);
        if ($fields == $was) {
            return null;
        }
        if ($mask && $fields['password'] !== '') {
            $fields['password'] = self::MASK;
        }
        $other = Conninfo::toFields((string) $stored['conninfo'])['other'];

        return Conninfo::fromFields($fields, $other);
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, string>
     */
    private function connectionFields(array $data): array
    {
        $fields = [];
        foreach (array_keys(Conninfo::FIELDS) as $field) {
            $fields[$field] = trim((string) ($data[$field] ?? ''));
        }
        $this->checkSslmode($fields['sslmode']);

        return $fields;
    }

    private function checkSslmode(string $sslmode): void
    {
        if ($sslmode !== '' && !in_array($sslmode, Server::SSL_MODES, true)) {
            throw new BadRequestException(sprintf('Unknown SSL mode "%s".', $sslmode));
        }
    }

    /**
     * The options that depend on the server version, null where the client left them out or
     * the server has none: binary, streaming, two_phase, disable_on_error, password_required,
     * run_as_owner, origin and failover.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function versionedOptions(NodeContext $ctx, array $data): array
    {
        $options = [];
        foreach (self::SINCE as $option => $since) {
            $value = $ctx->version() >= $since ? ($data[$option] ?? null) : null;
            $options[$option] = in_array($option, self::BOOLEANS, true) ? self::boolOrNull($value) : self::blankToNull($value);
        }
        $streaming = $ctx->version() >= 160000 ? ['off', 'on', 'parallel'] : ['off', 'on'];
        if ($options['streaming'] !== null && !in_array($options['streaming'], $streaming, true)) {
            throw new BadRequestException(sprintf('streaming is one of %s.', implode(', ', $streaming)));
        }
        if ($options['origin'] !== null && !in_array($options['origin'], ['any', 'none'], true)) {
            throw new BadRequestException('origin is any or none.');
        }

        return $options;
    }

    private function sync(mixed $value): ?string
    {
        $value = self::blankToNull($value);
        if ($value !== null && !in_array($value, self::SYNC, true)) {
            throw new BadRequestException(sprintf('synchronous_commit is one of %s.', implode(', ', self::SYNC)));
        }

        return $value;
    }

    /** @return list<string> */
    private function publicationList(mixed $pub): array
    {
        return array_values(array_unique(array_filter(array_map(static fn (mixed $p): string => trim((string) $p), is_array($pub) ? $pub : []), static fn (string $p): bool => $p !== '')));
    }

    /** Run the statements one by one, outside a transaction block. */
    private function runEach(NodeContext $ctx, string $sql): void
    {
        foreach (Splitter::split($sql) as $statement) {
            if (self::hasStatements($statement->sql)) {
                $ctx->conn->query($statement->sql);
            }
        }
    }

    private static function boolOrNull(mixed $value): ?bool
    {
        return is_bool($value) ? $value : null;
    }

    private static function blankToNull(mixed $value): ?string
    {
        return $value === null || trim((string) $value) === '' ? null : (string) $value;
    }
}
