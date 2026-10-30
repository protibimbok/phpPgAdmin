<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Status\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Database\QueryException;
use Psr\Http\Message\ServerRequestInterface;

/**
 * pgAdmin's System Statistics dashboard, from EDB's system_stats extension in the database the
 * login landed in: GET /api/server/status/system says whether it is installed, and with
 * ?section= the views of one tab, each a system_stats function's rows. Summary: the OS, the CPU
 * and the processes (pg_sys_os_info, pg_sys_cpu_info, pg_sys_process_info); CPU: usage, load
 * average and the processes' CPU (pg_sys_cpu_usage_info, pg_sys_load_avg_info,
 * pg_sys_cpu_memory_by_process); Memory: memory and swap (pg_sys_memory_info) and the
 * processes' memory; Storage: the disks and their I/O (pg_sys_disk_info,
 * pg_sys_io_analysis_info). A function the platform does not provide is reported as such
 * rather than failing the tab.
 */
final class SystemStatsController
{
    /** @var array<string, array<string, string>> section → view name → its query */
    private const array SECTIONS = [
        'summary' => [
            'pg_sys_os_info()' => 'SELECT * FROM {schema}.pg_sys_os_info()',
            'pg_sys_cpu_info()' => 'SELECT * FROM {schema}.pg_sys_cpu_info()',
            'pg_sys_process_info()' => 'SELECT * FROM {schema}.pg_sys_process_info()',
        ],
        'cpu' => [
            'pg_sys_cpu_usage_info()' => 'SELECT * FROM {schema}.pg_sys_cpu_usage_info()',
            'pg_sys_load_avg_info()' => 'SELECT * FROM {schema}.pg_sys_load_avg_info()',
            'pg_sys_cpu_memory_by_process()' => 'SELECT pid, name, cpu_usage FROM {schema}.pg_sys_cpu_memory_by_process() ORDER BY cpu_usage DESC NULLS LAST, pid',
        ],
        'memory' => [
            'pg_sys_memory_info()' => 'SELECT * FROM {schema}.pg_sys_memory_info()',
            'pg_sys_cpu_memory_by_process()' => 'SELECT pid, name, memory_usage, memory_bytes FROM {schema}.pg_sys_cpu_memory_by_process() ORDER BY memory_bytes DESC NULLS LAST, pid',
        ],
        'storage' => [
            'pg_sys_disk_info()' => 'SELECT * FROM {schema}.pg_sys_disk_info() WHERE mount_point IS NOT NULL OR drive_letter IS NOT NULL ORDER BY total_space DESC NULLS LAST',
            'pg_sys_io_analysis_info()' => 'SELECT * FROM {schema}.pg_sys_io_analysis_info() ORDER BY device_name',
        ],
    ];

    /** @return array{available: bool, version: string|null, views?: list<array<string, mixed>>} */
    public function statistics(ServerRequestInterface $request): array
    {
        $conn = ConnectionPool::from($request)->maintenance();
        // The functions are named with the schema the extension was created in, so a function
        // of the same name earlier on the search path is never the one called.
        $extension = $conn->query(
            "SELECT e.extversion, n.nspname FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'system_stats'",
        )->textRows()[0] ?? null;
        $version = $extension[0] ?? null;
        $section = (string) ($request->getQueryParams()['section'] ?? '');
        if ($extension === null || $section === '') {
            return ['available' => $extension !== null, 'version' => $version];
        }
        $queries = self::SECTIONS[$section] ?? throw new BadRequestException(sprintf('"%s" is not a section: summary, cpu, memory or storage.', $section));
        $schema = $conn->escapeIdentifier((string) $extension[1]);

        $views = [];
        foreach ($queries as $view => $sql) {
            $views[] = self::view($conn, $view, str_replace('{schema}.', $schema . '.', $sql));
        }

        return ['available' => true, 'version' => (string) $version, 'views' => $views];
    }

    /** @return array{view: string, columns: list<string>, rows: list<list<string|null>>, error: string|null} */
    private static function view(Connection $conn, string $view, string $sql): array
    {
        try {
            $result = $conn->query($sql);
        } catch (QueryException $e) {
            // A function that is not there, or not on this platform, leaves the others shown.
            return ['view' => $view, 'columns' => [], 'rows' => [], 'error' => $e->getMessage()];
        }

        return ['view' => $view, 'columns' => array_map(static fn ($column): string => $column->name, $result->columns()), 'rows' => $result->textRows(), 'error' => null];
    }
}
