<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Dump;

use Nyholm\Psr7\Stream;
use PhpPgAdmin\Core\Http\ApiException;
use Psr\Http\Message\StreamInterface;
use RuntimeException;

/**
 * pg_dump's directory format (-Fd), which writes a directory of files instead of one stream
 * and is the only format --jobs can write in parallel. pg_dump writes it into a temporary
 * directory; once it has finished the directory is packed as a tar file whose one folder is
 * the dump, ready for `tar -xf` and then `pg_restore` on the folder, and the directory is
 * removed. The tar file is a temporary file that goes away when the response has been sent.
 *
 * Unlike the other formats nothing reaches the browser before pg_dump is done, so a failure is
 * always an error response and never a cut-off file.
 */
final class DirectoryDump
{
    /**
     * Run pg_dump into a temporary directory and return the tar of it.
     *
     * @param list<string> $arguments pg_dump's arguments without --file
     * @param array<string, string> $environment
     * @param string $folder the name of the dump's folder inside the tar file
     * @throws ApiException when pg_dump fails
     */
    public static function run(string $program, array $arguments, array $environment, string $folder): StreamInterface
    {
        $parent = sys_get_temp_dir() . '/pgdump-' . bin2hex(random_bytes(8));
        if (!mkdir($parent, 0700)) {
            throw new RuntimeException('No temporary directory for the dump.');
        }
        $target = $parent . '/dump';
        $stderrFile = $parent . '/stderr';

        try {
            $process = proc_open([$program, ...$arguments, '--file=' . $target], [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', $stderrFile, 'w']], $pipes, null, $environment + ['PATH' => (string) getenv('PATH'), 'LC_MESSAGES' => 'C']);
            if ($process === false) {
                throw new ApiException(500, sprintf('%s could not be started.', basename($program)));
            }
            $status = proc_close($process);
            if ($status !== 0) {
                throw DumpStream::failure(basename($program), trim((string) @file_get_contents($stderrFile)), $status);
            }

            $tar = tmpfile() ?: throw new RuntimeException('No temporary file for the tar archive.');
            self::pack($tar, $target, $folder);
            rewind($tar);

            return Stream::create($tar);
        } finally {
            self::remove($parent);
        }
    }

    /**
     * Write the directory's files as a POSIX ustar archive under the folder name: a header of
     * 512 bytes for the folder and for each file, each file's bytes padded to 512, and two
     * empty blocks to end it. pg_dump's files are named by number (toc.dat, 3456.dat.gz), so
     * every name fits the header.
     *
     * @param resource $out
     */
    private static function pack($out, string $directory, string $folder): void
    {
        $folder = trim((string) preg_replace('/[^A-Za-z0-9._-]+/', '_', $folder), '._') ?: 'dump';
        $folder = substr($folder, 0, 90);
        $now = time();
        fwrite($out, self::header($folder . '/', 0, $now, '5', 0o755));

        $files = array_values(array_filter(scandir($directory) ?: [], static fn (string $name): bool => is_file($directory . '/' . $name)));
        sort($files);
        foreach ($files as $name) {
            $path = $directory . '/' . $name;
            $size = (int) filesize($path);
            fwrite($out, self::header($folder . '/' . $name, $size, (int) filemtime($path), '0', 0o644));
            $in = fopen($path, 'rb') ?: throw new RuntimeException(sprintf('The dump file %s cannot be read.', $name));
            stream_copy_to_stream($in, $out);
            fclose($in);
            if ($size % 512 !== 0) {
                fwrite($out, str_repeat("\0", 512 - $size % 512));
            }
        }
        fwrite($out, str_repeat("\0", 1024));
    }

    private static function header(string $name, int $size, int $mtime, string $type, int $mode): string
    {
        $octal = static fn (int $value, int $length): string => str_pad(decoct($value), $length - 1, '0', STR_PAD_LEFT) . "\0";
        $header = str_pad($name, 100, "\0")
            . $octal($mode, 8)
            . $octal(0, 8)
            . $octal(0, 8)
            . ($size < 8 ** 11 ? $octal($size, 12) : self::base256($size, 12))
            . $octal($mtime, 12)
            . str_repeat(' ', 8)
            . $type
            . str_repeat("\0", 100)
            . "ustar\0" . '00'
            . str_pad('postgres', 32, "\0")
            . str_pad('postgres', 32, "\0")
            . str_repeat("\0", 16)
            . str_repeat("\0", 155);
        $header = str_pad($header, 512, "\0");
        $sum = array_sum(array_map('ord', str_split($header)));

        return substr_replace($header, str_pad(decoct($sum), 6, '0', STR_PAD_LEFT) . "\0 ", 148, 8);
    }

    /**
     * A number too large for its octal field (a file of 8 GiB or more) in GNU tar's base-256
     * form: the high bit of the first byte set, then the value big-endian.
     */
    private static function base256(int $value, int $length): string
    {
        $bytes = '';
        for ($i = 0; $i < $length; $i++) {
            $bytes = chr($value & 0xff) . $bytes;
            $value >>= 8;
        }

        return chr(ord($bytes[0]) | 0x80) . substr($bytes, 1);
    }

    private static function remove(string $directory): void
    {
        if (!is_dir($directory)) {
            return;
        }
        foreach (scandir($directory) ?: [] as $name) {
            if ($name === '.' || $name === '..') {
                continue;
            }
            $path = $directory . '/' . $name;
            is_dir($path) && !is_link($path) ? self::remove($path) : @unlink($path);
        }
        @rmdir($directory);
    }
}
