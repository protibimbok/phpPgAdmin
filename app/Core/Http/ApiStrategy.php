<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Http;

use League\Route\Http;
use League\Route\Strategy\JsonStrategy;
use Override;
use PhpPgAdmin\Core\Database\ConnectionException;
use PhpPgAdmin\Core\Database\QueryException;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Throwable;

/**
 * league/route's JSON strategy, except that a PostgreSQL failure is reported with the server's
 * own message and error fields, and an unexpected exception only reveals its message and trace
 * when the application runs in debug mode.
 *
 * Every error body has "status_code" and "reason_phrase"; a PostgreSQL error adds "message" and,
 * when the server sent them, "sqlstate", "detail", "hint" and "position"; an ApiException adds
 * "message" and its own fields.
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
                } catch (QueryException | ApiException $e) {
                    return $this->json($e->httpStatus(), $e->toArray());
                } catch (ConnectionException $e) {
                    return $this->json($e->httpStatus(), ['message' => $e->responseMessage()]);
                } catch (Throwable $e) {
                    // The response hides the failure unless debugging; the server's log must not.
                    error_log(sprintf('phpPgAdmin: %s %s: %s: %s in %s:%d', $request->getMethod(), $request->getUri()->getPath(), $e::class, $e->getMessage(), $e->getFile(), $e->getLine()));
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

            /** @param array<string, mixed> $fields */
            private function json(int $status, array $fields): ResponseInterface
            {
                $reason = self::REASONS[$status] ?? 'Error';
                $payload = ['status_code' => $status, 'reason_phrase' => $reason, ...$fields];

                $this->response->getBody()->write(json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

                return $this->response
                    ->withHeader('content-type', 'application/json')
                    ->withStatus($status, $reason);
            }

            private const array REASONS = [
                400 => 'Bad Request',
                401 => 'Unauthorized',
                403 => 'Forbidden',
                404 => 'Not Found',
                409 => 'Conflict',
                500 => 'Internal Server Error',
                503 => 'Service Unavailable',
            ];
        };
    }
}
