<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Import\Restore;

/**
 * What a file to import holds, told from its first bytes as pg_restore tells its archives
 * apart: a custom archive starts with "PGDMP", a tar archive has "ustar" at offset 257, a file
 * of COPY's binary format starts with its signature "PGCOPY\n\377\r\n\0", and anything else is
 * taken for text (SQL, CSV or COPY's text format). A gzip file is looked into.
 */
final readonly class FileFormat
{
    private function __construct(
        /** sql (any text), custom, tar, binary (COPY), or zip, which is not read */
        public string $kind,
        public bool $gzip,
    ) {
    }

    public static function of(string $path): ?self
    {
        $handle = @fopen($path, 'rb');
        if ($handle === false) {
            return null;
        }
        $head = (string) fread($handle, 8192);
        fclose($handle);
        if (str_starts_with($head, "PK\x03\x04")) {
            return new self('zip', false);
        }
        $gzip = str_starts_with($head, "\x1f\x8b");
        if ($gzip) {
            $head = self::inflatePrefix($head);
        }

        return new self(match (true) {
            str_starts_with($head, 'PGDMP') => 'custom',
            substr($head, 257, 5) === 'ustar' => 'tar',
            str_starts_with($head, "PGCOPY\n\xff\r\n\0") => 'binary',
            default => 'sql',
        }, $gzip);
    }

    public function isArchive(): bool
    {
        return $this->kind === 'custom' || $this->kind === 'tar';
    }

    /** What the first bytes of a gzip stream inflate to; gzdecode() refuses a stream cut short. */
    private static function inflatePrefix(string $head): string
    {
        $context = inflate_init(ZLIB_ENCODING_GZIP);

        return $context === false ? '' : (string) @inflate_add($context, $head, ZLIB_SYNC_FLUSH);
    }
}
