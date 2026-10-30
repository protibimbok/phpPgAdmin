<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Auth\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Http\ApiException;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Auth\Preferences;
use PhpPgAdmin\Modules\Auth\RecentFavoriteTables;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The navigation panel's Recent and Favorites lists, after phpMyAdmin's RecentTablesList and
 * FavoriteTable controllers: both lists, a table opened (recorded first in Recent), and a table
 * added to or removed from Favorites. A table is only recorded when it exists; its kind is read
 * from the catalog, not taken from the request.
 */
final class RecentFavoriteController
{
    /** pg_class.relkind of the relations whose pages the lists open, as the kind in their URL. */
    private const array KINDS = ['r' => 'table', 'p' => 'table', 'v' => 'view', 'm' => 'mview'];

    /** @return array{recent: list<array<string, string>>, favorite: list<array<string, string>>} */
    public function index(ServerRequestInterface $request): array
    {
        return $this->lists($request);
    }

    /** @return array{recent: list<array<string, string>>, favorite: list<array<string, string>>} */
    public function recent(ServerRequestInterface $request): array
    {
        [$database, $schema, $table] = $this->target((array) $request->getParsedBody());
        $limit = self::limit(RecentFavoriteTables::RECENT);
        if ($limit > 0) {
            $kind = $this->kind($request, $database, $schema, $table);
            if ($kind !== null) {
                $this->store($request, RecentFavoriteTables::RECENT)->add($database, $schema, $table, $kind, $limit);
            }
        }

        return $this->lists($request);
    }

    /** @return array{recent: list<array<string, string>>, favorite: list<array<string, string>>} */
    public function addFavorite(ServerRequestInterface $request): array
    {
        [$database, $schema, $table] = $this->target((array) $request->getParsedBody());
        $favorites = $this->store($request, RecentFavoriteTables::FAVORITE);
        if (!$favorites->has($database, $schema, $table)) {
            $limit = self::limit(RecentFavoriteTables::FAVORITE);
            if ($favorites->count() >= $limit) {
                throw new ApiException(409, __('auth::errors.favorites_full'));
            }
            $kind = $this->kind($request, $database, $schema, $table) ?? throw new NotFoundException(sprintf('There is no table "%s"."%s" in "%s".', $schema, $table, $database));
            $favorites->add($database, $schema, $table, $kind, $limit);
        }

        return $this->lists($request);
    }

    /** @return array{recent: list<array<string, string>>, favorite: list<array<string, string>>} */
    public function removeFavorite(ServerRequestInterface $request): array
    {
        [$database, $schema, $table] = $this->target($request->getQueryParams());
        $this->store($request, RecentFavoriteTables::FAVORITE)->delete($database, $schema, $table);

        return $this->lists($request);
    }

    /** The list's length setting: the role's NumRecentTables / NumFavoriteTables, 0 for none. */
    private static function limit(string $list): int
    {
        $value = Preferences::forSession()?->get(RecentFavoriteTables::LIMIT_KEYS[$list]);

        return is_int($value) ? max(0, $value) : RecentFavoriteTables::DEFAULT_LIMIT;
    }

    /** @return array{recent: list<array<string, string>>, favorite: list<array<string, string>>} */
    private function lists(ServerRequestInterface $request): array
    {
        return [
            'recent' => $this->store($request, RecentFavoriteTables::RECENT)->all(self::limit(RecentFavoriteTables::RECENT)),
            'favorite' => $this->store($request, RecentFavoriteTables::FAVORITE)->all(self::limit(RecentFavoriteTables::FAVORITE)),
        ];
    }

    private function store(ServerRequestInterface $request, string $list): RecentFavoriteTables
    {
        return RecentFavoriteTables::for(Authenticate::sessionServer()?->key() ?? '', ConnectionPool::from($request)->username(), $list);
    }

    /**
     * @param array<mixed> $input
     * @return array{string, string, string}
     */
    private function target(array $input): array
    {
        $names = [];
        foreach (['database', 'schema', 'table'] as $field) {
            $value = $input[$field] ?? null;
            if (!is_string($value) || $value === '') {
                throw new BadRequestException('Name the table: its database, schema and table.');
            }
            $names[] = $value;
        }

        return [$names[0], $names[1], $names[2]];
    }

    /** The kind of relation the table is, or null when there is none of that name. */
    private function kind(ServerRequestInterface $request, string $database, string $schema, string $table): ?string
    {
        $relkind = ConnectionPool::from($request)->for($database)->scalar(
            'SELECT c.relkind FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2',
            [$schema, $table],
        );

        return self::KINDS[(string) $relkind] ?? null;
    }
}
