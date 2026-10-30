<?php

declare(strict_types=1);

/*
 * One query tool session for phpPgAdmin, as pgAdmin's query tool keeps one connection per tab:
 * started in the background (through bin/process-runner.php) with the libpq environment of the
 * role, it holds a single connection across the SQL page's requests, so SET, temporary tables,
 * prepared statements and an open transaction carry over from one run to the next. The page's
 * commands arrive as JSON lines on a Unix socket only this user can open:
 *
 *     {"command": "run", "options": {…QueryRunner's options…}}   the batch's results
 *     {"command": "commit"} / {"command": "rollback"}             end the open transaction
 *     {"command": "status"}                                       where the session stands
 *
 * Every reply also hands over the notifications (LISTEN/NOTIFY) received since the last one,
 * and, outside a transaction, the channels the session listens on.
 *     {"command": "stop"}                                         close the connection and end
 *
 * Every reply carries the transaction status ("idle", "intrans", "inerror"…) and the backend
 * PID. The session ends when the page stops it (also when its tab is closed), when the page's
 * heartbeat (the file "heartbeat", touched every half minute while the page is open) has
 * stopped for HEARTBEAT_LIMIT, after IDLE_LIMIT without a command, or when the server closes
 * the connection. Ending it closes the connection, which rolls back a transaction left open.
 *
 *     php bin/query-session.php <directory holding session.json>
 */

use PhpPgAdmin\App;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\QueryException;
use PhpPgAdmin\Modules\Sql\Sql\QueryRunner;
use PhpPgAdmin\Modules\Sql\Storage\QueryHistory;
use PhpPgAdmin\Modules\Sql\Storage\RunningQueries;

/** A background tab's timers may run only once a minute: a few missed heartbeats are allowed. */
const HEARTBEAT_LIMIT = 180;
/** However the page keeps it alive, a session nobody has sent a command to for this long ends. */
const IDLE_LIMIT = 4 * 3600;
/** The notifications a session keeps for the page between two of its requests. */
const NOTIFICATIONS_KEPT = 1000;

$directory = $argv[1] ?? '';
$job = is_file($directory . '/session.json') ? json_decode((string) file_get_contents($directory . '/session.json'), true) : null;
if (!is_array($job) || !is_string($job['socket'] ?? null) || !is_string($job['database'] ?? null)) {
    fwrite(STDERR, "Usage: php bin/query-session.php <directory holding session.json>\n");
    exit(2);
}

require dirname(__DIR__) . '/vendor/autoload.php';
// The configuration and the storage the runner records the history and running queries in.
App::create();

$stopping = false;
if (function_exists('pcntl_async_signals')) {
    pcntl_async_signals(true);
    foreach ([SIGINT, SIGTERM] as $signal) {
        pcntl_signal($signal, static function () use (&$stopping): void {
            $stopping = true;
        });
    }
}

$conninfo = "dbname='" . addcslashes($job['database'], "'\\") . "' application_name='phpPgAdmin query tool'";
$pg = @pg_connect($conninfo, PGSQL_CONNECT_FORCE_NEW);
if ($pg === false) {
    fwrite(STDERR, "The query tool session could not connect to the database.\n");
    exit(1);
}
$conn = new Connection($pg, $job['database']);
// The saved server's post-connection SQL for the role, as on phpPgAdmin's other connections.
if (is_string($job['post_connection_sql'] ?? null) && trim($job['post_connection_sql']) !== '') {
    try {
        $conn->queryMulti($job['post_connection_sql']);
    } catch (QueryException $e) {
        fwrite(STDERR, 'The post-connection SQL failed: ' . $e->getMessage() . "\n");
        exit(1);
    }
}
$history = QueryHistory::for((string) ($job['server'] ?? ''), (string) ($job['username'] ?? ''));
$running = RunningQueries::for((string) ($job['server'] ?? ''), (string) ($job['username'] ?? ''));

@unlink($job['socket']);
$umask = umask(0177);
$server = @stream_socket_server('unix://' . $job['socket'], $errno, $errstr);
umask($umask);
if ($server === false) {
    fwrite(STDERR, "The query tool session's socket could not be opened: $errstr\n");
    exit(1);
}
chmod($job['socket'], 0600);
// The backend's PID, for signing out to cancel what the session runs before stopping it.
file_put_contents($directory . '/backend_pid', (string) $conn->backendPid());
file_put_contents($directory . '/ready', '1');

