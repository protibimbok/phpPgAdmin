<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\I18n;

use InvalidArgumentException;

/**
 * A locale the UI may run in: its code, how it is called and which way its text runs.
 */
final readonly class Locale
{
    public function __construct(
        public string $code,
        public string $name,
        public string $native,
        public TextDirection $direction = TextDirection::LeftToRight,
    ) {
        if (!preg_match('/^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/', $code)) {
            throw new InvalidArgumentException(sprintf('Invalid locale code [%s].', $code));
        }
    }

    /** @param array{name?: string, native?: string, dir?: string} $config */
    public static function fromConfig(string $code, array $config): self
    {
        return new self(
            $code,
            $config['name'] ?? $code,
            $config['native'] ?? $config['name'] ?? $code,
            TextDirection::from($config['dir'] ?? 'ltr'),
        );
    }

    public function isRtl(): bool
    {
        return $this->direction === TextDirection::RightToLeft;
    }

    /** The name the language picker shows, like phpMyAdmin's: "العربية - Arabic", or just "English". */
    public function displayName(): string
    {
        return $this->native === $this->name ? $this->name : $this->native . ' - ' . $this->name;
    }

    /** The language part of the code: "pt" for "pt-BR". */
    public function language(): string
    {
        return strtolower((string) preg_split('/[-_]/', $this->code)[0]);
    }

    /** @return array{code: string, name: string, native: string, dir: string} */
    public function toArray(): array
    {
        return [
            'code' => $this->code,
            'name' => $this->name,
            'native' => $this->native,
            'dir' => $this->direction->value,
        ];
    }
}
