<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Database;

use PgSql\Result as PgResult;
use RuntimeException;

/**
 * The server rejected a statement. Carries the error fields the server sent, so the client can
 * show the SQLSTATE, detail, hint and the position in the statement, as psql does.
 */
final class QueryException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly ?string $sqlstate = null,
        public readonly ?string $detail = null,
        public readonly ?string $hint = null,
        /** 1-based character offset into the statement, when the server reports one. */
        public readonly ?int $position = null,
        public readonly ?string $sql = null,
    ) {
        parent::__construct($message);
    }

    public static function fromResult(PgResult $result, ?string $sql = null): self
    {
        $field = static function (int $code) use ($result): ?string {
            $value = pg_result_error_field($result, $code);

            return $value === null || $value === false || $value === '' ? null : $value;
        };

        $position = $field(PGSQL_DIAG_STATEMENT_POSITION);

        return new self(
            $field(PGSQL_DIAG_MESSAGE_PRIMARY) ?? trim(pg_result_error($result) ?: 'Query failed'),
            $field(PGSQL_DIAG_SQLSTATE),
            $field(PGSQL_DIAG_MESSAGE_DETAIL),
            $field(PGSQL_DIAG_MESSAGE_HINT),
            $position === null ? null : (int) $position,
            $sql,
        );
    }

    /** When the server gave no result at all, only a connection-level message. */
    public static function fromMessage(string $message, ?string $sql = null): self
    {
        return new self(trim($message) !== '' ? trim($message) : 'Query failed', sql: $sql);
    }

    /**
     * The HTTP status that fits the failure: the client's fault for syntax and semantic errors,
     * a conflict for integrity and object-state violations, forbidden for missing privileges.
     */
    public function httpStatus(): int
    {
        $class = substr((string) $this->sqlstate, 0, 2);

        return match (true) {
            $this->sqlstate === '42501' => 403,
            $class === '42', $class === '22', $class === '0A' => 400,
            $class === '23', $class === '55', $class === '40', $class === '2B' => 409,
            $class === '57' => 503,
            default => 500,
        };
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return array_filter([
            'message' => $this->getMessage(),
            'sqlstate' => $this->sqlstate,
            'detail' => $this->detail,
            'hint' => $this->hint,
            'position' => $this->position,
        ], static fn (mixed $v): bool => $v !== null);
    }
}
