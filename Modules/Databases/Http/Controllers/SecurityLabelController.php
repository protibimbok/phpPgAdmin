<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Databases\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\Quoting;

/**
 * The security labels of one object, pgAdmin's "Security labels" grid (provider and label):
 * read from pg_seclabel (pg_shseclabel for roles and databases) and written with SECURITY
 * LABEL FOR provider ON <object> IS 'label' (IS NULL to remove one).
 *
 * An object is addressed by its catalog (pg_class, pg_proc, pg_type, pg_namespace, pg_authid,
 * pg_database), OID and, for a column, attnum; pg_identify_object names it and gives its kind,
 * so the statement takes the object's own keyword (TABLE, VIEW, COLUMN, FUNCTION, …).
 *
 * The providers are the label providers the server has loaded: sepgsql ("selinux") and
 * dummy_seclabel ("dummy") from the preload settings, and any provider a label already names.
 * With none, SECURITY LABEL fails, so the client shows no card.
 */
final class SecurityLabelController
{
    private const array CATALOGS = ['pg_class', 'pg_proc', 'pg_type', 'pg_namespace', 'pg_authid', 'pg_database'];

    /** The catalogs whose labels are shared across databases, kept in pg_shseclabel. */
    private const array SHARED = ['pg_authid', 'pg_database'];

    /** pg_identify_object's type → the keyword SECURITY LABEL ON takes. */
    private const array KEYWORDS = [
        'table' => 'TABLE',
        'foreign table' => 'FOREIGN TABLE',
        'view' => 'VIEW',
        'materialized view' => 'MATERIALIZED VIEW',
        'sequence' => 'SEQUENCE',
        'table column' => 'COLUMN',
        'view column' => 'COLUMN',
        'materialized view column' => 'COLUMN',
        'foreign table column' => 'COLUMN',
        'function' => 'FUNCTION',
        'procedure' => 'PROCEDURE',
        'aggregate' => 'AGGREGATE',
        'type' => 'TYPE',
        'domain' => 'DOMAIN',
        'schema' => 'SCHEMA',
        'role' => 'ROLE',
        'database' => 'DATABASE',
    ];

    /** The loadable modules that register a label provider, by the provider name they register. */
    private const array PROVIDER_MODULES = ['sepgsql' => 'selinux', 'dummy_seclabel' => 'dummy'];

    /**
     * The object's labels, the providers that can label it, and for a relation its columns
     * (which the client may label too).
     *
     * @return array{labels: list<array{provider: string, label: string}>, providers: list<string>, columns: list<array{attnum: int, name: string}>}
     */
    public function show(Connection $conn, string $catalog, int $oid, int $subid): array
    {
        $this->identify($conn, $catalog, $oid, $subid);
        $columns = [];
        if ($catalog === 'pg_class' && $subid === 0) {
            $columns = array_map(static fn (array $r): array => ['attnum' => (int) $r['attnum'], 'name' => (string) $r['attname']], $conn->rows(
                'SELECT attnum, attname FROM pg_catalog.pg_attribute WHERE attrelid = $1 AND attnum > 0 AND NOT attisdropped ORDER BY attnum',
                [$oid],
            ));
        }

        return ['labels' => $this->labels($conn, $catalog, $oid, $subid), 'providers' => $this->providers($conn), 'columns' => $columns];
    }

    /**
     * The statements that turn the object's labels into the client's list.
     *
     * @param mixed $labels the client's list of {provider, label}
     */
    public function sql(Connection $conn, string $catalog, int $oid, int $subid, mixed $labels): string
    {
        [$keyword, $identity] = $this->identify($conn, $catalog, $oid, $subid);
        $before = array_column($this->labels($conn, $catalog, $oid, $subid), 'label', 'provider');
        $after = $this->fromClient($labels);
        $sql = [];
        foreach ($before as $provider => $label) {
            if (!array_key_exists($provider, $after)) {
                $sql[] = sprintf('SECURITY LABEL FOR %s ON %s %s IS NULL;', Quoting::ident((string) $provider), $keyword, $identity);
            }
        }
        foreach ($after as $provider => $label) {
            if (($before[$provider] ?? null) !== $label) {
                $sql[] = sprintf('SECURITY LABEL FOR %s ON %s %s IS %s;', Quoting::ident((string) $provider), $keyword, $identity, Quoting::literal($label));
            }
        }

        return implode("\n", $sql);
    }

