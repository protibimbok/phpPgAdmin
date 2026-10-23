<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Auth\Http\Controllers;

use League\Route\Http\Exception\UnprocessableEntityException;
use PhpPgAdmin\Modules\Auth\Preferences;
use Psr\Http\Message\ServerRequestInterface;

/** The signed-in role's preferences: read them all, or change some. */
final class PreferenceController
{
    /** @return array{preferences: object} */
    public function index(ServerRequestInterface $request): array
    {
        return ['preferences' => (object) $this->preferences()->all()];
    }

    /**
     * Merge the given keys into the preferences; a null value removes its key.
     *
     * @return array{preferences: object}
     */
    public function update(ServerRequestInterface $request): array
    {
        $input = $request->getParsedBody();
        if (!is_array($input) || array_is_list($input) && $input !== []) {
            throw new UnprocessableEntityException(__('auth::errors.invalid_preferences'));
        }

        foreach ($input as $key => $value) {
            if (!is_string($key) || $key === '' || strlen($key) > 128) {
                throw new UnprocessableEntityException(__('auth::errors.invalid_preferences'));
            }
        }

        $preferences = $this->preferences();
        $preferences->merge($input);

        return ['preferences' => (object) $preferences->all()];
    }

    private function preferences(): Preferences
    {
        return Preferences::forSession() ?? throw new \LogicException('The Authenticate middleware must run before ' . self::class . '.');
    }
}
