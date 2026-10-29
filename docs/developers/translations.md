# Translations

phpPgAdmin's interface text is kept in JSON message files that PHP and the browser both read. This page explains where messages live, how the locale is chosen, how the PHP translator and i18next use the files, and how to add a locale (including a right-to-left one) and check it for missing keys. English (`en`) and Arabic (`ar`, right-to-left) ship today.

## Where messages live

| File | Namespace | Read by |
|---|---|---|
| `Modules/<Name>/resources/lang/<code>.json` | the module's name, e.g. `search` | PHP (`__('search::…')`) and i18next (`t('…', { ns: 'search' })`) |
| `src/lang/<code>.json` | `app`, i18next's default namespace | i18next only |

A module provides its directory through `ProvidesTranslations::translationsPath()` (normally `resources/lang`). The files are nested JSON in i18next's format, so a string is written once for both sides:

```json
{
  "tab": "Search",
  "data": {
    "no_text": "Enter the words or values to search for.",
    "matches_one": "{{count}} match in <strong>{{table}}</strong>",
    "matches_other": "{{count}} matches in <strong>{{table}}</strong>"
  }
}
```

- **Keys** are paths into the nesting: `data.no_text`.
- **Placeholders** are <code v-pre>{{name}}</code>.
- **Plurals** use i18next's suffixes on the key: `_zero`, `_one`, `_two`, `_few`, `_many`, `_other`, chosen by the `count` value. English needs `_one` and `_other`. Arabic uses all six.
- **Markup** in a message (`<strong>`, `<em>`, `<app>`) is rendered with react-i18next's `<Trans>` where a page needs it. i18next's own escaping is off (`escapeValue: false`) because React escapes text.
- **Arrays** are allowed and read with `returnObjects: true`. The date picker's month and day names are an example (`sql:calendar.months`).

## Locale configuration

`config/i18n.php`:

```php
return [
    'default' => 'en',
    'fallback' => 'en',
    'locales' => [
        'en' => ['name' => 'English', 'native' => 'English', 'dir' => 'ltr'],
        'ar' => ['name' => 'Arabic', 'native' => 'العربية', 'dir' => 'rtl'],
    ],
];
```

| Key | Meaning |
|---|---|
| `default` | The locale when nothing else picks one |
| `fallback` | Where PHP looks up a key the current locale lacks |
| `locales` | Code → `name` (English), `native` (in the language itself; the picker shows "العربية - Arabic"), `dir` (`ltr` or `rtl`) |

`GET /api/i18n/locales` returns the configured locales and the current one.

## How the locale is chosen

The `SetLocale` middleware (I18n module) runs on every web and API request, after `StartSession`. It takes the first of these that names a configured locale:

1. `?lang=<code>` in the URL, which is also saved in the session;
2. the locale saved in the session;
3. the `pga_lang` cookie;
4. the `Accept-Language` header, best quality first;
5. `default` from the config.

A code matches exactly (case-insensitive, `_` or `-`) or by language, so `ar-EG` and `ar_SA` both find `ar`. The response gets `Content-Language`, and the `pga_lang` cookie (one year, `SameSite=Lax`, `Secure` over HTTPS) is refreshed when it differs.

Changing the language in the UI calls `PUT /api/i18n/locale {"locale": "ar"}`, which sets the session value and, for a signed-in role, stores it in the role's preferences. At the next sign-in the Auth module restores that stored locale.

```bash
curl -s 'http://phppgadmin.test/?lang=ar' | sed -n 2p
<html lang="ar" dir="rtl">
```

## PHP side

`app/Core/I18n/Translator.php` reads the same files. Each `ProvidesTranslations` module is registered under its `name()` at boot, and keys are `namespace::path`:

```php
__('auth::errors.credentials_required');
__('search::data.matches', ['count' => 3, 'table' => 'books']);
trans('i18n::errors.unsupported_locale', ['locale' => 'fr']);   // alias of __()
Lang::get('auth::login.title', [], 'ar');                        // a specific locale
Lang::locale()->direction;                                       // TextDirection::Rtl
```

- A key missing from the current locale is looked up in the `fallback` locale, then the key itself is returned.
- <code v-pre>{{name}}</code> placeholders are filled from the replacements. An unknown placeholder stays as written.
- Plurals: with a numeric `count`, PHP tries `_zero` (for 0), `_one` (for 1) and then `_other`. It does not know CLDR's `_two`, `_few` and `_many`, so an Arabic plural rendered by PHP always uses `_one` or `_other`. Plural messages are rendered in React, where i18next applies the full rules.
- The files are read when first needed and cached for the request. A file that is not valid JSON throws a `RuntimeException` naming the file.
- `src/lang/*.json` (the `app` namespace) is not registered in PHP. `__('app::…')` returns the key.

PHP renders very little text: the HTML shell's `lang`/`dir`, and a few error messages (login, unknown server, unsupported locale). Most controllers throw English messages written in the code, which reach the user as they are.

::: info Server messages stay in English
Validation errors thrown by controllers ("Enter at least three characters of the name.", "Could not find the sequence in the database…") and PostgreSQL's own messages are not translated. PostgreSQL's language follows the server's `lc_messages`, not the UI locale. Only messages that go through `__()` follow the UI locale. Today that is 11 call sites, mostly in the Auth and I18n modules.
:::

`GET /api/i18n/messages/<code>` returns every module's messages for a locale, keyed by module name, for a client that does not bundle the files. The React app does not use it. An unconfigured code is a 404.

## Frontend side

