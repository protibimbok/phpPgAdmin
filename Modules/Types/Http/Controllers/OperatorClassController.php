<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Types\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;

/**
 * The schema's operator classes, operator families and conversions, as the classic phpPgAdmin
 * lists them: each with its access method or encodings, the CREATE statement that makes it
 * again (members read the way pg_dump reads them), and DROP. They are not edited here; a
 * class's members are fixed at creation, and the SQL page runs ALTER OPERATOR FAMILY.
 */
final class OperatorClassController
{
    private const array KINDS = ['opclass' => 'OPERATOR CLASS', 'opfamily' => 'OPERATOR FAMILY', 'conversion' => 'CONVERSION'];

    /** @return list<array<string, mixed>> */
    public function list(NodeContext $ctx): array
    {
        return $ctx->conn->rows($ctx->renderFrom('opclasses', 'list.sql', ['kind' => null, 'oid' => null]));
    }

    /** The CREATE statement and the comment, after a commented DROP. */
    public function sql(NodeContext $ctx, string $kind, int $oid): string
    {
        $row = $this->row($ctx, $kind, $oid);
        $name = $this->qualified($row);
        $using = $kind === 'conversion' ? '' : ' USING ' . Quoting::ident((string) $row['amname']);

        $create = match ($kind) {
            'opclass' => sprintf(
                "CREATE OPERATOR CLASS %s\n    %sFOR TYPE %s USING %s%s AS\n    %s;",
                $name,
                $row['is_default'] ? 'DEFAULT ' : '',
                $row['for_type'],
                Quoting::ident((string) $row['amname']),
                $row['family'] === null ? '' : ' FAMILY ' . $row['family'],
                implode(",\n    ", [...$this->members($ctx, 'pg_opclass', $oid, 'i'), ...($row['storage'] === null ? [] : ['STORAGE ' . $row['storage']])]),
            ),
            'opfamily' => $this->familySql($ctx, $row, $name, $oid),
            default => sprintf("CREATE %sCONVERSION %s\n    FOR %s TO %s FROM %s;", $row['is_default'] ? 'DEFAULT ' : '', $name, Quoting::literal((string) $row['source_encoding']), Quoting::literal((string) $row['target_encoding']), $row['function']),
        };
        $parts = [Ddl::header(ucwords(strtolower(self::KINDS[$kind])), $name, sprintf('DROP %s IF EXISTS %s%s;', self::KINDS[$kind], $name, $using)), $create];
        if ($row['description'] !== null && $row['description'] !== '') {
            $parts[] = sprintf('COMMENT ON %s %s%s IS %s;', self::KINDS[$kind], $name, $using, Quoting::literal((string) $row['description']));
        }

        return Ddl::assemble($parts);
    }

    /** DROP OPERATOR CLASS / OPERATOR FAMILY / CONVERSION, CASCADE on request. */
    public function delete(NodeContext $ctx, string $kind, int $oid, bool $cascade): void
    {
        $row = $this->row($ctx, $kind, $oid);
        $using = $kind === 'conversion' ? '' : ' USING ' . Quoting::ident((string) $row['amname']);
        $ctx->conn->exec(sprintf('DROP %s %s%s%s', self::KINDS[$kind], $this->qualified($row), $using, $cascade ? ' CASCADE' : ''));
    }

    /** @param array<string, mixed> $row */
    private function familySql(NodeContext $ctx, array $row, string $name, int $oid): string
    {
        $sql = sprintf('CREATE OPERATOR FAMILY %s USING %s;', $name, Quoting::ident((string) $row['amname']));
        $members = $this->members($ctx, 'pg_opfamily', $oid, 'a');
        if ($members !== []) {
            $sql .= sprintf("\n\nALTER OPERATOR FAMILY %s USING %s ADD\n    %s;", $name, Quoting::ident((string) $row['amname']), implode(",\n    ", $members));
        }

        return $sql;
    }

    /** @return list<string> */
    private function members(NodeContext $ctx, string $refclass, int $oid, string $deptype): array
    {
        return array_map(static fn (array $r): string => (string) $r['member'], $ctx->conn->rows($ctx->renderFrom('opclasses', 'members.sql', ['refclass' => $refclass, 'oid' => $oid, 'deptype' => $deptype])));
    }

    /** @return array<string, mixed> */
    private function row(NodeContext $ctx, string $kind, int $oid): array
    {
        if (!isset(self::KINDS[$kind])) {
            throw new BadRequestException('The kind is opclass, opfamily or conversion.');
        }

        return $ctx->conn->row($ctx->renderFrom('opclasses', 'list.sql', ['kind' => $kind, 'oid' => $oid]))
            ?? throw new NotFoundException('It may have been removed by another user.');
    }

    /** @param array<string, mixed> $row */
    private function qualified(array $row): string
    {
        return Quoting::ident((string) $row['schema'], (string) $row['name']);
    }
}
