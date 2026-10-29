<?php

declare(strict_types=1);

/*
 * One PL/pgSQL debugging session for phpPgAdmin, as pgAdmin's debugger keeps one: started in
 * the background (through bin/process-runner.php) with the libpq environment of the role, it
 * holds the two sessions pldebugger needs across the page's requests. The target session sets
 * a breakpoint on the function (plpgsql_oid_debug) and calls it; when the call stops, the
 * target reports the port it waits on (NOTICE "PLDBGBREAK:<port>") and the proxy session
 * attaches to it (pldbg_attach_to_port). From then on the page's commands arrive as JSON lines
 * on a Unix socket only this user can open, run on the proxy (pldbg_step_into, pldbg_continue,
 * pldbg_set_breakpoint, pldbg_get_variables…), and are answered with the session's state:
 * where it stopped, the source, the stack, the variables, the breakpoints, the messages, and in
 * the end the call's result or error. It ends when the page stops it, when the call ends and
 * the page has read the result, or after half an hour without a command.
 *
 *     php bin/debugger-session.php <directory holding debug.json>
 */

const IDLE_LIMIT = 1800;
const RESULT_ROWS = 1000;

$directory = $argv[1] ?? '';
$job = is_file($directory . '/debug.json') ? json_decode((string) file_get_contents($directory . '/debug.json'), true) : null;
if (!is_array($job) || !is_string($job['call'] ?? null) || !is_string($job['socket'] ?? null)) {
    fwrite(STDERR, "Usage: php bin/debugger-session.php <directory holding debug.json>\n");
    exit(2);
}

$stopping = false;
if (function_exists('pcntl_async_signals')) {
    pcntl_async_signals(true);
    foreach ([SIGINT, SIGTERM] as $signal) {
        pcntl_signal($signal, static function () use (&$stopping): void {
            $stopping = true;
        });
    }
}

$session = new DebugSession($job);
try {
    $session->start();
} catch (Throwable $e) {
    $session->fail($e->getMessage());
}

@unlink($job['socket']);
$server = @stream_socket_server('unix://' . $job['socket'], $errno, $errstr);
if ($server === false) {
    fwrite(STDERR, "The debugger's socket could not be opened: $errstr\n");
    exit(1);
}
chmod($job['socket'], 0600);
file_put_contents($directory . '/ready', '1');

$lastCommand = time();
while (!$stopping && time() - $lastCommand < IDLE_LIMIT && !$session->done()) {
    $session->poll();
    $read = [$server];
    $write = $except = null;
    if (@stream_select($read, $write, $except, 0, 250000) < 1) {
        continue;
    }
    $client = @stream_socket_accept($server, 1);
    if ($client === false) {
        continue;
    }
    $lastCommand = time();
    stream_set_timeout($client, 5);
    $command = json_decode((string) fgets($client), true);
    try {
        $reply = $session->handle(is_array($command) ? $command : []);
    } catch (Throwable $e) {
        $reply = ['error' => $e->getMessage()] + $session->state();
    }
    fwrite($client, json_encode($reply, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE) . "\n");
    fclose($client);
}
$session->close();
fclose($server);
@unlink($job['socket']);

/** The two sessions of a direct debugging run and what the page is shown of it. */
final class DebugSession
{
    /** @var PgSql\Connection|null */
    private $target = null;

    /** @var PgSql\Connection|null */
    private $proxy = null;

    private ?int $handle = null;

    private int $oid;

    /** @var array{func: int, line: int, name: string}|null */
    private ?array $frame = null;

    /** @var array<int, string> */
    private array $sources = [];

    /** @var list<string> */
    private array $messages = [];

    private string $status = 'starting';

    /** @var array{columns: list<string>, rows: list<list<string|null>>, truncated: bool}|null */
    private ?array $result = null;

    private ?string $error = null;

    private bool $closing = false;

    public function __construct(private readonly array $job)
    {
        $this->oid = (int) $job['oid'];
    }

