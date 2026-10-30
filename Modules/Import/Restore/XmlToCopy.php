<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Import\Restore;

use DOMElement;
use PhpPgAdmin\Core\Http\ApiException;
use PhpPgAdmin\Modules\Export\Dump\CopyFormat;
use XMLReader;

/**
 * A table's rows in XML, turned into COPY's text format for CopyCommand to load. It reads the
 * classic phpPgAdmin's layout, which the Export page writes too:
 *
 *     <data>
 *     <header><column name="id" type="int4" /></header>
 *     <records><row><column name="id">1</column><column name="note" null="null" /></row></records>
 *     </data>
 *
 * and the data of phpMyAdmin's XML export, where each <table name="…"> of a <database> is a
 * row and only the rows of the table imported into are taken. The columns are the header's,
 * or the first row's in their order; a column a row leaves out is NULL. The file is read as a
 * stream, a row at a time, without network access or entity expansion.
 */
final class XmlToCopy
{
    /**
     * Convert the file and return the columns it holds, in the order the lines give them.
     *
     * @param list<string> $tableColumns the table's columns, which every column of the file must be
     * @return list<string>
     * @throws ApiException when the file is not XML of either layout, or names a column the table lacks
     */
    public static function convert(string $path, bool $gzip, string $target, string $table, array $tableColumns): array
    {
        $reader = new XMLReader();
        if (!@$reader->open(($gzip ? 'compress.zlib://' : '') . $path, null, LIBXML_NONET | LIBXML_COMPACT | LIBXML_PARSEHUGE)) {
            throw new ApiException(422, 'The XML file cannot be opened.');
        }
        $out = fopen($target, 'wb') ?: throw new ApiException(500, 'The converted rows cannot be written.');

        $header = [];
        $columns = null;
        $rows = 0;
        $previous = libxml_use_internal_errors(true);
        try {
            while (@$reader->read()) {
                if ($reader->nodeType !== XMLReader::ELEMENT || $reader->namespaceURI !== '') {
                    continue;
                }
                $element = $reader->localName;
                if ($element === 'header' && $reader->depth === 1) {
                    $node = $reader->expand();
                    foreach ($node?->childNodes ?? [] as $child) {
                        if ($child instanceof DOMElement && $child->localName === 'column') {
                            $header[] = $child->getAttribute('name');
                        }
                    }
                    $reader->next();
                    continue;
                }

                // A classic <row>, or phpMyAdmin's <table name="…"> inside a <database>.
                $isRow = $element === 'row' || ($element === 'table' && $reader->depth === 2);
                if (!$isRow) {
                    continue;
                }
                if ($element === 'table' && $reader->getAttribute('name') !== $table) {
                    $reader->next();
                    continue;
                }
                $node = $reader->expand();
                $values = [];
                foreach ($node?->childNodes ?? [] as $child) {
                    if ($child instanceof DOMElement && $child->localName === 'column') {
                        $values[$child->getAttribute('name')] = $child->getAttribute('null') === 'null' ? null : $child->textContent;
                    }
                }
                $reader->next();

                if ($columns === null) {
                    $columns = $header !== [] ? $header : array_map('strval', array_keys($values));
                    foreach ($columns as $name) {
                        if (!in_array($name, $tableColumns, true)) {
                            throw new ApiException(422, sprintf('The table "%s" has no column "%s", which the XML file holds.', $table, $name));
                        }
                    }
                }
                foreach (array_keys($values) as $name) {
                    if (!in_array((string) $name, $columns, true)) {
                        throw new ApiException(422, sprintf('Row %d of the XML file has a column "%s" the others do not.', $rows + 1, $name));
                    }
                }
                fwrite($out, implode("\t", array_map(static fn (string $name): string => CopyFormat::escape($values[$name] ?? null), $columns)) . "\n");
                $rows++;
            }

            $error = libxml_get_last_error();
            if ($error !== false && $error->level >= LIBXML_ERR_ERROR) {
                throw new ApiException(422, sprintf('The XML file is not well-formed: %s (line %d).', trim($error->message), $error->line));
            }
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
            $reader->close();
            fclose($out);
        }

        if ($columns === null) {
            throw new ApiException(422, sprintf('The XML file holds no rows: neither <records><row> elements nor phpMyAdmin <table name="%s"> rows.', $table));
        }

        return $columns;
    }
}
