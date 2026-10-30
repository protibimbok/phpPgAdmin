<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Dump;

/**
 * Rows as the classic phpPgAdmin's XML export writes them, which the Import page reads back:
 *
 *     <data>
 *     <header><column name="id" type="int4" /></header>
 *     <records><row><column name="id">1</column><column name="note" null="null" /></row></records>
 *     </data>
 *
 * Characters XML 1.0 cannot hold (most control characters) are left out of the values.
 */
final class XmlFormat implements RowFormat
{
    /** @var list<string> */
    private array $names = [];

    public function __construct(private readonly string $encoding)
    {
    }

    public function head(array $columns): string
    {
        $this->names = array_map(static fn ($column): string => self::e($column->name), $columns);
        $xml = sprintf("<?xml version=\"1.0\" encoding=\"%s\"?>\n<data>\n<header>\n", self::e($this->encoding));
        foreach ($columns as $i => $column) {
            $xml .= sprintf("\t<column name=\"%s\" type=\"%s\" />\n", $this->names[$i], self::e($column->typeName));
        }

        return $xml . "</header>\n<records>\n";
    }

    public function rows(array $rows): string
    {
        $out = '';
        foreach ($rows as $row) {
            $out .= "\t<row>\n";
            foreach ($row as $i => $value) {
                $out .= $value === null
                    ? sprintf("\t\t<column name=\"%s\" null=\"null\" />\n", $this->names[$i])
                    : sprintf("\t\t<column name=\"%s\">%s</column>\n", $this->names[$i], self::e($value));
            }
            $out .= "\t</row>\n";
        }

        return $out;
    }

    public function foot(): string
    {
        return "</records>\n</data>\n";
    }

    private static function e(string $text): string
    {
        $text = (string) preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', $text);

        return htmlspecialchars($text, ENT_QUOTES | ENT_XML1 | ENT_SUBSTITUTE, 'UTF-8');
    }
}
