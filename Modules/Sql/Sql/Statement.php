<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sql\Sql;

/** One statement out of a batch: its text without the delimiter, and the line it starts on. */
final readonly class Statement
{
    public function __construct(
        public string $sql,
        /** 1-based line in the batch where the statement's first token is. */
        public int $line,
        /** 0-based character offset of the statement's text in the batch. */
        public int $offset,
    ) {
    }
}
