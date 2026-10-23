<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Databases\Http\Controllers;

use League\Route\Http\Exception as HttpException;
use PhpPgAdmin\Core\Database\ConnectionException;
use PhpPgAdmin\Core\Database\Connector;
use PhpPgAdmin\Core\Database\Credentials;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use Psr\Http\Message\ServerRequestInterface;

final class DatabaseController
{
    /**
     * Every database on the server, with what pgAdmin shows in a database's properties. The
     * size is only computed for databases the role may connect to; the rest report null.
     */
    private const string LIST = <<<'SQL'
        SELECT d.datname AS name,
               pg_catalog.pg_get_userbyid(d.datdba) AS owner,
               pg_catalog.pg_encoding_to_char(d.encoding) AS encoding,
               d.datcollate AS collation,
               d.datistemplate AS is_template,
               d.datallowconn AS allow_connections,
               CASE WHEN d.datallowconn AND pg_catalog.has_database_privilege(d.datname, 'CONNECT')
                    THEN pg_catalog.pg_database_size(d.datname) END AS size,
               pg_catalog.shobj_description(d.oid, 'pg_database') AS comment
        FROM pg_catalog.pg_database d
        ORDER BY d.datname
        SQL;

    /**
     * @return array{databases: list<array<string, mixed>>}
     */
    public function index(ServerRequestInterface $request): array
    {
        /** @var Credentials $credentials */
        $credentials = $request->getAttribute(Authenticate::CREDENTIALS);

        try {
            $connection = Connector::fromConfig()->connect($credentials);
        } catch (ConnectionException $e) {
            throw new HttpException($e->httpStatus(), $e->getMessage());
        }

        $databases = [];
        foreach ($connection->query(self::LIST) as $row) {
            $databases[] = [
                'name' => $row['name'],
                'owner' => $row['owner'],
                'encoding' => $row['encoding'],
                'collation' => $row['collation'],
                'is_template' => (bool) $row['is_template'],
                'allow_connections' => (bool) $row['allow_connections'],
                'size' => $row['size'] === null ? null : (int) $row['size'],
                'comment' => $row['comment'],
            ];
        }

        return ['databases' => $databases];
    }
}