// pgAdmin's Notifications: what NOTIFY sent to the channels the session LISTENs on, kept
// until the next reply hands it over (the last NOTIFICATIONS_KEPT when nobody asked for long).
$notifications = [];
$collect = static function () use ($pg, &$notifications): void {
    while (($notify = pg_get_notify($pg, PGSQL_ASSOC)) !== false) {
        $notifications[] = ['channel' => (string) $notify['message'], 'pid' => (int) $notify['pid'], 'payload' => (string) ($notify['payload'] ?? ''), 'received_at' => gmdate('Y-m-d\TH:i:s\Z')];
    }
    if (count($notifications) > NOTIFICATIONS_KEPT) {
        $notifications = array_slice($notifications, -NOTIFICATIONS_KEPT);
    }
};
$state = static function () use ($conn, $collect, &$notifications): array {
    $collect();
    $state = ['transaction' => $conn->transactionStatus(), 'backend_pid' => $conn->backendPid(), 'notifications' => $notifications];
    $notifications = [];
    // The channels listened on, read only outside a transaction: a query in one would take its
    // snapshot, or fail in an aborted one.
    if ($state['transaction'] === 'idle') {
        try {
            $state['channels'] = array_column($conn->rows('SELECT pg_catalog.pg_listening_channels() AS channel'), 'channel');
        } catch (QueryException) {
            // The state goes without them.
        }
    }

    return $state;
};

/** @return array<string, mixed> */
$handle = static function (array $command) use ($conn, $history, $running, $state, &$stopping): array {
    switch ((string) ($command['command'] ?? 'status')) {
        case 'run':
            $options = is_array($command['options'] ?? null) ? $command['options'] : [];
            // A timeout set by the runner would stay on the session for every later statement.
            unset($options['statement_timeout_ms']);

            return (new QueryRunner($conn, $options, $history, $running))->run() + $state();
        case 'commit':
        case 'rollback':
            $before = $conn->transactionStatus();
            // COMMIT of a failed transaction rolls it back and says so (the tag is ROLLBACK).
            $tag = $conn->query(strtoupper((string) $command['command']))->commandTag();

            return ['command_tag' => $tag, 'was' => $before] + $state();
        case 'stop':
            $stopping = true;

            return ['stopped' => true] + $state();
        default:
            return $state();
    }
};

// The last command that did something, for IDLE_LIMIT; a status request (the page's heartbeat,
// the notifications poll) only shows that the page is open, which HEARTBEAT_LIMIT watches.
$lastCommand = time();
$lastContact = time();
$alive = static function () use (&$lastCommand, &$lastContact, $directory, $conn): bool {
    if (!$conn->isAlive() || time() - $lastCommand >= IDLE_LIMIT) {
        return false;
    }
    clearstatcache(true, $directory . '/heartbeat');
    $heartbeat = @filemtime($directory . '/heartbeat');

    return time() - max($lastContact, $heartbeat === false ? 0 : $heartbeat) < HEARTBEAT_LIMIT;
};

while (!$stopping && $alive()) {
    $read = [$server];
    $write = $except = null;
    if (@stream_select($read, $write, $except, 1) < 1) {
        $collect();

        continue;
    }
    $client = @stream_socket_accept($server, 1);
    if ($client === false) {
        continue;
    }
    $lastContact = time();
    stream_set_timeout($client, 10);
    $command = json_decode((string) fgets($client), true);
    $command = is_array($command) ? $command : [];
    $working = ($command['command'] ?? 'status') !== 'status';
    if ($working) {
        $lastCommand = time();
    }
    try {
        $reply = $handle($command);
    } catch (QueryException $e) {
        $reply = ['error' => $e->toArray()] + $state();
    } catch (Throwable $e) {
        $reply = ['error' => ['message' => $e->getMessage()]] + $state();
    }
    // The page may have given up waiting (a cancelled request); the reply then has nowhere to
    // go, and the notifications it carried wait for the next one.
    $line = json_encode($reply, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE) . "\n";
    $written = @fwrite($client, $line);
    if ($written !== strlen($line) && is_array($reply['notifications'] ?? null)) {
        $notifications = [...$reply['notifications'], ...$notifications];
    }
    fclose($client);
    $lastContact = time();
    if ($working) {
        $lastCommand = time();
    }
}

$conn->close();
fclose($server);
@unlink($job['socket']);
