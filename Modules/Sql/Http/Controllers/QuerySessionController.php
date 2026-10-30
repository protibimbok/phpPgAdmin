<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sql\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Config;
use PhpPgAdmin\Core\Http\ApiException;
use PhpPgAdmin\Core\Process\BackgroundProcess;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Sql\Sql\Splitter;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The SQL page's query tool sessions, as pgAdmin's query tool keeps a connection per tab: each
 * is a background process (bin/query-session.php) holding one connection, so session settings,
 * temporary tables and an open transaction outlive the request that made them, and "Auto
 * commit" can be turned off with Commit and Rollback ending the transaction.
 *
 * A session belongs to the PHP session that started it and to its role on its server: its id
 * is kept in $_SESSION, and a request from another sign-in (even in the same browser) cannot
 * reach it. The process talks only over a Unix socket of mode 0600.
 */
final class QuerySessionController
{
    private const string SESSIONS = 'query_sessions';

    /** How long a run may take before the request gives up waiting for its answer. */
    private const int RUN_TIMEOUT = 3600;

    /** At most this many sessions per sign-in; the oldest goes when another starts. */
    private const int MAX_SESSIONS = 8;

    /**
     * Start a session on a database ("database" in the body; the one the login landed in without).
     *
     * @return array{id: string, database: string, transaction: string, backend_pid: int}
     */
    public function start(ServerRequestInterface $request): array
    {
        if (!(bool) Config::get('tools.query_sessions', true)) {
            throw new ApiException(422, 'Query tool sessions are switched off (PGADMIN_QUERY_SESSIONS=0).');
        }
        $pool = ConnectionPool::from($request);
        $body = (array) ($request->getParsedBody() ?? []);
        $database = (string) ($body['database'] ?? '');
        // Connecting here first gives the usual 401/403/503 for a database the role cannot open.
        $conn = $database === '' ? $pool->maintenance() : $pool->for($database);
        $database = $conn->database();

        $this->forgetEnded();
        $owner = $this->owner($pool);
        $sessions = (array) ($_SESSION[self::SESSIONS] ?? []);
        while (count($sessions) >= self::MAX_SESSIONS) {
            $oldest = (string) array_key_first($sessions);
            $this->end($oldest);
            unset($sessions[$oldest]);
        }

        $process = BackgroundProcess::prepare();
        $socket = self::socket($process->id());
        file_put_contents($process->directory . '/session.json', json_encode(['database' => $database, 'socket' => $socket] + $owner, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
        try {
            $process->start(BackgroundProcess::php(), [dirname(__DIR__, 4) . '/bin/query-session.php', $process->directory], $pool->environment($database));
            for ($wait = 0; $wait < 200 && !is_file($process->directory . '/ready'); $wait++) {
                if ($process->status()['state'] !== 'running') {
                    break;
                }
                usleep(50000);
            }
            if (!is_file($process->directory . '/ready')) {
                $output = trim($process->output(0, false)['text']);
                throw new ApiException(500, $output !== '' ? $output : 'The query tool session did not start.');
            }
        } catch (\Throwable $e) {
            $process->stop();
            $process->remove();
            throw $e;
        }
        $sessions[$process->id()] = ['database' => $database] + $owner;
        $_SESSION[self::SESSIONS] = $sessions;

        return ['id' => $process->id(), 'database' => $database] + self::send($process, ['command' => 'status'], 10);
    }

    /**
     * Run a batch in the session: the body carries what QueryController::run takes, plus
     * "autocommit" (false: a run outside a transaction opens one and leaves it open).
     *
     * @param array{id: string} $args
     * @return array<string, mixed>
     */
    public function run(ServerRequestInterface $request, array $args): array
    {
        $process = $this->owned($request, (string) $args['id']);
        $input = (array) ($request->getParsedBody() ?? []);
        $sql = (string) ($input['sql'] ?? '');
        if (Splitter::split($sql, (string) ($input['delimiter'] ?? ';')) === []) {
            throw new BadRequestException('The query is empty.');
        }
        $this->release();
        $options = ['sql' => $sql] + array_intersect_key($input, array_flip(['delimiter', 'request_id', 'limit', 'offset', 'count', 'order', 'transaction', 'rollback', 'autocommit']));

        $reply = self::send($process, ['command' => 'run', 'options' => $options], self::RUN_TIMEOUT);
        if (isset($reply['error'])) {
            // The runner reports a statement's failure in its results; this is the run itself
            // failing, such as a savepoint refused in a failed transaction.
            throw new ApiException(409, (string) ($reply['error']['message'] ?? 'The query failed.'), ['transaction' => $reply['transaction'] ?? null] + (array) $reply['error']);
        }

        return $reply;
    }

    /** @param array{id: string} $args */
    public function commit(ServerRequestInterface $request, array $args): array
    {
        return $this->endTransaction($request, $args, 'commit');
    }

    /** @param array{id: string} $args */
    public function rollback(ServerRequestInterface $request, array $args): array
    {
        return $this->endTransaction($request, $args, 'rollback');
    }

    /**
     * Where the session stands; also its heartbeat, which keeps it alive while the page is open.
     *
     * @param array{id: string} $args
     */
    public function status(ServerRequestInterface $request, array $args): array
    {
        $process = $this->owned($request, (string) $args['id']);
        $this->release();
        touch($process->directory . '/heartbeat');

        return self::send($process, ['command' => 'status'], 10);
    }

    /**
     * End the session; the connection closes, rolling back a transaction left open.
     *
     * @param array{id: string} $args
     * @return array{ok: bool}
     */
    public function stop(ServerRequestInterface $request, array $args): array
    {
        $this->owned($request, (string) $args['id']);
        $this->end((string) $args['id']);
        unset($_SESSION[self::SESSIONS][(string) $args['id']]);

        return ['ok' => true];
    }

    /** @param array{id: string} $args */
    private function endTransaction(ServerRequestInterface $request, array $args, string $command): array
    {
        $process = $this->owned($request, (string) $args['id']);
        $this->release();
        $reply = self::send($process, ['command' => $command], 60);
        if (isset($reply['error'])) {
            throw new ApiException(409, (string) ($reply['error']['message'] ?? 'The command failed.'), ['transaction' => $reply['transaction'] ?? null]);
        }

        return $reply;
    }

    private function end(string $id): void
    {
        $process = BackgroundProcess::find($id);
        if ($process === null) {
            return;
        }
        try {
            self::send($process, ['command' => 'stop'], 5);
        } catch (ApiException) {
            // A session that is gone already is stopped.
        }
        for ($wait = 0; $wait < 30 && $process->status()['state'] === 'running'; $wait++) {
            usleep(100000);
        }
        $process->stop();
        $process->remove();
    }

    /** Drop the ids of sessions whose process has ended, removing what they left behind. */
    private function forgetEnded(): void
    {
        foreach (array_keys((array) ($_SESSION[self::SESSIONS] ?? [])) as $id) {
            $process = BackgroundProcess::find((string) $id);
            if ($process === null || $process->status()['state'] !== 'running') {
                $process?->remove();
                unset($_SESSION[self::SESSIONS][$id]);
            }
        }
    }

    /** @return array{server: string, username: string} */
    private function owner(ConnectionPool $pool): array
    {
        return ['server' => Authenticate::sessionServer()?->key() ?? '', 'username' => $pool->username()];
    }

    /** The session's process, when this sign-in started it and it still runs. */
    private function owned(ServerRequestInterface $request, string $id): BackgroundProcess
    {
        $session = $_SESSION[self::SESSIONS][$id] ?? null;
        if (!is_array($session) || preg_match('/^[0-9a-f]{24}$/', $id) !== 1) {
            throw new NotFoundException('There is no such query tool session.');
        }
        $owner = $this->owner(ConnectionPool::from($request));
        if ($session['server'] !== $owner['server'] || $session['username'] !== $owner['username']) {
            throw new NotFoundException('There is no such query tool session.');
        }
        $process = BackgroundProcess::find($id);
        if ($process === null || $process->status()['state'] !== 'running') {
            $process?->remove();
            unset($_SESSION[self::SESSIONS][$id]);
            throw new ApiException(410, 'The query tool session has ended; a transaction left open in it was rolled back.');
        }

        return $process;
    }

    /** A run may take long, and a cancel or a status request must get at the PHP session meanwhile. */
    private function release(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
    }

    private static function socket(string $id): string
    {
        return sys_get_temp_dir() . '/pga-sql-' . $id . '.sock';
    }

    /**
     * @param array<string, mixed> $command
     * @return array<string, mixed>
     */
    private static function send(BackgroundProcess $process, array $command, int $timeout): array
    {
        $socket = @stream_socket_client('unix://' . self::socket($process->id()), $errno, $error, 5);
        if ($socket === false) {
            throw new ApiException(410, 'The query tool session has ended; a transaction left open in it was rolled back.');
        }
        stream_set_timeout($socket, $timeout);
        fwrite($socket, json_encode($command, JSON_THROW_ON_ERROR) . "\n");
        $line = fgets($socket);
        fclose($socket);
        $reply = is_string($line) ? json_decode($line, true) : null;
        if (!is_array($reply)) {
            throw new ApiException(504, 'The query tool session did not answer.');
        }

        return $reply;
    }
}
