<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Import\Restore;

use League\Route\Http\Exception\BadRequestException;

/**
 * The options of a table's import through COPY … FROM STDIN, in phpMyAdmin's CSV terms where it
 * has them and pgAdmin's import options where it does not: the characters that separate,
 * enclose and escape columns, the line terminator, how many rows to import, the columns the
 * file holds, whether a duplicate key updates the row it matches, whether a value COPY cannot
 * read skips its row (ON_ERROR ignore), a header line, and the NULL and DEFAULT strings. Each
 * format reads its own fields (csv_*, text_*, binary_*, xml_*); a field left out takes its default.
 * An XML file is converted to the text format first (XmlToCopy), its columns read from it.
 */
final readonly class CopyImport
{
    public const array FORMATS = ['csv', 'text', 'binary', 'xml'];

    /** The line terminators COPY reads, as phpMyAdmin's "Lines terminated with" field writes them. */
    private const array LINE_ENDS = ['auto', '\n', '\r\n', '\r'];

    /** @param list<string> $columns */
    public function __construct(
        /** csv, text or binary */
        public string $format,
        public string $separator,
        public string $enclosed,
        public string $escaped,
        /** How many rows to import at most; null for all of them. */
        public ?int $limit,
        /** The columns the file holds, in its order; empty for the table's own. */
        public array $columns,
        public bool $replace,
        public bool $ignoreErrors,
        /** none, skip (the first line holds column names), or match (and they are checked) */
        public string $header,
        public ?string $null,
        public ?string $default,
        /** The file's character set when the conversion decides it (UTF8 for XML), over the page's. */
        public ?string $encoding = null,
    ) {
    }

    /** The options for the rows an XML file was converted to: COPY's text format, with the file's columns, in UTF-8. */
    public function withColumns(array $columns): self
    {
        return new self($this->format, $this->separator, $this->enclosed, $this->escaped, $this->limit, $columns, $this->replace, $this->ignoreErrors, $this->header, $this->null, $this->default, 'UTF8');
    }

    /** @param array<string, mixed> $input */
    public static function fromArray(array $input, string $format): self
    {
        $string = static fn (string $key, string $default): string => is_string($input["{$format}_{$key}"] ?? null) ? $input["{$format}_{$key}"] : $default;
        $bool = static fn (string $key): bool => filter_var($input["{$format}_{$key}"] ?? false, FILTER_VALIDATE_BOOL);

        $limit = trim($string('partial_import', ''));
        if ($format === 'xml') {
            if ($limit !== '' && filter_var($limit, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]) === false) {
                throw new BadRequestException('The number of rows to import is a whole number.');
            }

            return new self('text', "\t", '', '', $limit === '' || (int) $limit === 0 ? null : (int) $limit, [], $bool('replace'), $bool('ignore'), 'none', '\N', null);
        }
        if ($limit !== '' && filter_var($limit, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]) === false) {
            throw new BadRequestException('The number of rows to import is a whole number.');
        }
        $columns = trim($string('columns', ''));
        $columns = $columns === '' ? [] : array_map(static fn (string $name): string => trim($name), explode(',', $columns));
        if (in_array('', $columns, true)) {
            throw new BadRequestException('A column name in the list is empty.');
        }
        if (count($columns) !== count(array_unique($columns))) {
            throw new BadRequestException('A column is named twice in the list.');
        }

        $separator = $enclosed = $escaped = '';
        if ($format !== 'binary') {
            // phpMyAdmin's escape: \t for a tab.
            $separator = str_replace('\t', "\t", $string('terminated', $format === 'csv' ? ',' : '\t'));
            $lineEnd = strtolower(trim($string('new_line', 'auto')));
            if (!in_array($lineEnd === '' ? 'auto' : $lineEnd, self::LINE_ENDS, true)) {
                throw new BadRequestException('COPY reads lines ending in \n, \r\n or \r, whichever the file uses: leave "Lines terminated with" at auto.');
            }
        }
        if ($format === 'csv') {
            $enclosed = $string('enclosed', '"');
            $escaped = $string('escaped', '"');
            $escaped = $escaped === '' ? $enclosed : $escaped;
        }
        foreach (['separate' => $separator, 'enclose' => $enclosed, 'escape' => $escaped] as $what => $char) {
            if ($format !== 'binary' && ($what === 'separate' || $format === 'csv') && strlen($char) !== 1) {
                throw new BadRequestException(sprintf('COPY takes one single-byte character to %s columns with.', $what));
            }
        }
        if ($format === 'csv' && $separator === $enclosed) {
            throw new BadRequestException('Columns cannot be separated and enclosed with the same character.');
        }
        if ($format !== 'binary' && in_array($separator, ["\n", "\r", '\\'], true)) {
            throw new BadRequestException('COPY cannot separate columns with a line break or a backslash.');
        }

        $header = 'none';
        if ($format !== 'binary' && $bool('col_names')) {
            $header = $bool('header_match') ? 'match' : 'skip';
        }
        $default = $format === 'binary' ? '' : $string('default', '');

        return new self(
            $format,
            $separator,
            $enclosed,
            $escaped,
            $limit === '' || (int) $limit === 0 ? null : (int) $limit,
            $columns,
            $bool('replace'),
            $format !== 'binary' && $bool('ignore'),
            $header,
            $format === 'binary' ? null : $string('null', $format === 'csv' ? '' : '\N'),
            $default === '' ? null : $default,
        );
    }

    /** Whether the rows go through a temporary table first: to update duplicates, or to stop at the row limit. */
    public function staged(): bool
    {
        return $this->replace || $this->limit !== null;
    }
}
