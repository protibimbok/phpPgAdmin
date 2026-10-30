<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Dump;

/**
 * Rows as an HTML table, after phpMyAdmin's "Microsoft Word 2000" (htmlword) export and the
 * classic phpPgAdmin's HTML export: a document with a heading and one table, the column names
 * as its first row when asked, and NULL written as the given text.
 */
final class HtmlFormat implements RowFormat
{
    public function __construct(
        private readonly string $title,
        private readonly bool $columns,
        private readonly string $null,
        private readonly string $charset,
    ) {
    }

    public function head(array $columns): string
    {
        $html = sprintf(
            "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"%s\">\n<title>%s</title>\n</head>\n<body>\n<h2>%s</h2>\n<table border=\"1\" cellspacing=\"0\" cellpadding=\"3\">\n",
            self::e($this->charset),
            self::e($this->title),
            self::e($this->title),
        );
        if ($this->columns) {
            $html .= '<tr>' . implode('', array_map(static fn ($column): string => '<th>' . self::e($column->name) . '</th>', $columns)) . "</tr>\n";
        }

        return $html;
    }

    public function rows(array $rows): string
    {
        $out = '';
        foreach ($rows as $row) {
            $out .= '<tr>' . implode('', array_map(fn (?string $value): string => '<td>' . self::e($value ?? $this->null) . '</td>', $row)) . "</tr>\n";
        }

        return $out;
    }

    public function foot(): string
    {
        return "</table>\n</body>\n</html>\n";
    }

    private static function e(string $text): string
    {
        return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
    }
}
