<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Http;

use Psr\Http\Message\ResponseInterface;

final class ResponseEmitter
{
    public function emit(ResponseInterface $response): void
    {
        if (!headers_sent()) {
            $reason = $response->getReasonPhrase();
            header(sprintf(
                'HTTP/%s %d%s',
                $response->getProtocolVersion(),
                $response->getStatusCode(),
                $reason !== '' ? ' ' . $reason : '',
            ), true, $response->getStatusCode());

            foreach ($response->getHeaders() as $name => $values) {
                $first = strtolower($name) !== 'set-cookie';
                foreach ($values as $value) {
                    header("{$name}: {$value}", $first);
                    $first = false;
                }
            }
        }

        $body = $response->getBody();
        if ($body->isSeekable()) {
            $body->rewind();
        }
        while (!$body->eof()) {
            echo $body->read(8192);
        }
    }
}
