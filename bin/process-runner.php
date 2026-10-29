<?php

declare(strict_types=1);

/*
 * Runs one background process for phpPgAdmin, as pgAdmin's process_executor.py does: started
 * detached by PhpPgAdmin\Core\Process\BackgroundProcess with the directory it prepared, it runs
 * the program job.json names with the environment it was given, feeds it its input file on
 * stdin (inflating a gzip file as it goes), writes everything the program prints to output.log,
 * and keeps status.json up to date: the input read so far, the error lines counted, and in the
 * end the exit code. SIGTERM stops the program: SIGINT first, which psql and pg_restore answer
 * by cancelling the statement on the server, then SIGTERM.
 *
 *     php bin/process-runner.php <directory>
 */

const CHUNK = 65536;

$directory = $argv[1] ?? '';
$job = is_file($directory . '/job.json') ? json_decode((string) file_get_contents($directory . '/job.json'), true) : null;
if (!is_array($job) || !is_string($job['program'] ?? null) || !is_array($job['arguments'] ?? null)) {
    fwrite(STDERR, "Usage: php bin/process-runner.php <directory holding job.json>\n");
    exit(2);
}

if (function_exists('posix_setsid')) {
    @posix_setsid();
}

$stopping = false;
if (function_exists('pcntl_async_signals')) {
    pcntl_async_signals(true);
    // A program that exits before reading all its input must not take the runner with it.
    pcntl_signal(SIGPIPE, SIG_IGN);
    pcntl_signal(SIGTERM, static function () use (&$stopping): void {
        $stopping = true;
    });
}

$input = is_string($job['input'] ?? null) ? $job['input'] : null;
$status = [
    'runner_pid' => getmypid(),
    'pid' => null,
    'started_at' => gmdate('Y-m-d\TH:i:s\Z'),
    'ended_at' => null,
    'exit_code' => null,
    'killed' => false,
    'errors' => 0,
    'read' => 0,
    'size' => $input !== null ? (int) @filesize($input) : null,
];

$writeStatus = static function (array $status) use ($directory): void {
    $temporary = $directory . '/status.json.' . getmypid();
    file_put_contents($temporary, json_encode($status, JSON_UNESCAPED_SLASHES));
    rename($temporary, $directory . '/status.json');
};

