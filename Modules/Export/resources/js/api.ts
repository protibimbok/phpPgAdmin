import { api, ApiError, reportUnauthorized, type ApiErrorBody } from '@/api/request'

export type ExportScope = 'server' | 'database' | 'schema' | 'table' | 'query'

/** Where an export starts: nothing for the server, then a database, a schema, a relation; or a query's rows. */
export interface ExportTarget {
  database?: string
  schema?: string
  table?: string
  sql_query?: string
}

export interface ExportObject {
  name: string
  /** A relation's relkind, at the schema scope. */
  kind?: string
}

export interface ExportTemplate {
  id: number
  name: string
  data: Partial<ExportSettings>
}

export interface ExportOptions {
  scope: ExportScope
  /** The server's databases, the database's schemas, or the schema's relations. */
  objects: ExportObject[]
  encodings: string[]
  encoding: string
  filename_template: string
  server_major: number
  /** The pg_dump found, or null when there is none. */
  tools: { directory: string; version: string; usable: boolean; statistics: boolean; policies: boolean; toast_compression: boolean; table_access_method: boolean; psql: boolean } | null
  templates: ExportTemplate[]
}

/** The options of the Export form that a template keeps: everything but what is exported. */
export interface ExportSettings {
  method: 'quick' | 'custom'
  /** pg_dump's formats, CSV, CSV for MS Excel and tab-separated written by COPY, or HTML and XML read through a cursor. */
  format: 'plain' | 'custom' | 'tar' | 'directory' | 'csv' | 'excel' | 'tsv' | 'html' | 'xml'
  output: 'text' | 'file'
  filename_template: string
  encoding: string
  compression: 'none' | 'gzip'
  max_size: string
  header_comment: string
  /** At the server scope: the databases; elsewhere the schemas or relations, whose structure and data go in. */
  databases: string[]
  structure: string[]
  data: string[]
  contents: 'both' | 'structure' | 'data'
  globals: 'all' | 'globals' | 'roles' | 'tablespaces'
  large_objects: boolean
  data_style: 'copy' | 'insert'
  insert_syntax: 'neither' | 'columns' | 'multi' | 'both'
  rows_per_insert: string
  owner: boolean
  privileges: boolean
  comments: boolean
  tablespaces: boolean
  publications: boolean
  subscriptions: boolean
  security_labels: boolean
  policies: boolean
  unlogged_data: boolean
  role_passwords: boolean
  create: boolean
  clean: boolean
  if_exists: boolean
  statistics: boolean
  set_session_authorization: boolean
  quote_all_identifiers: boolean
  disable_dollar_quoting: boolean
  serializable_deferrable: boolean
  disable_triggers: boolean
  load_via_partition_root: boolean
  on_conflict_do_nothing: boolean
  csv_separator: string
  csv_enclosed: string
  csv_escaped: string
  csv_terminated: string
  csv_null: string
  csv_remove_crlf: boolean
  csv_columns: boolean
  excel_null: string
  excel_remove_crlf: boolean
  excel_columns: boolean
  excel_edition: 'win' | 'mac_excel2003' | 'mac_excel2008'
  tsv_null: string
  tsv_columns: boolean
  htmlword_columns: boolean
  htmlword_null: string
  /** pg_dump's parallel jobs, for the directory format. */
  jobs: string
  /** pg_dump's sections: pre-data, data and post-data. */
  sections: ('pre-data' | 'data' | 'post-data')[]
  /** pg_dump patterns of the schemas a database export leaves out, separated by commas. */
  exclude_schemas: string
  extra_float_digits: string
  lock_wait_timeout: string
  verbose: boolean
  enable_row_security: boolean
  toast_compression: boolean
  table_access_method: boolean
}

const query = (target: Record<string, string | undefined>) => new URLSearchParams(Object.entries(target).filter((entry): entry is [string, string] => typeof entry[1] === 'string')).toString()

export function exportOptions(target: ExportTarget, scope?: ExportScope): Promise<ExportOptions> {
  const { sql_query: _sql, ...where } = target

  return api.get<ExportOptions>(`/api/export/options?${query(scope === 'query' ? { ...where, scope } : where)}`)
}

export function createTemplate(type: ExportScope, name: string, data: Partial<ExportSettings>): Promise<ExportTemplate> {
  return api.post<{ template: ExportTemplate }>('/api/export/templates', { type, name, data }).then((r) => r.template)
}

export function updateTemplate(id: number, data: Partial<ExportSettings>): Promise<ExportTemplate> {
  return api.put<{ template: ExportTemplate }>(`/api/export/templates/${id}`, { data }).then((r) => r.template)
}

export function deleteTemplate(id: number): Promise<void> {
  return api.delete<{ ok: true }>(`/api/export/templates/${id}`).then(() => undefined)
}

let frameCount = 0

/**
 * Start the export as a download. The form is posted into a hidden frame so that the browser
 * saves the attachment as it streams in, as phpMyAdmin's export form does with the page itself.
 * A response that is not an attachment (an error, which comes before any output) loads into the
 * frame instead; it is read from there and handed to onError.
 */
export function downloadExport(request: Record<string, unknown>, onError: (error: ApiError) => void): void {
  const name = `export-frame-${++frameCount}`
  const frame = document.createElement('iframe')
  frame.name = name
  frame.hidden = true
  const form = document.createElement('form')
  form.method = 'post'
  form.action = '/api/export'
  form.target = name
  form.hidden = true
  const field = document.createElement('input')
  field.type = 'hidden'
  field.name = 'options'
  field.value = JSON.stringify(request)
  form.appendChild(field)

  // A download never fires "load", and removing the frame before the response has begun would
  // cancel it, so the frame stays until it shows an error.
  frame.addEventListener('load', () => {
    // The empty document a new frame starts with loads too.
    if (frame.contentWindow?.location.href === 'about:blank') return
    const text = frame.contentDocument?.body?.textContent ?? ''
    let body: ApiErrorBody
    try {
      body = JSON.parse(text) as ApiErrorBody
    } catch {
      body = { message: text.trim() }
    }
    frame.remove()
    const error = new ApiError(body.status_code ?? 500, body, 'The export failed.')
    // A session that ran out shows the login page, as a 401 on any other call does.
    reportUnauthorized(error)
    onError(error)
  })
  document.body.append(frame, form)
  form.submit()
  form.remove()
}

/** The export's plain SQL or CSV, for "View output as text". */
export async function exportText(request: Record<string, unknown>): Promise<string> {
  const response = await fetch('/api/export', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'text/plain, application/json' },
    body: JSON.stringify({ ...request, output: 'text' }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody
    const error = new ApiError(response.status, body, response.statusText || 'The export failed.')
    reportUnauthorized(error)
    throw error
  }

  return response.text()
}
