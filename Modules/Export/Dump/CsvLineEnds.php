<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Dump;

/**
 * Puts the line terminator asked for in place of the "\n" COPY ends its rows with, chunk by
 * chunk. A line break inside an enclosed value is data and stays as it is, so the filter
 * follows the quoting across chunks: inside a value, the escape character takes the next one
 * with it, and an enclosing character ends the value (two of them, when it is also the escape
 * character, end it and open it again, which comes to the same).
 */
final class CsvLineEnds
{
    private bool $quoted = false;

    /** The escape character was the last byte of the chunk before. */
    private bool $escaping = false;

    public function __construct(private readonly string $enclosed, private readonly string $escaped, private readonly string $terminated)
    {
    }

    public function __invoke(string $chunk): string
    {
        $out = '';
        $length = strlen($chunk);
        $i = 0;
        if ($this->escaping && $length > 0) {
            $out .= $chunk[0];
            $i = 1;
            $this->escaping = false;
        }
        $outside = "\n" . $this->enclosed;
        $inside = $this->enclosed === $this->escaped ? $this->enclosed : $this->enclosed . $this->escaped;

        while ($i < $length) {
            $span = strcspn($chunk, $this->quoted ? $inside : $outside, $i);
            $out .= substr($chunk, $i, $span);
            $i += $span;
            if ($i >= $length) {
                break;
            }
            $char = $chunk[$i++];
            if ($char === "\n") {
                $out .= $this->terminated;
            } elseif ($this->quoted && $char === $this->escaped && $this->escaped !== $this->enclosed) {
                $out .= $char;
                if ($i < $length) {
                    $out .= $chunk[$i++];
                } else {
                    $this->escaping = true;
                }
            } else {
                $out .= $char;
                $this->quoted = !$this->quoted;
            }
        }

        return $out;
    }
}
