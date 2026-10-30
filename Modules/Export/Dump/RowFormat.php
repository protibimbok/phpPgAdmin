<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Dump;

use PhpPgAdmin\Core\Database\Column;

/**
 * How RowStream writes the rows it reads: what goes before the first row (given the result's
 * columns), each batch of rows as the server's text values with NULL as null, and what closes
 * the file.
 */
interface RowFormat
{
    /** @param list<Column> $columns */
    public function head(array $columns): string;

    /** @param list<list<string|null>> $rows */
    public function rows(array $rows): string;

    public function foot(): string;
}
