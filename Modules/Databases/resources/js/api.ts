import { request } from '@auth/js/api'

export interface Database {
  name: string
  owner: string
  encoding: string
  collation: string
  is_template: boolean
  allow_connections: boolean
  /** Bytes, or null when the role may not connect to the database and so cannot measure it. */
  size: number | null
  comment: string | null
}

export function listDatabases(): Promise<Database[]> {
  return request<{ databases: Database[] }>('/api/databases').then(({ databases }) => databases)
}
