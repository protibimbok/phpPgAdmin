<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Import\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Config;
use PhpPgAdmin\Core\Http\ApiException;
use PhpPgAdmin\Core\Process\BackgroundProcess;
use PhpPgAdmin\Modules\Export\Dump\ClientTools;
use PhpPgAdmin\Modules\Import\Restore\FileFormat;
use PhpPgAdmin\Modules\Import\Restore\ImportRequest;
use PhpPgAdmin\Modules\Import\Restore\RestoreCommand;
use PhpPgAdmin\Modules\Import\Storage\Processes;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Message\UploadedFileInterface;

/**
 * The Import pages' backend: what a scope offers (GET /api/import/options), and the import
 * itself (POST /api/import), a file uploaded or taken from the upload directory and run by
 * psql or pg_restore in the background. The page follows it through /api/processes.
 */
final class ImportController
{
    /** The files of the upload directory offered for import, by extension. */
    private const string LOCAL_FILES = '/\.(sql|dump|backup|custom|tar|pgdump)(\.gz)?$/i';

    /** @return array<string, mixed> */
    public function options(ServerRequestInterface $request): array
    {
        $query = $request->getQueryParams();
        $pool = ConnectionPool::from($request);
        $database = is_string($query['database'] ?? null) && $query['database'] !== '' ? $query['database'] : null;
        $schema = $database !== null && is_string($query['schema'] ?? null) && $query['schema'] !== '' ? $query['schema'] : null;
        $conn = $database === null ? $pool->maintenance() : $pool->for($database);
        if ($schema !== null) {
            $this->checkSchema($conn, $schema);
        }
        $tools = ClientTools::locate();

        return [
            'scope' => $database === null ? 'server' : ($schema === null ? 'database' : 'schema'),
            'encodings' => array_column($conn->rows("SELECT pg_encoding_to_char(i) AS name FROM generate_series(0, 63) AS i WHERE pg_encoding_to_char(i) <> '' ORDER BY 1"), 'name'),
            'max_upload' => self::maxUpload(),
            'upload_dir' => self::uploadDirectory(),
            'maintenance_db' => $pool->maintenance()->database(),
            'tools' => $tools === null ? null : [
                'directory' => $tools->directory,
                'version' => $tools->versionString(),
                'psql' => is_executable($tools->path('psql')),
                'pg_restore' => is_executable($tools->path('pg_restore')),
                'restricts' => RestoreCommand::restricts($tools),
                'policies' => $tools->version >= 180000,
                'statistics' => $tools->version >= 180000,
                'table_access_method' => $tools->version >= 150000,
            ],
        ];
    }

    /** @return array{process: array<string, mixed>} */
    public function import(ServerRequestInterface $request): array
    {
        $body = (array) ($request->getParsedBody() ?? []);
        $files = $request->getUploadedFiles();
        if ($body === [] && $files === [] && (int) $request->getHeaderLine('Content-Length') > self::bytes((string) ini_get('post_max_size'))) {
            throw new ApiException(413, sprintf('The file is larger than PHP accepts in a request (post_max_size = %s).', ini_get('post_max_size')));
        }
        $options = is_string($body['options'] ?? null) ? json_decode($body['options'], true) : $body;
        if (!is_array($options)) {
            throw new BadRequestException('The import options are not valid JSON.');
        }
        $import = ImportRequest::fromArray($options);
        $pool = ConnectionPool::from($request);

        $tools = ClientTools::locate() ?? throw new ApiException(503, 'The PostgreSQL client programs were not found. Set PGADMIN_PG_BIN_DIR (config/tools.php) to their directory.');
        $program = $import->format === 'sql' ? 'psql' : 'pg_restore';
        if (!is_executable($tools->path($program))) {
            throw new ApiException(503, sprintf('%s was not found in %s.', $program, $tools->directory));
        }
        if ($import->format === 'sql' && !RestoreCommand::restricts($tools)) {
            throw new ApiException(422, sprintf('psql %s cannot run a file in restricted mode, which keeps its meta-commands from running on the web server. Use the client programs of 18, or of 17.6, 16.10, 15.14, 14.19, 13.22 or newer.', $tools->versionString()));
        }

        $conn = $import->database === null ? $pool->maintenance() : $pool->for($import->database);
        if ($import->schema !== null) {
            $this->checkSchema($conn, $import->schema);
        }

        $process = BackgroundProcess::prepare();
        try {
            [$path, $name, $temporary] = $this->input($process, $files['import_file'] ?? null, $import->localFile);
            $format = FileFormat::of($path) ?? throw new ApiException(422, 'The file to import cannot be read.');
            $this->checkFormat($import, $format, $name);

            $command = new RestoreCommand($import, $tools, $format, $conn->database());
            $arguments = $command->arguments($path);
            if (session_status() === PHP_SESSION_ACTIVE) {
                session_write_close();
            }
            $process->start(
                $command->program(),
                $arguments,
                $command->environment() + $pool->environment($conn->database()),
                $command->readsFile() ? null : $path,
                $temporary,
                !$format->isArchive(),
            );
        } catch (\Throwable $e) {
            $process->remove();
            throw $e;
        }

        $processes = Processes::for(ProcessController::serverKey(), $pool->username());
        $processes->create(
            $process->id(),
            $import->database,
            $import->schema,
            'import',
            $name,
            // The command as the page shows it: the file by its name, and not psql's restrict key.
            [basename($command->program()), ...array_map(static fn (string $arg): string => match (true) {
                $arg === $path => $name,
                str_starts_with($arg, '--command=\\restrict ') => '--command=\\restrict …',
                default => $arg,
            }, $arguments)],
            $process->status()['started_at'] ?? gmdate('Y-m-d\TH:i:s\Z'),
        );

        return ['process' => ProcessController::describe($processes->find($process->id()) ?? throw new \LogicException('The process just stored is gone.'), $process)];
    }

