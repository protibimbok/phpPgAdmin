import { api, ApiError, type ApiErrorBody } from '@/api/request'

export type ImportScope = 'server' | 'database' | 'schema' | 'table'

/** Where an import goes: the server, a database, a schema of one, or a table. */
export interface ImportTarget {
  database?: string
  schema?: string
  table?: string
}

/** The formats COPY reads a table's rows in. */
export type CopyFormat = 'csv' | 'text' | 'binary' | 'xml'

export interface ImportOptions {
  scope: ImportScope
  encodings: string[]
  /** The largest upload PHP takes, in bytes; 0 for no limit. */
  max_upload: number
  /** phpMyAdmin's UploadDir: its files, or null when it cannot be read; null when there is none. */
  upload_dir: { path: string; files: string[] | null } | null
  /** Where an archive imported on the server creates its database from. */
  maintenance_db: string
  /** The client programs found, or null when there are none. */
  tools: { directory: string; version: string; psql: boolean; pg_restore: boolean; restricts: boolean; policies: boolean; statistics: boolean; table_access_method: boolean } | null
  /** On a table: the columns COPY can fill, the primary key, and the COPY options the server has. */
  table: { columns: string[]; primary_key: string[]; on_error: boolean; default: boolean; header_match: boolean; text_header: boolean } | null
}

/** One COPY format's options, sent as <format>_<field>. */
export interface CopySettings {
  replace: boolean
  terminated: string
  enclosed: string
  escaped: string
  new_line: string
  partial_import: string
  columns: string
  ignore: boolean
  col_names: boolean
  header_match: boolean
  null: string
  default: string
}

/** The Import form's options, as POST /api/import reads them. */
export interface ImportSettings {
  format: 'sql' | 'archive' | CopyFormat
  charset: string
  local_file: string
  fk_checks: boolean
  stop_on_error: boolean
  sql_single_transaction: boolean
  contents: 'both' | 'structure' | 'data'
  jobs: string
  owner: boolean
  privileges: boolean
  tablespaces: boolean
  comments: boolean
  publications: boolean
  subscriptions: boolean
  security_labels: boolean
  policies: boolean
  table_access_method: boolean
  clean: boolean
  if_exists: boolean
  single_transaction: boolean
  exit_on_error: boolean
  disable_triggers: boolean
  no_data_for_failed_tables: boolean
  statistics: boolean
  set_session_authorization: boolean
  verbose: boolean
}

export type ProcessState = 'running' | 'finished' | 'failed' | 'killed' | 'lost'

/** A background process, as the runner last reported it. */
export interface BackgroundProcess {
  id: string
  type: string
  /** The file imported, or the command run. */
  description: string
  database: string | null
  schema: string | null
  table: string | null
  command: string[]
  state: ProcessState
  exit_code: number | null
  /** Error lines the program printed, or pg_restore's own count. */
  errors: number
  /** Bytes of the file read so far, of size. */
  read: number
  size: number | null
  started_at: string
  ended_at: string | null
}

export interface ProcessOutput {
  text: string
  /** Where the next read starts. */
  offset: number
  size: number
}

const query = (target: ImportTarget) => new URLSearchParams(Object.entries(target).filter((entry): entry is [string, string] => typeof entry[1] === 'string')).toString()

export function importOptions(target: ImportTarget): Promise<ImportOptions> {
  return api.get<ImportOptions>(`/api/import/options?${query(target)}`)
}

/**
 * Upload the file with the options and start the import. The upload goes through
 * XMLHttpRequest, which reports its progress as fetch does not.
 */
export function startImport(options: Record<string, unknown>, file: File | null, onProgress: (loaded: number, total: number) => void): Promise<BackgroundProcess> {
  const form = new FormData()
  form.append('options', JSON.stringify(options))
  if (file) form.append('import_file', file)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/import')
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total)
    })
    xhr.addEventListener('load', () => {
      let body: (ApiErrorBody & { process?: BackgroundProcess }) | null = null
      try {
        body = JSON.parse(xhr.responseText) as ApiErrorBody & { process?: BackgroundProcess }
      } catch {
        body = null
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.process) {
        resolve(body.process)
      } else {
        // The web server's own refusal (413 from nginx) is HTML, not the API's JSON.
        const fallback = xhr.status === 413 ? 'The file is larger than the web server accepts in a request.' : xhr.statusText || 'The import failed.'
        reject(new ApiError(xhr.status, body ?? {}, fallback))
      }
    })
    xhr.addEventListener('error', () => reject(new ApiError(0, {}, 'The upload failed.')))
    xhr.send(form)
  })
}

/** The processes of a type started on the target. */
export function listProcesses(target: ImportTarget, type: string): Promise<BackgroundProcess[]> {
  return api.get<{ processes: BackgroundProcess[] }>(`/api/processes?${new URLSearchParams({ database: target.database ?? '', schema: target.schema ?? '', table: target.table ?? '', type })}`).then((r) => r.processes)
}

export function getProcess(id: string, offset: number): Promise<{ process: BackgroundProcess; output: ProcessOutput }> {
  return api.get(`/api/processes/${id}?offset=${offset}`)
}

export function stopProcess(id: string): Promise<BackgroundProcess> {
  return api.post<{ process: BackgroundProcess }>(`/api/processes/${id}/stop`).then((r) => r.process)
}

export function dismissProcess(id: string): Promise<void> {
  return api.delete<{ ok: true }>(`/api/processes/${id}`).then(() => undefined)
}
