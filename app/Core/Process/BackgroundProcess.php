<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Process;

use PhpPgAdmin\Core\Facades\Config;
use RuntimeException;

/**
 * A program run in the background by bin/process-runner.php, for work that outlasts a request
 * (an import). Each one has a directory: job.json (the program, its arguments and its input,
 * never the environment, which carries the password), output.log and status.json, which the
 * runner keeps up to date. The environment is handed to the runner when it starts and goes no
 * further than the program.
 */
final readonly class BackgroundProcess
{
    /** Output returned by one read of the log at most. */
    public const int OUTPUT_LIMIT = 262144;

    public function __construct(public string $directory)
    {
    }

    /** The directory every process's own directory is made in. */
    public static function root(): string
    {
        return rtrim((string) Config::get('storage.processes', dirname(__DIR__, 3) . '/storage/processes'), '/');
    }

    /** A new, empty directory for a process, with an id to find it by. */
    public static function prepare(): self
    {
        $root = self::root();
        if (!is_dir($root) && !@mkdir($root, 0700, true) && !is_dir($root)) {
            throw new RuntimeException(sprintf('Cannot create the process directory %s.', $root));
        }
        $id = bin2hex(random_bytes(12));
        if (!@mkdir($root . '/' . $id, 0700)) {
            throw new RuntimeException(sprintf('Cannot create the process directory %s/%s.', $root, $id));
        }

        return new self($root . '/' . $id);
    }

    /** The process with this id, or null when the id is not one. */
    public static function find(string $id): ?self
    {
        return preg_match('/^[0-9a-f]{24}$/', $id) === 1 ? new self(self::root() . '/' . $id) : null;
    }

    /**
     * Remove the directories of ended processes of one kind (those holding the marker file),
     * ended at least $age seconds ago. A query tool or debugger session that ends on its own
     * (its heartbeat stopped) has nobody left to remove it; the next one started sweeps.
     */
    public static function removeEnded(string $marker, int $age = 600): void
    {
        foreach (@scandir(self::root()) ?: [] as $id) {
            if (preg_match('/^[0-9a-f]{24}$/', $id) !== 1 || !is_file(self::root() . '/' . $id . '/' . $marker)) {
                continue;
            }
            $process = new self(self::root() . '/' . $id);
            $ended = @filemtime($process->directory . '/status.json');
            if ($process->status()['state'] !== 'running' && $ended !== false && time() - $ended >= $age) {
                $process->remove();
            }
        }
    }

    public function id(): string
    {
        return basename($this->directory);
    }

    /**
     * Start the program and return once the runner has taken it over.
     *
     * @param list<string> $arguments
     * @param array<string, string> $environment
     * @param string|null $input a file fed to the program's standard input (inflated when gzipped)
     * @param bool $stripRestrict blank a plain dump's own \restrict and \unrestrict lines
     */
    public function start(string $program, array $arguments, array $environment, ?string $input = null, bool $deleteInput = false, bool $stripRestrict = false): void
    {
        file_put_contents($this->directory . '/job.json', json_encode([
            'program' => $program,
            'arguments' => $arguments,
            'input' => $input,
            'delete_input' => $deleteInput,
            'strip_restrict' => $stripRestrict,
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));

        // The shell puts the runner in the background and returns; the runner outlives the request.
        $command = ['/bin/sh', '-c', '"$0" "$1" "$2" </dev/null >/dev/null 2>"$2/runner.log" &', self::php(), dirname(__DIR__, 3) . '/bin/process-runner.php', $this->directory];
        $shell = proc_open($command, [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, null, $environment + ['PATH' => (string) getenv('PATH'), 'LC_MESSAGES' => 'C']);
        if ($shell === false) {
            throw new RuntimeException('The background process could not be started.');
        }
        proc_close($shell);

        if ($this->waitForStatus(100)) {
            return;
        }
        // Withdraw the job. When the rename fails the runner has claimed it and is starting up
        // (a slow host): wait for it rather than leave a job running that nothing tracks.
        if (!@rename($this->directory . '/job.json', $this->directory . '/job.withdrawn.json')) {
            if ($this->waitForStatus(1500)) {
                return;
            }
        }
        $message = trim((string) @file_get_contents($this->directory . '/runner.log'));
        throw new RuntimeException($message !== '' ? $message : sprintf('The background process did not start (%s).', self::php()));
    }

    /** Wait up to $steps × 20 ms for the runner's first status; true once it is there. */
    private function waitForStatus(int $steps): bool
    {
        for ($wait = 0; $wait < $steps && !is_file($this->directory . '/status.json'); $wait++) {
            usleep(20000);
        }

        return is_file($this->directory . '/status.json');
    }

    /**
     * What the runner last wrote, with a state read from it: running, finished, failed, killed,
     * or lost when the runner is gone without having written an end.
     *
     * @return array{state: string, exit_code: int|null, errors: int, read: int, size: int|null, started_at: string|null, ended_at: string|null}
     */
    public function status(): array
    {
        $status = json_decode((string) @file_get_contents($this->directory . '/status.json'), true);
        $status = is_array($status) ? $status : [];
        $exitCode = isset($status['exit_code']) ? (int) $status['exit_code'] : null;
        $ended = is_string($status['ended_at'] ?? null);
        $state = match (true) {
            $ended && ($status['killed'] ?? false) => 'killed',
            $ended => $exitCode === 0 ? 'finished' : 'failed',
            $this->alive((int) ($status['runner_pid'] ?? 0)) => 'running',
            default => 'lost',
        };

        return [
            'state' => $state,
            'exit_code' => $exitCode,
            'errors' => (int) ($status['errors'] ?? 0),
            'read' => (int) ($status['read'] ?? 0),
            'size' => isset($status['size']) ? (int) $status['size'] : null,
            'started_at' => is_string($status['started_at'] ?? null) ? $status['started_at'] : null,
            'ended_at' => $ended ? $status['ended_at'] : null,
        ];
    }

    /**
     * The output from a byte offset on, up to OUTPUT_LIMIT bytes and ending at a line end while
     * the program runs, so that a line is never cut between two reads.
     *
     * @return array{text: string, offset: int, size: int}
     */
    public function output(int $offset, bool $running): array
    {
        $file = $this->directory . '/output.log';
        $size = (int) @filesize($file);
        $offset = max(0, min($offset, $size));
        $handle = @fopen($file, 'rb');
        if ($handle === false || $offset === $size) {
            return ['text' => '', 'offset' => $offset, 'size' => $size];
        }
        fseek($handle, $offset);
        $text = (string) fread($handle, self::OUTPUT_LIMIT);
        fclose($handle);
        if (($running || $offset + strlen($text) < $size) && ($end = strrpos($text, "\n")) !== false) {
            $text = substr($text, 0, $end + 1);
        }

        return ['text' => $text, 'offset' => $offset + strlen($text), 'size' => $size];
    }

    /** Ask the runner to stop the program; false when it is not running. */
    public function stop(): bool
    {
        $status = json_decode((string) @file_get_contents($this->directory . '/status.json'), true);
        $pid = (int) ($status['runner_pid'] ?? 0);
        if (!is_array($status) || is_string($status['ended_at'] ?? null) || !$this->alive($pid)) {
            return false;
        }

        return function_exists('posix_kill') ? posix_kill($pid, SIGTERM) : (exec('kill -TERM ' . $pid, result_code: $code) !== false && $code === 0);
    }

    /** Remove the directory with the input, output and status. */
    public function remove(): void
    {
        // scandir rather than glob(GLOB_BRACE), which musl (Alpine) builds of PHP lack.
        foreach (@scandir($this->directory) ?: [] as $name) {
            $file = $this->directory . '/' . $name;
            if ($name !== '.' && $name !== '..' && is_file($file)) {
                @unlink($file);
            }
        }
        @rmdir($this->directory);
    }

    /**
     * Whether the runner with this pid still runs. After a reboot or a long time the pid may
     * belong to another program, so where /proc tells, the pid must be this directory's runner.
     */
    private function alive(int $pid): bool
    {
        if ($pid <= 0) {
            return false;
        }
        $cmdline = @file_get_contents('/proc/' . $pid . '/cmdline');
        if (is_string($cmdline)) {
            return str_contains($cmdline, 'process-runner.php') && str_contains($cmdline, $this->directory);
        }
        if (is_dir('/proc/self')) {
            // /proc is there but the pid is not: it has ended.
            return false;
        }
        if (function_exists('posix_kill')) {
            return posix_kill($pid, 0);
        }

        return false;
    }

    /** The PHP CLI that runs the background scripts. */
    public static function php(): string
    {
        $configured = Config::get('tools.php_binary');
        if (is_string($configured) && $configured !== '') {
            return $configured;
        }

        return PHP_SAPI === 'cli' ? PHP_BINARY : PHP_BINDIR . '/php';
    }
}
