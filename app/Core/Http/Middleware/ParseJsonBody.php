<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Http\Middleware;

use JsonException;
use League\Route\Http\Exception\BadRequestException;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Decodes an application/json body into the request's parsed body,
 * so $request->getParsedBody() works the same for JSON and form posts.
 */
final class ParseJsonBody implements MiddlewareInterface
{
    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $contentType = $request->getHeaderLine('content-type');

        if (str_contains($contentType, 'application/json') && $request->getParsedBody() === null) {
            $raw = (string) $request->getBody();

            if ($raw !== '') {
                try {
                    $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
                } catch (JsonException $e) {
                    throw new BadRequestException('Malformed JSON body: ' . $e->getMessage());
                }

                $request = $request->withParsedBody(is_array($decoded) ? $decoded : null);
            }
        }

        return $handler->handle($request);
    }
}
