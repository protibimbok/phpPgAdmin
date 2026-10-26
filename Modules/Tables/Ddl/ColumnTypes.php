<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Ddl;

/**
 * Column types as the forms and templates pass them around: the bare type name, whether it is
 * an array, and the length and precision its modifier holds. Ports of pgAdmin's
 * DataTypeReader (schemas/utils.py) and the helpers of columns/utils.py.
 */
final class ColumnTypes
{
    /** Types whose modifier is a length (pgAdmin's DATA_TYPE_WITH_LENGTH), by the name format_type gives them. */
    private const array LENGTH_TYPES = ['bit', 'bit varying', 'varbit', 'character', 'bpchar', 'character varying', 'varchar', 'vector', 'halfvec', 'sparsevec'];

    /** Types whose modifier is a fractional-seconds precision, written inside the name for the time types. */
    private const array TIME_TYPES = ['time', 'time without time zone', 'time with time zone', 'timetz', 'timestamp', 'timestamp without time zone', 'timestamp with time zone', 'timestamptz', 'interval'];

    /** The integer types a SERIAL declaration stands for. */
    public const array SERIAL_TYPES = ['serial' => 'integer', 'smallserial' => 'smallint', 'bigserial' => 'bigint'];

    /**
     * The type without its array brackets, and whether it had them: pgAdmin's type_formatter.
     *
     * @return array{0: string, 1: bool}
     */
    public static function split(string $type): array
    {
        return str_ends_with($type, '[]') ? [substr($type, 0, -2), true] : [$type, false];
    }

    /**
     * The type name without length and precision, so it matches the names the type list offers:
     * "character varying(20)" is "character varying", "timestamp(3) with time zone" is
     * "timestamp with time zone", "interval hour to minute" is "interval". pgAdmin's parse_type_name.
     */
    public static function parseTypeName(string $type): string
    {
        [$name, $isArray] = self::split($type);

        $open = strpos($name, '(');
        if ($open !== false && str_ends_with($name, ')')) {
            $name = substr($name, 0, $open);
        } elseif ($open !== false && str_starts_with($name, 'time')) {
            $name = (string) preg_replace('/\(\d+\)/', '', $name);
        } elseif (str_starts_with($name, 'interval')) {
            $name = 'interval';
        }

        return $name . ($isArray ? '[]' : '');
    }

    /**
     * Whether the type takes a length and a precision: numeric takes both, the character, bit
     * and time types a length only. pgAdmin's get_length_precision, by name.
     *
     * @return array{length: bool, precision: bool}
     */
    public static function lengthPrecision(string $typname): array
    {
        [$name] = self::split($typname);
        if ($name === 'numeric' || $name === 'decimal') {
            return ['length' => true, 'precision' => true];
        }

        return ['length' => in_array($name, self::LENGTH_TYPES, true) || in_array($name, self::TIME_TYPES, true), 'precision' => false];
    }

    /**
     * The length and precision inside a full type's parentheses, "(10,2)" → ["10", "2"]: pgAdmin's parse_params.
     *
     * @return array{0: string, 1: string}|null
     */
    public static function parseParams(string $fullType): ?array
    {
        return preg_match('/\((\d*[a-zA-Z]*),?(\d*)\)/', $fullType, $m) === 1 ? [$m[1], $m[2]] : null;
    }

    /**
     * Fill attlen and attprecision of a catalog column from its full type (cltype), as the
     * templates expect them: pgAdmin's fetch_length_precision.
     *
     * @param array<string, mixed> $column
     */
    public static function fetchLengthPrecision(array &$column): void
    {
        $column['attlen'] = null;
        $column['attprecision'] = null;

        $takes = self::lengthPrecision((string) ($column['typname'] ?? ''));
        $params = self::parseParams((string) ($column['cltype'] ?? ''));
        if ($params === null) {
            return;
        }
        if ($takes['length'] && $takes['precision']) {
            $column['attlen'] = $params[0];
            $column['attprecision'] = $params[1] !== '' ? $params[1] : null;
        } elseif ($takes['length']) {
            $column['attlen'] = $params[0];
        }
    }

    /**
     * Length and precision as strings, an empty one as null, so a 0 survives the templates'
     * truthiness tests: pgAdmin's convert_length_precision_to_string.
     *
     * @param array<string, mixed> $column
     */
    public static function normaliseLengths(array &$column): void
    {
        foreach (['attlen', 'attprecision'] as $key) {
            if (!array_key_exists($key, $column)) {
                continue;
            }
            $column[$key] = $column[$key] === '' || $column[$key] === null ? null : (string) $column[$key];
        }
    }
}
