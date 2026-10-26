<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sql\Sql;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\ConflictException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\QueryException;

/**
 * Writes the changes the Browse grid and the insert/edit form make, after pgAdmin's
 * save_changed_data: added rows become INSERTs, changed rows UPDATEs by primary key, removed
 * rows DELETEs by primary key, all in one transaction, each statement with $n parameters so
 * values never meet the SQL text. A value is text, null, {"default": true} for the column's
 * default, or {"func": name, "value": text} for one of the functions phpMyAdmin's form offers.
 *
 * Rows are addressed by primary key ("keys": column => text value), which is why only a table
 * with a primary key is editable.
 */
final class RowEditor
{
    /** The functions the form may wrap a value in: the name as the client sends it => SQL, %s standing for the value. */
    public const array FUNCTIONS = [
        'now()' => 'now()',
        'clock_timestamp()' => 'clock_timestamp()',
        'current_date' => 'current_date',
        'current_time' => 'current_time',
        'current_timestamp' => 'current_timestamp',
        'localtimestamp' => 'localtimestamp',
        'gen_random_uuid()' => 'gen_random_uuid()',
        'random()' => 'random()',
        'upper' => 'upper(%s)',
        'lower' => 'lower(%s)',
        'initcap' => 'initcap(%s)',
        'trim' => 'btrim(%s)',
        'reverse' => 'reverse(%s)',
        'length' => 'length(%s)',
        'md5' => 'md5(%s)',
        'sha256' => "encode(sha256(convert_to(%s, 'UTF8')), 'hex')",
        'abs' => 'abs(%s)',
        'round' => 'round(%s)',
    ];

    public function __construct(
        private readonly Connection $conn,
        private readonly Relation $relation,
    ) {
    }

    /**
     * The statements the changes would run, with their parameters, in order: added, updated,
     * deleted.
     *
     * @param array<string, mixed> $changes
     * @return list<array{op: string, index: int, sql: string, params: list<string|null>}>
     */
    public function statements(array $changes): array
    {
        if ($this->relation->primaryKeys() === [] && (($changes['updated'] ?? []) !== [] || ($changes['deleted'] ?? []) !== [])) {
            throw new BadRequestException('Rows can only be changed or deleted in a table with a primary key.');
        }

        $statements = [];
        $ignore = (bool) ($changes['ignore'] ?? false);

        foreach ((array) ($changes['added'] ?? []) as $i => $row) {
            $statements[] = ['op' => 'added', 'index' => (int) $i, ...$this->insert((array) ($row['values'] ?? []), $ignore)];
        }
        foreach ((array) ($changes['updated'] ?? []) as $i => $row) {
            $statements[] = ['op' => 'updated', 'index' => (int) $i, ...$this->update((array) ($row['keys'] ?? []), (array) ($row['values'] ?? []))];
        }
        foreach ((array) ($changes['deleted'] ?? []) as $i => $row) {
            $statements[] = ['op' => 'deleted', 'index' => (int) $i, ...$this->delete((array) ($row['keys'] ?? []))];
        }

        return $statements;
    }

    /**
     * Run the changes in one transaction and report what happened: the rows added and changed
     * as the server now has them, the number deleted, and the statements run.
     *
     * @param array<string, mixed> $changes
     * @return array{added: list<array<string, mixed>>, updated: list<array<string, mixed>>, deleted: int, sql: list<string>}
     * @throws QueryException the first failure, after the transaction was rolled back
     */
    public function save(array $changes): array
    {
        $statements = $this->statements($changes);

        return $this->conn->transaction(function (Connection $conn) use ($statements): array {
            $outcome = ['added' => [], 'updated' => [], 'deleted' => 0, 'sql' => []];
            foreach ($statements as $statement) {
                $result = $conn->query($statement['sql'], $statement['params']);
                $outcome['sql'][] = $this->inline($statement['sql'], $statement['params']);
                switch ($statement['op']) {
                    case 'added':
                        $outcome['added'] = [...$outcome['added'], ...$result->rows()];
                        break;
                    case 'updated':
                        if ($result->rowCount() === 0) {
                            throw new ConflictException('The row to change was not found. It may have been deleted by another user.');
                        }
                        $outcome['updated'] = [...$outcome['updated'], ...$result->rows()];
                        break;
                    default:
                        $outcome['deleted'] += $result->affectedRows();
                }
            }

            return $outcome;
        });
    }

    /**
     * The statements as they would read with their values inlined, for the preview modal.
     *
     * @param array<string, mixed> $changes
     * @return list<string>
     */
    public function preview(array $changes): array
    {
        return array_map(fn (array $s): string => $this->inline($s['sql'], $s['params']), $this->statements($changes));
    }

