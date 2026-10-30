<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Dump;

use DateTimeImmutable;

/**
 * phpMyAdmin's file name template: @SERVER@, @DATABASE@, @SCHEMA@ and @TABLE@ become the
 * names of what is exported, strftime's conversions (%Y, %m, %d, %H, %M, %S, …) the time, and
 * the format's extension is added.
 */
final class FileName
{
    /** strftime conversions as DateTime formats. */
    private const array STRFTIME = [
        'a' => 'D', 'A' => 'l', 'd' => 'd', 'e' => 'j', 'j' => 'z', 'u' => 'N', 'w' => 'w',
        'U' => 'W', 'V' => 'W', 'W' => 'W', 'b' => 'M', 'B' => 'F', 'h' => 'M', 'm' => 'm',
        'y' => 'y', 'Y' => 'Y', 'G' => 'o', 'H' => 'H', 'k' => 'G', 'I' => 'h', 'l' => 'g',
        'M' => 'i', 'p' => 'A', 'P' => 'a', 'S' => 's', 'z' => 'O', 'Z' => 'T', 's' => 'U',
        'D' => 'm/d/y', 'F' => 'Y-m-d', 'T' => 'H:i:s', 'R' => 'H:i',
    ];

    /** The default template of each scope, phpMyAdmin's for the server, a database and a table; a query's rows are "query_result". */
    public const array DEFAULTS = ['server' => '@SERVER@', 'database' => '@DATABASE@', 'schema' => '@SCHEMA@', 'table' => '@TABLE@', 'query' => 'query_result'];

    /** @param array{server: string, database?: ?string, schema?: ?string, table?: ?string} $names */
    public static function expand(string $template, array $names, string $extension, ?DateTimeImmutable $now = null): string
    {
        $now ??= new DateTimeImmutable();
        $name = strtr($template, [
            '@SERVER@' => $names['server'],
            '@DATABASE@' => (string) ($names['database'] ?? ''),
            '@SCHEMA@' => (string) ($names['schema'] ?? ''),
            '@TABLE@' => (string) ($names['table'] ?? ''),
        ]);
        $name = (string) preg_replace_callback('/%(.)/', static fn (array $m): string => match (true) {
            $m[1] === '%' => '%',
            isset(self::STRFTIME[$m[1]]) => $now->format(self::STRFTIME[$m[1]]),
            default => $m[0],
        }, $name);

        // No directories, no control characters, nothing a shell or a file system trips over.
        $name = trim((string) preg_replace('/[\x00-\x1f\x7f\/\\\\:*?"<>|]+/u', '_', $name), " .\t");

        return ($name === '' ? 'dump' : $name) . $extension;
    }

    /** ".sql", ".dump", ".tar", ".csv", ".tsv", ".html", ".xml", with ".gz" when the output is gzipped here. */
    public static function extension(string $format, string $compression): string
    {
        return match ($format) {
            'custom' => '.dump',
            'tar' => '.tar',
            'csv', 'excel' => '.csv',
            'tsv' => '.tsv',
            'html' => '.html',
            'xml' => '.xml',
            default => '.sql',
        } . ($compression === 'gzip' && $format !== 'custom' ? '.gz' : '');
    }
}