    public function start(): void
    {
        $conninfo = "dbname='" . addcslashes((string) $this->job['database'], "'\\") . "' application_name='phpPgAdmin debugger'";
        $this->target = pg_connect($conninfo, PGSQL_CONNECT_FORCE_NEW) ?: throw new RuntimeException('The debugging session could not connect.');
        $this->proxy = pg_connect($conninfo, PGSQL_CONNECT_FORCE_NEW) ?: throw new RuntimeException('The debugging session could not connect.');
        pg_set_error_verbosity($this->target, PGSQL_ERRORS_DEFAULT);
        pg_query($this->target, 'SELECT plpgsql_oid_debug(' . $this->oid . ')');
        pg_last_notice($this->target, PGSQL_NOTICE_CLEAR);
        pg_send_query($this->target, (string) $this->job['call']);

        // The call stops at its first statement and says where the debugger may attach.
        $port = null;
        $since = microtime(true);
        while ($port === null && microtime(true) - $since < 15) {
            $busy = pg_connection_busy($this->target);
            foreach ($this->notices() as $notice) {
                if (preg_match('/PLDBGBREAK:(\d+)/', $notice, $m) === 1) {
                    $port = (int) $m[1];
                }
            }
            if (!$busy && $port === null) {
                // The call ended without stopping: not PL/pgSQL, or it failed before its body.
                $this->finish();

                return;
            }
            usleep(20000);
        }
        if ($port === null) {
            throw new RuntimeException('The function did not stop for the debugger.');
        }
        $this->handle = (int) pg_fetch_result(pg_query($this->proxy, 'SELECT pldbg_attach_to_port(' . $port . ')'), 0, 0);
        $this->frame = $this->breakpoint('pldbg_wait_for_breakpoint');
        $this->status = 'paused';
    }

    public function fail(string $message): void
    {
        $this->status = 'finished';
        $this->error = $message;
    }

    public function done(): bool
    {
        return $this->closing;
    }

    /** Messages the call raised since the last look, and the end of the call. */
    public function poll(): void
    {
        if ($this->target === null || $this->status === 'finished') {
            return;
        }
        if (!pg_connection_busy($this->target) && $this->status === 'running') {
            $this->finish();
        } else {
            $this->notices();
        }
    }

    /** @param array<string, mixed> $command */
    public function handle(array $command): array
    {
        $name = (string) ($command['command'] ?? 'state');
        if ($name === 'stop') {
            $this->stop();
            $this->closing = true;

            return $this->state();
        }
        if ($name === 'quit') {
            $this->closing = true;

            return $this->state();
        }
        if ($this->status !== 'paused' || $this->handle === null) {
            return $this->state();
        }
        $h = $this->handle;
        $line = (int) ($command['line'] ?? 0);
        $func = (int) ($command['func'] ?? ($this->frame['func'] ?? $this->oid));
        switch ($name) {
            case 'step_into':
            case 'step_over':
            case 'continue':
                $this->run('pldbg_' . $name);
                break;
            case 'set_breakpoint':
                $this->proxyQuery(sprintf('SELECT pldbg_set_breakpoint(%d, %d, %d)', $h, $func, $line));
                break;
            case 'drop_breakpoint':
                $this->proxyQuery(sprintf('SELECT pldbg_drop_breakpoint(%d, %d, %d)', $h, $func, $line));
                break;
            case 'clear_breakpoints':
                foreach ($this->breakpoints() as $bp) {
                    $this->proxyQuery(sprintf('SELECT pldbg_drop_breakpoint(%d, %d, %d)', $h, $bp['func'], $bp['line']));
                }
                break;
            case 'deposit':
                $this->proxyQuery(sprintf('SELECT pldbg_deposit_value(%d, %s, %d, %s)', $h, pg_escape_literal($this->proxy, (string) ($command['name'] ?? '')), -1, pg_escape_literal($this->proxy, (string) ($command['value'] ?? ''))));
                break;
            case 'select_frame':
                $frame = pg_fetch_assoc($this->proxyQuery(sprintf('SELECT * FROM pldbg_select_frame(%d, %d)', $h, (int) ($command['level'] ?? 0))));
                if ($frame !== false) {
                    $this->frame = ['func' => (int) $frame['func'], 'line' => (int) $frame['linenumber'], 'name' => (string) $frame['targetname']];
                }
                break;
        }

        return $this->state();
    }

    /** What the page shows: where the call stands, and while it is paused the frame's details. */
    public function state(): array
    {
        $state = ['status' => $this->status, 'messages' => $this->messages, 'result' => $this->result, 'error' => $this->error, 'frame' => $this->frame];
        if ($this->status === 'paused' && $this->handle !== null && $this->frame !== null) {
            $func = $this->frame['func'];
            $this->sources[$func] ??= (string) pg_fetch_result($this->proxyQuery(sprintf('SELECT pldbg_get_source(%d, %d)', $this->handle, $func)), 0, 0);
            $state['source'] = $this->sources[$func];
            $state['stack'] = array_map(static fn (array $r): array => ['level' => (int) $r['level'], 'name' => (string) $r['targetname'], 'func' => (int) $r['func'], 'line' => (int) $r['linenumber'], 'args' => (string) $r['args']], pg_fetch_all($this->proxyQuery(sprintf('SELECT * FROM pldbg_get_stack(%d)', $this->handle))) ?: []);
            $state['variables'] = array_map(static fn (array $r): array => ['name' => (string) $r['name'], 'class' => (string) $r['varclass'], 'type' => (string) $r['type'], 'value' => $r['value'], 'const' => $r['isconst'] === 't', 'not_null' => $r['isnotnull'] === 't'], pg_fetch_all($this->proxyQuery(sprintf('SELECT v.*, pg_catalog.format_type(v.dtype, NULL) AS type FROM pldbg_get_variables(%d) v', $this->handle))) ?: []);
            $state['breakpoints'] = $this->breakpoints();
        }

        return $state;
    }

