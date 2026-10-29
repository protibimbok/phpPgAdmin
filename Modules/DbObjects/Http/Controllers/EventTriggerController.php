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
 * The event trigger node, after pgAdmin's EventTriggerView: the database's event triggers with
 * their event, function, tags, state, owner and comment, and the statements that create, alter
 * and drop one. A new event, function or tag list is a DROP and CREATE, as pgAdmin writes it.
 *
 * The client's data carries pgAdmin's field names: name, eventname, eventfunname, enabled
 * (O, D, R or A), eventowner, comment, and "when" as the tags separated by commas, unquoted.
 */
final class EventTriggerController extends NodeController
{
    public const array STATES = ['O', 'D', 'R', 'A'];

    public function list(NodeContext $ctx): array
    {
        return array_map(self::decorate(...), $ctx->rows('properties.sql'));
    }

    public function nodes(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->toNode($ctx, $row), $ctx->rows('nodes.sql'));
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        return $this->toNode($ctx, $ctx->row('nodes.sql', ['etid' => $oid]) ?? throw $this->gone($ctx));
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        return self::decorate($ctx->row('properties.sql', ['etid' => $oid]) ?? throw $this->gone($ctx));
    }

    public function sql(NodeContext $ctx, int $oid): string
    {
        $data = $this->properties($ctx, $oid);
        $data['when'] = self::quotedTags($data['when']);
        $drop = $ctx->render('delete.sql', ['etid' => null, 'name' => $data['name']]);

        return Ddl::assemble([Ddl::header('Event Trigger', Quoting::ident((string) $data['name']), $drop), $ctx->render('create.sql', ['data' => $data]), $ctx->render('grant.sql', ['data' => $data])]);
    }

    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($ctx, $data);
        // CREATE EVENT TRIGGER and the ALTERs after it run apart, as for the other nodes.
        $this->execute($ctx, $ctx->render('create.sql', ['data' => $data]));
        $this->execute($ctx, $ctx->render('grant.sql', ['data' => $data]));
        $oid = $ctx->conn->scalar($ctx->render('get_oid.sql', ['data' => $data])) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $oid);
    }

    /** The ALTERs, or the DROP and CREATE, for what changes; a recreated trigger has a new OID, so it is found by name. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $sql = $this->updateSql($ctx, $oid, $data);
        $name = trim((string) ($data['name'] ?? '')) !== '' ? (string) $data['name'] : (string) $this->properties($ctx, $oid)['name'];
        $this->execute($ctx, $sql);
        $new = $ctx->conn->scalar($ctx->render('get_oid.sql', ['data' => ['name' => $name]])) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $new);
    }

    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = $this->properties($ctx, $oid);
        $this->execute($ctx, $ctx->render('delete.sql', ['etid' => null, 'name' => $row['name'], 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid === null) {
            $data = $this->forCreate($ctx, $data);

            return Ddl::assemble([$ctx->render('create.sql', ['data' => $data]), $ctx->render('grant.sql', ['data' => $data])]);
        }

        return $this->updateSql($ctx, $oid, $data);
    }

    /**
     * The events the server fires (login on 17+), the functions returning event_trigger, and
     * the roles.
     *
     * @return array{events: list<string>, functions: list<string>, roles: list<string>}
     */
    public function options(NodeContext $ctx): array
    {
        return [
            'events' => ['DDL_COMMAND_START', 'DDL_COMMAND_END', 'SQL_DROP', 'TABLE_REWRITE', ...($ctx->version() >= 170000 ? ['LOGIN'] : [])],
            'functions' => array_column($ctx->rows('eventfunctions.sql'), 'tfname'),
            'roles' => Catalog::roles($ctx->conn),
        ];
    }

    /** The tags as the catalog lists them, "'CREATE TABLE', 'ALTER TABLE'", for the client: CREATE TABLE, ALTER TABLE. */
    private static function decorate(array $row): array
    {
        preg_match_all("/'((?:[^']|'')*)'/", (string) ($row['when'] ?? ''), $m);
        $row['when'] = implode(', ', array_map(static fn (string $tag): string => str_replace("''", "'", $tag), $m[1]));

        return $row;
    }

    /** The client's tags, "CREATE TABLE, ALTER TABLE", as WHEN TAG IN takes them. */
    private static function quotedTags(mixed $tags): string
    {
        $list = array_values(array_filter(array_map('trim', explode(',', (string) $tags)), static fn (string $t): bool => $t !== ''));

        return implode(', ', array_map(static fn (string $tag): string => Quoting::literal(strtoupper($tag)), $list));
    }

    /** @param array<string, mixed> $data */
    private function forCreate(NodeContext $ctx, array $data): array
    {
        $name = $this->requireName($data);
        $event = strtoupper(trim((string) ($data['eventname'] ?? '')));
        if (!in_array($event, $this->options($ctx)['events'], true)) {
            throw new BadRequestException('Choose the event the trigger fires on.');
        }
        $function = trim((string) ($data['eventfunname'] ?? ''));
        if ($function === '') {
            throw new BadRequestException('Choose the function the trigger runs.');
        }
        $enabled = (string) ($data['enabled'] ?? 'O');
        if (!in_array($enabled, self::STATES, true)) {
            throw new BadRequestException('An event trigger is enabled (O), disabled (D), replica (R) or always (A).');
        }
        $owner = trim((string) ($data['eventowner'] ?? ''));

        return [
            'name' => $name,
            'eventname' => $event,
            'eventfunname' => $function,
            'when' => self::quotedTags($data['when'] ?? ''),
            'enabled' => $enabled,
            'eventowner' => $owner !== '' ? $owner : (string) $ctx->conn->scalar('SELECT current_user'),
            'comment' => trim((string) ($data['comment'] ?? '')),
        ];
    }

    /**
     * update.sql for what differs from the catalog. The name is always passed, as the template
     * addresses the trigger by it after a rename.
     *
     * @param array<string, mixed> $data
     */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $old = $this->properties($ctx, $oid);
        $old['when'] = self::quotedTags($old['when']);
        $changes = ['name' => trim((string) ($data['name'] ?? '')) !== '' ? (string) $data['name'] : (string) $old['name']];
        if (array_key_exists('when', $data)) {
            $data['when'] = self::quotedTags($data['when']);
        }
        if (array_key_exists('eventname', $data)) {
            $data['eventname'] = strtoupper((string) $data['eventname']);
        }
        foreach (['eventname', 'eventfunname', 'when', 'enabled', 'eventowner', 'comment'] as $key) {
            if (array_key_exists($key, $data) && (string) ($data[$key] ?? '') !== (string) ($old[$key] ?? '')) {
                $changes[$key] = (string) ($data[$key] ?? '');
            }
        }
        if (isset($changes['enabled']) && !in_array($changes['enabled'], self::STATES, true)) {
            throw new BadRequestException('An event trigger is enabled (O), disabled (D), replica (R) or always (A).');
        }

        return $ctx->render('update.sql', ['data' => $changes, 'o_data' => $old]);
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, $row);
        $node['inode'] = false;

        return $node;
    }
}
