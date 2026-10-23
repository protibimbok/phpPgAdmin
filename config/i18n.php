<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Locales
    |--------------------------------------------------------------------------
    |
    | The locales the UI may run in. The key is the code the files are named
    | after (resources/lang/<code>.json in every module); "native" is the
    | name in the language itself, which the language picker shows, and
    | "dir" the writing direction the page is laid out in.
    |
    */

    'default' => 'en',

    'fallback' => 'en',

    'locales' => [

        'en' => [
            'name' => 'English',
            'native' => 'English',
            'dir' => 'ltr',
        ],

        'ar' => [
            'name' => 'Arabic',
            'native' => 'العربية',
            'dir' => 'rtl',
        ],

    ],

];
