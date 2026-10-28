<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Types\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Nodes\NodeContext;

/**
 * The text search template node, after pgAdmin's FtsTemplateView: a template is its lexize
 * and optional init functions. A changed function drops and recreates the template. The
 * client's data: name, description, tmplinit, tmpllexize.
 */
final class FtsTemplateController extends FtsController
{
    protected function idName(): string
    {
        return 'tid';
    }

    protected function kind(): string
    {
        return 'TEMPLATE';
    }

    /** The "SQL" tab, reverse engineered by sql.sql. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        return (string) ($ctx->conn->scalar($ctx->render('sql.sql', ['tid' => $oid])) ?? throw $this->gone($ctx));
    }

    /**
     * What the editor offers: the init and lexize functions (functions.sql).
     *
     * @return array<string, list<string>>
     */
    public function options(NodeContext $ctx): array
    {
        return [
            'init' => self::functionNames($ctx->rows('functions.sql', ['init' => true])),
            'lexize' => self::functionNames($ctx->rows('functions.sql', ['lexize' => true])),
        ];
    }

    protected function forCreate(NodeContext $ctx, array $data): array
    {
        $data['tmpllexize'] = trim((string) ($data['tmpllexize'] ?? ''));
        if ($data['tmpllexize'] === '') {
            throw new BadRequestException('Could not find the required parameter (tmpllexize).');
        }
        $data['tmplinit'] = trim((string) ($data['tmplinit'] ?? ''));
        if ($data['tmplinit'] === '' || $data['tmplinit'] === '-') {
            unset($data['tmplinit']);
        }

        return $data;
    }

    /** The functions that differ from the old ones; either recreates the template. */
    protected function changes(NodeContext $ctx, array $data, array $old, array $changes): array
    {
        foreach (['tmplinit', 'tmpllexize'] as $key) {
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