$log = fopen($directory . '/output.log', 'ab');
$descriptors = [0 => $input !== null ? ['pipe', 'r'] : ['file', '/dev/null', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
$process = proc_open([$job['program'], ...array_map('strval', $job['arguments'])], $descriptors, $pipes);
if ($process === false || $log === false) {
    $status['ended_at'] = gmdate('Y-m-d\TH:i:s\Z');
    $status['exit_code'] = 127;
    if ($log !== false) {
        fwrite($log, sprintf("%s could not be started.\n", basename($job['program'])));
    }
    $writeStatus($status);
    exit(1);
}
$status['pid'] = proc_get_status($process)['pid'];
$writeStatus($status);

foreach ($pipes as $pipe) {
    stream_set_blocking($pipe, false);
}
/** @var array<int, resource> $open */
$open = [1 => $pipes[1], 2 => $pipes[2]];
$stdin = $pipes[0] ?? null;

// The input, read raw so that the share read is the share of the file, and inflated here.
$source = $input !== null ? fopen($input, 'rb') : false;
$inflate = null;
if ($source !== false) {
    $magic = (string) fread($source, 2);
    rewind($source);
    if ($magic === "\x1f\x8b") {
        $inflate = inflate_init(ZLIB_ENCODING_GZIP);
    }
}
$pending = '';
$carry = '';
$stripRestrict = (bool) ($job['strip_restrict'] ?? false);

/*
 * Lines a pg_dump of 18 or a patched release puts around a plain dump: "\restrict <key>" and
 * "\unrestrict <key>". psql is already restricted with a key the file cannot know, so the
 * file's own pair would only fail; they are blanked, which keeps the line numbers.
 */
$filter = static function (string $text, bool $last) use (&$carry, $stripRestrict): string {
    if (!$stripRestrict) {
        return $text;
    }
    $text = $carry . $text;
    $end = $last ? strlen($text) : strrpos($text, "\n");
    if ($end === false) {
        $carry = $text;

        return '';
    }
    $carry = $last ? '' : substr($text, $end + 1);
    $lines = substr($text, 0, $last ? $end : $end + 1);

    return (string) preg_replace('/^\\\\(un)?restrict[ \t]+\S+[ \t]*\r?$/m', '', $lines);
};

$stderrLine = '';
$countErrors = static function (string $chunk) use (&$stderrLine, &$status): void {
    $text = $stderrLine . $chunk;
    $lines = explode("\n", $text);
    $stderrLine = array_pop($lines);
    foreach ($lines as $line) {
        if (preg_match('/^((psql|pg_restore)(:[^\n]*?)?: )?(ERROR|FATAL|error|fatal):/', $line) === 1) {
            $status['errors']++;
        } elseif (preg_match('/^pg_restore: warning: errors ignored on restore: (\d+)/', $line, $m) === 1) {
            // pg_restore's own count, which takes in what its parallel workers did not print.
            $status['errors'] = max($status['errors'], (int) $m[1]);
        }
    }
};

$lastWrite = 0.0;
$signalled = null;
while ($open !== []) {
    if ($stopping && $signalled === null) {
        $status['killed'] = true;
        proc_terminate($process, SIGINT);
        $signalled = microtime(true);
    } elseif ($signalled !== null && microtime(true) - $signalled > 5) {
        proc_terminate($process, SIGTERM);
        $signalled = INF;
    }

    $read = array_values($open);
    $write = $stdin !== null ? [$stdin] : [];
    $except = null;
    $ready = @stream_select($read, $write, $except, 0, 200000);
    if ($ready === false) {
        // A signal interrupted the wait.
        continue;
    }

    foreach ($read as $pipe) {
        $chunk = (string) fread($pipe, CHUNK);
        if ($chunk === '' && feof($pipe)) {
            fclose($pipe);
            $open = array_filter($open, static fn ($p): bool => $p !== $pipe);
            continue;
        }
        fwrite($log, $chunk);
        if ($pipe === $pipes[2]) {
            $countErrors($chunk);
        }
    }

    if ($write !== [] && $stdin !== null) {
        if ($pending === '' && $source !== false) {
            $raw = (string) fread($source, CHUNK);
            $status['read'] += strlen($raw);
            $done = feof($source);
            $pending = $filter($inflate !== null ? (string) inflate_add($inflate, $raw, $done ? ZLIB_FINISH : ZLIB_SYNC_FLUSH) : $raw, $done);
            if ($done) {
                fclose($source);
                $source = false;
            }
        }
        if ($pending !== '') {
            $written = @fwrite($stdin, $pending);
            if ($written === false) {
                // The program has stopped reading: it ended, or stopped at an error.
                $pending = '';
                $source = false;
            } else {
                $pending = substr($pending, $written);
            }
        }
        if (($pending === '' && $source === false) || $stopping) {
            fclose($stdin);
            $stdin = null;
        }
    }

    if (microtime(true) - $lastWrite > 0.5) {
        $writeStatus($status);
        $lastWrite = microtime(true);
    }
}
if ($stderrLine !== '') {
    $countErrors("\n");
}
if ($stdin !== null) {
    fclose($stdin);
}
if (is_resource($source)) {
    fclose($source);
}

// proc_close() cannot give the exit code once proc_get_status() has seen the program end, so
// the code is taken from the status that first reports it.
do {
    $state = proc_get_status($process);
    if ($state['running']) {
        usleep(50000);
    }
} while ($state['running']);
proc_close($process);
fclose($log);

$status['exit_code'] = $state['signaled'] ? 128 + $state['termsig'] : $state['exitcode'];
$status['ended_at'] = gmdate('Y-m-d\TH:i:s\Z');
if ($input !== null && ($job['delete_input'] ?? false)) {
    @unlink($input);
}
$writeStatus($status);
