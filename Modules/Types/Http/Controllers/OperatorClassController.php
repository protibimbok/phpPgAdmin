<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Types\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;

/**
 * The schema's operator classes, operator families and conversions, as the classic phpPgAdmin
 * lists them: each with its access method or encodings, the CREATE statement that makes it
 * again (members read the way pg_dump reads them), CREATE from a form, and DROP. They are not
 * altered here; a class's members are fixed at creation, and the SQL page runs ALTER OPERATOR
 * FAMILY.
 */
final class OperatorClassController
{
    private const array KINDS = ['opclass' => 'OPERATOR CLASS', 'opfamily' => 'OPERATOR FAMILY', 'conversion' => 'CONVERSION'];

    /** An operator name, bare or schema-qualified: the characters PostgreSQL allows in one. */
    private const string OPERATOR = '/^(?:[A-Za-z_][A-Za-z0-9_$]*\.)?[+\-*\/<>=~!@#%^&|`?]{1,63}$/';

    /**
     * What the create form offers: the index access methods, the encodings, and the operator
     * families of the database (for a class's FAMILY and an operator's FOR ORDER BY).
     *
     * @return array{methods: list<string>, encodings: list<string>, families: list<array{name: string, amname: string}>}
     */
    public function options(NodeContext $ctx): array
    {
        return [
            'methods' => array_map('strval', array_column($ctx->conn->rows("SELECT amname FROM pg_catalog.pg_am WHERE amtype = 'i' ORDER BY amname"), 'amname')),
            'encodings' => Catalog::encodings($ctx->conn),
            'families' => array_map(static fn (array $r): array => ['name' => (string) $r['name'], 'amname' => (string) $r['amname']], $ctx->conn->rows(
                'SELECT pg_catalog.quote_ident(n.nspname) || \'.\' || pg_catalog.quote_ident(f.opfname) AS name, am.amname
                 FROM pg_catalog.pg_opfamily f JOIN pg_catalog.pg_namespace n ON n.oid = f.opfnamespace JOIN pg_catalog.pg_am am ON am.oid = f.opfmethod
                 ORDER BY n.nspname <> \'pg_catalog\', 1',
            )),
        ];
    }

    /** CREATE OPERATOR CLASS / OPERATOR FAMILY / CONVERSION from the form, with its comment. */
    public function create(NodeContext $ctx, string $kind, array $data): void
    {
        $ctx->conn->queryMulti($this->createSql($ctx, $kind, $data));
    }

    /**
     * The statements create() runs.
     *
     * The data: name and description for every kind; amname for a class and a family; for a
     * class also for_type, is_default, family, storage and members ({type: operator|function,
     * number, name, lefttype, righttype, order_by}); for a conversion source_encoding,
     * target_encoding, function and is_default.
     *
     * @param array<string, mixed> $data
     */
    public function createSql(NodeContext $ctx, string $kind, array $data): string
    {
        if (!isset(self::KINDS[$kind])) {
            throw new BadRequestException('The kind is opclass, opfamily or conversion.');
        }
        $text = static fn (string $key): string => trim((string) ($data[$key] ?? ''));
        $name = $text('name');
        if ($name === '') {
            throw new BadRequestException('Could not find the required parameter (name).');
        }
        $schema = (string) ($ctx->conn->scalar('SELECT nspname FROM pg_catalog.pg_namespace WHERE oid = $1', [$ctx->id('scid')]) ?? throw new NotFoundException('Could not find the schema.'));
        $qualified = Quoting::ident($schema, $name);
        $default = filter_var($data['is_default'] ?? false, FILTER_VALIDATE_BOOL);

        $using = '';
        if ($kind !== 'conversion') {
            $method = $text('amname');
            if (!in_array($method, $this->options($ctx)['methods'], true)) {
                throw new BadRequestException('Choose the index access method.');
            }
            $using = ' USING ' . Quoting::ident($method);
        }

        $sql = match ($kind) {
            'opfamily' => sprintf('CREATE OPERATOR FAMILY %s%s;', $qualified, $using),
            'conversion' => $this->conversionSql($qualified, $default, $text('source_encoding'), $text('target_encoding'), $text('function')),
            default => $this->classSql($qualified, $default, $using, $data),
        };
        $description = $text('description');
        if ($description !== '') {
            $sql .= sprintf("\n\nCOMMENT ON %s %s%s\n    IS %s;", self::KINDS[$kind], $qualified, $using, Quoting::literal($description));
        }

        return $sql;
    }

    private function conversionSql(string $qualified, bool $default, string $source, string $target, string $function): string
    {
        foreach (['source' => $source, 'target' => $target] as $what => $encoding) {
            if (preg_match('/^[A-Za-z0-9_]+$/', $encoding) !== 1) {
                throw new BadRequestException(sprintf('Choose the %s encoding.', $what));
            }
        }
        if ($function === '') {
            throw new BadRequestException('The conversion function is required.');
        }

        return sprintf("CREATE %sCONVERSION %s\n    FOR %s TO %s FROM %s;", $default ? 'DEFAULT ' : '', $qualified, Quoting::literal($source), Quoting::literal($target), $function);
    }

    /** @param array<string, mixed> $data */
    private function classSql(string $qualified, bool $default, string $using, array $data): string
    {
        $type = trim((string) ($data['for_type'] ?? ''));
        if ($type === '') {
            throw new BadRequestException('The data type the class is for is required.');
        }
        $items = [];
        foreach ((array) ($data['members'] ?? []) as $i => $member) {
            $member = (array) $member;
            $number = filter_var($member['number'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $name = trim((string) ($member['name'] ?? ''));
            if ($name === '' && $number === false) {
                continue;
            }
            if ($number === false || $name === '') {
                throw new BadRequestException(sprintf('Member %d needs a strategy or support number of 1 or more and a name.', $i + 1));
            }
            $left = trim((string) ($member['lefttype'] ?? ''));
            $right = trim((string) ($member['righttype'] ?? ''));
            $types = $left !== '' || $right !== '' ? sprintf(' (%s, %s)', $left !== '' ? $left : 'NONE', $right !== '' ? $right : 'NONE') : '';
            if (($member['type'] ?? 'operator') === 'function') {
                // FUNCTION n [(lefttype, righttype)] name(argument types)
                $items[] = sprintf('FUNCTION %d%s %s', $number, $types, $name);
            } else {
                if (preg_match(self::OPERATOR, $name) !== 1) {
                    throw new BadRequestException(sprintf('"%s" is not an operator name.', $name));
                }
                $orderBy = trim((string) ($member['order_by'] ?? ''));
                $items[] = sprintf('OPERATOR %d %s%s%s', $number, $name, $types, $orderBy === '' ? '' : ' FOR ORDER BY ' . $orderBy);
            }
        }
        $storage = trim((string) ($data['storage'] ?? ''));
        if ($storage !== '') {
            $items[] = 'STORAGE ' . $storage;
        }
        if ($items === []) {
            throw new BadRequestException('An operator class needs at least one operator or support function.');
        }
        $family = trim((string) ($data['family'] ?? ''));

        return sprintf("CREATE OPERATOR CLASS %s\n    %sFOR TYPE %s%s%s AS\n    %s;", $qualified, $default ? 'DEFAULT ' : '', $type, $using, $family === '' ? '' : ' FAMILY ' . $family, implode(",\n    ", $items));
    }

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
