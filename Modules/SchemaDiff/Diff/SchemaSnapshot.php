<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\SchemaDiff\Diff;

use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The objects of one schema as the schema diff compares them. When a whole database is
 * compared, a schema only one side has stands on the other as an absent snapshot, with no
 * objects, so that each of its objects is only in the source or only in the target.
 */
final class SchemaSnapshot extends Snapshot
{
    /**
     * The node types compared, in the order a script creates them: what a column or a routine
     * may use comes first, the relations that use them after, the views last.
     */
    public const array TYPES = [
        'collation', 'type', 'domain', 'fts_parser', 'fts_template', 'fts_dictionary', 'fts_configuration',
        'sequence', 'function', 'procedure', 'trigger_function', 'aggregate', 'operator',
        'table', 'foreign_table', 'view', 'mview',
    ];

    public readonly ?int $scid;

    public function __construct(
        ConnectionPool $pool,
        Connection $conn,
        public readonly string $schema,
        ServerRequestInterface $request,
        bool $absent = false,
    ) {
        parent::__construct($pool, $conn, $request);
        if ($absent) {
            $this->scid = null;

            return;
        }
        $scid = $conn->scalar('SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = $1', [$schema]);
        if ($scid === null) {
            throw new NotFoundException(sprintf('There is no schema "%s" in the database "%s".', $schema, $conn->database()));
        }
        $this->scid = (int) $scid;
    }

    public function types(): array
    {
        return self::TYPES;
    }

    protected function parent(): string
    {
        return 'schema';
    }

    protected function containerIds(): array
    {
        return $this->scid === null ? [] : ['scid' => $this->scid];
    }

    protected function exists(): bool
    {
        return $this->scid !== null;
    }
}
