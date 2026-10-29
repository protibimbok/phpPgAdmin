<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\DbObjects\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Nodes\Options;

/**
 * The OPTIONS of a foreign data wrapper, foreign server or user mapping as pgAdmin's templates
 * take them: a list of {<prefix>option, <prefix>value}, and for an update the options added,
 * changed and deleted. The client reads and sends them as a plain list of {option, value}.
 */
final class ForeignOptions
{
    /**
     * The catalog's options ('{host=db,port=5432}') as the client reads them.
     *
     * @return list<array{option: string, value: string}>
     */
    public static function fromCatalog(mixed $options): array
    {
        return array_map(static function (string $entry): array {
            [$option, $value] = array_pad(explode('=', $entry, 2), 2, '');

            return ['option' => $option, 'value' => $value];
        }, Options::list($options));
    }

    /**
     * The client's options, checked: each named once, none without a name.
     *
     * @return list<array{option: string, value: string}>
     */
    public static function fromClient(mixed $options): array
    {
        $list = [];
        foreach (is_array($options) ? $options : [] as $entry) {
            $option = trim((string) ($entry['option'] ?? ''));
            $value = (string) ($entry['value'] ?? '');
            if ($option === '' && $value === '') {
                continue;
            }
            if ($option === '') {
                throw new BadRequestException('An option has a value but no name.');
            }
            if (isset($list[$option])) {
                throw new BadRequestException(sprintf('The option "%s" is given twice.', $option));
            }
            $list[$option] = ['option' => $option, 'value' => $value];
        }

        return array_values($list);
    }

    /**
     * A list in a template's field names: fdwoption/fdwvalue, fsrvoption/fsrvvalue, umoption/umvalue.
     *
     * @param list<array{option: string, value: string}> $options
     * @return list<array<string, string>>
     */
    public static function named(array $options, string $prefix): array
    {
        return array_map(static fn (array $o): array => [$prefix . 'option' => $o['option'], $prefix . 'value' => $o['value']], $options);
    }

    /**
     * What an update does to the options, {added, changed, deleted}, in a template's field names.
     *
     * @param list<array{option: string, value: string}> $old
     * @param list<array{option: string, value: string}> $new
     * @return array{added: list<array<string, string>>, changed: list<array<string, string>>, deleted: list<array<string, string>>}
     */
    public static function diff(array $old, array $new, string $prefix): array
    {
        $before = array_column($old, 'value', 'option');
        $after = array_column($new, 'value', 'option');
        $added = $changed = $deleted = [];
        foreach ($after as $option => $value) {
            if (!array_key_exists($option, $before)) {
                $added[] = ['option' => (string) $option, 'value' => $value];
            } elseif ($before[$option] !== $value) {
                $changed[] = ['option' => (string) $option, 'value' => $value];
            }
        }
        foreach ($before as $option => $value) {
            if (!array_key_exists($option, $after)) {
                $deleted[] = ['option' => (string) $option, 'value' => $value];
            }
        }

        return ['added' => self::named($added, $prefix), 'changed' => self::named($changed, $prefix), 'deleted' => self::named($deleted, $prefix)];
    }
}
