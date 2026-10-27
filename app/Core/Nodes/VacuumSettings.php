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

    /** The settings a table or materialized view may set per relation, besides autovacuum_enabled. */
    public const array OPTIONS = [
        'autovacuum_vacuum_threshold', 'autovacuum_vacuum_scale_factor', 'autovacuum_analyze_threshold',
        'autovacuum_analyze_scale_factor', 'autovacuum_vacuum_cost_delay', 'autovacuum_vacuum_cost_limit',
        'autovacuum_freeze_min_age', 'autovacuum_freeze_max_age', 'autovacuum_freeze_table_age',
    ];

    /**
     * pgAdmin's update_autovacuum_properties: autovacuum_enabled as 'x' (not set), 't' or 'f',
     * and whether any custom setting is in force, for the relation and its TOAST table.
     *
     * @param array<string, mixed> $row the relation's properties row
     */
    public static function flags(array &$row): void
    {
        foreach (['' => 'autovacuum_custom', 'toast_' => 'toast_autovacuum'] as $prefix => $flag) {
            $enabled = $row[$prefix . 'autovacuum_enabled'] ?? null;
            $row[$prefix . 'autovacuum_enabled'] = $enabled === null ? 'x' : ($enabled ? 't' : 'f');

            $custom = $row[$prefix . 'autovacuum_enabled'] !== 'x';
            foreach (self::OPTIONS as $option) {
                if (!empty($row[$prefix . $option])) {
                    $custom = true;
                }
            }
            $row[$flag] = $custom;
        }
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
