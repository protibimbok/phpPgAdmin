import { api } from '@/api/request'
import { collection, collectionUrl } from '@/nodes/client'

export interface Extension {
  oid: number
  name: string
  owner: string
  schema: string
  relocatable: boolean
  version: string
  comment: string | null
  is_sys_obj: boolean
}

export interface Language {
  oid: number
  name: string
  trusted: boolean
  lanproc: string
  laninl: string | null
  lanval: string | null
  lanowner: string
  description: string | null
  is_sys_obj: boolean
}

export interface Cast {
  oid: number
  /** "source->target" */
  name: string
  srctyp: string
  trgtyp: string
  /** "name(args)", or "binary compatible" */
  proname: string
  pronspname: string | null
  castcontext: 'IMPLICIT' | 'ASSIGNMENT' | 'EXPLICIT'
  description: string | null
}

export interface EventTrigger {
  oid: number
  name: string
  eventname: string
  eventfunname: string
  /** The tags, "CREATE TABLE, ALTER TABLE"; empty for every command. */
  when: string
  enabled: 'O' | 'D' | 'R' | 'A'
  eventowner: string
  comment: string | null
}

export interface ExtensionOptions {
  available: { name: string; installed_version: string | null; versions: string[]; schema: string | null; superuser: boolean }[]
  schemas: string[]
}

export interface LanguageOptions {
  handler: string[]
  inline: string[]
  validator: string[]
  roles: string[]
}

export interface CastOptions {
  types: string[]
  functions: string[]
}

export interface EventTriggerOptions {
  events: string[]
  functions: string[]
  roles: string[]
}

export type ObjectKind = 'extension' | 'language' | 'cast' | 'event_trigger'

export const COLLECTIONS: Record<ObjectKind, string> = { extension: 'extensions', language: 'languages', cast: 'casts', event_trigger: 'event_triggers' }

export const extensions = (db: string) => collection<Extension>(collectionUrl(db, 'extensions'))
export const languages = (db: string) => collection<Language>(collectionUrl(db, 'languages'))
export const casts = (db: string) => collection<Cast>(collectionUrl(db, 'casts'))
export const eventTriggers = (db: string) => collection<EventTrigger>(collectionUrl(db, 'event_triggers'))

export function objectCollection(db: string, kind: ObjectKind) {
  return collection(collectionUrl(db, COLLECTIONS[kind]))
}

export const extensionOptions = (db: string) => api.get<ExtensionOptions>(`${collectionUrl(db, 'extensions')}/options`)
export const languageOptions = (db: string) => api.get<LanguageOptions>(`${collectionUrl(db, 'languages')}/options`)
export const castOptions = (db: string, srctyp = '', trgtyp = '') => api.get<CastOptions>(`${collectionUrl(db, 'casts')}/options?${new URLSearchParams({ srctyp, trgtyp })}`)
export const eventTriggerOptions = (db: string) => api.get<EventTriggerOptions>(`${collectionUrl(db, 'event_triggers')}/options`)
