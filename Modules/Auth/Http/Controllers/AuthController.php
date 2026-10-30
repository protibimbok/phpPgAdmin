<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Auth\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Contracts\EndsWithSignOut;
use PhpPgAdmin\Core\Database\ConnectionException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Database\Connector;
use PhpPgAdmin\Core\Database\Server;
use PhpPgAdmin\Core\Facades\Config;
use PhpPgAdmin\Core\Facades\Lang;
use PhpPgAdmin\Core\Facades\Modules;
use PhpPgAdmin\Core\Http\ApiException;
use PhpPgAdmin\Core\I18n\LocaleResolver;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Auth\Preferences;
use PhpPgAdmin\Modules\Auth\Servers;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Logging in means connecting to a PostgreSQL server as the given role, like phpMyAdmin's
 * cookie authentication does against MySQL. The server is the configured one, a saved one
 * picked by id, or one entered under the form's "Advanced" section; a server a login succeeds
 * against is saved (without the password) and offered next time. The credentials and the
 * server are kept in the session so later requests can open connections for the same role.
 *
 * Actions return arrays; the JSON strategy encodes them. Return a ResponseInterface for anything else.
 */
final class AuthController
{
    /**
     * The servers the login page offers: the saved ones, most recently used first, and the
     * configured default to pre-fill the advanced fields with.
     *
     * @return array{servers: list<array<string, mixed>>, default: array<string, mixed>}
     */
    public function servers(ServerRequestInterface $request): array
    {
        $servers = Servers::make();

        return [
            'servers' => array_map(
                static fn (Server $server): array => [...$server->toArray(), 'last_username' => $server->id === null ? null : $servers->lastUsername($server->id)],
                $servers->all(),
            ),
            'default' => Server::fromConfig()->toArray(),
        ];
    }

    /** @return array<string, mixed> */
    public function login(ServerRequestInterface $request): array
    {
        $input = (array) ($request->getParsedBody() ?? []);
        $username = (string) ($input['username'] ?? '');
        $password = (string) ($input['password'] ?? '');

        if ($username === '') {
            throw new BadRequestException(__('auth::errors.credentials_required'));
        }

        if (self::disallowed($username, $password)) {
            throw new ApiException(403, __('auth::errors.login_disallowed'));
        }

        $server = $this->server($input['server'] ?? null);
        $connector = Connector::for($server);

        try {
            [$connection, $credentials] = $connector->login($username, $password);
        } catch (ConnectionException $e) {
            // The API reports the server's own message, the way pgAdmin and phpMyAdmin do; an
            // unreachable server is also worth a line in the log.
            if (!$e->credentialsRejected()) {
                error_log(sprintf('phpPgAdmin: cannot connect to %s:%d: %s', $connector->host, $connector->port, $e->getMessage()));
            }

            throw $e;
        }

        $version = $connection->versionString();
        $connection->close();

        // The server let the role in: remember it for the next login, without the password.
        $server = Servers::make()->remember($server, $username);

        // A sign-in that was still in the session (no logout first) ends with what it kept:
        // its query tool and debugger sessions must not pass to the new role.
        self::endSignIn(Authenticate::sessionPool());

        // A fresh session id, so a session fixed before the login does not carry the credentials.
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_regenerate_id(true);
        }

        $_SESSION[Authenticate::USER] = [
            'username' => $username,
            'server' => [
                'id' => $server->id,
                'name' => $server->name,
                'host' => $server->host,
                'port' => $server->port,
                'version' => $version !== '' ? $version : null,
            ],
        ];
        $_SESSION[Authenticate::CREDENTIALS] = $credentials->toArray();
        $_SESSION[Authenticate::SERVER] = $server->toSessionArray();
        unset($_SESSION[Authenticate::OTHER_CREDENTIALS]);

        // The role's saved language, as phpMyAdmin restores a user's settings from its configuration
        // storage. The session and, through SetLocale, the cookie follow it; the client switches too.
        $saved = Preferences::for($server, $username)->get(Preferences::LOCALE);
        if (is_string($saved) && ($locale = Lang::find($saved)) !== null) {
            Lang::setLocale($locale);
            $_SESSION[LocaleResolver::SESSION_KEY] = $locale->code;
        }

        return ['user' => $_SESSION[Authenticate::USER], 'locale' => Lang::locale()->code];
    }

    /**
     * The classic phpPgAdmin's extra_login_security: with it on, the usual superuser names and
     * empty passwords are refused before the server is asked, since a "trust" line in
     * pg_hba.conf would let them in with any password.
     */
    public static function disallowed(string $username, string $password): bool
    {
        if (!(bool) Config::get('auth.extra_login_security', false)) {
            return false;
        }

        return $password === '' || in_array(strtolower($username), ['postgres', 'pgsql', 'root', 'administrator'], true);
    }

    /** @return array<string, mixed> */
    public function logout(ServerRequestInterface $request): array
    {
        // The modules' background sessions (query tool, debugger) end with the sign-in, so an
        // open transaction does not outlive it holding its locks.
        try {
            $pool = ConnectionPool::from($request);
        } catch (\Throwable) {
            $pool = null;
        }
        self::endSignIn($pool);
        unset($_SESSION[Authenticate::USER], $_SESSION[Authenticate::CREDENTIALS], $_SESSION[Authenticate::SERVER], $_SESSION[Authenticate::OTHER_CREDENTIALS]);

        if (session_status() === PHP_SESSION_ACTIVE) {
            session_regenerate_id(true);
        }

        return ['ok' => true];
    }

    /** What the modules keep for a sign-in (EndsWithSignOut) ends with it. */
    private static function endSignIn(?ConnectionPool $pool): void
    {
        foreach (Modules::providing(EndsWithSignOut::class) as $module) {
            $module->signOut($pool);
        }
    }

    /** @return array<string, mixed> */
    public function me(ServerRequestInterface $request): array
    {
        return ['user' => $request->getAttribute(Authenticate::USER)];
    }

    /**
     * The server the form asks to sign in to: a saved one by id, one described by host and
     * port (the "Advanced" fields), or the configured default when nothing is given.
     */
    private function server(mixed $input): Server
    {
        if (!is_array($input) || $input === []) {
            return Server::fromConfig();
        }

        if (isset($input['id']) && is_numeric($input['id'])) {
            return Servers::make()->find((int) $input['id']) ?? throw new NotFoundException(__('auth::errors.unknown_server'));
        }

        try {
            $server = Server::fromArray($input);
        } catch (\InvalidArgumentException $e) {
            throw new BadRequestException($e->getMessage());
        }
        // A host and port typed in that are a saved server's sign in with its connection
        // options (role, post-connection SQL, SSL files), as choosing it from the list does.
        foreach (Servers::make()->all() as $saved) {
            if ($saved->host === $server->host && $saved->port === $server->port) {
                return $server->withOptions($saved->options);
            }
        }

        return $server;
    }
}
