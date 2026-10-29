<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Maintenance\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Http\ApiException;
use PhpPgAdmin\Core\Process\BackgroundProcess;
use PhpPgAdmin\Modules\Export\Dump\ClientTools;
use PhpPgAdmin\Modules\Import\Http\Controllers\ProcessController;
use PhpPgAdmin\Modules\Import\Storage\Processes;
use PhpPgAdmin\Modules\Maintenance\Command\MaintenanceCommand;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The Maintenance card's backend: what the server offers (GET /api/maintenance/options), and a
 * run (POST /api/maintenance; with preview, only the statement), its statement given to psql as a background process like
 * pgAdmin's maintenance tool, so that a long VACUUM FULL or REINDEX outlives the request. The
 * card follows it through /api/processes; VERBOSE messages are its output.
 */
final class MaintenanceController
{
    /** @return array<string, mixed> */
    public function options(ServerRequestInterface $request): array
    {
        [$database, $schema] = $this->target($request->getQueryParams());
        $conn = ConnectionPool::from($request)->for($database);
        if ($schema !== null) {
            $this->tables($conn, $schema);
        }
        $tools = ClientTools::locate();
        $version = $conn->version();

        return [
            'version' => $version,
            'tablespaces' => array_column($conn->rows("SELECT spcname FROM pg_tablespace WHERE spcname <> 'pg_global' ORDER BY 1"), 'spcname'),
            'tools' => $tools === null ? null : ['directory' => $tools->directory, 'psql' => is_executable($tools->path('psql'))],
        ];
    }

    /** @return array{process: array<string, mixed>}|array{sql: string} the process started, or with preview the statement it would run */
    public function run(ServerRequestInterface $request): array
    {
        $body = (array) ($request->getParsedBody() ?? []);
        [$database, $schema] = $this->target($body);
        $pool = ConnectionPool::from($request);
        $conn = $pool->for($database);
        $tables = $schema === null ? [] : $this->tables($conn, $schema);
        $options = is_array($body['options'] ?? null) ? $body['options'] : [];
        $command = new MaintenanceCommand(strtoupper((string) ($body['operation'] ?? '')), $options, $conn->database(), $schema, $tables, $conn->version());
        $statement = $command->statement();
        if (filter_var($body['preview'] ?? false, FILTER_VALIDATE_BOOL)) {
            return ['sql' => $statement . ';'];
        }

        $tools = ClientTools::locate() ?? throw new ApiException(503, 'The PostgreSQL client programs were not found. Set PGADMIN_PG_BIN_DIR (config/tools.php) to their directory.');
        if (!is_executable($tools->path('psql'))) {
            throw new ApiException(503, sprintf('psql was not found in %s.', $tools->directory));
        }
        $arguments = ['--no-password', '--no-psqlrc', '--set=ON_ERROR_STOP=1', '--command=' . $statement];

        $process = BackgroundProcess::prepare();
        try {
            if (session_status() === PHP_SESSION_ACTIVE) {
                session_write_close();
            }
            $process->start($tools->path('psql'), $arguments, $pool->environment($conn->database()), null, false, false);
        } catch (\Throwable $e) {
            $process->remove();
            throw $e;
        }

        $processes = Processes::for(ProcessController::serverKey(), $pool->username());
        $processes->create($process->id(), $database, $schema, null, 'maintenance', $command->description(), ['psql', ...$arguments], $process->status()['started_at'] ?? gmdate('Y-m-d\TH:i:s\Z'));

        return ['process' => ProcessController::describe($processes->find($process->id()) ?? throw new \LogicException('The process just stored is gone.'), $process)];
    }

    /**
     * @param array<string, mixed> $input
     * @return array{0: string, 1: string|null} the database and the schema
     */
    private function target(array $input): array
    {
        $database = is_string($input['database'] ?? null) && $input['database'] !== '' ? $input['database'] : throw new BadRequestException('Maintenance runs on a database.');
        $schema = is_string($input['schema'] ?? null) && $input['schema'] !== '' ? $input['schema'] : null;

        return [$database, $schema];
    }

    /** @return list<string> the schema's tables and materialized views, which VACUUM and ANALYZE take; a partition comes with its parent */
    private function tables(Connection $conn, string $schema): array
    {
        if ($conn->scalar('SELECT 1 FROM pg_namespace WHERE nspname = $1', [$schema]) === null) {
            throw new NotFoundException(sprintf('There is no schema "%s".', $schema));
        }

        return array_column($conn->rows(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind IN ('r', 'm', 'p') AND NOT c.relispartition ORDER BY 1",
            [$schema],
        ), 'relname');
    }
}