    /**
     * The file to import: an upload, moved into the process's directory and removed when the
     * import ends, or a file of the upload directory, which stays.
     *
     * @return array{0: string, 1: string, 2: bool} the path, the name to show, and whether the file is the process's own
     */
    private function input(BackgroundProcess $process, mixed $upload, ?string $localFile): array
    {
        if ($upload instanceof UploadedFileInterface && $upload->getError() !== UPLOAD_ERR_NO_FILE) {
            if ($upload->getError() !== UPLOAD_ERR_OK) {
                throw new ApiException(422, match ($upload->getError()) {
                    UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => sprintf('The file is larger than PHP accepts (upload_max_filesize = %s).', ini_get('upload_max_filesize')),
                    UPLOAD_ERR_PARTIAL => 'The file was only partly uploaded.',
                    UPLOAD_ERR_NO_TMP_DIR => 'PHP has no temporary directory for uploads.',
                    UPLOAD_ERR_CANT_WRITE => 'PHP could not write the upload to disk.',
                    default => 'The upload failed.',
                });
            }
            $name = basename(str_replace('\\', '/', (string) $upload->getClientFilename())) ?: 'upload';
            $path = $process->directory . '/input';
            $upload->moveTo($path);

            return [$path, $name, true];
        }

        if ($localFile !== null) {
            $directory = Config::get('storage.upload_dir');
            $name = basename($localFile);
            $path = is_string($directory) && $directory !== '' ? rtrim($directory, '/') . '/' . $name : null;
            if ($path === null || $name !== $localFile || !is_file($path) || !is_readable($path)) {
                throw new ApiException(422, sprintf('"%s" is not a file of the upload directory.', $localFile));
            }

            return [$path, $name, false];
        }

        throw new ApiException(422, 'No file was chosen to import.');
    }

    private function checkFormat(ImportRequest $import, FileFormat $format, string $name): void
    {
        if ($format->kind === 'zip') {
            throw new ApiException(422, sprintf('"%s" is a zip file; an import reads SQL or a pg_dump archive, uncompressed or gzipped.', $name));
        }
        if ($import->format === 'sql' && $format->isArchive()) {
            throw new ApiException(422, sprintf('"%s" is a pg_dump %s archive, which pg_restore reads: choose the archive format.', $name, $format->kind));
        }
        if ($import->format === 'archive' && !$format->isArchive()) {
            throw new ApiException(422, sprintf('"%s" is not a pg_dump custom or tar archive. A plain SQL dump is imported as SQL.', $name));
        }
        if ($format->kind === 'tar' && $import->jobs > 1) {
            throw new ApiException(422, 'pg_restore runs parallel jobs on a custom archive only, not on a tar archive: restore it with one job.');
        }
        if ($format->isArchive() && $format->gzip && $import->jobs > 1) {
            throw new ApiException(422, 'pg_restore reads a gzipped archive from its input, which it cannot do with parallel jobs: decompress the file or restore with one job.');
        }
    }

    private function checkSchema(Connection $conn, string $schema): void
    {
        if ($conn->scalar('SELECT 1 FROM pg_namespace WHERE nspname = $1', [$schema]) === null) {
            throw new NotFoundException(sprintf('There is no schema "%s".', $schema));
        }
    }

    /** @return array{path: string, files: list<string>|null}|null null without an upload directory; files is null when it cannot be read */
    private static function uploadDirectory(): ?array
    {
        $directory = Config::get('storage.upload_dir');
        if (!is_string($directory) || $directory === '') {
            return null;
        }
        $entries = is_dir($directory) ? @scandir($directory) : false;
        if ($entries === false) {
            return ['path' => $directory, 'files' => null];
        }
        $files = array_values(array_filter($entries, static fn (string $entry): bool => preg_match(self::LOCAL_FILES, $entry) === 1 && is_file($directory . '/' . $entry)));

        return ['path' => $directory, 'files' => $files];
    }

    /** The largest upload PHP takes: the smaller of upload_max_filesize and post_max_size. */
    private static function maxUpload(): int
    {
        $limits = array_filter([self::bytes((string) ini_get('upload_max_filesize')), self::bytes((string) ini_get('post_max_size'))], static fn (int $limit): bool => $limit > 0);

        return $limits === [] ? 0 : min($limits);
    }

    /** "2M" in bytes */
    private static function bytes(string $value): int
    {
        $value = trim($value);
        $number = (int) $value;

        return match (strtolower(substr($value, -1))) {
            'g' => $number * 1073741824,
            'm' => $number * 1048576,
            'k' => $number * 1024,
            default => $number,
        };
    }
}
