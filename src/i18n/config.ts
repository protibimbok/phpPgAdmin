export type TextDirection = 'ltr' | 'rtl'

/** A locale as config/i18n.php describes it. */
export interface Locale {
  code: string
  name: string
  /** The name in the language itself, e.g. "العربية". */
  native: string
  dir: TextDirection
}

export interface I18nConfig {
  /** The locale the server resolved for this page load. */
  locale: string
  locales: Locale[]
}

const FALLBACK: I18nConfig = {
  locale: 'en',
  locales: [{ code: 'en', name: 'English', native: 'English', dir: 'ltr' }],
}

/**
 * What the PHP shell embedded in `<script id="app-config" type="application/json">`: the locale
 * SetLocale picked for the request and every locale it offers.
 */
export function readConfig(): I18nConfig {
  const raw = document.getElementById('app-config')?.textContent
  if (!raw) {
    return { ...FALLBACK, locale: document.documentElement.lang || FALLBACK.locale }
  }

  try {
    const parsed = JSON.parse(raw) as Partial<I18nConfig>
    const locales = Array.isArray(parsed.locales) && parsed.locales.length > 0 ? parsed.locales : FALLBACK.locales

    return { locale: parsed.locale ?? locales[0].code, locales }
  } catch {
    return FALLBACK
  }
}

/** The name the language picker shows, like phpMyAdmin's: "العربية - Arabic", or just "English". */
export function displayName(locale: Locale): string {
  return locale.native === locale.name ? locale.name : `${locale.native} - ${locale.name}`
}
