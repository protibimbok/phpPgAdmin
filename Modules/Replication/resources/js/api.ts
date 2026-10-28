import { api } from '@/api/request'
import { collection, collectionUrl } from '@/nodes/client'

/** A row of pg_settings as the Replication page lists it: the value as SHOW prints it. */
export interface Setting {
  name: string
  value: string
  context: string
  pending_restart: boolean
}

/** A standby streaming from this server: pg_stat_replication with its replay lag in bytes. */
export interface Replica {
  pid: number
  usename: string | null
  application_name: string
  client_addr: string | null
  client_hostname: string | null
  client_port: number | null
  backend_start: string
  state: string | null
  sent_lsn: string | null
  write_lsn: string | null
  flush_lsn: string | null
  replay_lsn: string | null
  write_lag: string | null
  flush_lag: string | null
  replay_lag: string | null
  sync_state: string | null
  reply_time: string | null
  replay_lag_bytes: number | null
}

/** pg_replication_slots with the WAL each slot holds back; the later columns depend on the version. */
export interface Slot {
  slot_name: string
  plugin: string | null
  slot_type: 'physical' | 'logical'
  database: string | null
  temporary: boolean
  active: boolean
  active_pid: number | null
  xmin: string | null
  catalog_xmin: string | null
  restart_lsn: string | null
  confirmed_flush_lsn: string | null
  wal_status: string | null
  safe_wal_size: number | null
  two_phase?: boolean
  inactive_since?: string | null
  conflicting?: boolean | null
  invalidation_reason?: string | null
  failover?: boolean
  synced?: boolean
  retained_bytes: number | null
}

/** A standby's WAL receiver (its columns null when none runs) and its replay. */
export interface Receiver {
  pid: number | null
  status: string | null
  sender_host: string | null
  sender_port: number | null
  slot_name: string | null
  conninfo: string | null
  received_tli: number | null
  written_lsn: string | null
  flushed_lsn: string | null
  latest_end_lsn: string | null
  latest_end_time: string | null
  last_msg_send_time: string | null
  last_msg_receipt_time: string | null
  receive_lsn: string | null
  replay_lsn: string | null
  replay_timestamp: string | null
  replay_lag_bytes: number | null
  replay_paused: boolean
}

export interface ReplicationOverview {
  server: {
    in_recovery: boolean
    wal_level: string
    max_wal_senders: number
    current_lsn: string | null
    current_walfile: string | null
    superuser: boolean
    /** Whether the role may create slots: REPLICATION or superuser. */
    replication: boolean
    /** Whether it sees other roles' replication statistics: pg_read_all_stats or superuser. */
    monitor: boolean
    /** Whether it may pause and resume WAL replay. */
    replay_control: boolean
  }
  primary_settings: Setting[]
  standby_settings: Setting[]
  replicas: Replica[]
  slots: Slot[]
  receiver: Receiver | null
}

export function replicationOverview(): Promise<ReplicationOverview> {
  return api.get<ReplicationOverview>('/api/server/replication')
}

export interface SlotData {
  name: string
  type: 'physical' | 'logical'
  /** Physical: reserve WAL now rather than when a standby first connects. */
  reserve?: boolean
  database?: string
  plugin?: string
  two_phase?: boolean
}

export function createSlot(data: SlotData): Promise<{ sql: string }> {
  return api.post<{ sql: string }>('/api/server/replication/slots', data)
}

export function dropSlot(name: string): Promise<{ sql: string }> {
  return api.delete<{ sql: string }>(`/api/server/replication/slots/${encodeURIComponent(name)}`)
}

export function walReplay(action: 'pause' | 'resume'): Promise<{ sql: string; replay_paused: boolean }> {
  return api.post<{ sql: string; replay_paused: boolean }>(`/api/server/replication/replay/${action}`, {})
}

/** A table a publication publishes; from PostgreSQL 15 with a column list and a row filter. */
export interface PublishedTable {
  tid: number
  table_name?: string
  columns: string[]
  where: string | null
}

