<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Dump;

use PhpPgAdmin\Core\Http\ApiException;
use Psr\Http\Message\StreamInterface;
use RuntimeException;

/**
 * A running pg_dump or pg_dumpall as a response body: its output is passed on as it comes,
 * gzipped here when asked (pg_dumpall cannot compress, and plain and tar output then share
 * one way), and nothing is held in memory or on disk but a chunk at a time.
 *
 * start() waits for the program's first output, so a dump that fails before writing anything
 * (no connection, a permission or lock error) becomes an error response instead of a file. A
 * failure after the download has begun can only be told in the file: a plain dump ends with a
 * comment carrying the program's message, an archive is cut short and the message logged.
 */
final class DumpStream implements StreamInterface
{
    private const int CHUNK = 65536;

    /** @var resource|null */
    private $process;

    /** @var resource|null */
    private $stdout;

    private string $buffer;

    private bool $finished = false;

    private ?\DeflateContext $gzip;

    /**
     * @param resource|null $process null when the program has already ended
     * @param resource|null $stdout
     */
    private function __construct($process, $stdout, private readonly string $stderrFile, string $first, private readonly string $program, bool $gzip, private readonly bool $plain)
    {
        $this->process = $process;
        $this->stdout = $stdout;
        $this->gzip = $gzip ? (deflate_init(ZLIB_ENCODING_GZIP, ['level' => 6]) ?: null) : null;
        $this->buffer = $this->compress($first, $process === null);
        $this->finished = $process === null;
    }

    /**
     * Run the program and wait for its first output.
     *
     * @param list<string> $arguments
     * @param array<string, string> $environment
     * @param string $prefix written before the program's output (a header comment)
     * @throws ApiException when the program fails before writing anything
     */
    public static function start(string $program, array $arguments, array $environment, bool $gzip, bool $plain, string $prefix = ''): self
    {
        $stderrFile = tempnam(sys_get_temp_dir(), 'pgdump') ?: throw new RuntimeException('No temporary file for the dump\'s messages.');
        $process = proc_open([$program, ...$arguments], [0 => ['file', '/dev/null', 'r'], 1 => ['pipe', 'w'], 2 => ['file', $stderrFile, 'w']], $pipes, null, $environment + ['PATH' => (string) getenv('PATH'), 'LC_MESSAGES' => 'C']);
        if ($process === false) {
            @unlink($stderrFile);
            throw new ApiException(500, sprintf('%s could not be started.', basename($program)));
        }
        $stdout = $pipes[1];

        $first = (string) fread($stdout, self::CHUNK);
        if ($first === '' && feof($stdout)) {
            fclose($stdout);
            $status = proc_close($process);
            $message = trim((string) file_get_contents($stderrFile));
            @unlink($stderrFile);
            if ($status !== 0) {
                // The program's own "error:" lines are the message; the server's warnings and
                // notices around them (a collation version mismatch, say) are the detail.
                $lines = array_values(array_filter(explode("\n", $message), static fn (string $line): bool => trim($line) !== ''));
                $errors = array_values(array_filter($lines, static fn (string $line): bool => preg_match('/^pg_dump(all)?: (error|fatal):/', $line) === 1));
                $rest = array_values(array_diff($lines, $errors));

                throw new ApiException(422, self::message(basename($program), implode("\n", $errors === [] ? $lines : $errors), $status), $errors === [] || $rest === [] ? [] : ['detail' => implode("\n", $rest)]);
            }

            return new self(null, null, $stderrFile, $prefix, basename($program), $gzip, $plain);
        }

        return new self($process, $stdout, $stderrFile, $prefix . $first, basename($program), $gzip, $plain);
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
        if ($this->stdout !== null) {
            fclose($this->stdout);
            $this->stdout = null;
        }
        if ($this->process !== null) {
            // A client that went away leaves the program running: stop it.
            proc_terminate($this->process);
            proc_close($this->process);
            $this->process = null;
        }
        if (is_file($this->stderrFile)) {
            @unlink($this->stderrFile);
        }
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
        throw new RuntimeException('A dump stream has no position.');
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
        throw new RuntimeException('A dump stream is not seekable.');
    }

    public function rewind(): void
    {
        throw new RuntimeException('A dump stream is not seekable.');
    }

    public function isWritable(): bool
    {
        return false;
    }

    public function write(string $string): int
    {
        throw new RuntimeException('A dump stream is not writable.');
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

    private function pull(): void
    {
        $data = $this->stdout !== null ? (string) fread($this->stdout, self::CHUNK) : '';
        if ($data !== '' || ($this->stdout !== null && !feof($this->stdout))) {
            $this->buffer .= $this->compress($data, false);

            return;
        }

        $tail = '';
        if ($this->stdout !== null) {
            fclose($this->stdout);
            $this->stdout = null;
        }
        if ($this->process !== null) {
            $status = proc_close($this->process);
            $this->process = null;
            if ($status !== 0) {
                $message = self::message($this->program, trim((string) @file_get_contents($this->stderrFile)), $status);
                error_log('phpPgAdmin export: ' . $message);
                if ($this->plain) {
                    $tail = "\n-- " . str_replace("\n", "\n-- ", $message) . "\n";
                }
            }
        }
        @unlink($this->stderrFile);
        $this->buffer .= $this->compress($tail, true);
        $this->finished = true;
    }

    private function compress(string $data, bool $last): string
    {
        if ($this->gzip === null) {
            return $data;
        }

        return (string) deflate_add($this->gzip, $data, $last ? ZLIB_FINISH : ZLIB_NO_FLUSH);
    }

    private static function message(string $program, string $stderr, int $status): string
    {
        $lines = array_values(array_filter(explode("\n", $stderr), static fn (string $line): bool => trim($line) !== ''));

        return $lines === [] ? sprintf('%s failed (exit status %d).', $program, $status) : implode("\n", $lines);
    }
}
