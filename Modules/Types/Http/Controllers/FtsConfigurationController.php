<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Types\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\Options;

/**
 * The text search configuration node, after pgAdmin's FtsConfigurationView: a configuration
 * is a parser (or a copy of another configuration) with the dictionaries each token type maps
 * to. The client's data: name, owner, description, prsname or copy_config on creation, and
 * tokens [{token, dictname: [...]}] as the full mapping list.
 */
final class FtsConfigurationController extends FtsController
{
    protected function idName(): string
    {
        return 'cfgid';
    }

    protected function kind(): string
    {
        return 'CONFIGURATION';
    }

    /** The properties with the token mappings (tokenDictList.sql). */
    public function properties(NodeContext $ctx, int $oid): array
    {
        $row = parent::properties($ctx, $oid);
        $row['tokens'] = array_map(static fn (array $r): array => ['token' => $r['token'], 'dictname' => Options::list($r['dictname'])], $ctx->rows('tokenDictList.sql', ['cfgid' => $oid]));

        return $row;
    }

    /** The "SQL" tab, reverse engineered by sql.sql: CREATE with the parser, the comment and an ADD MAPPING per token. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        return (string) ($ctx->conn->scalar($ctx->render('sql.sql', ['cfgid' => $oid])) ?? throw $this->gone($ctx));
    }

    /**
     * What the editor offers: the parsers (with their OIDs, for the token list), the
     * configurations to copy, the dictionaries and the roles.
     *
     * @return array<string, mixed>
     */
    public function options(NodeContext $ctx): array
    {
        return [
            'parsers' => array_map(static fn (array $r): array => ['oid' => (int) $r['oid'], 'name' => self::qualify($r['nspname'], (string) $r['prsname'])], $ctx->conn->rows('SELECT p.oid, p.prsname, n.nspname FROM pg_catalog.pg_ts_parser p JOIN pg_catalog.pg_namespace n ON n.oid = p.prsnamespace ORDER BY n.nspname <> \'pg_catalog\', p.prsname')),
            'configurations' => array_map(static fn (array $r): string => self::qualify($r['nspname'], (string) $r['cfgname']), $ctx->rows('copy_config.sql', ['copy_config' => true])),
            'dictionaries' => array_column($ctx->rows('dictionaries.sql'), 'dictname'),
            'roles' => $this->roles($ctx),
        ];
    }

    /**
     * The token types a parser produces (tokens.sql), which a configuration may map.
     *
     * @return list<string>
     */
    public function tokens(NodeContext $ctx, int $parserOid): array
    {
        return array_column($ctx->rows('tokens.sql', ['parseroid' => $parserOid]), 'alias');
    }

    protected function forCreate(NodeContext $ctx, array $data): array
    {
        foreach (['copy_config', 'prsname'] as $key) {
            if (array_key_exists($key, $data) && trim((string) ($data[$key] ?? '')) === '') {
                unset($data[$key]);
            }
        }
        if (!isset($data['copy_config']) && !isset($data['prsname'])) {
            throw new BadRequestException('Provide at least copy config or parser.');
        }
        if (isset($data['copy_config'])) {
            unset($data['prsname']);
        }
        unset($data['tokens']);

        return $data;
    }

    /** The full token list against the old mappings as {added, changed, deleted}, by token. */
    protected function changes(NodeContext $ctx, array $data, array $old, array $changes): array
    {
        if (!isset($data['tokens']) || !is_array($data['tokens'])) {
            return $changes;
        }
        $was = [];
        foreach ($old['tokens'] as $mapping) {
            $was[(string) $mapping['token']] = $mapping['dictname'];
        }
        $lists = ['added' => [], 'changed' => [], 'deleted' => []];
        $seen = [];
        foreach ($data['tokens'] as $mapping) {
            $token = trim((string) ($mapping['token'] ?? ''));
            $dictionaries = array_values(array_filter(array_map(trim(...), is_array($mapping['dictname'] ?? null) ? $mapping['dictname'] : explode(',', (string) ($mapping['dictname'] ?? ''))), static fn (string $d): bool => $d !== ''));
            if ($token === '' || $dictionaries === []) {
                continue;
            }
            $seen[] = $token;
            if (!isset($was[$token])) {
                $lists['added'][] = ['token' => $token, 'dictname' => $dictionaries];
            } elseif ($was[$token] !== $dictionaries) {
                $lists['changed'][] = ['token' => $token, 'dictname' => $dictionaries];
            }
        }
        foreach (array_keys($was) as $token) {
            if (!in_array($token, $seen, true)) {
                $lists['deleted'][] = ['token' => $token];
            }
        }
        $changes['tokens'] = array_filter($lists);

        return $changes;
    }
}
