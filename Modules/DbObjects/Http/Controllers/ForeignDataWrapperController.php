<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\DbObjects\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;

/**
 * The foreign data wrapper node, after pgAdmin's ForeignDataWrapperView: the database's
 * wrappers with their handler, validator, options, owner and comment, and the statements that
 * create, alter and drop one. Its children are the foreign servers.
 *
 * The client's data carries pgAdmin's field names: name, fdwhan, fdwvalue (the handler and the
 * validator as "schema.function"), fdwowner, description, and fdwoptions as {option, value}.
 */
final class ForeignDataWrapperController extends NodeController
{
    public function list(NodeContext $ctx): array
    {
        return array_map(self::decorate(...), $ctx->rows('properties.sql'));
    }

    public function nodes(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->toNode($ctx, $row), $ctx->rows('properties.sql'));
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        return $this->toNode($ctx, $this->properties($ctx, $oid));
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        return self::decorate($ctx->row('properties.sql', ['fid' => $oid]) ?? throw $this->gone($ctx));
    }

    public function sql(NodeContext $ctx, int $oid): string
    {
        $data = $this->templateData($this->properties($ctx, $oid));
        $drop = $ctx->render('delete.sql', ['fid' => null, 'name' => $data['name']]);

        return Ddl::assemble([Ddl::header('Foreign Data Wrapper', Quoting::ident((string) $data['name']), $drop), $ctx->render('create.sql', ['data' => $data, 'is_valid_options' => $data['fdwoptions'] !== []])]);
    }

    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($ctx, $data);
        $this->execute($ctx, $ctx->render('create.sql', ['data' => $data, 'is_valid_options' => $data['fdwoptions'] !== []]));

        return $this->toNode($ctx, $ctx->row('properties.sql', ['fid' => null, 'fname' => $data['name']]) ?? throw $this->gone($ctx));
    }

    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));

        return $this->node($ctx, $oid);
    }

    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = $this->properties($ctx, $oid);
        $this->execute($ctx, $ctx->render('delete.sql', ['fid' => null, 'name' => $row['name'], 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid === null) {
            $data = $this->forCreate($ctx, $data);

            return $ctx->render('create.sql', ['data' => $data, 'is_valid_options' => $data['fdwoptions'] !== []]);
        }

        return $this->updateSql($ctx, $oid, $data);
    }

    /**
     * The functions a wrapper may name as its handler and its validator, and the roles.
     *
     * @return array{handlers: list<string>, validators: list<string>, roles: list<string>}
     */
    public function options(NodeContext $ctx): array
    {
        return [
            'handlers' => array_column($ctx->rows('handlers.sql'), 'schema_prefix_fdw_hand'),
            'validators' => array_column($ctx->rows('validators.sql'), 'schema_prefix_fdw_val'),
            'roles' => Catalog::roles($ctx->conn),
        ];
    }

    /** @param array<string, mixed> $data */
    private function checkFunctions(NodeContext $ctx, array $data): void
    {
        $options = $this->options($ctx);
        foreach (['fdwhan' => 'handlers', 'fdwvalue' => 'validators'] as $key => $list) {
            $value = trim((string) ($data[$key] ?? ''));
            if ($value !== '' && !in_array($value, $options[$list], true)) {
                throw new BadRequestException(sprintf('%s is not a %s function.', $value, $key === 'fdwhan' ? 'foreign data wrapper handler' : 'foreign data wrapper validator'));
            }
        }
    }

    /** The row as the client reads it: the options as {option, value}. */
    private static function decorate(array $row): array
    {
        $row['fdwoptions'] = ForeignOptions::fromCatalog($row['fdwoptions']);

        return $row;
    }

    /** A row or the client's data with the options in the template's names. */
    private function templateData(array $data): array
    {
        $data['fdwoptions'] = ForeignOptions::named($data['fdwoptions'], 'fdw');

        return $data;
    }

    /**
     * The client's data as create.sql takes it. The handler and validator are spelled into the
     * statement as given, so they must be functions the catalog offers.
     *
     * @param array<string, mixed> $data
     */
    private function forCreate(NodeContext $ctx, array $data): array
    {
        $this->checkFunctions($ctx, $data);
        $out = ['name' => $this->requireName($data), 'fdwoptions' => ForeignOptions::named(ForeignOptions::fromClient($data['fdwoptions'] ?? []), 'fdw')];
        foreach (['fdwhan', 'fdwvalue', 'fdwowner', 'description'] as $key) {
            $value = trim((string) ($data[$key] ?? ''));
            if ($value !== '') {
                $out[$key] = $value;
            }
        }

        return $out;
    }

    /** @param array<string, mixed> $data */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $this->checkFunctions($ctx, $data);
        $old = $this->properties($ctx, $oid);
        $changes = ['name' => trim((string) ($data['name'] ?? '')) !== '' ? (string) $data['name'] : (string) $old['name']];
        foreach (['fdwhan', 'fdwvalue', 'fdwowner', 'description'] as $key) {
            if (array_key_exists($key, $data) && (string) ($data[$key] ?? '') !== (string) ($old[$key] ?? '')) {
                $changes[$key] = (string) ($data[$key] ?? '');
            }
        }
        $vars = ['o_data' => $old];
        if (array_key_exists('fdwoptions', $data)) {
            $diff = ForeignOptions::diff($old['fdwoptions'], ForeignOptions::fromClient($data['fdwoptions']), 'fdw');
            $changes['fdwoptions'] = $diff;
            $vars += ['is_valid_added_options' => $diff['added'] !== [], 'is_valid_changed_options' => $diff['changed'] !== []];
        }
        // update.sql reads an absent handler or validator as "NO HANDLER"; only a change may say so.
        foreach (['fdwhan', 'fdwvalue'] as $key) {
            if (!array_key_exists($key, $changes)) {
                $changes[$key] = (string) ($old[$key] ?? '');
            }
        }

        return $ctx->render('update.sql', ['data' => $changes] + $vars);
    }
}
