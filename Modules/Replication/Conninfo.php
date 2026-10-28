<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Replication;

/**
 * libpq's keyword/value connection strings, as a subscription stores its CONNECTION.
 *
 * pgAdmin cuts subconninfo apart with SPLIT_PART on "host=", " port"…, which breaks on a
 * quoted value or a keyword order of its own; this reads it as libpq does (values single-quoted
 * when they hold spaces, \ escaping inside quotes), and writes the values back the same way.
 */
final class Conninfo
{
    /** The keywords the subscription form edits, by pgAdmin's field names. */
    public const array FIELDS = [
        'host' => 'host',
        'port' => 'port',
        'username' => 'user',
        'password' => 'password',
        'db' => 'dbname',
        'connect_timeout' => 'connect_timeout',
        'passfile' => 'passfile',
        'sslmode' => 'sslmode',
        'sslcompression' => 'sslcompression',
        'sslcert' => 'sslcert',
        'sslkey' => 'sslkey',
        'sslrootcert' => 'sslrootcert',
        'sslcrl' => 'sslcrl',
    ];

    /**
     * "host=a port=5432 password='x y'" → ['host' => 'a', 'port' => '5432', 'password' => 'x y'].
     *
     * @return array<string, string>
     */
    public static function parse(string $conninfo): array
    {
        $params = [];
        $length = strlen($conninfo);
        $i = 0;
        while ($i < $length) {
            while ($i < $length && ctype_space($conninfo[$i])) {
                $i++;
            }
            if ($i >= $length) {
                break;
            }
            $start = $i;
            while ($i < $length && $conninfo[$i] !== '=' && !ctype_space($conninfo[$i])) {
                $i++;
            }
            $keyword = substr($conninfo, $start, $i - $start);
            while ($i < $length && ctype_space($conninfo[$i])) {
                $i++;
            }
            if ($i >= $length || $conninfo[$i] !== '=') {
                break;
            }
            $i++;
            while ($i < $length && ctype_space($conninfo[$i])) {
                $i++;
            }
            $value = '';
            if ($i < $length && $conninfo[$i] === "'") {
                $i++;
                while ($i < $length && $conninfo[$i] !== "'") {
                    if ($conninfo[$i] === '\\' && $i + 1 < $length) {
                        $i++;
                    }
                    $value .= $conninfo[$i++];
                }
                $i++;
            } else {
                while ($i < $length && !ctype_space($conninfo[$i])) {
                    if ($conninfo[$i] === '\\' && $i + 1 < $length) {
                        $i++;
                    }
                    $value .= $conninfo[$i++];
                }
            }
            $params[$keyword] = $value;
        }

        return $params;
    }

    /**
     * The string libpq reads back as the given keywords; empty values are left out.
     *
     * @param array<string, string> $params
     */
    public static function build(array $params): string
    {
        $parts = [];
        foreach ($params as $keyword => $value) {
            if ($value !== '') {
                $parts[] = $keyword . '=' . self::quote($value);
            }
        }

        return implode(' ', $parts);
    }

    /**
     * The form's fields (pgAdmin's names) from a stored connection string; the keywords the form
     * does not edit are kept under "other".
     *
     * @return array<string, mixed>
     */
    public static function toFields(string $conninfo): array
    {
        $params = self::parse($conninfo);
        $fields = [];
        foreach (self::FIELDS as $field => $keyword) {
            $fields[$field] = $params[$keyword] ?? '';
            unset($params[$keyword]);
        }
        $fields['other'] = $params;

        return $fields;
    }

    /**
     * The connection string of the form's fields, the other keywords after them.
     *
     * @param array<string, mixed> $fields
     * @param array<string, string> $other
     */
    public static function fromFields(array $fields, array $other = []): string
    {
        $params = [];
        foreach (self::FIELDS as $field => $keyword) {
            $params[$keyword] = trim((string) ($fields[$field] ?? ''));
        }

        return self::build([...$params, ...$other]);
    }

    private static function quote(string $value): string
    {
        if (preg_match('/[\s\'\\\\]/', $value) !== 1) {
            return $value;
        }

        return "'" . addcslashes($value, "\\'") . "'";
    }
}
