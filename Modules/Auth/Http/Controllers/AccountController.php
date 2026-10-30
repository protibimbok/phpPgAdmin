<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Auth\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Database\Credentials;
use PhpPgAdmin\Core\Database\PasswordHash;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The signed-in role's own password, after phpMyAdmin's "Change password" (user-password) and
 * the classic phpPgAdmin's Account page: ALTER ROLE CURRENT_USER, which every role may run on
 * itself, with the verifier computed here. The session keeps working with the new password.
 */
final class AccountController
{
    private const array METHODS = ['scram-sha-256', 'md5'];

    /** @return array{username: string, password_encryption: string} */
    public function show(ServerRequestInterface $request): array
    {
        $pool = ConnectionPool::from($request);

        return ['username' => $pool->username(), 'password_encryption' => (string) $pool->maintenance()->scalar('SHOW password_encryption')];
    }

    /** @return array{ok: true} */
    public function password(ServerRequestInterface $request): array
    {
        $input = (array) ($request->getParsedBody() ?? []);
        $password = $input['password'] ?? null;
        if ($password !== null && (!is_string($password) || $password === '')) {
            throw new BadRequestException('Enter the new password, or choose "No Password".');
        }
        $method = (string) ($input['hashing'] ?? 'scram-sha-256');
        if (!in_array($method, self::METHODS, true)) {
            throw new BadRequestException(sprintf('Password hashing is one of %s.', implode(', ', self::METHODS)));
        }

        $pool = ConnectionPool::from($request);
        $conn = $pool->maintenance();
        if ($password === null) {
            $conn->exec('ALTER ROLE CURRENT_USER PASSWORD NULL');
        } else {
            $verifier = PasswordHash::verifier($password, $pool->username(), $method);
            if ($verifier === null) {
                // The server hashes it with its own password_encryption, set for this statement.
                $conn->transaction(static function () use ($conn, $method, $password): void {
                    $conn->exec('SELECT pg_catalog.set_config($1, $2, true)', ['password_encryption', $method]);
                    $conn->exec('ALTER ROLE CURRENT_USER PASSWORD ' . Quoting::literal($password));
                });
            } else {
                $conn->exec('ALTER ROLE CURRENT_USER PASSWORD ' . Quoting::literal($verifier));
            }
        }

        $credentials = Credentials::fromArray((array) ($_SESSION[Authenticate::CREDENTIALS] ?? []));
        if ($credentials !== null) {
            $_SESSION[Authenticate::CREDENTIALS] = (new Credentials($credentials->username, $password ?? '', $credentials->database))->toArray();
        }

        return ['ok' => true];
    }
}
