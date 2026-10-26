<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Http;

use RuntimeException;

/**
 * A failure the API reports with fields of its own beside the message: a server-side problem
 * the client can offer to remedy, for instance. The strategy sends the status, the message and
 * the fields as the error body.
 */
final class ApiException extends RuntimeException
{
    /** @param array<string, mixed> $fields */
    public function __construct(
        private readonly int $status,
        string $message,
        private readonly array $fields = [],
    ) {
        parent::__construct($message);
    }

    public function httpStatus(): int
    {
        return $this->status;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return ['message' => $this->getMessage(), ...$this->fields];
    }
}
