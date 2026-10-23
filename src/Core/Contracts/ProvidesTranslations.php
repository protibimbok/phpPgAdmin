<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Contracts;

interface ProvidesTranslations
{
    /**
     * The directory holding the module's messages, relative to the module's path, e.g. "resources/lang".
     * It contains one <locale>.json per locale; the keys are read under the module's name as namespace:
     *
     *     __('auth::login.title')
     */
    public function translationsPath(): string;
}
