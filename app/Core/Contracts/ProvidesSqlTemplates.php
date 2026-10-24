<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Contracts;

/**
 * A module that ships SQL templates: pgAdmin's catalog queries and DDL, ported to Twig.
 *
 * The directory holds one folder per node ("tables", "schemas") with version folders inside
 * ("default", "13_plus", … "18_plus") and the template files in those, named as pgAdmin names
 * them ("properties.sql", "create.sql"). Sql::render('tables', 'create.sql', $vars, $version)
 * picks the newest version folder not above the server's that has the file.
 */
interface ProvidesSqlTemplates
{
    /** The directory, relative to the module's path, e.g. "resources/sql". */
    public function sqlTemplatesPath(): string;
}
