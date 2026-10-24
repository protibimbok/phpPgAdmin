<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Nodes;

use PhpPgAdmin\Core\Database\Quoting;

/**
 * Privileges as pgAdmin passes them between the catalog, the client and the DDL templates
 * (parse_priv_from_db and parse_priv_to_db in servers/utils.py).
 *
 * The catalog side is a row per grantee with parallel lists of privilege codes and grant
 * options; the client side is {grantor, grantee, privileges: [{privilege_type, privilege,
 * with_grant}]}; the template side is {grantor, grantee, with_grant: [...], without_grant: [...],
 * old_grantee, acltype} with the privileges spelled out and ALL collapsed.
 */
final class Acl
{
    public const array PRIVILEGES = [
        'c' => 'CONNECT',
        'C' => 'CREATE',
        'T' => 'TEMPORARY',
        'a' => 'INSERT',
        'r' => 'SELECT',
        'R' => 'READ',
        'w' => 'UPDATE',
        'W' => 'WRITE',
        'd' => 'DELETE',
        'D' => 'TRUNCATE',
        'x' => 'REFERENCES',
        't' => 'TRIGGER',
        'U' => 'USAGE',
        'X' => 'EXECUTE',
        'm' => 'MAINTAIN',
    ];

    /**
     * One catalog row ({grantor, grantee, privileges: [codes], grantable: [bools], acltype?}) as
     * the client reads it.
     *
     * @param array{grantor: string|null, grantee: string, privileges: list<string>|string, grantable: list<bool|string>|string, acltype?: string} $row
     * @return array{grantor: string|null, grantee: string, privileges: list<array{privilege_type: string, privilege: true, with_grant: bool}>, acltype?: string}
     */
    public static function fromDb(array $row): array
    {
        $codes = self::list($row['privileges']);
        $grantable = self::list($row['grantable']);

        $privileges = [];
        foreach ($codes as $index => $code) {
            $privileges[] = [
                'privilege_type' => $code,
                'privilege' => true,
                'with_grant' => self::truthy($grantable[$index] ?? false),
            ];
        }
        usort($privileges, static fn (array $a, array $b): int => strcmp($a['privilege_type'], $b['privilege_type']));

        $acl = ['grantor' => $row['grantor'] ?? null, 'grantee' => $row['grantee'], 'privileges' => $privileges];
        if (isset($row['acltype'])) {
            $acl['acltype'] = $row['acltype'];
        }

        return $acl;
    }

    /**
     * Every row of an ACL query, grouped under the column the templates read ("relacl", "nspacl"…).
     *
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    public static function allFromDb(array $rows): array
    {
        return array_map(self::fromDb(...), $rows);
    }

    /**
     * The client's privilege entries as the DDL templates take them. Codes the object does not
     * allow are dropped; a grantee holding every allowed privilege gets ALL; entries granting
     * the same set are merged into one "role1, role2" grantee.
     *
     * @param list<array<string, mixed>> $entries
     * @param list<string> $allowed the privilege codes the object type accepts, e.g. ['a', 'r', 'w', 'd', 'D', 'x', 't']
     * @return list<array{grantor: string, grantee: string, with_grant: list<string>, without_grant: list<string>, old_grantee: string, acltype: string}>
     */
    public static function toDb(array $entries, array $allowed = []): array
    {
        $privileges = [];
        $allowedCount = count($allowed);

        foreach ($entries as $entry) {
            $withGrant = [];
            $withoutGrant = [];

            foreach (self::normalise($entry['privileges'] ?? []) as $privilege) {
                $code = $privilege['privilege_type'];
                if (!isset(self::PRIVILEGES[$code]) || !in_array($code, $allowed, true)) {
                    continue;
                }
                if ($privilege['with_grant']) {
                    $withGrant[] = self::PRIVILEGES[$code];
                } elseif ($privilege['privilege']) {
                    $withoutGrant[] = self::PRIVILEGES[$code];
                }
            }

            if ($allowedCount > 1 && count($withGrant) === $allowedCount) {
                $withGrant = ['ALL'];
            }
            if ($allowedCount > 1 && count($withoutGrant) === $allowedCount) {
                $withoutGrant = ['ALL'];
            }

            $grantee = self::role((string) $entry['grantee']);
            $oldGrantee = array_key_exists('old_grantee', $entry) ? self::role((string) $entry['old_grantee']) : $grantee;

            $privileges[] = [
                'grantor' => Quoting::ident((string) ($entry['grantor'] ?? '')),
                'grantee' => $grantee,
                'with_grant' => $withGrant,
                'without_grant' => $withoutGrant,
                'old_grantee' => $oldGrantee,
                'acltype' => (string) ($entry['acltype'] ?? 'defaultacls'),
            ];
        }

        return self::groupByGrantee($privileges);
    }

