<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Auth\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Actions return arrays; the JSON strategy encodes them. Return a ResponseInterface for anything else.
 */
final class AuthController
{
    /** @return array<string, mixed> */
    public function login(ServerRequestInterface $request): array
    {
        $input = (array) ($request->getParsedBody() ?? []);
        $username = (string) ($input['username'] ?? '');
        $password = (string) ($input['password'] ?? '');

        if ($username === '' || $password === '') {
            throw new BadRequestException('username and password are required');
        }

        // TODO: verify against PostgreSQL. For now, store the username in session.
        $_SESSION['user'] = ['username' => $username];

        return ['user' => $_SESSION['user']];
    }

    /** @return array<string, mixed> */
    public function logout(ServerRequestInterface $request): array
    {
        unset($_SESSION['user']);

        return ['ok' => true];
    }

    /** @return array<string, mixed> */
    public function me(ServerRequestInterface $request): array
    {
        return ['user' => $request->getAttribute('user')];
    }
}
