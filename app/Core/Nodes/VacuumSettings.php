<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Nodes;

use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Facades\Sql;

/**
 * The autovacuum settings a table or its TOAST table may override, with the server's defaults:
 * pgAdmin's VacuumSettings (schemas/utils.py) and the vacuum_settings templates.
 */
final class VacuumSettings
{
    /** @var array<string, array<string, list<array<string, mixed>>>> defaults per database and type */
    private static array $defaults = [];

    /**
     * The settings of the given type (table or toast) as [{name, label, column_type, setting}],
     * read once per database from pg_show_all_settings().
     *
     * @return list<array<string, mixed>>
     */
    public static function defaults(Connection $conn, string $type): array
    {
        $key = $conn->database();
        if (isset(self::$defaults[$key][$type])) {
            return self::$defaults[$key][$type];
        }

        /** @var array<string, array<string, array{0: string, 1: string, 2: string}>> $fields */
        $fields = json_decode(Sql::templates()->renderPlain('vacuum_settings/vacuum_fields.json'), true, flags: JSON_THROW_ON_ERROR);
        $columns = "'" . implode("','", array_keys($fields[$type])) . "'";

        $rows = [];
        foreach ($conn->rows(Sql::templates()->renderPlain('vacuum_settings/vacuum_defaults.sql', ['columns' => $columns])) as $row) {
            [$name, $label, $columnType] = $fields[$type][$row['name']];
            $rows[] = ['name' => $name, 'label' => $label, 'column_type' => $columnType, 'setting' => $row['setting']];
        }

        return self::$defaults[$key][$type] = $rows;
    }

    /**
     * The settings with the values the object sets ("value"), from its properties row; settings
     * it leaves to the default have no "value". Toast settings are read from the toast_* columns.
     *
     * @param array<string, mixed> $properties
     * @return list<array<string, mixed>>
     */
    public static function parse(Connection $conn, array $properties, string $type): array
    {
        $settings = [];
        foreach (self::defaults($conn, $type) as $row) {
            $column = $type === 'toast' ? 'toast_' . $row['name'] : $row['name'];
            if (isset($properties[$column]) && $properties[$column] !== '') {
                $value = (float) $properties[$column];
                $row['value'] = floor($value) == $value ? (int) $value : $value;
            }
            $settings[] = $row;
        }

        return $settings;
    }
}
