<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Dump;

use PhpPgAdmin\App;

/**
 * Rows as phpMyAdmin's JSON export writes them: one array holding a header object, a database
 * object, and an object per table with its rows under "data", each row an object of column
 * name to text value (null for NULL), as the server sends them:
 *
 *     [
 *     {"type":"header","version":"0.1.1","comment":"Export to JSON plugin for phpPgAdmin"},
 *     {"type":"database","name":"bookshop"},
 *     {"type":"table","name":"authors","database":"bookshop","schema":"public","data":
 *     [
 *     {"id":"1","name":"Ann"}
 *     ]
 *     }
 *     ]
 *
 * "schema" is added to phpMyAdmin's table object; readers of that format ignore it. Several
 * relations (a schema's export) follow one another in the same array.
 */
final class JsonFormat implements MultiRowFormat
{
    /** @var list<string> */
    private array $names = [];

    private int $index = 0;

    private bool $firstRow = true;

    /**
     * @param list<array{schema: string|null, name: string}> $relations the relations in the order their rows come
     */
    public function __construct(
        private readonly string $database,
        private readonly array $relations,
        private readonly bool $pretty = false,
        private readonly bool $unicode = false,
    ) {
    }

    public function head(array $columns): string
    {
        return "[\n"
            . $this->encode(['type' => 'header', 'version' => App::VERSION, 'comment' => 'Export to JSON plugin for phpPgAdmin']) . ",\n"
            . $this->encode(['type' => 'database', 'name' => $this->database]) . ",\n"
            . $this->table($columns);
    }

    public function next(array $columns): string
    {
        $this->index++;

        return $this->close() . ',' . $this->table($columns);
    }

    public function rows(array $rows): string
    {
        $out = '';
        foreach ($rows as $row) {
            $out .= ($this->firstRow ? '' : ",\n") . $this->encode((object) array_combine($this->names, $row));
            $this->firstRow = false;
        }

        return $out;
    }

    public function foot(): string
    {
        return $this->close() . "]\n";
    }

    /** @param list<\PhpPgAdmin\Core\Database\Column> $columns */
    private function table(array $columns): string
    {
        // Columns of the same name (a join's two "id"s) keep the last value, as in phpMyAdmin.
        $this->names = array_map(static fn ($column): string => $column->name, $columns);
        $this->firstRow = true;
        $relation = $this->relations[$this->index] ?? ['schema' => null, 'name' => 'query_result'];
        $object = ['type' => 'table', 'name' => $relation['name'], 'database' => $this->database];
        if ($relation['schema'] !== null) {
            $object['schema'] = $relation['schema'];
        }
        $object['data'] = '@@DATA@@';
        [$before] = explode('"@@DATA@@"', $this->encode($object));

        return $before . "\n[\n";
    }

    private function close(): string
    {
        return "\n]\n}\n";
    }

    /** @param array<string, mixed>|object $data */
    private function encode(array|object $data): string
    {
        $flags = JSON_INVALID_UTF8_SUBSTITUTE | ($this->pretty ? JSON_PRETTY_PRINT : 0) | ($this->unicode ? JSON_UNESCAPED_UNICODE : 0);

        return (string) json_encode($data, $flags);
    }
}
