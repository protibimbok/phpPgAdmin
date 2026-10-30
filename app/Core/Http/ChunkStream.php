<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Http;

use Psr\Http\Message\StreamInterface;
use RuntimeException;

/**
 * A read-only response body filled a chunk at a time by a producer, so a large download is
 * passed on as it is read instead of being held in memory or on disk first. The producer returns
 * the next chunk, or null when there is no more; the closer runs once, when the body is done or
 * dropped (to close a connection the producer reads from).
 */
final class ChunkStream implements StreamInterface
{
    private string $buffer = '';

    private bool $finished = false;

    private int $position = 0;

    /** @var (\Closure(): ?string)|null */
    private ?\Closure $producer;

    /** @var (\Closure(): void)|null */
    private ?\Closure $closer;

    /**
     * @param \Closure(): ?string $producer
     * @param (\Closure(): void)|null $closer
     */
    public function __construct(\Closure $producer, ?\Closure $closer = null, private readonly ?int $size = null)
    {
        $this->producer = $producer;
        $this->closer = $closer;
    }

    public function __destruct()
    {
        $this->close();
    }

    public function __toString(): string
    {
        return $this->getContents();
    }

    public function close(): void
    {
        $this->finished = true;
        $this->producer = null;
        if ($this->closer !== null) {
            $closer = $this->closer;
            $this->closer = null;
            $closer();
        }
    }

    public function detach()
    {
        $this->close();

        return null;
    }

    public function getSize(): ?int
    {
        return $this->size;
    }

    public function tell(): int
    {
        return $this->position;
    }

    public function eof(): bool
    {
        $this->fill();

        return $this->buffer === '' && $this->finished;
    }

    public function isSeekable(): bool
    {
        return false;
    }

    public function seek(int $offset, int $whence = SEEK_SET): void
    {
        throw new RuntimeException('The stream cannot seek.');
    }

    public function rewind(): void
    {
        throw new RuntimeException('The stream cannot rewind.');
    }

    public function isWritable(): bool
    {
        return false;
    }

    public function write(string $string): int
    {
        throw new RuntimeException('The stream is read-only.');
    }

    public function isReadable(): bool
    {
        return true;
    }

    public function read(int $length): string
    {
        $this->fill();
        $chunk = substr($this->buffer, 0, $length);
        $this->buffer = (string) substr($this->buffer, strlen($chunk));
        $this->position += strlen($chunk);

        return $chunk;
    }

    public function getContents(): string
    {
        $out = '';
        while (!$this->eof()) {
            $out .= $this->read(65536);
        }

        return $out;
    }

    public function getMetadata(?string $key = null)
    {
        return $key === null ? [] : null;
    }

    /** Ask the producer for more while the buffer is empty and it has not said it is done. */
    private function fill(): void
    {
        while ($this->buffer === '' && !$this->finished && $this->producer !== null) {
            $chunk = ($this->producer)();
            if ($chunk === null) {
                $this->close();

                return;
            }
            $this->buffer = $chunk;
        }
    }
}
