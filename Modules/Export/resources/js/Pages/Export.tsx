import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useLocation, useParams, useSearchParams } from 'react-router'
import { errorMessage, type ApiError } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { notify, notifyError, notifySuccess } from '@/notify'
import { preference } from '@/preferences'
import { createTemplate, deleteTemplate, downloadExport, exportOptions, exportText, updateTemplate, type ExportObject, type ExportOptions, type ExportScope, type ExportSettings, type ExportTarget, type ExportTemplate } from '../api'
import { COMPRESSION, FORMAT, METHOD } from '../preferences'

const DEFAULTS: Omit<ExportSettings, 'filename_template' | 'encoding' | 'databases' | 'structure' | 'data'> = {
  method: 'quick',
  format: 'plain',
  output: 'file',
  compression: 'none',
  max_size: '',
  header_comment: '',
  contents: 'both',
  globals: 'all',
  large_objects: true,
  data_style: 'copy',
  insert_syntax: 'both',
  rows_per_insert: '100',
  owner: true,
  privileges: true,
  comments: true,
  tablespaces: true,
  publications: true,
  subscriptions: true,
  security_labels: true,
  policies: true,
  unlogged_data: true,
  role_passwords: true,
  create: false,
  clean: false,
  if_exists: false,
  statistics: false,
  set_session_authorization: false,
  quote_all_identifiers: false,
  disable_dollar_quoting: false,
  serializable_deferrable: false,
  disable_triggers: false,
  load_via_partition_root: false,
  on_conflict_do_nothing: false,
  csv_separator: ',',
  csv_enclosed: '"',
  csv_escaped: '"',
  csv_terminated: 'AUTO',
  csv_null: 'NULL',
  csv_remove_crlf: false,
  csv_columns: true,
  excel_null: 'NULL',
  excel_remove_crlf: false,
  excel_columns: true,
  excel_edition: 'win',
  tsv_null: '\\N',
  tsv_columns: true,
  htmlword_columns: true,
  htmlword_null: 'NULL',
  jobs: '1',
  sections: ['pre-data', 'data', 'post-data'],
  exclude_schemas: '',
  extra_float_digits: '',
  lock_wait_timeout: '',
  verbose: false,
  enable_row_security: false,
  toast_compression: true,
  table_access_method: true,
}

const SECTIONS = ['pre-data', 'data', 'post-data'] as const

/** What a query's rows can be exported as. */
const QUERY_FORMATS: ExportSettings['format'][] = ['plain', 'csv', 'excel', 'tsv', 'html', 'xml']

/** The formats written as rows of data only: COPY's CSV and text, and the HTML and XML read through a cursor. */
const DATA_FORMATS: ExportSettings['format'][] = ['csv', 'excel', 'tsv', 'html', 'xml']

type Flag = { [K in keyof ExportSettings]: ExportSettings[K] extends boolean ? K : never }[keyof ExportSettings]

/** Relation kinds with rows of their own; a view's structure is all there is to export. */
const WITH_DATA = ['r', 'p', 'm', 'S']

const FILENAME_KEY = (scope: ExportScope) => `pgaExportFilename.${scope}`

function rememberedFilename(scope: ExportScope): string | null {
  try {
    return localStorage.getItem(FILENAME_KEY(scope))
  } catch {
    return null
  }
}

/** The role's default format, where the scope offers it: archives and CSV need a database, HTML and XML a table. */
function preferredFormat(scope: ExportScope): ExportSettings['format'] {
  const format = preference<ExportSettings['format']>(FORMAT)
  if (scope === 'server') return 'plain'
  if (scope === 'query') return QUERY_FORMATS.includes(format) ? format : 'plain'
  if ((format === 'html' || format === 'xml') && scope !== 'table') return 'plain'

  return format
}

/**
 * The Export page of every level, laid out like phpMyAdmin's export.twig with
 * server/database/table/export/index.twig's selection card: the export templates, Quick or
 * Custom, the format, what to export, the output, and the format's options: pg_dump's (and
 * pg_dumpall's for the server), or CSV's, which COPY writes. The export downloads as it is
 * written, or shows as text. The query scope exports the rows of one statement, which comes in
 * the navigation state (or ?sql=) from the SQL page's results.
 */
export default function Export({ scope }: { scope: ExportScope }) {
  const params = useParams()
  const [search] = useSearchParams()
  const location = useLocation()
  const sql = scope === 'query' ? ((location.state as { sql?: string } | null)?.sql ?? search.get('sql') ?? '') : ''
  const target: ExportTarget =
    scope === 'server' ? {} : scope === 'query' ? { database: params.db, sql_query: sql } : scope === 'database' ? { database: params.db } : scope === 'schema' ? { database: params.db, schema: params.schema } : { database: params.db, schema: params.schema, table: params.table }
  const { data: options, error } = useRequest(() => exportOptions(target, scope), [scope, params.db, params.schema, params.table])

  if (scope === 'query' && sql.trim() === '') {
    return (
      <div className="container">
        <div className="alert alert-primary my-3" role="alert">
          <Icon name="s_notice" /> <QueryMissing />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container">
        <div className="alert alert-danger my-3" role="alert">
          {error.message}
        </div>
      </div>
    )
  }
  if (!options) return null

  // Tables ticked on the schema's Structure page ("With selected: Export") come in the URL.
  const preselected = search.getAll('table')

  return <ExportForm key={`${scope}:${params.db}:${params.schema}:${params.table}`} scope={scope} target={target} options={options} preselected={preselected} />
}

