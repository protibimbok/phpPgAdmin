<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sql\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\ConflictException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Sql\Storage\Macros;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The signed-in role's query macros on this server: pgAdmin's get_user_macros and set_macros,
 * one macro per request. A name or key already in use answers 409.
 */
final class MacroController
{
    /** @return array{macros: list<array<string, mixed>>, keys: list<string>} */
    public function index(ServerRequestInterface $request): array
    {
        return ['macros' => $this->macros($request)->all(), 'keys' => Macros::KEYS];
    }

    /** @return array{macro: array<string, mixed>} */
    public function store(ServerRequestInterface $request): array
    {
        $macros = $this->macros($request);
        [$name, $sql, $key] = $this->validated($request);
        $this->ensureFree($macros, $name, $key);

        return ['macro' => $macros->create($name, $sql, $key)];
    }

    /**
     * @param array{id: string} $args
     * @return array{macro: array<string, mixed>}
     */
    public function update(ServerRequestInterface $request, array $args): array
    {
        $macros = $this->macros($request);
        $id = (int) $args['id'];
        $current = $macros->find($id) ?? throw new NotFoundException('No such macro.');
        $input = (array) ($request->getParsedBody() ?? []);
        // A field left out stays as it is.
        [$name, $sql, $key] = $this->validated($request, $input + $current, $input);
        $this->ensureFree($macros, $name, $key, $id);

        return ['macro' => $macros->update($id, $name, $sql, $key) ?? throw new NotFoundException('No such macro.')];
    }

    /**
     * @param array{id: string} $args
     * @return array{ok: true}
     */
    public function destroy(ServerRequestInterface $request, array $args): array
    {
        if (!$this->macros($request)->delete((int) $args['id'])) {
            throw new NotFoundException('No such macro.');
        }

        return ['ok' => true];
    }

    /**
     * The name, statement and key of the request, checked: both texts present, the key one of
     * the fixed ones or none.
     *
     * @param array<string, mixed>|null $data the fields to read, the request's body by default
     * @param array<string, mixed>|null $given the fields the client sent, when $data has defaults mixed in
     * @return array{0: string, 1: string, 2: string|null}
     */
    private function validated(ServerRequestInterface $request, ?array $data = null, ?array $given = null): array
    {
        $data ??= (array) ($request->getParsedBody() ?? []);
        $given ??= $data;
        $name = trim((string) ($data['name'] ?? ''));
        $sql = trim((string) ($data['sql'] ?? ''));
        if ($name === '' || $sql === '') {
            throw new BadRequestException('A name and a statement are required.');
        }
        $key = array_key_exists('key', $given) ? $given['key'] : ($data['key'] ?? null);
        $key = $key === null || trim((string) $key) === '' ? null : trim((string) $key);
        if ($key !== null && !in_array($key, Macros::KEYS, true)) {
            throw new BadRequestException(sprintf('"%s" is not a macro key; use one of %s.', $key, implode(', ', Macros::KEYS)));
        }

        return [$name, $sql, $key];
    }

    private function ensureFree(Macros $macros, string $name, ?string $key, ?int $except = null): void
    {
        $taken = $macros->conflict($name, $key, $except);
        if ($taken === 'name') {
            throw new ConflictException(sprintf('A macro named "%s" exists already.', $name));
        }
        if ($taken === 'key') {
            throw new ConflictException(sprintf('The key %s is bound to another macro.', (string) $key));
        }
    }

    private function macros(ServerRequestInterface $request): Macros
    {
        return Macros::for(Authenticate::sessionServer()?->key() ?? '', ConnectionPool::from($request)->username());
    }
}
