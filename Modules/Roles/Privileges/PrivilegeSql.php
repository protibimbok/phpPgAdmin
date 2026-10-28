<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Roles\Privileges;

use PhpPgAdmin\Core\Database\Quoting;

/**
 * The GRANT and REVOKE statements that take one grantee's privileges on one target from what
 * they are to what they should be. Only the difference is granted or revoked, so privileges
 * left alone keep their grantor and whatever was granted on from them.
 *
 * Privileges are keyed by keyword (SELECT, USAGE…), the value telling whether the grantee may
 * grant it on (WITH GRANT OPTION).
 */
final class PrivilegeSql
{
    /**
     * @param string $prefix "" for an object, "ALTER DEFAULT PRIVILEGES FOR ROLE r IN SCHEMA s " for default privileges
     * @param string $target what follows ON: "TABLE public.t", "TABLES"
     * @param array<string, bool> $old
     * @param array<string, bool> $new
     * @param string|null $column a column of the table, for column privileges
     * @return list<string>
     */
    public static function diff(string $prefix, string $target, string $grantee, array $old, array $new, ?string $column = null): array
    {
        $role = self::role($grantee);
        $revoke = array_keys(array_diff_key($old, $new));
        $revokeOption = array_keys(array_filter($new, static fn (bool $grant, string $p): bool => !$grant && ($old[$p] ?? false), ARRAY_FILTER_USE_BOTH));
        $grant = array_keys(array_filter($new, static fn (bool $grant, string $p): bool => !$grant && !array_key_exists($p, $old), ARRAY_FILTER_USE_BOTH));
        $grantOption = array_keys(array_filter($new, static fn (bool $grant, string $p): bool => $grant && !($old[$p] ?? false), ARRAY_FILTER_USE_BOTH));

        $list = static fn (array $privileges): string => implode(', ', array_map(static fn (string $p): string => $column === null ? $p : sprintf('%s (%s)', $p, Quoting::ident($column)), $privileges));
        $statements = [];
        if ($revoke !== []) {
            $statements[] = sprintf('%sREVOKE %s ON %s FROM %s;', $prefix, $list($revoke), $target, $role);
        }
        if ($revokeOption !== []) {
            $statements[] = sprintf('%sREVOKE GRANT OPTION FOR %s ON %s FROM %s;', $prefix, $list($revokeOption), $target, $role);
        }
        if ($grant !== []) {
            $statements[] = sprintf('%sGRANT %s ON %s TO %s;', $prefix, $list($grant), $target, $role);
        }
        if ($grantOption !== []) {
            $statements[] = sprintf('%sGRANT %s ON %s TO %s WITH GRANT OPTION;', $prefix, $list($grantOption), $target, $role);
        }

        return $statements;
    }

    /**
     * The client's privileges ([{privilege, with_grant}]) as a keyword map, keeping only those
     * the object accepts.
     *
     * @param list<string> $allowed
     * @return array<string, bool>
     */
    public static function fromClient(mixed $privileges, array $allowed): array
    {
        $map = [];
        foreach (is_array($privileges) ? $privileges : [] as $privilege) {
            $keyword = strtoupper(trim((string) ($privilege['privilege'] ?? '')));
            if (in_array($keyword, $allowed, true)) {
                $map[$keyword] = filter_var($privilege['with_grant'] ?? false, FILTER_VALIDATE_BOOL);
            }
        }

        return $map;
    }

    /** PUBLIC is a keyword, not a role, so it is never quoted. */
    public static function role(string $name): string
    {
        return strtoupper($name) === 'PUBLIC' ? 'PUBLIC' : Quoting::ident($name);
    }
}
