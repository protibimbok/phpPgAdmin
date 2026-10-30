import { api } from '@/api/request'
import { collection, collectionUrl, resolve, type TreeNode } from '@/nodes/client'

/** A schema as pgAdmin's properties.sql describes it. */
export interface Schema {
  oid: number
  name: string
  /** 3 for a user schema, 0 for pg_*, 1 for a temporary one. */
  nsptyp: number
  namespaceowner: string
  description: string | null
  can_create: boolean
  acl: string | null
  is_sys_obj: boolean
}

export interface SchemaMeta {
  can_create: boolean
  has_usage: boolean
  description: string | null
}

export function schemas(db: string) {
  return collection<Schema, SchemaMeta>(collectionUrl(db, 'schemas'))
}

export function listSchemas(db: string): Promise<Schema[]> {
  return schemas(db).list()
}

export function schemaNodes(db: string): Promise<TreeNode<SchemaMeta>[]> {
  return schemas(db).nodes()
}

export function resolveSchema(db: string, name: string): Promise<number> {
  return resolve(db, 'schema', { name }).then((ids) => ids.scid)
}

export function schemaProperties(db: string, scid: number): Promise<Schema> {
  return schemas(db).properties(scid)
}

/** What CREATE SCHEMA and ALTER SCHEMA take, by pgAdmin's field names (create.sql, update.sql). */
export interface SchemaData {
  name?: string
  namespaceowner?: string
  description?: string
}

export function createSchema(db: string, data: SchemaData & { name: string }): Promise<TreeNode<SchemaMeta>> {
  return schemas(db).create(data)
}

export function updateSchema(db: string, scid: number, data: SchemaData): Promise<TreeNode<SchemaMeta>> {
  return schemas(db).update(scid, data)
}

export function dropSchema(db: string, scid: number, cascade = false): Promise<void> {
  return schemas(db).remove(scid, cascade).then(() => undefined)
}

export function schemaModifiedSql(db: string, data: SchemaData, scid?: number): Promise<string> {
  return schemas(db).modifiedSql(data, scid)
}

export function schemaOptions(db: string): Promise<{ roles: string[] }> {
  return api.get<{ roles: string[] }>(`${collectionUrl(db, 'schemas')}/options`)
}

/** A column in the data dictionary, with the columns its foreign keys reference. */
export interface DictionaryColumn {
  name: string
  type: string
  nullable: boolean
  default: string | null
  primary_key: boolean
  links: { schema: string; table: string; column: string }[]
  comment: string | null
}

export interface DictionaryIndex {
  name: string
  method: string
  unique: boolean
  primary: boolean
  comment: string | null
  /** Key columns (or expressions), then INCLUDE columns. */
  columns: { name: string; collation: string | null; nulls: string | null; included: boolean }[]
}

export interface DictionaryTable {
  schema: string
  name: string
  /** relkind: r, p, v, m or f. */
  kind: string
  comment: string | null
  columns: DictionaryColumn[]
  indexes: DictionaryIndex[]
}

export interface DataDictionary {
  database: string
  schema: string | null
  comment: string | null
  tables: DictionaryTable[]
}

/** phpMyAdmin's data dictionary: the database's tables (one schema's when given) with their columns and indexes. */
export function dataDictionary(db: string, schema?: string | null): Promise<DataDictionary> {
  const query = schema ? `?${new URLSearchParams({ schema })}` : ''

  return api.get<DataDictionary>(`/api/databases/${encodeURIComponent(db)}/data-dictionary${query}`)
}

/** phpMyAdmin's Copy database to, for a schema; with preview only the statements come back. */
export function copySchema(db: string, scid: number, options: { name: string; what: 'structure' | 'data' | 'dataonly'; sequences: boolean }, preview = false): Promise<string> {
  return api.post<{ sql: string }>(`/api/databases/${encodeURIComponent(db)}/schemas/${scid}/copy`, { ...options, preview }).then((r) => r.sql)
}