function ExportForm({ scope, target, options, preselected }: { scope: ExportScope; target: ExportTarget; options: ExportOptions; preselected: string[] }) {
  const { t } = useTranslation('export')
  const names = options.objects.map((object) => object.name)
  const initialSelection = preselected.length > 0 ? names.filter((name) => preselected.includes(name)) : names
  const [settings, setSettings] = useState<ExportSettings>(() => ({
    ...DEFAULTS,
    // The role's defaults, where the scope offers them: pg_dump's archives and CSV need a database.
    method: preselected.length > 0 ? 'custom' : preference<ExportSettings['method']>(METHOD),
    contents: scope === 'query' ? 'data' : DEFAULTS.contents,
    format: preferredFormat(scope),
    compression: preference<ExportSettings['compression']>(COMPRESSION),
    filename_template: rememberedFilename(scope) ?? options.filename_template,
    encoding: options.encoding,
    databases: names,
    structure: initialSelection,
    data: initialSelection.filter((name) => dataOf(options.objects.find((object) => object.name === name))),
  }))
  const [rememberFilename, setRememberFilename] = useState(true)
  const [templates, setTemplates] = useState<ExportTemplate[]>(options.templates)
  const [templateName, setTemplateName] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [text, setText] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (text !== null) textRef.current?.scrollIntoView({ block: 'start' })
  }, [text])

  const set = <K extends keyof ExportSettings>(key: K, value: ExportSettings[K]) => setSettings((current) => ({ ...current, [key]: value }))
  const custom = settings.method === 'custom'
  const plain = settings.format === 'plain'
  // CSV is data only, as in phpMyAdmin: what is ticked under Data goes in. So are tab-separated, HTML and XML.
  const csv = DATA_FORMATS.includes(settings.format)
  // HTML and XML are read through a cursor here, without the client programs.
  const rowFormat = settings.format === 'html' || settings.format === 'xml' || (scope === 'query' && settings.format === 'plain')
  const query = scope === 'query'
  // pg_dump writes a directory archive as files, which download as one tar file and never as text.
  const directory = settings.format === 'directory'
  const asText = settings.output === 'text' && !directory
  const tools = options.tools
  const toolsProblem = rowFormat ? null : tools === null ? t('tools.missing') : csv ? (tools.psql ? null : t('tools.no_psql', { directory: tools.directory })) : tools.usable ? null : t('tools.too_old', { version: tools.version, server: options.server_major })

  // What the selection adds up to at the database and schema scopes, as the server reads it.
  const contents: ExportSettings['contents'] = scope === 'database' || scope === 'schema' ? (settings.structure.length === 0 ? 'data' : settings.data.length === 0 ? 'structure' : 'both') : settings.contents

  function dataOf(object: ExportObject | undefined): boolean {
    return object !== undefined && (object.kind === undefined || WITH_DATA.includes(object.kind))
  }

  /** The settings a template keeps: the objects ticked are the page's, not the template's, unless they exist here. */
  function apply(template: ExportTemplate) {
    const data = template.data
    setSettings((current) => ({
      ...current,
      ...data,
      databases: data.databases ? data.databases.filter((name) => names.includes(name)) : current.databases,
      structure: data.structure ? data.structure.filter((name) => names.includes(name)) : current.structure,
      data: data.data ? data.data.filter((name) => names.includes(name)) : current.data,
    }))
  }

  /** The request for the server: the target, and in Custom mode every option the page shows. */
  function request(): Record<string, unknown> {
    if (!custom) return { ...target, format: settings.format }
    const { method: _method, output: _output, databases, structure, data, ...rest } = settings
    const selection = scope === 'server' ? { databases } : scope === 'database' || scope === 'schema' ? { structure, data } : {}

    return { ...target, ...rest, ...selection }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (running) return
    if (toolsProblem !== null) {
      notifyError(toolsProblem)

      return
    }
    if (custom && rememberFilename) {
      try {
        localStorage.setItem(FILENAME_KEY(scope), settings.filename_template)
      } catch {
        // The template is remembered where the browser allows it.
      }
    }
    if (custom && asText) {
      setRunning(true)
      exportText(request()).then(
        (output) => {
          setText(output)
          setRunning(false)
        },
        (err: unknown) => {
          setRunning(false)
          notifyError(describe(err))
        },
      )

      return
    }
    setText(null)
    downloadExport(request(), (err) => notifyError(describe(err)))
  }

  function describe(err: unknown): string {
    const detail = (err as Partial<ApiError>).detail

    return detail ? `${errorMessage(err)}\n${detail}` : errorMessage(err)
  }

  async function saveTemplate(e: FormEvent) {
    e.preventDefault()
    try {
      const template = await createTemplate(scope, templateName.trim(), templateData())
      setTemplates((list) => [...list, template].sort((a, b) => a.name.localeCompare(b.name)))
      setTemplateId(String(template.id))
      setTemplateName('')
      notifySuccess(t('templates.created'))
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  async function overwriteTemplate() {
    if (templateId === '') return notify(t('templates.none_selected'), 'error')
    try {
      const template = await updateTemplate(Number(templateId), templateData())
      setTemplates((list) => list.map((entry) => (entry.id === template.id ? template : entry)))
      notifySuccess(t('templates.updated'))
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  async function removeTemplate() {
    if (templateId === '') return notify(t('templates.none_selected'), 'error')
    try {
      await deleteTemplate(Number(templateId))
      setTemplates((list) => list.filter((entry) => String(entry.id) !== templateId))
      setTemplateId('')
      notifySuccess(t('templates.deleted'))
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  function templateData(): Partial<ExportSettings> {
    return { ...settings }
  }

  const title = {
    server: t('title.server'),
    database: t('title.database', { name: target.database }),
    schema: t('title.schema', { name: target.schema }),
    table: t('title.table', { name: target.table }),
    query: t('title.query'),
  }[scope]

  const formats: { value: ExportSettings['format']; label: string }[] = query ? QUERY_FORMATS.map((value) => ({ value, label: t(`format.${value}`) })) : [
    { value: 'plain', label: t('format.plain') },
    ...(scope === 'server'
      ? []
      : [
          { value: 'custom' as const, label: t('format.custom') },
          { value: 'tar' as const, label: t('format.tar') },
          { value: 'directory' as const, label: t('format.directory') },
          { value: 'csv' as const, label: t('format.csv') },
          { value: 'excel' as const, label: t('format.excel') },
          { value: 'tsv' as const, label: t('format.tsv') },
          ...(scope === 'table'
            ? [
                { value: 'html' as const, label: t('format.html') },
                { value: 'xml' as const, label: t('format.xml') },
              ]
            : []),
        ]),
  ]

  // The field names of phpMyAdmin's plugins: sql_*, and csv_* and excel_* as they are spelled there.
  const field = (key: Flag) => (key.startsWith('csv_') || key.startsWith('excel_') ? key.replace('remove_crlf', 'removeCRLF') : key.startsWith('tsv_') || key.startsWith('htmlword_') ? key : `sql_${key}`)
  const toggle = (key: Flag, label: ReactNode, children?: ReactNode) => (
    <li className="list-group-item">
      <div className="form-check form-switch">
        <input className="form-check-input" type="checkbox" role="switch" name={field(key)} id={`checkbox_${field(key)}`} checked={settings[key]} onChange={(e) => set(key, e.target.checked)} />
        <label className="form-check-label" htmlFor={`checkbox_${field(key)}`}>
          {label}
        </label>
      </div>
      {children}
    </li>
  )
  const code = { code: <code /> }
  const label = (key: string) => <Trans t={t} i18nKey={key} components={code} />

  return (
    <div className="container">
      <h2 className="my-3">
        <Icon name="b_export" /> {title}
      </h2>

      {toolsProblem !== null && (
        <div className="alert alert-danger" role="alert">
          {toolsProblem}
        </div>
      )}

      {query && (
        <div className="card mb-3" id="export_query">
          <div className="card-header">{t('query.title')}</div>
          <div className="card-body">
            <pre className="mb-0 text-wrap" dir="ltr">
              <code>{target.sql_query}</code>
            </pre>
          </div>
        </div>
      )}

      {!query && (
        <div className="card mb-3">
          <div className="card-header">{t('templates.title')}</div>
          <div className="card-body row gy-3">
            <form className="col-12 col-md" onSubmit={(e) => void saveTemplate(e)}>
              <fieldset>
                <legend>{t('templates.new')}</legend>
                <div className="row g-3 align-items-center">
                  <div className="col-auto">
                    <label htmlFor="templateName" className="col-form-label">
                      {t('templates.name')}
                    </label>
                  </div>
                  <div className="col-auto">
                    <input className="form-control" type="text" name="templateName" id="templateName" maxLength={64} placeholder={t('templates.name')} required value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
                  </div>
                  <div className="col-auto">
                    <input className="btn btn-secondary" type="submit" name="createTemplate" id="createTemplate" value={t('templates.create')} />
                  </div>
                </div>
              </fieldset>
            </form>

            <form
              className="col-12 col-md"
              id="existingTemplatesForm"
              onSubmit={(e) => {
                e.preventDefault()
                // Update and Delete are both the form's submit buttons, as in phpMyAdmin.
                const submitter = (e.nativeEvent as SubmitEvent).submitter
                void (submitter?.id === 'deleteTemplate' ? removeTemplate() : overwriteTemplate())
              }}
            >
              <fieldset>
                <legend>{t('templates.existing')}</legend>
                <div className="row g-3 align-items-center">
                  <div className="col-auto">
                    <label htmlFor="template" className="col-form-label">
                      {t('templates.template')}
                    </label>
                  </div>
                  <div className="col-auto">
                    <select
                      className="form-select"
                      name="template"
                      id="template"
                      required
                      value={templateId}
                      onChange={(e) => {
                        setTemplateId(e.target.value)
                        const template = templates.find((entry) => String(entry.id) === e.target.value)
                        if (template) apply(template)
                      }}
                    >
                      <option value="">-- {t('templates.select')} --</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-auto">
                    <input className="btn btn-secondary" type="submit" name="updateTemplate" id="updateTemplate" value={t('templates.update')} />
                  </div>
                  <div className="col-auto">
                    <input className="btn btn-secondary" type="submit" name="deleteTemplate" id="deleteTemplate" value={t('templates.delete')} />
                  </div>
                </div>
              </fieldset>
            </form>
          </div>
        </div>
      )}

      <form method="post" name="dump" onSubmit={submit}>
        <div className="card mb-3" id="quick_or_custom">
          <div className="card-header">{t('method.title')}</div>
          <div className="card-body">
            <div className="form-check">
              <input className="form-check-input" type="radio" name="quick_or_custom" value="quick" id="radio_quick_export" checked={!custom} onChange={() => set('method', 'quick')} />
              <label className="form-check-label" htmlFor="radio_quick_export">
                {t('method.quick')}
              </label>
            </div>
            <div className="form-check">
              <input className="form-check-input" type="radio" name="quick_or_custom" value="custom" id="radio_custom_export" checked={custom} onChange={() => set('method', 'custom')} />
              <label className="form-check-label" htmlFor="radio_custom_export">
                {t('method.custom')}
              </label>
            </div>
          </div>
        </div>

        <div className="card mb-3" id="format">
          <div className="card-header">{t('format.title')}</div>
          <div className="card-body">
            <select className="form-select" id="plugins" name="what" aria-label={t('format.aria')} value={settings.format} onChange={(e) => set('format', e.target.value as ExportSettings['format'])}>
              {formats.map((format) => (
                <option key={format.value} value={format.value}>
                  {format.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {custom && scope === 'server' && <DatabaseSelection databases={names} selected={settings.databases} onChange={(databases) => set('databases', databases)} />}
        {custom && (scope === 'database' || scope === 'schema') && (
          <ObjectSelection scope={scope} objects={options.objects} structure={settings.structure} data={settings.data} dataOnly={csv} hasData={dataOf} onChange={(structure, data) => setSettings((current) => ({ ...current, structure, data }))} />
        )}

        {custom && (
          <div className="card mb-3" id="output">
            <div className="card-header">{t('output.title')}</div>
            <ul className="list-group list-group-flush">
              <li className="list-group-item">
                {!directory && (
                  <div className="form-check">
                    <input className="form-check-input" type="radio" id="radio_view_as_text" name="output_format" value="astext" checked={asText} onChange={() => set('output', 'text')} />
                    <label className="form-check-label" htmlFor="radio_view_as_text">
                      {t('output.as_text')}
                    </label>
                  </div>
                )}
                <div className="form-check mb-2">
                  <input className="form-check-input" type="radio" name="output_format" value="sendit" id="radio_dump_asfile" checked={!asText} onChange={() => set('output', 'file')} />
                  <label className="form-check-label" htmlFor="radio_dump_asfile">
                    {t('output.as_file')}
                  </label>
                </div>
                {!asText && (
                  <div className="hstack gap-3">
                    <div className="vr"></div>
                    <ul className="list-group" id="ul_save_asfile">
                      <li className="list-group-item">
                        <div className="row g-3 align-items-center">
                          <div className="col-auto">
                            <label htmlFor="filename_template" className="col-form-label">
                              {t('output.filename')} <Icon name="b_help" title={t(`output.filename_hint.${scope}`)} />
                            </label>
                          </div>
                          <div className="col-auto">
                            <input type="text" className="form-control" name="filename_template" id="filename_template" value={settings.filename_template} onChange={(e) => set('filename_template', e.target.value)} />
                          </div>
                          <div className="col-auto">
                            <div className="form-check form-switch">
                              <input className="form-check-input" type="checkbox" role="switch" name="remember_template" id="checkbox_remember_template" checked={rememberFilename} onChange={(e) => setRememberFilename(e.target.checked)} />
                              <label className="form-check-label" htmlFor="checkbox_remember_template">
                                {t('output.remember')}
                              </label>
                            </div>
                          </div>
                        </div>
                      </li>
                      <li className="list-group-item">
                        <div className="row">
                          <div className="col-auto">
                            <label htmlFor="select_charset" className="col-form-label">
                              {t('output.charset')}
                            </label>
                          </div>
                          <div className="col-auto">
                            <select className="form-select" id="select_charset" name="charset" value={settings.encoding} onChange={(e) => set('encoding', e.target.value)}>
                              {options.encodings.map((encoding) => (
                                <option key={encoding} value={encoding}>
                                  {encoding}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </li>
                      <li className="list-group-item">
                        <div className="row">
                          <div className="col-auto">
                            <label htmlFor="compression" className="col-form-label">
                              {t('output.compression')}
                            </label>
                          </div>
                          <div className="col-auto">
                            <select className="form-select" id="compression" name="compression" value={settings.compression} onChange={(e) => set('compression', e.target.value as ExportSettings['compression'])}>
                              <option value="none">{t('output.none')}</option>
                              <option value="gzip">{t('output.gzip')}</option>
                            </select>
                          </div>
                        </div>
                      </li>
                      {directory && (
                        <li className="list-group-item">
                          <div className="row">
                            <div className="col-auto">
                              <label htmlFor="text_jobs" className="col-form-label">
                                {t('output.jobs')}
                              </label>
                            </div>
                            <div className="col-auto">
                              <input className="form-control" type="number" min={1} max={64} id="text_jobs" name="jobs" aria-describedby="jobsHelp" value={settings.jobs} onChange={(e) => set('jobs', e.target.value)} />
                            </div>
                          </div>
                          <div id="jobsHelp" className="form-text">
                            {t('output.jobs_help')}
                          </div>
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </li>

              {scope !== 'server' && !query && (
                <li className="list-group-item">
                  <label htmlFor="maxsize" className="form-label">
                    {t('output.max_size')}
                  </label>
                  <input className="form-control" type="number" min={0} step="any" id="maxsize" name="maxsize" aria-describedby="maxsizeHelp" value={settings.max_size} onChange={(e) => set('max_size', e.target.value)} />
                  <div id="maxsizeHelp" className="form-text">
                    {t('output.max_size_help')}
                  </div>
                </li>
              )}
            </ul>
          </div>
        )}

        {custom && (
          <div className="card mb-3" id="format_specific_opts">
            <div className="card-header">{t('options.title')}</div>
            <div className="card-body">
              {settings.format === 'csv' && (
                <div id="csv_options" className="format_specific_options">
                  <div id="csv_general_opts">
                    <ul className="list-group">
                      {(['separator', 'enclosed', 'escaped', 'terminated', 'null'] as const).map((key) => (
                        <li className="list-group-item" key={key}>
                          <label htmlFor={`text_csv_${key}`} className="form-label">
                            {t(`csv.${key}`)}
                          </label>
                          <input className="form-control" type="text" name={`csv_${key}`} id={`text_csv_${key}`} value={settings[`csv_${key}`]} onChange={(e) => set(`csv_${key}`, e.target.value)} />
                        </li>
                      ))}
                      {toggle('csv_remove_crlf', t('csv.remove_crlf'))}
                      {toggle('csv_columns', t('csv.columns'))}
                    </ul>
                  </div>
                </div>
              )}
              {settings.format === 'excel' && (
                <div id="excel_options" className="format_specific_options">
                  <div id="excel_general_opts">
                    <ul className="list-group">
                      <li className="list-group-item">
                        <label htmlFor="text_excel_null" className="form-label">
                          {t('csv.null')}
                        </label>
                        <input className="form-control" type="text" name="excel_null" id="text_excel_null" value={settings.excel_null} onChange={(e) => set('excel_null', e.target.value)} />
                      </li>
                      {toggle('excel_remove_crlf', t('csv.remove_crlf'))}
                      {toggle('excel_columns', t('csv.columns'))}
                      <li className="list-group-item">
                        <label htmlFor="select_excel_edition" className="form-label">
                          {t('csv.edition')}
                        </label>
                        <select className="form-select" name="excel_edition" id="select_excel_edition" value={settings.excel_edition} onChange={(e) => set('excel_edition', e.target.value as ExportSettings['excel_edition'])}>
                          <option value="win">{t('csv.edition_win')}</option>
                          <option value="mac_excel2003">{t('csv.edition_mac_excel2003')}</option>
                          <option value="mac_excel2008">{t('csv.edition_mac_excel2008')}</option>
                        </select>
                      </li>
                    </ul>
                  </div>
                </div>
              )}
              {settings.format === 'tsv' && (
                <div id="tsv_options" className="format_specific_options">
                  <ul className="list-group">
                    <li className="list-group-item">
                      <label htmlFor="text_tsv_null" className="form-label">
                        {t('csv.null')}
                      </label>
                      <input className="form-control" type="text" name="tsv_null" id="text_tsv_null" value={settings.tsv_null} onChange={(e) => set('tsv_null', e.target.value)} />
                    </li>
                    {toggle('tsv_columns', t('csv.columns'))}
                  </ul>
                </div>
              )}
              {settings.format === 'html' && (
                <div id="htmlword_options" className="format_specific_options">
                  <ul className="list-group">
                    <li className="list-group-item">
                      <label htmlFor="text_htmlword_null" className="form-label">
                        {t('csv.null')}
                      </label>
                      <input className="form-control" type="text" name="htmlword_null" id="text_htmlword_null" value={settings.htmlword_null} onChange={(e) => set('htmlword_null', e.target.value)} />
                    </li>
                    {toggle('htmlword_columns', t('csv.columns'))}
                  </ul>
                </div>
              )}
              {settings.format === 'xml' && (
                <div id="xml_options" className="format_specific_options">
                  <p className="card-text">{t('options.xml_none')}</p>
                </div>
              )}
              {!csv && (
                <div id="sql_options" className="format_specific_options">
                  <div id="sql_general_opts">
                    <ul className="list-group">
                      {plain && (
                        <li className="list-group-item">
                          <label htmlFor="text_sql_header_comment" className="form-label">
                            {t('options.header_comment')}
                          </label>
                          <input className="form-control" type="text" name="sql_header_comment" id="text_sql_header_comment" value={settings.header_comment} onChange={(e) => set('header_comment', e.target.value)} />
                        </li>
                      )}
                      {scope === 'server' && (
                        <li className="list-group-item">
                          {t('options.globals.title')}
                          <ul className="list-group" id="ul_globals">
                            {(['all', 'globals', 'roles', 'tablespaces'] as const).map((value) => (
                              <li className="list-group-item" key={value}>
                                <div className="form-check">
                                  <input className="form-check-input" type="radio" name="sql_globals" id={`radio_sql_globals_${value}`} value={value} checked={settings.globals === value} onChange={() => set('globals', value)} />
                                  <label className="form-check-label" htmlFor={`radio_sql_globals_${value}`}>
                                    {t(`options.globals.${value}`)}
                                  </label>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </li>
                      )}
                      {(scope === 'server' || scope === 'table') && (
                        <li className="list-group-item">
                          {t(scope === 'server' ? 'options.contents.title_databases' : 'options.contents.title_table')}
                          <ul className="list-group" id="ul_structure_or_data">
                            {(['structure', 'data', 'both'] as const).map((value) => (
                              <li className="list-group-item" key={value}>
                                <div className="form-check">
                                  <input className="form-check-input" type="radio" name="sql_structure_or_data" id={`radio_sql_structure_or_data_${value}`} value={value} checked={settings.contents === value} onChange={() => set('contents', value)} />
                                  <label className="form-check-label" htmlFor={`radio_sql_structure_or_data_${value}`}>
                                    {t(`options.contents.${value}`)}
                                  </label>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </li>
                      )}
                      {scope !== 'server' && !query && (
                        <li className="list-group-item">
                          {t('options.sections.title')}
                          <ul className="list-group" id="ul_sections">
                            {SECTIONS.map((section) => (
                              <li className="list-group-item" key={section}>
                                <div className="form-check">
                                  <input
                                    className="form-check-input"
                                    type="checkbox"
                                    name="sql_sections[]"
                                    id={`checkbox_sql_section_${section}`}
                                    value={section}
                                    checked={settings.sections.includes(section)}
                                    onChange={(e) => set('sections', SECTIONS.filter((entry) => (entry === section ? e.target.checked : settings.sections.includes(entry))))}
                                  />
                                  <label className="form-check-label" htmlFor={`checkbox_sql_section_${section}`}>
                                    {label(`options.sections.${section}`)}
                                  </label>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </li>
                      )}
                      {scope === 'database' && (
                        <li className="list-group-item">
                          <label htmlFor="text_sql_exclude_schemas" className="form-label">
                            {label('options.exclude_schemas')}
                          </label>
                          <input className="form-control" type="text" name="sql_exclude_schemas" id="text_sql_exclude_schemas" aria-describedby="excludeSchemasHelp" value={settings.exclude_schemas} onChange={(e) => set('exclude_schemas', e.target.value)} />
                          <div id="excludeSchemasHelp" className="form-text">
                            {t('options.exclude_schemas_help')}
                          </div>
                        </li>
                      )}
                      {!query && (
                        <li className="list-group-item">
                          <label htmlFor="text_sql_lock_wait_timeout" className="form-label">
                            {t('options.lock_wait_timeout')}
                          </label>
                          <input className="form-control" type="text" name="sql_lock_wait_timeout" id="text_sql_lock_wait_timeout" aria-describedby="lockWaitHelp" value={settings.lock_wait_timeout} onChange={(e) => set('lock_wait_timeout', e.target.value)} />
                          <div id="lockWaitHelp" className="form-text">
                            {t('options.lock_wait_timeout_help')}
                          </div>
                        </li>
                      )}
                      {scope !== 'server' && !query && contents !== 'structure' && toggle('serializable_deferrable', label('options.serializable_deferrable'))}
                      {!query && toggle('quote_all_identifiers', label('options.quote_all_identifiers'))}
                      {!query && toggle('disable_dollar_quoting', label('options.disable_dollar_quoting'))}
                      {!query && toggle('verbose', label('options.verbose'))}
                    </ul>
                  </div>

                  {contents !== 'data' && (
                    <div id="sql_structure">
                      <h5 className="card-title mt-4 mb-2">{t('options.structure_title')}</h5>
                      <ul className="list-group">
                        <li className="list-group-item">{t('options.add_statements')}</li>
                        <li className="list-group-item">
                          <ul className="list-group" id="ul_add_statements">
                            {scope === 'database' && plain && toggle('create', label('options.create'))}
                            {plain &&
                              toggle(
                                'clean',
                                label('options.clean'),
                                settings.clean && <ul className="list-group mt-2">{toggle('if_exists', label('options.if_exists'))}</ul>,
                              )}
                            {plain &&
                              toggle(
                                'owner',
                                label('options.owner'),
                                settings.owner && <ul className="list-group mt-2">{toggle('set_session_authorization', label('options.set_session_authorization'))}</ul>,
                              )}
                            {toggle('privileges', label('options.privileges'))}
                            {toggle('comments', label('options.comments'))}
                            {toggle('tablespaces', label('options.tablespaces'))}
                            {toggle('security_labels', label('options.security_labels'))}
                            {tools?.policies !== false && toggle('policies', label('options.policies'))}
                            {(scope === 'server' || scope === 'database') && toggle('publications', label('options.publications'))}
                            {(scope === 'server' || scope === 'database') && toggle('subscriptions', label('options.subscriptions'))}
                            {scope === 'server' && toggle('role_passwords', label('options.role_passwords'))}
                            {tools?.toast_compression !== false && toggle('toast_compression', label('options.toast_compression'))}
                            {tools?.table_access_method !== false && toggle('table_access_method', label('options.table_access_method'))}
                            {tools?.statistics !== false && contents === 'both' && toggle('statistics', label('options.statistics'))}
                          </ul>
                        </li>
                      </ul>
                    </div>
                  )}

                  {contents !== 'structure' && (
                    <div id="sql_data">
                      <h5 className="card-title mt-4 mb-2">{t('options.data_title')}</h5>
                      <ul className="list-group">
                        {contents === 'data' && !query && toggle('disable_triggers', label('options.disable_triggers'))}
                        {!query && toggle('unlogged_data', label('options.unlogged_data'))}
                        {(scope === 'database' || scope === 'schema') && toggle('large_objects', label('options.large_objects'))}
                        {!query && toggle('load_via_partition_root', label('options.load_via_partition_root'))}
                        {!query && toggle('enable_row_security', label('options.enable_row_security'))}
                        {!query && (
                          <li className="list-group-item">
                            <label htmlFor="text_sql_extra_float_digits" className="form-label">
                              {label('options.extra_float_digits')}
                            </label>
                            <input className="form-control" type="number" min={-15} max={3} name="sql_extra_float_digits" id="text_sql_extra_float_digits" value={settings.extra_float_digits} onChange={(e) => set('extra_float_digits', e.target.value)} />
                          </li>
                        )}
                        <li className="list-group-item">
                          <label htmlFor="select_sql_type" className="form-label">
                            {t('options.data_style')}
                          </label>
                          <select className="form-select" name="sql_type" id="select_sql_type" value={settings.data_style} onChange={(e) => set('data_style', e.target.value as ExportSettings['data_style'])}>
                            <option value="copy">COPY</option>
                            <option value="insert">INSERT</option>
                          </select>
                        </li>
                        {settings.data_style === 'insert' && (
                          <>
                            {toggle('on_conflict_do_nothing', label('options.on_conflict_do_nothing'))}
                            <li className="list-group-item">
                              {t('options.syntax.title')}
                              <ul className="list-group" id="ul_insert_syntax">
                                {(['columns', 'multi', 'both', 'neither'] as const).map((value) => (
                                  <li className="list-group-item" key={value}>
                                    <div className="form-check">
                                      <input className="form-check-input" type="radio" name="sql_insert_syntax" id={`radio_sql_insert_syntax_${value}`} value={value} checked={settings.insert_syntax === value} onChange={() => set('insert_syntax', value)} />
                                      <label className="form-check-label" htmlFor={`radio_sql_insert_syntax_${value}`}>
                                        {label(`options.syntax.${value}`)}
                                        <br />
                                        {t('options.syntax.example')} <code>{t(`options.syntax.example_${value}`)}</code>
                                      </label>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </li>
                            {(settings.insert_syntax === 'multi' || settings.insert_syntax === 'both') && (
                              <li className="list-group-item">
                                <label htmlFor="text_sql_rows_per_insert" className="form-label">
                                  {t('options.rows_per_insert')}
                                </label>
                                <input className="form-control" type="number" min={1} name="sql_rows_per_insert" id="text_sql_rows_per_insert" value={settings.rows_per_insert} onChange={(e) => set('rows_per_insert', e.target.value)} />
                              </li>
                            )}
                          </>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div id="submit">
          <input id="buttonGo" className="btn btn-primary" type="submit" value={t('export')} />
        </div>
      </form>

      {text !== null && (
        <div className="card my-3">
          <div className="card-header">{t('output.text_title')}</div>
          <div className="card-body">
            <textarea ref={textRef} id="textSQLDUMP" className="form-control font-monospace" rows={30} readOnly value={text} />
          </div>
        </div>
      )}
    </div>
  )
}

/** What the query export page says when it is opened without a statement. */
function QueryMissing() {
  const { t } = useTranslation('export')

  return <>{t('query.missing')}</>
}

/** server/export/index.twig's Databases card: a multiple select with Select all / Unselect all. */
function DatabaseSelection({ databases, selected, onChange }: { databases: string[]; selected: string[]; onChange: (selected: string[]) => void }) {
  const { t } = useTranslation('export')

  return (
    <div className="card mb-3" id="databases_and_tables">
      <div className="card-header">{t('selection.databases')}</div>
      <div className="card-body">
        <div className="mb-3">
          <button type="button" className="btn btn-secondary" id="db_select_all" onClick={() => onChange(databases)}>
            {t('selection.select_all')}
          </button>{' '}
          <button type="button" className="btn btn-secondary" id="db_unselect_all" onClick={() => onChange([])}>
            {t('selection.unselect_all')}
          </button>
        </div>
        <select className="form-select" name="db_select[]" id="db_select" size={10} multiple aria-label={t('selection.databases')} value={selected} onChange={(e) => onChange(Array.from(e.target.selectedOptions, (option) => option.value))}>
          {databases.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

/**
 * database/export/index.twig's Tables card: a row per schema (at the database scope) or per
 * relation (at the schema scope) with its Structure and Data boxes. A view has no Data box. A
 * data-only format (CSV) hides the Structure column, as phpMyAdmin does.
 */
function ObjectSelection({ scope, objects, structure, data, dataOnly, hasData, onChange }: { scope: 'database' | 'schema'; objects: ExportObject[]; structure: string[]; data: string[]; dataOnly: boolean; hasData: (object: ExportObject) => boolean; onChange: (structure: string[], data: string[]) => void }) {
  const { t } = useTranslation('export')
  const withData = objects.filter(hasData).map((object) => object.name)
  const all = objects.map((object) => object.name)
  const allStructure = all.length > 0 && all.every((name) => structure.includes(name))
  const allData = withData.length > 0 && withData.every((name) => data.includes(name))
  const toggle = (list: string[], name: string, on: boolean) => (on ? (list.includes(name) ? list : [...list, name]) : list.filter((entry) => entry !== name))

  return (
    <div className="card mb-3" id="databases_and_tables">
      <div className="card-header">{t(scope === 'database' ? 'selection.schemas' : 'selection.tables')}</div>
      <div className="card-body" style={{ overflowY: 'scroll', maxHeight: '20em' }}>
        <table className="table table-sm table-striped table-hover export_table_select">
          <thead>
            <tr>
              <th></th>
              <th>{t(scope === 'database' ? 'selection.schemas_column' : 'selection.tables_column')}</th>
              {!dataOnly && <th className="export_structure text-center">{t('selection.structure')}</th>}
              <th className="export_data text-center">{t('selection.data')}</th>
            </tr>
            <tr>
              <td></td>
              <td className="align-middle">{t('selection.select_all')}</td>
              {!dataOnly && (
                <td className="export_structure text-center">
                  <input type="checkbox" id="table_structure_all" aria-label={t('selection.structure_all')} checked={allStructure} onChange={(e) => onChange(e.target.checked ? all : [], data)} />
                </td>
              )}
              <td className="export_data text-center">
                <input type="checkbox" id="table_data_all" aria-label={t('selection.data_all')} checked={allData} onChange={(e) => onChange(structure, e.target.checked ? withData : [])} />
              </td>
            </tr>
          </thead>
          <tbody>
            {objects.map((object) => {
              const inStructure = structure.includes(object.name)
              const inData = data.includes(object.name)
              const rowData = hasData(object)

              return (
                <tr key={object.name} className={inData || (inStructure && !dataOnly) ? 'marked' : undefined}>
                  <td>
                    <input className="checkall" type="checkbox" name="table_select[]" value={object.name} checked={inData || (inStructure && !dataOnly)} onChange={(e) => onChange(toggle(structure, object.name, e.target.checked), rowData ? toggle(data, object.name, e.target.checked) : data)} />
                  </td>
                  <td className="align-middle text-nowrap">{object.name}</td>
                  {!dataOnly && (
                    <td className="export_structure text-center">
                      <input type="checkbox" name="table_structure[]" value={object.name} aria-label={t('selection.structure_of', { name: object.name })} checked={inStructure} onChange={(e) => onChange(toggle(structure, object.name, e.target.checked), data)} />
                    </td>
                  )}
                  <td className="export_data text-center">
                    {rowData && <input type="checkbox" name="table_data[]" value={object.name} aria-label={t('selection.data_of', { name: object.name })} checked={inData} onChange={(e) => onChange(structure, toggle(data, object.name, e.target.checked))} />}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