    public function close(): void
    {
        if ($this->status !== 'finished') {
            $this->stop();
        }
        if ($this->proxy !== null) {
            pg_close($this->proxy);
        }
        if ($this->target !== null) {
            pg_close($this->target);
        }
    }

    /** Abort the call: the target rolls it back and the session ends. */
    private function stop(): void
    {
        if ($this->status === 'paused' && $this->handle !== null) {
            @pg_query($this->proxy, sprintf('SELECT pldbg_abort_target(%d)', $this->handle));
            $this->wait();
        }
    }

    /** A step or continue: where the call stops next, or its end. */
    private function run(string $function): void
    {
        $this->status = 'running';
        $frame = @pg_query($this->proxy, sprintf('SELECT * FROM %s(%d)', $function, (int) $this->handle));
        $row = $frame === false ? false : pg_fetch_assoc($frame);
        if ($row === false || $row === null) {
            // The proxy loses the target when the call returns: the call's own result tells how it ended.
            $this->wait();

            return;
        }
        $this->frame = ['func' => (int) $row['func'], 'line' => (int) $row['linenumber'], 'name' => (string) $row['targetname']];
        $this->status = 'paused';
        $this->notices();
    }

    /** @return array{func: int, line: int, name: string} */
    private function breakpoint(string $function): array
    {
        $row = pg_fetch_assoc($this->proxyQuery(sprintf('SELECT * FROM %s(%d)', $function, (int) $this->handle)));
        if ($row === false) {
            throw new RuntimeException('The debugger did not report where the call stopped.');
        }

        return ['func' => (int) $row['func'], 'line' => (int) $row['linenumber'], 'name' => (string) $row['targetname']];
    }

    /** @return list<array{func: int, line: int}> */
    private function breakpoints(): array
    {
        return array_values(array_filter(array_map(static fn (array $r): array => ['func' => (int) $r['func'], 'line' => (int) $r['linenumber']], pg_fetch_all($this->proxyQuery(sprintf('SELECT * FROM pldbg_get_breakpoints(%d)', (int) $this->handle))) ?: []), static fn (array $b): bool => $b['line'] > 0));
    }

    private function wait(): void
    {
        $since = microtime(true);
        while (pg_connection_busy($this->target) && microtime(true) - $since < 30) {
            $this->notices();
            usleep(20000);
        }
        $this->finish();
    }

    /** The call's end: its rows, or its error, and the messages it raised last. */
    private function finish(): void
    {
        $this->status = 'finished';
        $this->handle = null;
        $result = pg_get_result($this->target);
        $this->notices();
        if ($result === false) {
            return;
        }
        $error = pg_result_error($result);
        if ($error !== '' && $error !== false) {
            $this->error = trim($error);
        } else {
            $columns = [];
            for ($i = 0; $i < pg_num_fields($result); $i++) {
                $columns[] = pg_field_name($result, $i);
            }
            $rows = [];
            while (count($rows) < RESULT_ROWS && ($row = pg_fetch_row($result)) !== false) {
                $rows[] = $row;
            }
            $this->result = ['columns' => $columns, 'rows' => $rows, 'truncated' => pg_num_rows($result) > RESULT_ROWS];
        }
        while (pg_get_result($this->target) !== false) {
            // Nothing more is read from a single statement.
        }
    }

    /** @return list<string> the target's new notices, the debugger's own left out of the messages */
    private function notices(): array
    {
        $notices = pg_last_notice($this->target, PGSQL_NOTICE_ALL);
        pg_last_notice($this->target, PGSQL_NOTICE_CLEAR);
        $notices = is_array($notices) ? array_values($notices) : [];
        foreach ($notices as $notice) {
            if (!str_contains($notice, 'PLDBGBREAK:')) {
                $this->messages[] = trim($notice);
            }
        }

        return $notices;
    }

    private function proxyQuery(string $sql): PgSql\Result
    {
        $result = @pg_query($this->proxy, $sql);
        if ($result === false) {
            throw new RuntimeException(trim(pg_last_error($this->proxy)));
        }

        return $result;
    }
}