    /**
     * @param array<string, mixed> $values
     * @return array{sql: string, params: list<string|null>}
     */
    private function insert(array $values, bool $ignore): array
    {
        $columns = [];
        $expressions = [];
        $params = [];
        foreach ($values as $name => $value) {
            $columns[] = $this->quotedColumn((string) $name, forWrite: true);
            $expressions[] = $this->expression($value, $params);
        }

        $sql = $columns === []
            ? sprintf('INSERT INTO %s DEFAULT VALUES', $this->relation->quotedName())
            : sprintf('INSERT INTO %s (%s) VALUES (%s)', $this->relation->quotedName(), implode(', ', $columns), implode(', ', $expressions));
        if ($ignore) {
            $sql .= ' ON CONFLICT DO NOTHING';
        }

        return ['sql' => $sql . ' RETURNING *', 'params' => $params];
    }

    /**
     * @param array<string, mixed> $keys
     * @param array<string, mixed> $values
     * @return array{sql: string, params: list<string|null>}
     */
    private function update(array $keys, array $values): array
    {
        if ($values === []) {
            throw new BadRequestException('Nothing to change.');
        }

        $params = [];
        $assignments = [];
        foreach ($values as $name => $value) {
            $assignments[] = $this->quotedColumn((string) $name, forWrite: true) . ' = ' . $this->expression($value, $params);
        }

        return [
            'sql' => sprintf('UPDATE %s SET %s WHERE %s RETURNING *', $this->relation->quotedName(), implode(', ', $assignments), $this->where($keys, $params)),
            'params' => $params,
        ];
    }

    /**
     * @param array<string, mixed> $keys
     * @return array{sql: string, params: list<string|null>}
     */
    private function delete(array $keys): array
    {
        $params = [];

        return ['sql' => sprintf('DELETE FROM %s WHERE %s', $this->relation->quotedName(), $this->where($keys, $params)), 'params' => $params];
    }

    /**
     * The primary-key condition for a row: every key column must be given.
     *
     * @param array<string, mixed> $keys
     * @param list<string|null> $params
     */
    private function where(array $keys, array &$params): string
    {
        $conditions = [];
        foreach ($this->relation->primaryKeys() as $key) {
            if (!array_key_exists($key, $keys)) {
                throw new BadRequestException(sprintf('The primary key column "%s" is missing from the row\'s keys.', $key));
            }
            $params[] = $keys[$key] === null ? null : (string) $keys[$key];
            $conditions[] = $this->quotedColumn($key, forWrite: false) . ($keys[$key] === null ? ' IS NOT DISTINCT FROM $' : ' = $') . count($params);
        }

        return implode(' AND ', $conditions);
    }

    /**
     * The SQL for one value, adding its parameter(s): DEFAULT, NULL, $n, or a function around $n.
     *
     * @param list<string|null> $params
     */
    private function expression(mixed $value, array &$params): string
    {
        if (is_array($value)) {
            if (!empty($value['default'])) {
                return 'DEFAULT';
            }
            $func = (string) ($value['func'] ?? '');
            $template = self::FUNCTIONS[$func] ?? throw new BadRequestException(sprintf('Unknown function "%s".', $func));
            if (!str_contains($template, '%s')) {
                return $template;
            }
            $inner = $value['value'] ?? null;
            $params[] = $inner === null ? null : (string) $inner;

            return sprintf($template, '$' . count($params));
        }

        $params[] = $value === null ? null : (is_bool($value) ? ($value ? 'true' : 'false') : (string) $value);

        return '$' . count($params);
    }

    /** The column's quoted name, after checking it exists and, for a write, that the server does not compute it. */
    private function quotedColumn(string $name, bool $forWrite): string
    {
        $column = $this->relation->column($name) ?? throw new BadRequestException(sprintf('There is no column "%s" in %s.%s.', $name, $this->relation->schema, $this->relation->name));
        if ($forWrite && !empty($column['is_generated'])) {
            throw new BadRequestException(sprintf('The column "%s" is generated and cannot be set.', $name));
        }

        return $this->conn->escapeIdentifier($name);
    }

    /**
     * The statement with its parameters written as literals, for display.
     *
     * @param list<string|null> $params
     */
    private function inline(string $sql, array $params): string
    {
        return (string) preg_replace_callback('/\$(\d+)/', function (array $m) use ($params): string {
            $value = $params[(int) $m[1] - 1] ?? null;

            return $value === null ? 'NULL' : $this->conn->escapeLiteral($value);
        }, $sql);
    }
}
