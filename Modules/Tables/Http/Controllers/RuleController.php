<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;

/**
 * The rule node, after pgAdmin's RuleView: the rewrite rules of a table or view, with the
 * event, condition, commands and DO INSTEAD parsed out of pg_get_ruledef, and the statements
 * that create, alter, enable, disable and drop one. Registered under tables and under views
 * (as view_rule). A view's own _RETURN rule is a system rule and is left out of the list.
 *
 * The client's data carries pgAdmin's field names: name, event ('SELECT', 'INSERT',
 * 'UPDATE', 'DELETE'), do_instead, condition, statements, comment, is_enable_rule.
 */
final class RuleController extends TableChildController
{
    private const array EVENTS = ['1' => 'SELECT', '2' => 'UPDATE', '3' => 'INSERT', '4' => 'DELETE'];

    public function list(NodeContext $ctx): array
    {
        $rows = [];
        foreach ($ctx->rows('properties.sql', ['tid' => $this->tableOid($ctx)]) as $row) {
            if ($row['name'] === '_RETURN') {
                continue;
            }
            $rows[] = self::parse($row);
        }

        return $rows;
    }

    public function nodes(NodeContext $ctx): array
    {
        $nodes = [];
        foreach ($ctx->rows('nodes.sql', ['tid' => $this->tableOid($ctx)]) as $row) {
            if ($row['name'] !== '_RETURN') {
                $nodes[] = $this->toNode($ctx, $row);
            }
        }

        return $nodes;
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('nodes.sql', ['tid' => null, 'rid' => $oid]) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        return self::parse($this->row($ctx, $oid));
    }

    /** The "SQL" tab: the commented header (from create.sql's display_comments) and CREATE OR REPLACE RULE. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        return $this->createSqlOf($ctx, $oid, true);
    }

    /** CREATE RULE on the relation; the new rule's node. */
    public function create(NodeContext $ctx, array $data): array
    {
        $this->execute($ctx, $this->createSql($ctx, $data));

        $oid = $ctx->conn->scalar($ctx->render('rule_id.sql', ['rule_name' => trim((string) $data['name'])])) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $oid);
    }

    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));

        return $this->node($ctx, $oid);
    }

    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = $ctx->row('delete.sql', ['rid' => $oid]) ?? throw $this->gone($ctx);
        $this->execute($ctx, $ctx->render('delete.sql', ['rid' => null, 'rulename' => $row['rulename'], 'relname' => $row['relname'], 'nspname' => $row['nspname'], 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        return $oid === null ? $this->createSql($ctx, $data) : $this->updateSql($ctx, $oid, $data);
    }

    /** CREATE RULE for the "SQL" tab or a table's DDL, by OID. */
    public function createSqlOf(NodeContext $ctx, int $oid, bool $withHeader): string
    {
        $data = self::parse($this->row($ctx, $oid));

        return Ddl::assemble([$ctx->render('create.sql', ['data' => $data, 'display_comments' => $withHeader, 'add_replace_clause' => true])]);
    }

    private function createSql(NodeContext $ctx, array $data): string
    {
        $data['name'] = $this->requireName($data);
        [$data['schema'], $data['view']] = $this->parentNames($ctx);
        $data = self::normalise($data);

        return $ctx->render('create.sql', ['data' => $data]);
    }

    /** update.sql against the rule as it stands; fields equal to the current value are dropped. */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $old = self::parse($this->row($ctx, $oid));
        $data = self::normalise($data);
        foreach (['name', 'event', 'condition', 'statements', 'comment', 'is_enable_rule'] as $key) {
            if (array_key_exists($key, $data) && trim((string) ($data[$key] ?? '')) === trim((string) ($old[$key] ?? ''))) {
                unset($data[$key]);
            }
        }
        if (array_key_exists('do_instead', $data) && (bool) $data['do_instead'] === (bool) $old['do_instead']) {
            unset($data['do_instead']);
        }
        if (isset($data['event']) || isset($data['do_instead']) || array_key_exists('condition', $data) || array_key_exists('statements', $data)) {
            // CREATE OR REPLACE restates the definition; the template reads what the form left alone from the old row.
            $data['statements'] ??= $old['statements'];
        }

        return $ctx->render('update.sql', ['data' => $data, 'o_data' => $old]);
    }

    /**
     * pgAdmin's parse_rule_definition: the event from ev_type, DO INSTEAD, and the condition
     * and commands cut out of pg_get_ruledef's text.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function parse(array $row): array
    {
        $definition = (string) ($row['definition'] ?? '');
        $condition = '';
        if (preg_match('/(ON\s+[\s\S]+?TO\s+[\s\S]+?DO)/', $definition, $part) && preg_match('/WHERE\s+(\([\s\S]*\))\s+DO/', $part[1], $m)) {
            $condition = $m[1];
            if (str_starts_with($condition, '(') && str_ends_with($condition, ')')) {
                $condition = substr($condition, 1, -1);
            }
        }
        $statements = '';
        if (preg_match('/DO\s+(?:INSTEAD\s+)?([\s\S]*);/', $definition, $m)) {
            $statements = $m[1];
            if (str_starts_with($statements, '(') && str_ends_with($statements, ')')) {
                $statements = substr($statements, 1, -1);
            }
        }
        $row['event'] = self::EVENTS[(string) ($row['ev_type'] ?? '1')] ?? 'SELECT';
        $row['do_instead'] = (bool) ($row['is_instead'] ?? false);
        $row['statements'] = $statements;
        $row['condition'] = $condition;

        return $row;
    }

    /** @param array<string, mixed> $data */
    private static function normalise(array $data): array
    {
        if (array_key_exists('do_instead', $data)) {
            $data['do_instead'] = filter_var($data['do_instead'], FILTER_VALIDATE_BOOL);
        }
        if (isset($data['event'])) {
            $data['event'] = strtoupper(trim((string) $data['event']));
            if (!in_array($data['event'], self::EVENTS, true)) {
                throw new BadRequestException('A rule fires on SELECT, INSERT, UPDATE or DELETE.');
            }
        }
        if (array_key_exists('condition', $data)) {
            $data['condition'] = trim((string) ($data['condition'] ?? ''));
        }
        if (array_key_exists('statements', $data)) {
            $data['statements'] = trim((string) ($data['statements'] ?? ''));
        }
        if (array_key_exists('enabled', $data)) {
            $data['enabled'] = filter_var($data['enabled'], FILTER_VALIDATE_BOOL);
        }

        return $data;
    }

    /** @return array<string, mixed> */
    private function row(NodeContext $ctx, int $oid): array
    {
        return $ctx->row('properties.sql', ['tid' => null, 'rid' => $oid]) ?? throw $this->gone($ctx);
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, $row);
        $node['inode'] = false;

        return $node;
    }
}
