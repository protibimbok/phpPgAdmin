import { api } from '@/api/request'

export interface SearchRelation {
  schema: string
  name: string
  /** pg_class.relkind: r, p, v, m or f */
  kind: string
}

export interface ObjectType {
  type: string
  label: string
  icon: string | null
}

export interface SearchOptions {
  relations: SearchRelation[]
  object_types: ObjectType[]
}

/** phpMyAdmin's criteriaSearchType */
export type SearchType = 1 | 2 | 3 | 4 | 5

export interface DataResult extends SearchRelation {
  count: number
  select: string
  /** null for a view or a materialized view */
  delete: string | null
}

export interface ObjectResult {
  name: string
  type: string
  /** The object's nodes from the schema in, pgAdmin's object path. */
  path: { type: string; oid: number; name: string }[]
  other_info: string | null
  /** N for a user schema, D for pg_catalog, O for information_schema */
  catalog_level: string
}

const base = (db: string) => `/api/databases/${encodeURIComponent(db)}/search`

export function searchOptions(db: string): Promise<SearchOptions> {
  return api.get<SearchOptions>(`${base(db)}/options`)
}

export function searchData(db: string, criteria: { text: string; type: SearchType; relations: { schema: string; name: string }[]; column: string }): Promise<{ results: DataResult[]; total: number }> {
  return api.post(`${base(db)}/data`, criteria)
}

export function searchObjects(db: string, criteria: { text: string; type: string; system: boolean }): Promise<ObjectResult[]> {
  return api.post<{ results: ObjectResult[] }>(`${base(db)}/objects`, criteria).then((r) => r.results)
}