export interface Publication {
  oid: number
  name: string
  pubowner: string
  description: string | null
  all_table: boolean
  evnt_insert: boolean
  evnt_update: boolean
  evnt_delete: boolean
  evnt_truncate: boolean
  publish_via_partition_root: boolean
  pubtable: PublishedTable[]
  pubschema: string[]
}

export interface PublicationData {
  name: string
  pubowner: string
  description: string
  all_table?: boolean
  only_table: boolean
  evnt_insert: boolean
  evnt_update: boolean
  evnt_delete: boolean
  evnt_truncate: boolean
  publish_via_partition_root: boolean
  pubtable?: PublishedTable[]
  pubschema?: string[]
}

export interface PublicationOptions {
  tables: { tid: number; table: string }[]
  schemas: string[]
  roles: string[]
  version: number
}

export const publications = (db: string) => collection<Publication>(collectionUrl(db, 'publications'))

export function publicationOptions(db: string): Promise<PublicationOptions> {
  return api.get<PublicationOptions>(`${collectionUrl(db, 'publications')}/options`)
}

export function publicationColumns(db: string, tid: number): Promise<string[]> {
  return api.get<{ columns: string[] }>(`${collectionUrl(db, 'publications')}/columns/${tid}`).then((r) => r.columns)
}

/** The connection fields of a subscription, pgAdmin's names; the password is never read back. */
export interface ConnectionFields {
  host: string
  port: string
  username: string
  db: string
  connect_timeout: string
  passfile: string
  sslmode: string
  sslcompression: string
  sslcert: string
  sslkey: string
  sslrootcert: string
  sslcrl: string
}

/** The apply worker of a subscription (pg_stat_subscription) and its error counts (15+). */
export interface SubscriptionWorker {
  pid: number | null
  received_lsn: string | null
  latest_end_lsn: string | null
  last_msg_send_time: string | null
  last_msg_receipt_time: string | null
  latest_end_time: string | null
  apply_error_count: number | null
  sync_error_count: number | null
}

export interface Subscription extends ConnectionFields {
  oid: number
  name: string
  subowner: string
  description: string | null
  pub: string[]
  enabled: boolean
  slot_name: string | null
  sync: string
  binary?: boolean
  streaming?: 'off' | 'on' | 'parallel'
  two_phase?: boolean
  disable_on_error?: boolean
  password_required?: boolean
  run_as_owner?: boolean
  origin?: 'any' | 'none'
  failover?: boolean
  /** Whether this role may read the connection (only superusers may). */
  conninfo_visible: boolean
  has_password: boolean
  worker?: SubscriptionWorker | null
}

export type SubscriptionData = Partial<ConnectionFields> & {
  name: string
  subowner: string
  description: string
  password?: string
  pub: string[]
  connect?: boolean
  enabled: boolean
  copy_data?: boolean
  create_slot?: boolean
  slot_name: string
  slot_none: boolean
  sync: string
  binary?: boolean
  streaming?: string
  two_phase?: boolean
  disable_on_error?: boolean
  password_required?: boolean
  run_as_owner?: boolean
  origin?: string
  failover?: boolean
  refresh_pub?: boolean
  copy_data_after_refresh?: boolean
}

export interface SubscriptionOptions {
  roles: string[]
  version: number
  conninfo_visible: boolean
}

export const subscriptions = (db: string) => collection<Subscription>(collectionUrl(db, 'subscriptions'))

export function subscriptionOptions(db: string): Promise<SubscriptionOptions> {
  return api.get<SubscriptionOptions>(`${collectionUrl(db, 'subscriptions')}/options`)
}

/** pgAdmin's get_publications: what the publisher at the given connection publishes. */
export function remotePublications(db: string, connection: Partial<ConnectionFields> & { password?: string }, subid?: number): Promise<string[]> {
  const query = subid === undefined ? '' : `?subid=${subid}`

  return api.post<{ publications: string[] }>(`${collectionUrl(db, 'subscriptions')}/publications${query}`, connection).then((r) => r.publications)
}

