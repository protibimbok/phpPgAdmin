<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Nodes;

use PhpPgAdmin\Core\Database\Connection;

/**
 * The lists the create and alter forms offer in their selects: roles, tablespaces, encodings,
 * schemas and collations of the server the connection is to.
 */
final class Catalog
{
    /** @return list<string> the roles a form may name as an owner, the pg_* ones left out */
    public static function roles(Connection $conn): array
    {
        return array_column($conn->rows("SELECT rolname FROM pg_catalog.pg_roles WHERE rolname NOT LIKE E'pg\\\\_%' ORDER BY rolname"), 'rolname');
    }

    /** @return list<string> */
    public static function tablespaces(Connection $conn): array
    {
        return array_column($conn->rows('SELECT spcname FROM pg_catalog.pg_tablespace ORDER BY spcname'), 'spcname');
    }

    /** @return list<string> the server encodings, as pgAdmin's get_encodings.sql lists them */
    public static function encodings(Connection $conn): array
    {
        return array_column($conn->rows("SELECT pg_catalog.pg_encoding_to_char(s.i) AS encoding FROM pg_catalog.generate_series(0, 100, 1) AS s(i) WHERE pg_catalog.pg_encoding_to_char(s.i) <> '' ORDER BY 1"), 'encoding');
    }

    /** @return list<string> the user schemas of the connection's database */
    public static function schemas(Connection $conn): array
    {
        return array_column($conn->rows("SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname NOT LIKE E'pg\\\\_%' AND nspname <> 'information_schema' ORDER BY nspname"), 'nspname');
    }

    /** @return list<string> the collations as a COLLATE clause names them, "pg_catalog.\"C\"", as columns/get_collations.sql lists them */
    public static function collations(Connection $conn): array
    {
        return array_column($conn->rows("SELECT pg_catalog.concat(pg_catalog.quote_ident(n.nspname), '.', pg_catalog.quote_ident(c.collname)) AS collation FROM pg_catalog.pg_collation c JOIN pg_catalog.pg_namespace n ON c.collnamespace = n.oid ORDER BY n.nspname, c.collname"), 'collation');
    }

    /** @return list<string> the databases the role may use as a CREATE DATABASE template */
    public static function databases(Connection $conn): array
    {
        return array_column($conn->rows('SELECT datname FROM pg_catalog.pg_database ORDER BY datname'), 'datname');
    }
}
