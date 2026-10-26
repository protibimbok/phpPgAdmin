<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sql\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Sql\Storage\Bookmarks;
use PhpPgAdmin\Modules\Sql\Storage\QueryHistory;
use Psr\Http\Message\ServerRequestInterface;

/** The signed-in role's saved queries and its query history on this server. */
final class BookmarkController
{
    /** @return array{bookmarks: list<array<string, mixed>>} */
    public function index(ServerRequestInterface $request): array
    {
        $database = $request->getQueryParams()['database'] ?? null;

        return ['bookmarks' => $this->bookmarks($request)->all(is_string($database) && $database !== '' ? $database : null)];
    }

    /** @return array{bookmark: array<string, mixed>} */
    public function store(ServerRequestInterface $request): array
    {
        $input = (array) ($request->getParsedBody() ?? []);
        $label = trim((string) ($input['label'] ?? ''));
        $sql = trim((string) ($input['sql'] ?? ''));
        $database = (string) ($input['database'] ?? '');
        if ($label === '' || $sql === '' || $database === '') {
            throw new BadRequestException('A label, a database and a query are required.');
        }

        return ['bookmark' => $this->bookmarks($request)->create($database, $label, $sql, !empty($input['shared']), !empty($input['replace']))];
    }

    /**
     * @param array{id: string} $args
     * @return array{ok: true}
     */
    public function destroy(ServerRequestInterface $request, array $args): array
    {
        if (!$this->bookmarks($request)->delete((int) $args['id'])) {
            throw new NotFoundException('No such bookmark.');
        }

        return ['ok' => true];
    }

    /** @return array{history: list<array<string, mixed>>} */
    public function history(ServerRequestInterface $request): array
    {
        $query = $request->getQueryParams();
        $database = $query['database'] ?? null;

        return ['history' => $this->historyOf($request)->all((int) ($query['limit'] ?? 100), is_string($database) && $database !== '' ? $database : null)];
    }

    /** @return array{ok: true} */
    public function clearHistory(ServerRequestInterface $request): array
    {
        $this->historyOf($request)->clear();

        return ['ok' => true];
    }

    private function bookmarks(ServerRequestInterface $request): Bookmarks
    {
        return Bookmarks::for(Authenticate::sessionServer()?->key() ?? '', ConnectionPool::from($request)->username());
    }

    private function historyOf(ServerRequestInterface $request): QueryHistory
    {
        return QueryHistory::for(Authenticate::sessionServer()?->key() ?? '', ConnectionPool::from($request)->username());
    }
}
