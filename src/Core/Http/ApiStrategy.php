<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Http;

use League\Route\Http;
use League\Route\Strategy\JsonStrategy;
use Override;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Throwable;

/**
 * league/route's JSON strategy, except that an unexpected exception only
 * reveals its message and trace when the application runs in debug mode.
 */
final class ApiStrategy extends JsonStrategy
{
    public function __construct(ResponseFactoryInterface $responseFactory, private readonly bool $debug = false)
    {
        parent::__construct($responseFactory, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    #[Override]
    public function getThrowableHandler(): MiddlewareInterface
    {
        return new class ($this->responseFactory->createResponse(), $this->debug) implements MiddlewareInterface {
            public function __construct(private readonly ResponseInterface $response, private readonly bool $debug)
            {
            }

            public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
            {
                try {
                    return $handler->handle($request);
                } catch (Http\Exception $e) {
                    return $e->buildJsonResponse($this->response);
                } catch (Throwable $e) {
                    $payload = ['status_code' => 500, 'reason_phrase' => 'Internal Server Error'];
                    if ($this->debug) {
                        $payload['exception'] = $e::class;
                        $payload['message'] = $e->getMessage();
                        $payload['trace'] = explode("\n", $e->getTraceAsString());
                    }

                    $this->response->getBody()->write(json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

                    return $this->response
                        ->withHeader('content-type', 'application/json')
                        ->withStatus(500, 'Internal Server Error');
                }
            }
        };
    }
}
