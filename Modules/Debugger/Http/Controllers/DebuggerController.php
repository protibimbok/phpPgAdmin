<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Debugger\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Facades\Config;
use PhpPgAdmin\Core\Http\ApiException;
use PhpPgAdmin\Core\Nodes\Options;
use PhpPgAdmin\Core\Process\BackgroundProcess;
use Psr\Http\Message\ServerRequestInterface;

/**
 * pgAdmin's direct debugging of a PL/pgSQL function or procedure. Whether the database can
 * (GET …/debugger/status), the routine and its arguments (GET …/debugger/{oid}), a session
 * started with the arguments' values (POST …/debugger/{oid}/sessions), and the session driven
 * (POST /api/debugger/sessions/{id}) and stopped (DELETE). A session is bin/debugger-session.php
 * in the background, holding the call and the debugger's connection between the requests; the
 * requests reach it on its socket. Only the PHP session that started a debugging session can
 * drive it.
 */
final class DebuggerController
{
    private const string SESSIONS = 'debugger_sessions';

    /** How long a step may take before the request gives up waiting for it: a loop may run long. */
    private const int COMMAND_TIMEOUT = 120;

    /** @return array{available: bool, reason: string|null} */
    public function status(ServerRequestInterface $request, array $args): array
    {
        $reason = $this->unavailable($this->connection($request, $args));

        return ['available' => $reason === null, 'reason' => $reason];
    }

    /**
     * The routine as the arguments dialog shows it: its name, kind and language, and each
     * argument with its mode, type and default.
     *
     * @return array<string, mixed>
     */
    public function target(ServerRequestInterface $request, array $args): array
    {
        $conn = $this->connection($request, $args);
        $info = $this->targetInfo($conn, (int) $args['oid']);
        unset($info['argtypes']);

        return ['target' => $info, 'reason' => $this->unavailable($conn)];
    }

