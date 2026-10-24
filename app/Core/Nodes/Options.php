<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Nodes;

/**
 * The per-object settings pgAdmin shows as lists on its dialogs: the configuration parameters
 * of a database or role (pg_db_role_setting.setconfig) and security labels. Ports of
 * parse_variables_from_db and parse_sec_labels_from_db in servers/databases/utils.py.
 */
final class Options
{
    /**
     * "name=value" settings, one row per role/database pair with a "setconfig" array, as the
     * client lists them: [{name, value, role?, database?}]. "false"/"off" become false, as
     * pgAdmin saves booleans that way.
     *
     * @param list<array<string, mixed>> $rows rows with setconfig, and user_name / db_name when known
     * @return list<array{name: string, value: mixed, role?: string|null, database?: string|null}>
     */
    public static function parseVariables(array $rows): array
    {
        $variables = [];

        foreach ($rows as $row) {
            foreach (self::list($row['setconfig'] ?? null) as $setting) {
                [$name, $value] = array_pad(explode('=', $setting, 2), 2, '');
                if ($value === 'false' || $value === 'off') {
                    $value = false;
                }

                $variable = ['name' => $name, 'value' => $value];
                if (array_key_exists('user_name', $row)) {
                    $variable['role'] = $row['user_name'];
                }
                if (array_key_exists('db_name', $row)) {
                    $variable['database'] = $row['db_name'];
                }
                $variables[] = $variable;
            }
        }

        return $variables;
    }

    /**
     * "provider=label" entries as [{provider, label}].
     *
     * @return list<array{provider: string, label: string}>
     */
    public static function parseSecurityLabels(mixed $labels): array
    {
        $result = [];

        foreach (self::list($labels) as $entry) {
            if (preg_match('/^([^=]+)=(.*)$/s', $entry, $m) === 1) {
                $result[] = ['provider' => $m[1], 'label' => $m[2]];
            }
        }

        return $result;
    }

    /**
     * A PostgreSQL text array as ext-pgsql hands it over ('{"a=b",c=d}'), or a list already.
     *
     * @return list<string>
     */
    public static function list(mixed $value): array
    {
        if (is_array($value)) {
            return array_values(array_map(strval(...), $value));
        }
        if (!is_string($value) || $value === '' || $value === '{}') {
            return [];
        }

        // Elements are comma-separated; a quoted element may hold commas, quotes and backslashes.
        $items = [];
        $length = strlen($value);
        $i = 1; // skip "{"
        while ($i < $length - 1) {
            if ($value[$i] === '"') {
                $item = '';
                $i++;
                while ($i < $length && $value[$i] !== '"') {
                    if ($value[$i] === '\\' && $i + 1 < $length) {
                        $i++;
                    }
                    $item .= $value[$i++];
                }
                $i++; // closing quote
                $items[] = $item;
            } else {
                $end = strpos($value, ',', $i);
                if ($end === false || $end > $length - 1) {
                    $end = $length - 1;
                }
                $items[] = substr($value, $i, $end - $i);
                $i = $end;
            }
            if ($i < $length && $value[$i] === ',') {
                $i++;
            }
        }

        return $items;
    }
}