    /** Runs the statements; the object's labels afterwards. */
    public function apply(Connection $conn, string $catalog, int $oid, int $subid, mixed $labels): array
    {
        $sql = $this->sql($conn, $catalog, $oid, $subid, $labels);
        if ($sql !== '') {
            $conn->queryMulti($sql);
        }

        return $this->show($conn, $catalog, $oid, $subid);
    }

    /**
     * The object's keyword and identity, as SECURITY LABEL names it.
     *
     * @return array{0: string, 1: string}
     */
    private function identify(Connection $conn, string $catalog, int $oid, int $subid): array
    {
        if (!in_array($catalog, self::CATALOGS, true)) {
            throw new BadRequestException(sprintf('"%s" is not a catalog security labels are kept for.', $catalog));
        }
        if ($subid !== 0 && $catalog !== 'pg_class') {
            throw new BadRequestException('Only a relation has columns.');
        }
        $row = $conn->row('SELECT type, identity FROM pg_catalog.pg_identify_object($1::regclass, $2::oid, $3::integer)', ["pg_catalog.$catalog", $oid, $subid]);
        if ($row === null || $row['identity'] === null || $row['identity'] === '') {
            throw new NotFoundException('Could not find the object.');
        }
        $keyword = self::KEYWORDS[(string) $row['type']] ?? throw new BadRequestException(sprintf('A %s cannot be given security labels here.', $row['type']));

        return [$keyword, (string) $row['identity']];
    }

    /** @return list<array{provider: string, label: string}> */
    private function labels(Connection $conn, string $catalog, int $oid, int $subid): array
    {
        $rows = in_array($catalog, self::SHARED, true)
            ? $conn->rows('SELECT provider, label FROM pg_catalog.pg_shseclabel WHERE classoid = $1::regclass AND objoid = $2 ORDER BY provider', ["pg_catalog.$catalog", $oid])
            : $conn->rows('SELECT provider, label FROM pg_catalog.pg_seclabel WHERE classoid = $1::regclass AND objoid = $2 AND objsubid = $3 ORDER BY provider', ["pg_catalog.$catalog", $oid, $subid]);

        return array_map(static fn (array $r): array => ['provider' => (string) $r['provider'], 'label' => (string) $r['label']], $rows);
    }

    /** @return list<string> the providers loaded, or named by a label already */
    private function providers(Connection $conn): array
    {
        $providers = array_column($conn->rows('SELECT provider FROM pg_catalog.pg_seclabel UNION SELECT provider FROM pg_catalog.pg_shseclabel'), 'provider');
        $libraries = (string) $conn->scalar("SELECT concat_ws(',', current_setting('shared_preload_libraries', true), current_setting('session_preload_libraries', true), current_setting('local_preload_libraries', true))");
        foreach (explode(',', $libraries) as $library) {
            $module = basename(trim($library, " \t\"'"));
            $module = preg_replace('/\.(so|dll|dylib)$/', '', $module) ?? $module;
            if (isset(self::PROVIDER_MODULES[$module])) {
                $providers[] = self::PROVIDER_MODULES[$module];
            }
        }
        $providers = array_values(array_unique(array_map('strval', $providers)));
        sort($providers);

        return $providers;
    }

    /**
     * The client's labels, checked: each provider once, none without a provider.
     *
     * @return array<string, string> label by provider
     */
    private function fromClient(mixed $labels): array
    {
        $list = [];
        foreach (is_array($labels) ? $labels : [] as $entry) {
            $provider = trim((string) ($entry['provider'] ?? ''));
            $label = (string) ($entry['label'] ?? '');
            if ($provider === '' && $label === '') {
                continue;
            }
            if ($provider === '') {
                throw new BadRequestException('A security label needs its provider.');
            }
            if ($label === '') {
                throw new BadRequestException(sprintf('The label for provider "%s" is empty; remove the row to remove the label.', $provider));
            }
            if (isset($list[$provider])) {
                throw new BadRequestException(sprintf('The provider "%s" is given twice.', $provider));
            }
            $list[$provider] = $label;
        }

        return $list;
    }
}
