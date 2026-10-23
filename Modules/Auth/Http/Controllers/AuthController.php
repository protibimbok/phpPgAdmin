<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Auth\Http\Controllers;

use League\Route\Http\Exception as HttpException;
use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\ConnectionException;
use PhpPgAdmin\Core\Database\Connector;
use PhpPgAdmin\Core\Facades\Lang;
use PhpPgAdmin\Core\I18n\LocaleResolver;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Auth\Preferences;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Logging in means connecting to the configured PostgreSQL server as the given role,
 * like phpMyAdmin's cookie authentication does against MySQL. The credentials are kept
 * in the session so later requests can open connections for the same role.
 *
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

        if ($username === '') {
            throw new BadRequestException(__('auth::errors.credentials_required'));
        }

        $connector = Connector::fromConfig();

        try {
            [$connection, $credentials] = $connector->login($username, $password);
        } catch (ConnectionException $e) {
            // The server's own message, the way pgAdmin and phpMyAdmin report a failed connection.
            if (!$e->credentialsRejected()) {
                error_log(sprintf('phpPgAdmin: cannot connect to %s:%d: %s', $connector->host, $connector->port, $e->getMessage()));
            }

            throw new HttpException($e->httpStatus(), $e->getMessage());
        }

        /** @var string|false $version */
        $version = $connection->query('SHOW server_version')->fetchColumn();
        unset($connection);

        // A fresh session id, so a session fixed before the login does not carry the credentials.
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_regenerate_id(true);
        }

        $_SESSION[Authenticate::USER] = [
            'username' => $username,
            'server' => [
                'host' => $connector->host,
                'port' => $connector->port,
                'version' => $version === false ? null : $version,
            ],
        ];
        $_SESSION[Authenticate::CREDENTIALS] = $credentials->toArray();

        // The role's saved language, as phpMyAdmin restores a user's settings from its configuration
        // storage. The session and, through SetLocale, the cookie follow it; the client switches too.
        $saved = Preferences::for($username)->get(Preferences::LOCALE);
        if (is_string($saved) && ($locale = Lang::find($saved)) !== null) {
            Lang::setLocale($locale);
            $_SESSION[LocaleResolver::SESSION_KEY] = $locale->code;
        }

        return ['user' => $_SESSION[Authenticate::USER], 'locale' => Lang::locale()->code];
    }

    /** @return array<string, mixed> */
    public function logout(ServerRequestInterface $request): array
    {
        unset($_SESSION[Authenticate::USER], $_SESSION[Authenticate::CREDENTIALS]);

        if (session_status() === PHP_SESSION_ACTIVE) {
            session_regenerate_id(true);
        }

        return ['ok' => true];
    }

    /** @return array<string, mixed> */
    public function me(ServerRequestInterface $request): array
    {
        return ['user' => $request->getAttribute(Authenticate::USER)];
    }
}
