<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Dump;

use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\QueryException;
use PhpPgAdmin\Core\Http\ApiException;
use Psr\Http\Message\StreamInterface;
use RuntimeException;
use Throwable;

/**
 * The rows of a SELECT as a response body, written by a RowFormat (HTML, XML, INSERT or COPY
 * statements): what pg_dump cannot write, read here through a cursor in a read-only
 * repeatable-read transaction, a thousand rows at a time, so that nothing but one batch is held
 * in memory. DECLARE takes only a SELECT or VALUES, so a statement that would change data is
 * refused before anything is read.
 *
 * start() declares the cursor and reads the first batch, so a statement that fails (a syntax
 * error, a missing privilege) becomes an error response instead of a file. A failure after the
 * download has begun is told in the file, as DumpStream does for a plain dump.
 */
final class RowStream implements StreamInterface
{
    private const int BATCH = 1000;

    private const int CHUNK = 65536;

    private string $buffer = '';

    private bool $finished = false;

    private ?\DeflateContext $gzip;

    private function __construct(private ?Connection $conn, private readonly RowFormat $format, bool $gzip, private readonly string $errorComment)
    {
        $this->gzip = $gzip ? (deflate_init(ZLIB_ENCODING_GZIP, ['level' => 6]) ?: null) : null;
    }

    /**
     * Declare the cursor on the connection (which the stream then owns and closes) and read the
     * first batch.
     *
     * @param string $select a SELECT or VALUES statement
     * @param string $prefix written before the format's head (a header comment)
     * @param string $errorComment how a comment line starts in the format ("-- ", or "" when it has none)
     * @throws ApiException when the statement is refused or fails
     */
    public static function start(Connection $conn, string $select, RowFormat $format, bool $gzip, string $prefix = '', string $errorComment = '', ?string $encoding = null): self
    {
        $stream = new self($conn, $format, $gzip, $errorComment);
        try {
            if ($encoding !== null) {
                $conn->exec('SELECT pg_catalog.set_config($1, $2, false)', ['client_encoding', $encoding]);
            }
            $conn->exec('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
            $conn->exec('DECLARE pga_export NO SCROLL CURSOR FOR ' . rtrim(trim($select), ';'));
            $result = $conn->query(sprintf('FETCH FORWARD %d FROM pga_export', self::BATCH));
        } catch (QueryException $e) {
            $conn->close();

            throw new ApiException(422, $e->getMessage());
        }

        $stream->append($prefix . $format->head($result->columns()));
        $stream->take($result->textRows());

        return $stream;
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
        $this->conn?->close();
        $this->conn = null;
    }

    public function detach()
    {
        $this->close();

        return null;
    }

    public function getSize(): ?int
    {
        return null;
    }

    public function tell(): int
    {
        throw new RuntimeException('A row stream has no position.');
    }

    public function eof(): bool
    {
        return $this->finished && $this->buffer === '';
    }

    public function isSeekable(): bool
    {
        return false;
    }

    public function seek(int $offset, int $whence = SEEK_SET): void
    {
        throw new RuntimeException('A row stream is not seekable.');
    }

    public function rewind(): void
    {
        throw new RuntimeException('A row stream is not seekable.');
    }

    public function isWritable(): bool
    {
        return false;
    }

    public function write(string $string): int
    {
        throw new RuntimeException('A row stream is not writable.');
    }

    public function isReadable(): bool
    {
        return true;
    }

    public function read(int $length): string
    {
        while ($this->buffer === '' && !$this->finished) {
            $this->pull();
        }
        $chunk = substr($this->buffer, 0, $length);
        $this->buffer = substr($this->buffer, strlen($chunk));

        return $chunk;
    }

    public function getContents(): string
    {
        $contents = '';
        while (!$this->eof()) {
            $contents .= $this->read(self::CHUNK);
        }

        return $contents;
    }

    public function getMetadata(?string $key = null)
    {
        return $key === null ? [] : null;
    }

    /** The next batch, or the end of the file once the cursor is exhausted. */
    private function pull(): void
    {
        if ($this->conn === null) {
            $this->finish('');

            return;
        }
        try {
            $this->take($this->conn->query(sprintf('FETCH FORWARD %d FROM pga_export', self::BATCH))->textRows());
        } catch (Throwable $e) {
            error_log('phpPgAdmin export: ' . $e->getMessage());
            $this->close();
            $this->finish($this->errorComment === '' ? '' : "\n" . $this->errorComment . str_replace("\n", "\n" . $this->errorComment, $e->getMessage()) . "\n");
        }
    }

    /** @param list<list<string|null>> $rows a batch; fewer than a full one means the last */
    private function take(array $rows): void
    {
        if ($rows !== []) {
            $this->append($this->format->rows($rows));
        }
        if (count($rows) < self::BATCH) {
            try {
                $this->conn?->exec('CLOSE pga_export');
                $this->conn?->exec('COMMIT');
            } catch (Throwable) {
                // The rows are all read; a failing COMMIT of a read-only transaction loses nothing.
            }
            $this->close();
            $this->finish($this->format->foot());
        }
    }

    private function finish(string $tail): void
    {
        if ($this->finished) {
            return;
        }
        $this->buffer .= $this->compress($tail, true);
        $this->finished = true;
    }

    private function append(string $data): void
    {
        $this->buffer .= $this->compress($data, false);
    }

    private function compress(string $data, bool $last): string
    {
        if ($this->gzip === null) {
            return $data;
        }

        return (string) deflate_add($this->gzip, $data, $last ? ZLIB_FINISH : ZLIB_NO_FLUSH);
    }
}