`src/i18n/index.ts` sets up i18next with `react-i18next` and `i18next-resources-to-backend`:

- `import.meta.glob('../../Modules/*/resources/lang/*.json')` and `'../lang/*.json'` turn every file into a lazily loaded chunk. The namespace is the module's directory name in lower case (`Modules/SchemaDiff` → `schemadiff`), so it matches the PHP namespace only while `name()` follows that rule.
- The start locale and the locale list come from the `app-config` JSON the PHP shell embeds, so the first page renders in the locale `SetLocale` picked, without another request.
- `fallbackLng: 'en'`, `load: 'currentOnly'`, `defaultNS: 'app'`, `useSuspense: true`. A page suspends until the namespaces it asks for are loaded. A module without a file for the current locale contributes an empty set, and English fills in.

In components:

```tsx
const { t } = useTranslation('search')          // this module's namespace
t('data.no_text')
t('data.matches', { count, table })             // plural by count
i18n.t('close')                                 // the global t() reads the default "app" namespace
```

Use the namespace prefix to read another namespace from anywhere: `t('search:tab')`, `t('app:not_available_yet')`. Tab labels in `registerModule()` and preference labels are always written this way (`'search:tab'`, `'settings:main.max_rows'`).

`useLocale()` (`src/i18n/useLocale.ts`) returns `{ locale, locales, setLocale }`. `setLocale(code)` changes i18next's language and persists the choice with `PUT /api/i18n/locale`. On `languageChanged`, `applyDocumentLocale()` sets `<html lang>` and `<html dir>`, which flips the layout (see [Right-to-left](#right-to-left)). `LocaleSelect` is the picker the login page and the server home page use.

::: warning The frontend fallback is fixed to English
`config/i18n.php`'s `fallback` applies to PHP only. i18next is initialised with `fallbackLng: 'en'`, so English must stay a configured locale and every namespace must have an `en.json`.
:::

## Adding a locale

1. Add the locale to `config/i18n.php`:

   ```php
   'de' => ['name' => 'German', 'native' => 'Deutsch', 'dir' => 'ltr'],
   ```

2. Copy every `en.json` to `<code>.json` and translate it: `src/lang/` and `Modules/*/resources/lang/` (23 module files today, from Auth to Views; the Frontend module has none). Keep the key structure. Add the plural forms the language needs; i18next uses `Intl.PluralRules`, so German needs `_one` and `_other`, Polish `_one`, `_few`, `_many` and `_other`.
3. Keep placeholders (<code v-pre>{{count}}</code>, <code v-pre>{{name}}</code>) and inline markup (`<strong>…</strong>`, `<app>…</app>`) as they are. Translate around them.
4. With `pnpm dev` running, Vite picks up the new files. For a production install, run `pnpm build`: the files are bundled as chunks, and a release without the rebuilt `public/dist` will not show the new language in the browser, even though PHP reads the new files directly.
5. Open the app with `?lang=<code>` and walk the tabs. Text that stays English is either a missing key (it falls back to English) or a message hard-coded in PHP (see above).

### Right-to-left

Set `'dir' => 'rtl'`. Nothing else is needed for the layout. The shell writes `<html dir="rtl">`, and the stylesheet already carries flipped rules under `[dir="rtl"]`, generated at build time by `postcss-rtlcss` (see [Frontend: Right-to-left](/developers/frontend#right-to-left)). Check these in the new locale:

- SQL, identifiers, file names and code stay left-to-right. Wrap them in `dir="ltr"`, as `PreviewSql` and `SqlView` do.
- Icons with a direction (arrows, "with selected" arrow) are background images and are not mirrored.
- Numbers and mixed-direction strings in messages: check the placement of <code v-pre>{{placeholders}}</code> in a right-to-left sentence.

## Checking for missing keys

There is no checker in the repository. A comparison of each locale file with its `en.json` takes a few lines of Node. Flatten both files to dotted keys, strip plural suffixes, and compare the sets:

```bash
node -e '
const fs = require("fs"), path = require("path");
const flat = (o, p = "", out = new Set()) => { for (const [k, v] of Object.entries(o)) { const key = p ? p + "." + k : k;
  if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out); else out.add(key.replace(/_(zero|one|two|few|many|other)$/, "")) } return out };
const dirs = ["src/lang", ...fs.readdirSync("Modules").map((m) => path.join("Modules", m, "resources/lang"))].filter((d) => fs.existsSync(d + "/en.json"));
for (const d of dirs) { const en = flat(JSON.parse(fs.readFileSync(d + "/en.json")));
  for (const f of fs.readdirSync(d).filter((f) => f.endsWith(".json") && f !== "en.json")) { const o = flat(JSON.parse(fs.readFileSync(path.join(d, f))));
    const missing = [...en].filter((k) => !o.has(k)), extra = [...o].filter((k) => !en.has(k));
    if (missing.length || extra.length) console.log(d, f, "missing:", missing, "extra:", extra) } }'
```

Run it from the project root. At the time of writing it reports no missing Arabic keys. Its only output is 19 keys under `app:dependency.types.*` that exist in `ar.json` but not in `en.json`. That is intended: `DependencyPanel` passes an English `defaultValue` derived from the type name (`foreign_key` → "Foreign key"), so English needs no entry for the plain cases, while Arabic needs one for every type.

A check of the other direction, `t('literal.key')` calls whose key is in no `en.json`, found nothing missing either. Its only hits were the date picker's array messages, which a simple flatten does not see as keys. Dynamic keys (`` t(`pages.${id}`) ``) cannot be checked this way. Review them by hand when you add one.
