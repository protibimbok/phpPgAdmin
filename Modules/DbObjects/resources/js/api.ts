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

export type ObjectKind = 'extension' | 'language' | 'cast' | 'event_trigger' | 'foreign_data_wrapper' | 'foreign_server' | 'user_mapping'

export const COLLECTIONS: Record<'extension' | 'language' | 'cast' | 'event_trigger', string> = { extension: 'extensions', language: 'languages', cast: 'casts', event_trigger: 'event_triggers' }

export const extensions = (db: string) => collection<Extension>(collectionUrl(db, 'extensions'))
export const languages = (db: string) => collection<Language>(collectionUrl(db, 'languages'))
export const casts = (db: string) => collection<Cast>(collectionUrl(db, 'casts'))
export const eventTriggers = (db: string) => collection<EventTrigger>(collectionUrl(db, 'event_triggers'))

/** The collection an object is in: its kind's, under its wrapper and server for the foreign ones. */
export function objectCollection(db: string, kind: ObjectKind, parents: { fid?: number; fsid?: number } = {}) {
  switch (kind) {
    case 'foreign_data_wrapper':
      return collection(collectionUrl(db, 'foreign_data_wrappers'))
    case 'foreign_server':
      return collection(collectionUrl(db, 'foreign_data_wrappers', parents.fid ?? 0, 'foreign_servers'))
    case 'user_mapping':
      return collection(collectionUrl(db, 'foreign_data_wrappers', parents.fid ?? 0, 'foreign_servers', parents.fsid ?? 0, 'user_mappings'))
    default:
      return collection(collectionUrl(db, COLLECTIONS[kind]))
  }
}

export interface OptionPair {
  option: string
  value: string
}

export interface ForeignDataWrapper {
  oid: number
  name: string
  /** The handler and the validator as "schema.function". */
  fdwhan: string | null
  fdwvalue: string | null
  fdwoptions: OptionPair[]
  fdwowner: string
  description: string | null
}

export interface ForeignServer {
  oid: number
  name: string
  fid: number
  fdwname: string
  fsrvtype: string | null
  fsrvversion: string | null
  fsrvoptions: OptionPair[]
  fsrvowner: string
  description: string | null
}

export interface UserMapping {
  oid: number
  /** The role, or "public" */
  name: string
  fid: number
  fsid: number
  srvname: string
  umoptions: OptionPair[]
}

export interface ForeignDataWrapperOptions {
  handlers: string[]
  validators: string[]
  roles: string[]
}

/**
 * The foreign data wrappers, the servers of each, and the user mappings of each server, every
 * object with the OIDs of the ones it is under.
 */
export async function foreignObjects(db: string): Promise<{ wrappers: ForeignDataWrapper[]; servers: ForeignServer[]; mappings: UserMapping[] }> {
  const wrappers = await collection<ForeignDataWrapper>(collectionUrl(db, 'foreign_data_wrappers')).list()
  const servers = (
    await Promise.all(wrappers.map((w) => collection<Omit<ForeignServer, 'fid'>>(collectionUrl(db, 'foreign_data_wrappers', w.oid, 'foreign_servers')).list().then((rows) => rows.map((row) => ({ ...row, fid: w.oid })))))
  ).flat()
  const mappings = (
    await Promise.all(servers.map((s) => collection<Omit<UserMapping, 'fid' | 'fsid' | 'srvname'>>(collectionUrl(db, 'foreign_data_wrappers', s.fid, 'foreign_servers', s.oid, 'user_mappings')).list().then((rows) => rows.map((row) => ({ ...row, fid: s.fid, fsid: s.oid, srvname: s.name })))))
  ).flat()

  return { wrappers, servers, mappings }
}

export const foreignDataWrapperOptions = (db: string) => api.get<ForeignDataWrapperOptions>(`${collectionUrl(db, 'foreign_data_wrappers')}/options`)
export const foreignServerOptions = (db: string) => api.get<{ roles: string[] }>(`${collectionUrl(db, 'foreign_servers')}/options`)
export const userMappingOptions = (db: string) => api.get<{ roles: string[] }>(`${collectionUrl(db, 'user_mappings')}/options`)

export const extensionOptions = (db: string) => api.get<ExtensionOptions>(`${collectionUrl(db, 'extensions')}/options`)
export const languageOptions = (db: string) => api.get<LanguageOptions>(`${collectionUrl(db, 'languages')}/options`)
export const castOptions = (db: string, srctyp = '', trgtyp = '') => api.get<CastOptions>(`${collectionUrl(db, 'casts')}/options?${new URLSearchParams({ srctyp, trgtyp })}`)
export const eventTriggerOptions = (db: string) => api.get<EventTriggerOptions>(`${collectionUrl(db, 'event_triggers')}/options`)

export interface ForeignTable {
  oid: number
  name: string
  owner: string
  basensp: string
  ftsrvname: string
  ftoptions: OptionPair[]
  description: string | null
  columns: { attnum: number; name: string; cltype: string; attnotnull: boolean; defval: string; coloptions: OptionPair[]; inheritedfrom: string | null }[]
  /** The tables it inherits from, schema-qualified. */
  inherits: string[]
  /** Its CHECK constraints; conislocal false for one inherited from a parent. */
  constraints: { conname: string; consrc: string; convalidated: boolean; connoinherit: boolean; conislocal: boolean }[]
}

export const foreignTables = (db: string, scid: number) => collection<ForeignTable>(collectionUrl(db, 'schemas', scid, 'foreign_tables'))
export const foreignTableOptions = (db: string, scid: number) => api.get<{ servers: string[]; roles: string[]; schemas: string[]; tables: string[] }>(`${collectionUrl(db, 'schemas', scid, 'foreign_tables')}/options`)

/** What IMPORT FOREIGN SCHEMA takes: tables are names one per line, mode 'all', 'limit' (LIMIT TO) or 'except'. */
export interface ForeignSchemaImport {
  server: string
  remote_schema: string
  mode: 'all' | 'limit' | 'except'
  tables: string
  into: string
  options: OptionPair[]
}

export const importForeignSchemaSql = (db: string, scid: number, data: ForeignSchemaImport) => api.post<{ sql: string }>(`${collectionUrl(db, 'schemas', scid, 'foreign_tables')}/import/sql`, data).then((r) => r.sql)
export const importForeignSchema = (db: string, scid: number, data: ForeignSchemaImport) => api.post<{ sql: string; tables: string[] }>(`${collectionUrl(db, 'schemas', scid, 'foreign_tables')}/import`, data)
