<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Nodes;

use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Facades\Sql;

/**
 * What an object depends on and what depends on it, read from pg_depend and pg_shdepend with
 * pgAdmin's queries (templates/depends) and shaped the way its Dependencies and Dependents
 * panels show it (get_dependencies, get_dependents, __fetch_dependency in browser/utils.py).
 */
final class Dependencies
{
    private const string TEMPLATES = 'depends';

    /** The node whose icon a type without a node of its own takes. */
    private const array ICON_OF = ['partition_table' => 'table', 'partition_index' => 'index', 'toast_table' => 'table'];

    /** relkind codes; null means the row needs a closer look. */
    private const array STANDARD_TYPES = [
        'r' => null, 'i' => 'index', 'S' => 'sequence', 'v' => 'view', 'p' => 'partition_table',
        'f' => 'foreign_table', 'm' => 'mview', 't' => 'toast_table', 'I' => 'partition_index',
    ];

    private const array CUSTOM_TYPES = [
        'x' => 'external_table', 'n' => 'schema', 'd' => 'domain', 'l' => 'language',
        'Cc' => 'check', 'Cd' => 'domain_constraints', 'Cf' => 'foreign_key', 'Cp' => 'primary_key',
        'Co' => 'collation', 'Cu' => 'unique_constraint', 'Cx' => 'exclusion_constraint',
        'Fw' => 'foreign_data_wrapper', 'Fs' => 'foreign_server', 'Fc' => 'fts_configuration',
        'Fp' => 'fts_parser', 'Fd' => 'fts_dictionary', 'Ft' => 'fts_template',
        'Ex' => 'extension', 'Et' => 'event_trigger', 'Pa' => 'package', 'Pf' => 'function',
        'Pt' => 'trigger_function', 'Pp' => 'procedure', 'Rl' => 'rule', 'Rs' => 'row_security_policy',
        'Sy' => 'synonym', 'Ty' => 'type', 'Tr' => 'trigger', 'Tc' => 'compound_trigger', 'c' => 'type',
        'A' => null,
    ];

    private const array DEP_TYPES = ['n' => 'normal', 'a' => 'auto', 'i' => null, 'p' => null];

    /**
     * The objects the given one depends on, including the roles that own it or hold privileges on it.
     *
     * @param string|null $where a WHERE clause replacing the default "WHERE dep.objid=<oid>"
     * @return list<array{type: string, name: string, field: string, icon: string|null}>
     */
    public static function of(Connection $conn, int $oid, ?string $where = null, bool $showSystemObjects = false): array
    {
        $where ??= sprintf('WHERE dep.objid=%d::oid', $oid);
        $sql = Sql::render(self::TEMPLATES, 'dependencies.sql', ['where_clause' => $where, 'object_id' => $oid], $conn->version());
        $dependencies = self::fetch($conn, $sql, $showSystemObjects);

        // Roles are in pg_shdepend, which has no "subid" to restrict by.
        if (!str_contains($where, 'subid')) {
            $sql = Sql::render(self::TEMPLATES, 'role_dependencies.sql', ['where_clause' => $where, 'conn' => $conn], $conn->version());
            foreach ($conn->rows($sql) as $row) {
                if ((int) $row['refclassid'] !== 1260) {
                    continue;
                }
                $dependencies[] = [
                    'type' => 'role',
                    'name' => (string) $row['refname'],
                    'field' => match ($row['deptype']) { 'a' => 'ACL', 'o' => 'Owner', default => '' },
                    'icon' => Nodes::find('role')?->icon ?: null,
                ];
            }
        }

        return $dependencies;
    }

    /**
     * The objects that depend on the given one.
     *
     * @return list<array{type: string, name: string, field: string, icon: string|null}>
     */
    public static function dependents(Connection $conn, int $oid, ?string $where = null, bool $showSystemObjects = false): array
    {
        $where ??= sprintf('WHERE dep.refobjid=%d::oid', $oid);
        $sql = Sql::render(self::TEMPLATES, 'dependents.sql', ['where_clause' => $where, 'object_id' => $oid], $conn->version());

        return self::fetch($conn, $sql, $showSystemObjects);
    }

    /** @return list<array{type: string, name: string, field: string, icon: string|null}> */
    private static function fetch(Connection $conn, string $sql, bool $showSystemObjects): array
    {
        $types = [...self::STANDARD_TYPES, ...self::CUSTOM_TYPES];
        $result = [];

        foreach ($conn->rows($sql) as $row) {
            $refName = (string) ($row['refname'] ?? '');
            $typeCode = (string) ($row['type'] ?? '');
            $depCode = (string) ($row['deptype'] ?? '');
            $prefix = $row['nspname'] !== null && $row['nspname'] !== '' ? $row['nspname'] . '.' : '';
            $typeName = '';
            $keepRef = true;

            if ($typeCode !== '' && array_key_exists($typeCode, $types) && $types[$typeCode] !== null) {
                $typeName = $types[$typeCode];
                if ($typeCode === 'Rl') {
                    $prefix = $refName . ' ON ' . $prefix . (string) $row['ownertable'];
                    $keepRef = false;
                } elseif ($typeCode === 'Cf') {
                    $prefix .= (string) $row['ownertable'] . '.';
                }
            } elseif ($typeCode !== '' && array_key_exists($typeCode[0], $types) && $types[$typeCode[0]] === null) {
                if ($typeCode[0] === 'r') {
                    // "r" followed by the column number: a column when the number is above zero.
                    $sub = (int) substr($typeCode, 1);
                    if ($sub > 0) {
                        $typeName = 'column';
                    } else {
                        $typeName = 'table';
                        $inherits = ($row['is_inherits'] ?? '0') === '1';
                        $inherited = ($row['is_inherited'] ?? '0') === '1';
                        if ($inherits && !$inherited && $depCode === 'a') {
                            $typeName = 'partition';
                        }
                    }
                } elseif ($typeCode[0] === 'A') {
                    // A column default: only worth listing when it calls a function.
                    if (!str_starts_with((string) ($row['adbin'] ?? ''), '{FUNCEXPR')) {
                        continue;
                    }
                    $typeName = 'function';
                    $prefix = (string) $row['adsrc'];
                    $keepRef = false;
                }
            } else {
                continue;
            }

            $name = $keepRef ? $prefix . $refName : $prefix;

            $field = '';
            if ($depCode !== '' && array_key_exists($depCode[0], self::DEP_TYPES)) {
                if (self::DEP_TYPES[$depCode[0]] === null) {
                    if ($depCode[0] === 'i') {
                        if (!$showSystemObjects) {
                            continue;
                        }
                        $field = 'internal';
                    } elseif ($depCode[0] === 'p') {
                        $field = 'pin';
                        $typeName = '';
                    }
                } else {
                    $field = self::DEP_TYPES[$depCode[0]];
                }
            }

            // pgAdmin's icon classes name its own sprites; the node type's icon is ours.
            $result[] = ['type' => $typeName, 'name' => $name, 'field' => $field, 'icon' => Nodes::find(self::ICON_OF[$typeName] ?? $typeName)?->icon ?: null];
        }

        return $result;
    }
}
