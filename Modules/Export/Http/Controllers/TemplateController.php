<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\ConflictException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Modules\Export\Storage\ExportTemplates;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The Export page's templates card, phpMyAdmin's /export/template/{create,load,update,delete}:
 * the role's saved option sets for one kind of export.
 */
final class TemplateController
{
    /** @return array{templates: list<array<string, mixed>>} */
    public function index(ServerRequestInterface $request): array
    {
        return ['templates' => $this->templates($request)->all(self::type((string) ($request->getQueryParams()['type'] ?? '')))];
    }

    /** @return array{template: array<string, mixed>} */
    public function store(ServerRequestInterface $request): array
    {
        $input = (array) ($request->getParsedBody() ?? []);
        $type = self::type((string) ($input['type'] ?? ''));
        $name = trim((string) ($input['name'] ?? ''));
        if ($name === '' || mb_strlen($name) > 64) {
            throw new BadRequestException('A template name of up to 64 characters is required.');
        }
        $templates = $this->templates($request);
        if ($templates->exists($type, $name)) {
            throw new ConflictException(sprintf('A template named "%s" exists already.', $name));
        }

        return ['template' => $templates->create($type, $name, self::data($input))];
    }

    /**
     * @param array{id: string} $args
     * @return array{template: array<string, mixed>}
     */
    public function update(ServerRequestInterface $request, array $args): array
    {
        $input = (array) ($request->getParsedBody() ?? []);

        return ['template' => $this->templates($request)->update((int) $args['id'], self::data($input)) ?? throw new NotFoundException('No such template.')];
    }

    /**
     * @param array{id: string} $args
     * @return array{ok: true}
     */
    public function destroy(ServerRequestInterface $request, array $args): array
    {
        if (!$this->templates($request)->delete((int) $args['id'])) {
            throw new NotFoundException('No such template.');
        }

        return ['ok' => true];
    }

    private static function type(string $type): string
    {
        if (!in_array($type, ExportTemplates::TYPES, true)) {
            throw new BadRequestException(sprintf('"type" takes one of %s.', implode(', ', ExportTemplates::TYPES)));
        }

        return $type;
    }

    /** @return array<string, mixed> */
    private static function data(array $input): array
    {
        if (!isset($input['data']) || !is_array($input['data'])) {
            throw new BadRequestException('A template holds the export options as "data".');
        }

        return $input['data'];
    }

    private function templates(ServerRequestInterface $request): ExportTemplates
    {
        return ExportTemplates::for(ExportController::serverKey(), ConnectionPool::from($request)->username());
    }
}
