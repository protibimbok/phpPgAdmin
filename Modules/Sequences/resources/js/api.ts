import { api } from '@/api/request'
import { collection, collectionUrl, resolve, type TreeNode } from '@/nodes/client'

/** A sequence as pgAdmin's properties.sql describes it, with the definition read from pg_sequence. */
export interface Sequence {
  oid: number
  name: string
  schema: string
  seqowner: string
  comment: string | null
  acl: string | null
  owned_table: string | null
  owned_column: string | null
  /** True for UNLOGGED. */
  relpersistence: boolean
  /** The bigint definition values come as strings, to keep their digits above 2⁵³. */
  current_value: string
  is_called: boolean
  minimum: string
  maximum: string
  increment: string
  start: string
  cache: string
  cycled: boolean
  is_sys_obj: boolean
  securities?: { provider: string; label: string }[]
  relacl?: unknown[]
}

export function sequences(db: string, scid: number) {
  return collection<Sequence>(collectionUrl(db, 'schemas', scid, 'sequences'))
}

/** The schema's OID, which the sequence collection is addressed by. */
export function resolveSchema(db: string, schema: string): Promise<number> {
  return resolve(db, 'schema', { name: schema }).then((ids) => ids.scid)
}

/** The sequence's OIDs: resolve by schema and name → { scid, seid }. */
export function resolveSequence(db: string, schema: string, name: string): Promise<{ scid: number; seid: number }> {
  return resolve(db, 'sequence', { schema, name }).then((ids) => ({ scid: ids.scid, seid: ids.seid }))
}

/** What the editor offers (GET …/sequences/options). */
export interface SequenceOptions {
  roles: string[]
  schemas: string[]
  tables: { name: string; columns: string[] }[]
}

export function sequenceOptions(db: string, scid: number): Promise<SequenceOptions> {
  return api.get<SequenceOptions>(`${collectionUrl(db, 'schemas', scid, 'sequences')}/options`)
}

/**
 * What CREATE SEQUENCE and ALTER SEQUENCE take, by pgAdmin's field names (create.sql,
 * update.sql). An update may send the whole form: the server keeps what differs.
 */
export interface SequenceData {
  name?: string
  schema?: string
  seqowner?: string
  comment?: string
  current_value?: string
  increment?: string
  start?: string
  minimum?: string
  maximum?: string
  cache?: string
  cycled?: boolean
  relpersistence?: boolean
  owned_table?: string | null
  owned_column?: string | null
}

export function createSequence(db: string, scid: number, data: SequenceData): Promise<TreeNode> {
  return sequences(db, scid).create(data)
}

export function updateSequence(db: string, scid: number, seid: number, data: SequenceData): Promise<TreeNode> {
  return sequences(db, scid).update(seid, data)
}

export function dropSequence(db: string, scid: number, seid: number, cascade = false): Promise<void> {
  return sequences(db, scid).remove(seid, cascade).then(() => undefined)
}

export function sequenceModifiedSql(db: string, scid: number, data: SequenceData, seid?: number): Promise<string> {
  return sequences(db, scid).modifiedSql(data, seid)
}
