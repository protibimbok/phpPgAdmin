<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Database;

/** One column of a result set: its name, type and, for a plain column of a table, where it comes from. */
final readonly class Column
{
    public function __construct(
        public string $name,
        public int $typeOid,
        public string $typeName,
        /** The OID of the table the column is read from, or null for an expression. */
        public ?int $tableOid,
    ) {
    }

    /** @return array{name: string, type_oid: int, type_name: string, table_oid: int|null} */
    public function toArray(): array
    {
        return ['name' => $this->name, 'type_oid' => $this->typeOid, 'type_name' => $this->typeName, 'table_oid' => $this->tableOid];
    }
}
