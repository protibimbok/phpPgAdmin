<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Types\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;

/**
 * The text search dictionary node, after pgAdmin's FtsDictionaryView: a dictionary is a
 * template with its options. The client's data: name, owner, description, template
 * ("schema.name") and options [{option, value}] as the full option list.
 */
final class FtsDictionaryController extends FtsController
{
    protected function idName(): string
    {
        return 'dcid';
    }

    protected function kind(): string
    {
        return 'DICTIONARY';
    }

    /** The template qualified when it is not pg_catalog's, and the options as a list (pgAdmin's tokenize_options). */
    protected function decorate(NodeContext $ctx, array $row, string $schema): array
    {
        $row = parent::decorate($ctx, $row, $schema);
        $row['template'] = self::qualify($row['template_schema'] ?? null, (string) $row['template']);
        $row['options'] = self::tokenizeOptions($row['options'] ?? null);

        return $row;
    }

    /** The "SQL" tab: the commented header and DROP, then CREATE TEXT SEARCH DICTIONARY with the options and comment. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        $data = $this->properties($ctx, $oid);
        $data['options'] = array_map(static fn (array $o): array => [...$o, 'value' => Quoting::literal((string) $o['value'])], $data['options']);
        $drop = $ctx->render('delete.sql', ['dcid' => null, 'schema' => $data['schema'], 'name' => $data['name']]);

        return Ddl::assemble([Ddl::header('Text Search Dictionary', Quoting::ident((string) $data['schema'], (string) $data['name']), $drop), $ctx->render('create.sql', ['data' => $data, 'is_displaying' => true])]);
    }

    /**
     * What the editor offers: the templates and the roles.
     *
     * @return array<string, mixed>
     */
    public function options(NodeContext $ctx): array
    {
        return [
            'templates' => array_map(static fn (array $r): string => self::qualify($r['nspname'], (string) $r['tmplname']), $ctx->rows('templates.sql', ['template' => true])),
            'roles' => $this->roles($ctx),
        ];
    }

    protected function forCreate(NodeContext $ctx, array $data): array
    {
        if (trim((string) ($data['template'] ?? '')) === '') {
            throw new BadRequestException('Could not find the required parameter (template).');
        }
        $data['options'] = self::cleanOptions($data['options'] ?? []);

        return $data;
    }

    /** The full option list against the old one as {added, changed, deleted}, by option name. */
    protected function changes(NodeContext $ctx, array $data, array $old, array $changes): array
    {
        if (!isset($data['options']) || !is_array($data['options'])) {
            return $changes;
        }
        $was = [];
        foreach ($old['options'] as $option) {
            $was[(string) $option['option']] = (string) $option['value'];
        }
        $lists = ['added' => [], 'changed' => [], 'deleted' => []];
        $seen = [];
        foreach (self::cleanOptions($data['options']) as $option) {
            $seen[] = $option['option'];
            if (!array_key_exists($option['option'], $was)) {
                $lists['added'][] = $option;
            } elseif ($was[$option['option']] !== $option['value']) {
                $lists['changed'][] = $option;
            }
        }
        foreach (array_keys($was) as $name) {
            if (!in_array($name, $seen, true)) {
                $lists['deleted'][] = ['option' => $name];
            }
        }
        $changes['options'] = array_filter($lists);

        return $changes;
    }

    /**
     * "key1 = 'value1', key2 = value2" from dictinitoption as [{option, value}].
     *
     * @return list<array{option: string, value: string}>
     */
    private static function tokenizeOptions(?string $options): array
    {
        if ($options === null || trim($options) === '') {
            return [];
        }
        $result = [];
        foreach (explode(',', $options) as $pair) {
            if (!str_contains($pair, '=')) {
                continue;
            }
            [$key, $value] = explode('=', $pair, 2);
            $result[] = ['option' => trim($key), 'value' => trim(trim($value), "'")];
        }

        return $result;
    }

    /**
     * The client's option rows with blank names dropped.
     *
     * @return list<array{option: string, value: string}>
     */
    private static function cleanOptions(mixed $options): array
    {
        $result = [];
        foreach (is_array($options) ? $options : [] as $option) {
            $name = trim((string) ($option['option'] ?? ''));
            if ($name !== '') {
                $result[] = ['option' => $name, 'value' => trim((string) ($option['value'] ?? ''))];
            }
        }

        return $result;
    }
}
