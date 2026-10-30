import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import i18n, { config, findLocale, locales } from '.'
import type { Locale } from './config'

async function persist(code: string): Promise<void> {
  const response = await fetch('/api/i18n/locale', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale: code }),
  })

  if (!response.ok) {
    throw new Error(`Could not save the locale (${response.status})`)
  }
}

/**
 * The locale the UI runs in and how to change it. Changing it switches the loaded messages,
 * flips the document's direction and tells the server, so PHP answers in the same language and
 * the next page load starts in it.
 */
export function useLocale(): { locale: Locale; locales: readonly Locale[]; setLocale: (code: string) => Promise<void> } {
  const { i18n: instance } = useTranslation()
  const code = instance.resolvedLanguage ?? instance.language ?? config.locale
  const locale = findLocale(code) ?? locales[0]

  const setLocale = useCallback(async (next: string) => {
    if (next === i18n.language || !findLocale(next)) {
      return
    }

    // The server is told first: should it refuse, the page stays in the language PHP still
    // answers in, rather than switching now and coming back on the next load.
    await persist(next)
    await i18n.changeLanguage(next)
  }, [])

  return { locale, locales, setLocale }
}