    /**
     * The client sends a changed entry's privileges as {changed: [...]}; flatten that to the
     * plain list, with "privilege" and "with_grant" filled in as pgAdmin's _check_privilege_type does.
     *
     * @param array<mixed> $privileges
     * @return list<array{privilege_type: string, privilege: bool, with_grant: bool}>
     */
    private static function normalise(array $privileges): array
    {
        if (isset($privileges['changed']) && is_array($privileges['changed'])) {
            $privileges = array_map(static fn (array $p): array => [
                'privilege_type' => $p['privilege_type'],
                'privilege' => array_key_exists('privilege', $p) ? (bool) $p['privilege'] : array_key_exists('with_grant', $p),
                'with_grant' => array_key_exists('with_grant', $p) ? (bool) $p['with_grant'] : false,
            ], $privileges['changed']);
        }

        return array_values(array_map(static fn (array $p): array => [
            'privilege_type' => (string) $p['privilege_type'],
            'privilege' => (bool) ($p['privilege'] ?? false),
            'with_grant' => (bool) ($p['with_grant'] ?? false),
        ], $privileges));
    }

    /**
     * Merge entries that grant exactly the same privileges from the same grantor to different
     * roles into one GRANT … TO role1, role2, keeping the order of first appearance.
     *
     * @param list<array{grantor: string, grantee: string, with_grant: list<string>, without_grant: list<string>, old_grantee: string, acltype: string}> $privileges
     * @return list<array{grantor: string, grantee: string, with_grant: list<string>, without_grant: list<string>, old_grantee: string, acltype: string}>
     */
    private static function groupByGrantee(array $privileges): array
    {
        $grouped = [];
        foreach ($privileges as $privilege) {
            $key = implode("\0", [$privilege['grantor'], $privilege['acltype'], implode(',', $privilege['with_grant']), implode(',', $privilege['without_grant'])]);
            if (isset($grouped[$key])) {
                $grouped[$key]['grantee'] .= ', ' . $privilege['grantee'];
                $grouped[$key]['old_grantee'] .= ', ' . $privilege['old_grantee'];
            } else {
                $grouped[$key] = $privilege;
            }
        }

        return array_values($grouped);
    }

    /** PUBLIC is a keyword, not a role, so it is never quoted. */
    private static function role(string $name): string
    {
        return $name === 'PUBLIC' ? 'PUBLIC' : Quoting::ident($name);
    }

    /**
     * A PostgreSQL array as ext-pgsql hands it over ("{a,r,w}") or a list already.
     *
     * @return list<mixed>
     */
    private static function list(mixed $value): array
    {
        if (is_array($value)) {
            return array_values($value);
        }
        if (!is_string($value) || $value === '' || $value === '{}') {
            return [];
        }

        return array_map(static fn (string $v): string => trim($v, '"'), explode(',', trim($value, '{}')));
    }

    private static function truthy(mixed $value): bool
    {
        return $value === true || $value === 't' || $value === 'true' || $value === 1 || $value === '1';
    }
}
