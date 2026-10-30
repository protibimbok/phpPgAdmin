<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Dump;

use PhpPgAdmin\Core\Database\Column;

/**
 * A RowFormat that can hold the rows of several relations in one file, one after the other
 * (JSON): head() opens the file and the first relation, next() each one after it.
 */
interface MultiRowFormat extends RowFormat
{
    /** @param list<Column> $columns the next relation's columns */
    public function next(array $columns): string;
}
