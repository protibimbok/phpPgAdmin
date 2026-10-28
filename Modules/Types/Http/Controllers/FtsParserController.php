<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Types\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Nodes\NodeContext;

/**
 * The text search parser node, after pgAdmin's FtsParserView: a parser is its start,
 * gettoken, end, lextypes and optional headline functions. A changed function drops and
 * recreates the parser. The client's data: name, description, prsstart, prstoken, prsend,
 * prslextype, prsheadline.
 */
final class FtsParserController extends FtsController
{
    private const array FUNCTIONS = ['prsstart', 'prstoken', 'prsend', 'prslextype', 'prsheadline'];

    protected function idName(): string
    {
        return 'pid';
    }

    protected function kind(): string
    {
        return 'PARSER';
    }

    /** The "SQL" tab, reverse engineered by sql.sql. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        return (string) ($ctx->conn->scalar($ctx->render('sql.sql', ['pid' => $oid])) ?? throw $this->gone($ctx));
    }

    /**
     * What the editor offers: the functions with each slot's signature (functions.sql).
     *
     * @return array<string, list<string>>
     */
    public function options(NodeContext $ctx): array
    {
        return [
            'start' => self::functionNames($ctx->rows('functions.sql', ['start' => true])),
            'token' => self::functionNames($ctx->rows('functions.sql', ['token' => true])),
            'end' => self::functionNames($ctx->rows('functions.sql', ['end' => true])),
            'lextype' => self::functionNames($ctx->rows('functions.sql', ['lextype' => true])),
            'headline' => self::functionNames($ctx->rows('functions.sql', ['headline' => true])),
        ];
    }

    protected function forCreate(NodeContext $ctx, array $data): array
    {
        foreach (self::FUNCTIONS as $key) {
            $data[$key] = trim((string) ($data[$key] ?? ''));
            if ($data[$key] === '' && $key !== 'prsheadline') {
                throw new BadRequestException(sprintf('Could not find the required parameter (%s).', $key));
            }
        }
        if ($data['prsheadline'] === '' || $data['prsheadline'] === '-') {
            unset($data['prsheadline']);
        }

        return $data;
    }

    /** The functions that differ from the old ones; any of them recreates the parser. */
    protected function changes(NodeContext $ctx, array $data, array $old, array $changes): array
    {
        foreach (self::FUNCTIONS as $key) {
            if (!array_key_exists($key, $data)) {
                continue;
            }
            $new = trim((string) ($data[$key] ?? '')) ?: '-';
            $was = trim((string) ($old[$key] ?? '')) ?: '-';
            if ($new !== $was) {
                $changes[$key] = $new;
            }
        }

        return $changes;
    }
}
