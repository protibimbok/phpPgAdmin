<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Import\Http\Controllers;

use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Http\ApiException;
use PhpPgAdmin\Core\Process\BackgroundProcess;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Import\Storage\Processes;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The role's background processes, after pgAdmin's process watcher: the list, one process with
 * its output from an offset on (GET /api/processes/{id}?offset=), stopping one, and dismissing
 * one that ended, which removes its output.
 */
final class ProcessController
{
    /** @return array{processes: list<array<string, mixed>>} */
    public function index(ServerRequestInterface $request): array
    {
        $query = $request->getQueryParams();
        $filtered = array_key_exists('database', $query);
        $database = is_string($query['database'] ?? null) && $query['database'] !== '' ? $query['database'] : null;
        $schema = is_string($query['schema'] ?? null) && $query['schema'] !== '' ? $query['schema'] : null;
        $processes = $this->processes($request);

        return ['processes' => array_map(static fn (array $row): array => self::describe($row, self::directory($row['id']), $processes), $processes->all($filtered, $database, $schema))];
    }

    /** @return array{process: array<string, mixed>, output: array{text: string, offset: int, size: int}} */
    public function show(ServerRequestInterface $request, array $args): array
    {
        $processes = $this->processes($request);
        $row = $processes->find((string) $args['id']) ?? throw new NotFoundException('There is no such process.');
        $directory = self::directory($row['id']);
        $process = self::describe($row, $directory, $processes);
        $offset = (int) ($request->getQueryParams()['offset'] ?? 0);

        return ['process' => $process, 'output' => $directory->output($offset, $process['state'] === 'running')];
    }

    /** @return array{process: array<string, mixed>} */
    public function stop(ServerRequestInterface $request, array $args): array
    {
        $processes = $this->processes($request);
        $row = $processes->find((string) $args['id']) ?? throw new NotFoundException('There is no such process.');
        $directory = self::directory($row['id']);
        if (!$directory->stop()) {
            throw new ApiException(409, 'The process is not running.');
        }

        return ['process' => self::describe($row, $directory, $processes)];
    }

    /** @return array{ok: true} */
    public function destroy(ServerRequestInterface $request, array $args): array
    {
        $processes = $this->processes($request);
        $row = $processes->find((string) $args['id']) ?? throw new NotFoundException('There is no such process.');
        $directory = self::directory($row['id']);
        if ($directory->status()['state'] === 'running') {
            throw new ApiException(409, 'The process is still running: stop it first.');
        }
        $directory->remove();
        $processes->delete($row['id']);

        return ['ok' => true];
    }

    /**
     * A process as the page shows it: its row with the runner's status, which is written back
     * to the row when the process has ended.
     *
     * @param array{id: string, database: string|null, schema: string|null, type: string, description: string, command: list<string>, started_at: string, ended_at: string|null, exit_code: int|null} $row
     * @return array<string, mixed>
     */
    public static function describe(array $row, BackgroundProcess $directory, ?Processes $processes = null): array
    {
        $status = $directory->status();
        $endedAt = $status['ended_at'] ?? $row['ended_at'];
        if ($processes !== null && $row['ended_at'] === null && $status['ended_at'] !== null) {
            $processes->finish($row['id'], $status['ended_at'], $status['exit_code']);
        }

        return [
            'id' => $row['id'],
            'type' => $row['type'],
            'description' => $row['description'],
            'database' => $row['database'],
            'schema' => $row['schema'],
            'command' => $row['command'],
            // A process whose directory is gone (removed by hand) can only be dismissed.
            'state' => $status['started_at'] === null && $row['ended_at'] !== null ? ($row['exit_code'] === 0 ? 'finished' : 'failed') : $status['state'],
            'exit_code' => $status['exit_code'] ?? $row['exit_code'],
            'errors' => $status['errors'],
            'read' => $status['read'],
            'size' => $status['size'],
            'started_at' => $row['started_at'],
            'ended_at' => $endedAt,
        ];
    }

    public static function serverKey(): string
    {
        return Authenticate::sessionServer()?->key() ?? '';
    }

    private function processes(ServerRequestInterface $request): Processes
    {
        return Processes::for(self::serverKey(), ConnectionPool::from($request)->username());
    }

    private static function directory(string $id): BackgroundProcess
    {
        return BackgroundProcess::find($id) ?? throw new NotFoundException('There is no such process.');
    }
}