    /** @return array{id: string, state: array<string, mixed>} */
    public function start(ServerRequestInterface $request, array $args): array
    {
        $pool = ConnectionPool::from($request);
        $conn = $this->connection($request, $args);
        if (($reason = $this->unavailable($conn)) !== null) {
            throw new ApiException(422, $reason);
        }
        $target = $this->targetInfo($conn, (int) $args['oid']);
        if ($target['language'] !== 'plpgsql') {
            throw new ApiException(422, 'Only PL/pgSQL functions and procedures can be debugged.');
        }
        $body = (array) ($request->getParsedBody() ?? []);
        $call = $this->call($target, is_array($body['args'] ?? null) ? $body['args'] : []);

        $process = BackgroundProcess::prepare();
        $socket = sys_get_temp_dir() . '/pga-dbg-' . $process->id() . '.sock';
        file_put_contents($process->directory . '/debug.json', json_encode(['database' => $conn->database(), 'oid' => $target['oid'], 'call' => $call, 'socket' => $socket], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
        try {
            $process->start(BackgroundProcess::php(), [dirname(__DIR__, 4) . '/bin/debugger-session.php', $process->directory], $pool->environment($conn->database()));
            for ($wait = 0; $wait < 200 && !is_file($process->directory . '/ready'); $wait++) {
                if ($process->status()['state'] !== 'running') {
                    break;
                }
                usleep(50000);
            }
            if (!is_file($process->directory . '/ready')) {
                $output = trim($process->output(0, false)['text']);
                throw new ApiException(500, $output !== '' ? $output : 'The debugging session did not start.');
            }
        } catch (\Throwable $e) {
            $process->stop();
            $process->remove();
            throw $e;
        }
        $_SESSION[self::SESSIONS][$process->id()] = ['database' => $conn->database(), 'oid' => $target['oid'], 'call' => $call];

        return ['id' => $process->id(), 'call' => $call, 'state' => self::send($process, ['command' => 'state'])];
    }

    /** @return array<string, mixed> the session's state after the command: step_into, step_over, continue, set_breakpoint, drop_breakpoint, clear_breakpoints, deposit, select_frame, state */
    public function command(ServerRequestInterface $request, array $args): array
    {
        $process = $this->owned((string) $args['id']);
        $body = (array) ($request->getParsedBody() ?? []);
        $command = (string) ($body['command'] ?? 'state');
        if (!in_array($command, ['state', 'step_into', 'step_over', 'continue', 'set_breakpoint', 'drop_breakpoint', 'clear_breakpoints', 'deposit', 'select_frame'], true)) {
            throw new BadRequestException(sprintf('"%s" is not a debugger command.', $command));
        }
        if (session_status() === PHP_SESSION_ACTIVE) {
            // A step may wait long; the PHP session is not held meanwhile.
            session_write_close();
        }

        return self::send($process, ['command' => $command] + array_intersect_key($body, array_flip(['line', 'func', 'name', 'value', 'level'])));
    }

    /** @return array{ok: true} the call aborted and the session ended */
    public function stop(ServerRequestInterface $request, array $args): array
    {
        $process = $this->owned((string) $args['id']);
        try {
            self::send($process, ['command' => 'stop']);
        } catch (ApiException) {
            // A session that is gone already is stopped.
        }
        for ($wait = 0; $wait < 50 && $process->status()['state'] === 'running'; $wait++) {
            usleep(100000);
        }
        $process->stop();
        $process->remove();
        unset($_SESSION[self::SESSIONS][(string) $args['id']]);

        return ['ok' => true];
    }

    /** Why the database cannot debug, or null when it can. */
    private function unavailable(Connection $conn): ?string
    {
        if (!(bool) Config::get('tools.debugger', true)) {
            return 'The debugger is switched off (PGADMIN_DEBUGGER=0).';
        }
        if ($conn->scalar("SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pldbgapi'") === null) {
            return "The debugger needs the pldbgapi extension in this database: CREATE EXTENSION pldbgapi (EDB's pldebugger).";
        }
        $preload = (string) $conn->scalar("SELECT current_setting('shared_preload_libraries')");
        if (!str_contains($preload, 'plugin_debugger')) {
            return "The debugger needs shared_preload_libraries = 'plugin_debugger' on the server.";
        }

        return null;
    }

    /** @return array<string, mixed> */
    private function targetInfo(Connection $conn, int $oid): array
    {
        $row = $conn->row(<<<'SQL'
            SELECT p.oid, n.nspname AS schema, p.proname AS name, p.prokind::text AS kind, l.lanname AS language,
                   p.proargtypes::text AS in_types, p.proallargtypes, p.proargmodes::text[] AS modes, p.proargnames AS names,
                   p.pronargdefaults, pg_catalog.pg_get_expr(p.proargdefaults, 0) AS defaults,
                   pg_catalog.pg_get_function_identity_arguments(p.oid) AS signature
            FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            JOIN pg_catalog.pg_language l ON l.oid = p.prolang
            WHERE p.oid = $1
            SQL, [$oid]) ?? throw new NotFoundException('There is no such routine.');
        if (!in_array($row['kind'], ['f', 'p'], true)) {
            throw new ApiException(422, 'Only functions and procedures can be debugged.');
        }

        // proargtypes is an oidvector, "1700 25"; proallargtypes, an oid[], only when there are OUT arguments.
        $types = Options::list($row['proallargtypes'] ?? null) ?: array_values(array_filter(explode(' ', (string) $row['in_types']), static fn (string $t): bool => $t !== ''));
        $modes = Options::list($row['modes']) ?: array_fill(0, count($types), 'i');
        $names = Options::list($row['names']);
        $typeNames = [];
        foreach ($types as $type) {
            $typeNames[] = (string) $conn->scalar('SELECT pg_catalog.format_type($1::oid, NULL)', [(int) $type]);
        }
        // The defaults belong to the last IN, INOUT and VARIADIC arguments, in order.
        $defaults = self::splitDefaults((string) ($row['defaults'] ?? ''));
        $inputs = array_keys(array_filter($modes, static fn (string $m): bool => in_array($m, ['i', 'b', 'v'], true)));
        $withDefault = array_slice($inputs, count($inputs) - count($defaults));
        $arguments = [];
        foreach ($types as $i => $type) {
            $d = array_search($i, $withDefault, true);
            $arguments[] = ['name' => $names[$i] ?? '', 'type' => $typeNames[$i], 'mode' => $modes[$i] ?? 'i', 'default' => $d === false ? null : $defaults[$d]];
        }

        return ['oid' => (int) $row['oid'], 'schema' => (string) $row['schema'], 'name' => (string) $row['name'], 'kind' => $row['kind'] === 'p' ? 'procedure' : 'function', 'language' => (string) $row['language'], 'signature' => (string) $row['signature'], 'arguments' => $arguments];
    }

    /**
     * The statement that calls the routine with the arguments given, as pgAdmin's debugger
     * writes it: SELECT * FROM a function, CALL a procedure (NULL for its OUT arguments). An
     * argument is a value (a literal cast to its type), an expression written as is, NULL, or its
     * default, which must then be the default of every argument after it too.
     *
     * @param array<string, mixed> $target
     * @param list<array<string, mixed>> $given
     */
    private function call(array $target, array $given): string
    {
        $values = [];
        $defaulted = false;
        foreach ($target['arguments'] as $i => $argument) {
            $mode = $argument['mode'];
            if ($mode === 'o' || $mode === 't') {
                if ($target['kind'] === 'procedure') {
                    $values[] = 'NULL::' . $argument['type'];
                }
                continue;
            }
            $input = is_array($given[$i] ?? null) ? $given[$i] : [];
            if (filter_var($input['use_default'] ?? false, FILTER_VALIDATE_BOOL) && $argument['default'] !== null) {
                $defaulted = true;
                continue;
            }
            if ($defaulted) {
                throw new BadRequestException('Only the last arguments can take their defaults: give a value to every argument before one that does not.');
            }
            $value = match (true) {
                filter_var($input['null'] ?? false, FILTER_VALIDATE_BOOL) => 'NULL::' . $argument['type'],
                filter_var($input['expression'] ?? false, FILTER_VALIDATE_BOOL) => '(' . (string) ($input['value'] ?? '') . ')',
                default => Quoting::literal((string) ($input['value'] ?? '')) . '::' . $argument['type'],
            };
            $values[] = ($mode === 'v' ? 'VARIADIC ' : '') . $value;
        }
        $name = Quoting::ident($target['schema'], $target['name']);

        return $target['kind'] === 'procedure' ? sprintf('CALL %s(%s)', $name, implode(', ', $values)) : sprintf('SELECT * FROM %s(%s)', $name, implode(', ', $values));
    }

    /** pg_get_expr's defaults, "1, 'a, b'::text", as a list: commas inside quotes and parentheses do not split. */
    private static function splitDefaults(string $defaults): array
    {
        if (trim($defaults) === '') {
            return [];
        }
        $parts = [];
        $depth = 0;
        $quoted = false;
        $current = '';
        for ($i = 0, $n = strlen($defaults); $i < $n; $i++) {
            $c = $defaults[$i];
            if ($c === "'") {
                $quoted = !$quoted;
            } elseif (!$quoted && ($c === '(' || $c === '[')) {
                $depth++;
            } elseif (!$quoted && ($c === ')' || $c === ']')) {
                $depth--;
            } elseif (!$quoted && $depth === 0 && $c === ',') {
                $parts[] = trim($current);
                $current = '';
                continue;
            }
            $current .= $c;
        }
        $parts[] = trim($current);

        return $parts;
    }

    /** A session this PHP session started. */
    private function owned(string $id): BackgroundProcess
    {
        if (!isset($_SESSION[self::SESSIONS][$id])) {
            throw new NotFoundException('There is no such debugging session.');
        }

        return BackgroundProcess::find($id) ?? throw new NotFoundException('The debugging session has ended.');
    }

    /**
     * A command to the session on its socket, and its answer.
     *
     * @param array<string, mixed> $command
     * @return array<string, mixed>
     */
    private static function send(BackgroundProcess $process, array $command): array
    {
        $socket = @stream_socket_client('unix://' . sys_get_temp_dir() . '/pga-dbg-' . $process->id() . '.sock', $errno, $error, 5);
        if ($socket === false) {
            throw new ApiException(410, 'The debugging session has ended.');
        }
        stream_set_timeout($socket, self::COMMAND_TIMEOUT);
        fwrite($socket, json_encode($command, JSON_THROW_ON_ERROR) . "\n");
        $line = fgets($socket);
        fclose($socket);
        $reply = is_string($line) ? json_decode($line, true) : null;
        if (!is_array($reply)) {
            throw new ApiException(504, 'The debugging session did not answer.');
        }

        return $reply;
    }

    private function connection(ServerRequestInterface $request, array $args): Connection
    {
        $db = rawurldecode((string) ($args['db'] ?? ''));

        return ConnectionPool::from($request)->for($db !== '' ? $db : throw new BadRequestException('A database name is required.'));
    }
}
