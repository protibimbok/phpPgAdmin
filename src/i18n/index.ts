import i18n from 'i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
import { initReactI18next } from 'react-i18next'
import { readConfig, type Locale } from './config'

/**
 * i18next, fed from the same JSON message files the PHP translator reads.
 *
 * Every module's resources/lang/<locale>.json becomes an i18next namespace named after the
 * module, so `t('login.title', { ns: 'auth' })` reads what PHP reads as `auth::login.title`.
 * The host app's src/lang/<locale>.json is the default "app" namespace. The files
 * are split into one chunk each by Vite and loaded on demand, so a page costs only the
 * namespaces it uses in the locale it runs in.
 */

type Messages = Record<string, unknown>
type Loader = () => Promise<{ default: Messages }>

const moduleFiles = import.meta.glob<{ default: Messages }>('../../Modules/*/resources/lang/*.json')
const appFiles = import.meta.glob<{ default: Messages }>('../lang/*.json')

export const DEFAULT_NAMESPACE = 'app'

const loaders = new Map<string, Loader>()
const namespaces = new Set<string>([DEFAULT_NAMESPACE])

for (const [path, load] of Object.entries(moduleFiles)) {
  const match = /\/Modules\/([^/]+)\/resources\/lang\/([^/]+)\.json$/.exec(path)
  if (match) {
    const namespace = match[1].toLowerCase() // the module directory, "Auth", is the module name, "auth"
    namespaces.add(namespace)
    loaders.set(`${namespace}:${match[2]}`, load)
  }
}

for (const [path, load] of Object.entries(appFiles)) {
  const match = /\/([^/]+)\.json$/.exec(path)
  if (match) {
    loaders.set(`${DEFAULT_NAMESPACE}:${match[1]}`, load)
  }
}

export const config = readConfig()

/** Every locale the server offers, in its order. */
export const locales: readonly Locale[] = config.locales

export function findLocale(code: string): Locale | undefined {
  return locales.find((locale) => locale.code === code)
}

/** Lay the document out in the locale's direction, as the PHP shell did for the first load. */
export function applyDocumentLocale(code: string): void {
  const locale = findLocale(code)
  document.documentElement.lang = code
  document.documentElement.dir = locale?.dir ?? i18n.dir(code)
}

void i18n
  .use(
    resourcesToBackend((language: string, namespace: string) => {
      const load = loaders.get(`${namespace}:${language}`)

      // A module without a file for a locale has nothing to say in it; the fallback locale fills in.
      return load ? load().then((module) => module.default) : Promise.resolve({})
    }),
  )
  .use(initReactI18next)
  .init({
    lng: config.locale,
    fallbackLng: 'en',
    supportedLngs: locales.map((locale) => locale.code),
    load: 'currentOnly',
    ns: [...namespaces],
    defaultNS: DEFAULT_NAMESPACE,
    interpolation: { escapeValue: false }, // React escapes
    returnNull: false,
    react: { useSuspense: true },
  })

i18n.on('languageChanged', applyDocumentLocale)

export default i18n
