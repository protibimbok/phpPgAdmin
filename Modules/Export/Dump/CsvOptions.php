<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Dump;

use League\Route\Http\Exception\BadRequestException;

/**
 * The options of phpMyAdmin's CSV and "CSV for MS Excel" formats, as COPY's CSV format takes
 * them: one character each to separate, enclose and escape columns, the text NULL becomes, and
 * a header row. COPY ends lines with "\n"; another line terminator is put in by CsvLineEnds.
 * The Excel format is CSV with every value enclosed, "\r\n" line ends and the edition's
 * separator, as phpMyAdmin writes it. Tab-separated is COPY's text format (the classic
 * phpPgAdmin's "tab" export): tabs between columns, backslash escapes and NULL as \N.
 */
final readonly class CsvOptions
{
    public const array EDITIONS = ['win' => ';', 'mac_excel2003' => ';', 'mac_excel2008' => ','];

    public function __construct(
        public string $separator,
        public string $enclosed,
        public string $escaped,
        public string $terminated,
        public string $null,
        public bool $removeCrLf,
        public bool $columns,
        public bool $forceQuote,
        public bool $text = false,
    ) {
    }

    /**
     * The options for the format from the request's csv_* or excel_* fields, each left out
     * taking phpMyAdmin's default.
     *
     * @param array<string, mixed> $input
     */
    public static function fromArray(array $input, string $format): self
    {
        $string = static fn (string $key, string $default): string => is_string($input[$key] ?? null) ? $input[$key] : $default;
        $bool = static fn (string $key, bool $default): bool => array_key_exists($key, $input) ? filter_var($input[$key], FILTER_VALIDATE_BOOL) : $default;

        if ($format === 'tsv') {
            return new self("\t", '', '', "\n", $string('tsv_null', '\N'), false, $bool('tsv_columns', true), false, true);
        }

        if ($format === 'excel') {
            $edition = $string('excel_edition', 'win');
            if (!isset(self::EDITIONS[$edition])) {
                throw new BadRequestException(sprintf('"excel_edition" takes one of %s.', implode(', ', array_keys(self::EDITIONS))));
            }

            return new self(self::EDITIONS[$edition], '"', '"', "\r\n", $string('excel_null', 'NULL'), $bool('excel_remove_crlf', false), $bool('excel_columns', true), true);
        }

        // phpMyAdmin's escapes: \t in the separator, \r, \n and \t in the line terminator.
        $separator = str_replace('\t', "\t", $string('csv_separator', ','));
        $terminated = $string('csv_terminated', 'AUTO');
        $terminated = $terminated === '' || strtolower($terminated) === 'auto' ? "\n" : str_replace(['\r', '\n', '\t'], ["\r", "\n", "\t"], $terminated);
        $enclosed = $string('csv_enclosed', '"');
        $escaped = $string('csv_escaped', '"');
        $escaped = $escaped === '' ? $enclosed : $escaped;

        foreach (['separate' => $separator, 'enclose' => $enclosed, 'escape' => $escaped] as $what => $char) {
            if (strlen($char) !== 1) {
                throw new BadRequestException(sprintf('COPY takes one single-byte character to %s columns with.', $what));
            }
        }
        if ($separator === $enclosed) {
            throw new BadRequestException('Columns cannot be separated and enclosed with the same character.');
        }

        return new self($separator, $enclosed, $escaped, $terminated, $string('csv_null', 'NULL'), $bool('csv_remove_crlf', false), $bool('csv_columns', true), false);
    }
}
