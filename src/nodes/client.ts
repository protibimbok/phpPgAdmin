import { api } from '@/api/request'

/**
 * The node API: pgAdmin's object model behind /api/databases/{db}/…, addressed by OIDs. A
 * page with a name-based URL calls resolve() once to get the OIDs, then uses them.
 */

/** A node type as GET /api/databases/{db}/nodes describes it. */
export interface NodeType {
  type: string
  collection: string
  parent: string
  label: string
  icon: string
  supports: string[]
  collection_node: boolean
}

/** A tree node. */
export interface TreeNode<Meta = Record<string, unknown>> {
  id: string
  oid: number
  label: string
  type: string
  icon: string
  /** Whether it may have children. */
  inode: boolean
  meta: Meta
}

export interface Dependency {
  type: string
  name: string
  field: string
  icon: string | null
}

export interface Statistics {
  columns: { name: string; type: string }[]
  rows: Record<string, unknown>[]
}

const encode = encodeURIComponent

/** "/api/databases/app/schemas/2200/tables": the collection path from (collection, oid) pairs. */
export function collectionUrl(db: string, ...path: (string | number)[]): string {
  return `/api/databases/${encode(db)}/${path.map((segment) => (typeof segment === 'number' ? String(segment) : segment)).join('/')}`
}

export function getNodeTypes(db: string): Promise<NodeType[]> {
  return api.get<{ nodes: NodeType[] }>(`/api/databases/${encode(db)}/nodes`).then((r) => r.nodes)
}

/** The OIDs behind a name: resolve('app', 'table', { schema: 'public', name: 't' }) → { scid, tid }. */
export function resolve(db: string, type: string, params: Record<string, string>): Promise<Record<string, number>> {
  const query = new URLSearchParams({ type, ...params })

  return api.get<{ ids: Record<string, number> }>(`/api/databases/${encode(db)}/resolve?${query}`).then((r) => r.ids)
}

/** The operations on one collection, given its URL (see collectionUrl). */
export function collection<Props extends Record<string, unknown> = Record<string, unknown>, Meta = Record<string, unknown>>(url: string) {
  return {
    list: () => api.get<{ rows: Props[] }>(url).then((r) => r.rows),
    nodes: () => api.get<{ nodes: TreeNode<Meta>[] }>(`${url}/nodes`).then((r) => r.nodes),
    node: (oid: number) => api.get<{ node: TreeNode<Meta> }>(`${url}/${oid}/node`).then((r) => r.node),
    properties: (oid: number) => api.get<{ properties: Props }>(`${url}/${oid}`).then((r) => r.properties),
    create: (data: unknown) => api.post<{ node: TreeNode<Meta> }>(url, data).then((r) => r.node),
    update: (oid: number, data: unknown) => api.put<{ node: TreeNode<Meta> }>(`${url}/${oid}`, data).then((r) => r.node),
    remove: (oid: number, cascade = false) => api.delete<{ ok: true }>(`${url}/${oid}${cascade ? '?cascade=1' : ''}`),
    sql: (oid: number) => api.get<{ sql: string }>(`${url}/${oid}/sql`).then((r) => r.sql),
    /** The DDL a create (oid undefined) or an update would run. */
    modifiedSql: (data: unknown, oid?: number) => api.post<{ sql: string }>(oid === undefined ? `${url}/msql` : `${url}/${oid}/msql`, data).then((r) => r.sql),
    statistics: (oid?: number) => api.get<Statistics>(oid === undefined ? `${url}/stats` : `${url}/${oid}/stats`),
    dependencies: (oid: number) => api.get<{ dependencies: Dependency[] }>(`${url}/${oid}/dependencies`).then((r) => r.dependencies),
    dependents: (oid: number) => api.get<{ dependents: Dependency[] }>(`${url}/${oid}/dependents`).then((r) => r.dependents),
    children: (oid: number) => api.get<{ children: NodeType[] }>(`${url}/${oid}/children`).then((r) => r.children),
  }
}
