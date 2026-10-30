import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { errorMessage, type ApiError } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { formatSize } from '@/format'
import { notifyError } from '@/notify'
import { preference } from '@/preferences'
import { importOptions, listProcesses, startImport, type BackgroundProcess, type CopyFormat, type CopySettings, type ImportOptions, type ImportScope, type ImportSettings, type ImportTarget } from '../api'
import { CHARSET, STOP_ON_ERROR } from '../preferences'
import ProcessView from '../ProcessView'

const DEFAULTS: Omit<ImportSettings, 'charset'> = {
  format: 'sql',
  local_file: '',
  fk_checks: true,
  stop_on_error: true,
  sql_single_transaction: false,
  contents: 'both',
  jobs: '1',
  owner: true,
  privileges: true,
  tablespaces: true,
  comments: true,
  publications: true,
  subscriptions: true,
  security_labels: true,
  policies: true,
  table_access_method: true,
  clean: false,
  if_exists: false,
  single_transaction: false,
  exit_on_error: false,
  disable_triggers: false,
  no_data_for_failed_tables: false,
  statistics: false,
  set_session_authorization: false,
  verbose: false,
}

const COPY_FORMATS: CopyFormat[] = ['csv', 'text', 'binary', 'xml']

/** Each COPY format's options as the page starts, phpMyAdmin's CSV defaults and COPY's own. */
const COPY_DEFAULTS: Record<CopyFormat, CopySettings> = {
  csv: { replace: false, terminated: ',', enclosed: '"', escaped: '"', new_line: 'auto', partial_import: '', columns: '', ignore: false, col_names: false, header_match: false, null: '', default: '' },
  text: { replace: false, terminated: '\\t', enclosed: '', escaped: '', new_line: 'auto', partial_import: '', columns: '', ignore: false, col_names: false, header_match: false, null: '\\N', default: '' },
  binary: { replace: false, terminated: '', enclosed: '', escaped: '', new_line: '', partial_import: '', columns: '', ignore: false, col_names: false, header_match: false, null: '', default: '' },
  xml: { replace: false, terminated: '', enclosed: '', escaped: '', new_line: '', partial_import: '', columns: '', ignore: false, col_names: false, header_match: false, null: '', default: '' },
}

type Flag = { [K in keyof ImportSettings]: ImportSettings[K] extends boolean ? K : never }[keyof ImportSettings]

const isCopy = (format: ImportSettings['format']): format is CopyFormat => (COPY_FORMATS as string[]).includes(format)

/** The format a file's name suggests, as phpMyAdmin picks the plugin matching the extension; a table's rows only on a table. */
function formatOf(name: string, scope: ImportScope): ImportSettings['format'] | null {
  const base = name.toLowerCase().replace(/\.gz$/, '')
  if (/\.(sql|psql|pgsql)$/.test(base)) return 'sql'
  if (/\.(dump|backup|bak|custom|tar|pgdump)$/.test(base)) return 'archive'
  if (scope === 'table' && /\.csv$/.test(base)) return 'csv'
  if (scope === 'table' && /\.(tsv|copy)$/.test(base)) return 'text'
  if (scope === 'table' && /\.xml$/.test(base)) return 'xml'
  if (/\.txt$/.test(base)) return scope === 'table' ? 'text' : 'sql'

  return null
}

/**
 * The Import page of the server, a database, a schema and a table, laid out like phpMyAdmin's
 * import.twig: the file (uploaded, or from the upload directory) and its character set, other
 * options, the format (SQL, run by psql, a pg_dump archive, restored by pg_restore, or on a
 * table its rows in CSV, COPY's text or binary format or XML, loaded by COPY) and its options. The import runs in the background; its output shows above the form until it is
 * dismissed, so an import started before the page was left is there when it is opened again.
 */
export default function Import({ scope }: { scope: ImportScope }) {
  const params = useParams()
  const target: ImportTarget = scope === 'server' ? {} : scope === 'database' ? { database: params.db } : scope === 'schema' ? { database: params.db, schema: params.schema } : { database: params.db, schema: params.schema, table: params.table }
  const { data: options, error } = useRequest(() => importOptions(target), [scope, params.db, params.schema, params.table])

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

  return <ImportForm key={`${scope}:${params.db}:${params.schema}:${params.table}`} scope={scope} target={target} options={options} />
}

function ImportForm({ scope, target, options }: { scope: ImportScope; target: ImportTarget; options: ImportOptions }) {
  const { t } = useTranslation('import')
  // The role's defaults: the character set (when the server knows it) and stopping at the first error.
  const [settings, setSettings] = useState<ImportSettings>(() => {
    const charset = preference<string>(CHARSET).toUpperCase()

    return { ...DEFAULTS, stop_on_error: preference<boolean>(STOP_ON_ERROR), charset: options.encodings.includes(charset) ? charset : options.encodings.includes('UTF8') ? 'UTF8' : '' }
  })
  const [copy, setCopy] = useState<Record<CopyFormat, CopySettings>>(COPY_DEFAULTS)
  const [file, setFile] = useState<File | null>(null)
  const [source, setSource] = useState<'upload' | 'local'>('upload')
  const [upload, setUpload] = useState<{ loaded: number; total: number } | null>(null)
  const [processes, setProcesses] = useState<BackgroundProcess[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let current = true
    listProcesses(target, 'import').then(
      (list) => current && setProcesses(list),
      () => undefined,
    )

    return () => {
      current = false
    }
    // The target is the form's key: it does not change while the form is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = <K extends keyof ImportSettings>(key: K, value: ImportSettings[K]) => setSettings((current) => ({ ...current, [key]: value }))
  const archive = settings.format === 'archive'
  const copyFormat = isCopy(settings.format) ? settings.format : null
  const tools = options.tools
  const program = archive ? 'pg_restore' : 'psql'
  const toolsProblem =
    tools === null
      ? t('tools.missing')
      : !(archive ? tools.pg_restore : tools.psql)
        ? t('tools.no_program', { program, directory: tools.directory })
        : settings.format === 'sql' && !tools.restricts
          ? t('tools.no_restrict', { version: tools.version })
          : null
  const local = options.upload_dir !== null && (source === 'local' || options.upload_dir.files === null)

  function choose(chosen: File | null) {
    setFile(chosen)
    const format = chosen ? formatOf(chosen.name, scope) : null
    if (format) set('format', format)
  }

  function drop(e: DragEvent) {
    const dropped = e.dataTransfer.files[0]
    if (!dropped) return
    e.preventDefault()
    if (fileInput.current) {
      const transfer = new DataTransfer()
      transfer.items.add(dropped)
      fileInput.current.files = transfer.files
    }
    setSource('upload')
    choose(dropped)
  }

  /** The request: the target, the format and its options, and the file of the upload directory. */
  function request(): Record<string, unknown> {
    const { local_file, jobs, ...rest } = settings
    const copyFields = copyFormat ? Object.fromEntries(Object.entries(copy[copyFormat]).map(([key, value]) => [`${copyFormat}_${key}`, value])) : {}

    return { ...target, ...rest, ...copyFields, jobs: Number(jobs) || 1, local_file: local ? local_file : '' }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (upload !== null) return
    if (toolsProblem !== null) return notifyError(toolsProblem)
    if (local ? settings.local_file === '' : file === null) return notifyError(t('file.none'))
    if (!local && file && options.max_upload > 0 && file.size > options.max_upload) return notifyError(t('file.too_large', { size: formatSize(options.max_upload) }))

    setUpload({ loaded: 0, total: local || !file ? 0 : file.size })
    startImport(request(), local ? null : file, (loaded, total) => setUpload({ loaded, total })).then(
      (process) => {
        setUpload(null)
        setProcesses((list) => [process, ...list])
      },
      (err: unknown) => {
        setUpload(null)
        const detail = (err as Partial<ApiError>).detail
        notifyError(detail ? `${errorMessage(err)}\n${detail}` : errorMessage(err))
      },
    )
  }

  const title = {
    server: t('title.server'),
    database: t('title.database', { name: target.database }),
    schema: t('title.schema', { name: target.schema }),
    table: t('title.table', { name: target.table }),
  }[scope]

  const toggle = (key: Flag, label: ReactNode, children?: ReactNode) => (
    <li className="list-group-item">
      <div className="form-check form-switch">
        <input className="form-check-input" type="checkbox" role="switch" name={key} id={`checkbox_${key}`} checked={settings[key]} onChange={(e) => set(key, e.target.checked)} />
        <label className="form-check-label" htmlFor={`checkbox_${key}`}>
          {label}
        </label>
      </div>
      {children}
    </li>
  )
  const code = { code: <code /> }
  const label = (key: string) => <Trans t={t} i18nKey={key} components={code} />
  const maxUpload = options.max_upload > 0 ? t('file.max', { size: (options.max_upload / 1024).toLocaleString('en-US') }) : ''
  const definitions = settings.contents !== 'data'

  const fileInputs = (
    <>
      <div className="mb-3">
        <label className="form-label" htmlFor="input_import_file">
          {t('file.browse')} <small>{maxUpload}</small>
        </label>
        <input className="form-control" type="file" name="import_file" id="input_import_file" ref={fileInput} onChange={(e) => choose(e.target.files?.[0] ?? null)} />
      </div>
      {upload !== null && upload.total > 0 && (
        <div id="upload_form_status" className="mb-3">
          <div className="progress" role="progressbar" aria-label={t('file.uploading')} aria-valuenow={Math.round((upload.loaded / upload.total) * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-bar" style={{ width: `${(upload.loaded / upload.total) * 100}%` }}>
              {Math.round((upload.loaded / upload.total) * 100)}%
            </div>
          </div>
        </div>
      )}
      <p className="card-text">{t('file.drop')}</p>
    </>
  )
  const localInputs =
    options.upload_dir === null ? null : options.upload_dir.files === null ? (
      <div className="alert alert-danger" role="alert">
        <Icon name="s_error" /> {t('file.dir_unreachable')}
      </div>
    ) : options.upload_dir.files.length > 0 ? (
      <div className="mb-3">
        <label className="form-label" htmlFor="select_local_import_file">
          <Trans t={t} i18nKey="file.select_local" values={{ path: options.upload_dir.path }} components={{ strong: <strong /> }} />
        </label>
        <select
          className="form-select"
          size={1}
          name="local_import_file"
          id="select_local_import_file"
          value={settings.local_file}
          onChange={(e) => {
            set('local_file', e.target.value)
            const format = formatOf(e.target.value, scope)
            if (format) set('format', format)
          }}
        >
          <option value=""></option>
          {options.upload_dir.files.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
    ) : (
      <div className="alert alert-info" role="alert">
        {t('file.no_files')}
      </div>
    )

  return (
    <div className="container" onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()} onDrop={drop}>
      <h2 className="my-3">
        <Icon name="b_import" /> {title}
      </h2>

      {toolsProblem !== null && (
        <div className="alert alert-danger" role="alert">
          {toolsProblem}
        </div>
      )}

      {processes.map((process) => (
        <ProcessView key={process.id} initial={process} onDismiss={() => setProcesses((list) => list.filter((entry) => entry.id !== process.id))} />
      ))}

      <p id="all_jobs">
        <Link to="/server/status/jobs">
          <Icon name="s_status" /> {t('process.all_jobs')}
        </Link>
      </p>

      <div id="importmain">
        <form id="import_file_form" method="post" encType="multipart/form-data" name="import" onSubmit={submit}>
          <div className="card mb-3">
            <div className="card-header">{t('file.title')}</div>
            <div className="card-body">
              <p className="card-text">
                {t('file.compressed')}
                <br />
                <Trans t={t} i18nKey="file.compressed_name" components={{ strong: <strong /> }} />
              </p>

              {options.upload_dir !== null ? (
                <>
                  <ul className="nav nav-pills mb-3" id="importFileTab" role="tablist">
                    <li className="nav-item" role="presentation">
                      <button className={`nav-link${!local ? ' active' : ''}`} id="uploadFileTab" type="button" role="tab" aria-controls="uploadFile" aria-selected={!local} onClick={() => setSource('upload')}>
                        {t('file.upload_tab')}
                      </button>
                    </li>
                    <li className="nav-item" role="presentation">
                      <button className={`nav-link${local ? ' active' : ''}`} id="localFileTab" type="button" role="tab" aria-controls="localFile" aria-selected={local} onClick={() => setSource('local')}>
                        {t('file.local_tab')}
                      </button>
                    </li>
                  </ul>
                  <div className="tab-content mb-3" id="importFileTabContent">
                    <div className={`tab-pane fade${!local ? ' show active' : ''}`} id="uploadFile" role="tabpanel" aria-labelledby="uploadFileTab">
                      {fileInputs}
                    </div>
                    <div className={`tab-pane fade${local ? ' show active' : ''}`} id="localFile" role="tabpanel" aria-labelledby="localFileTab">
                      {localInputs}
                    </div>
                  </div>
                </>
              ) : (
                fileInputs
              )}

              <label className="form-label" htmlFor="charset_of_file">
                {t('file.charset')}
              </label>
              <select className="form-select" id="charset_of_file" name="charset_of_file" size={1} value={settings.charset} onChange={(e) => set('charset', e.target.value)}>
                {options.encodings.map((encoding) => (
                  <option key={encoding} value={encoding}>
                    {encoding}
                  </option>
                ))}
              </select>
              {archive && <div className="form-text">{t('file.charset_archive')}</div>}
              {settings.format === 'binary' && <div className="form-text">{t('file.charset_binary')}</div>}
              {settings.format === 'xml' && <div className="form-text">{t('file.charset_xml')}</div>}
            </div>
          </div>

          <div className="card mb-3">
            <div className="card-header">{t('other.title')}</div>
            <div className="card-body">
              <div className="form-check form-switch">
                <input className="form-check-input" type="checkbox" role="switch" name="fk_checks" id="fk_checks" value="1" checked={settings.fk_checks} onChange={(e) => set('fk_checks', e.target.checked)} aria-describedby="fkChecksHelp" />
                <label className="form-check-label" htmlFor="fk_checks">
                  {t('other.fk_checks')}
                </label>
                <div id="fkChecksHelp" className="form-text">
                  {label('other.fk_checks_help')}
                </div>
              </div>
            </div>
          </div>

          <div className="card mb-3">
            <div className="card-header">{t('format.title')}</div>
            <div className="card-body">
              <select className="form-select" id="plugins" name="format" aria-label={t('format.aria')} value={settings.format} onChange={(e) => set('format', e.target.value as ImportSettings['format'])}>
                {scope === 'table' && <option value="csv">{t('format.csv')}</option>}
                {scope === 'table' && <option value="binary">{t('format.binary')}</option>}
                {scope === 'table' && <option value="text">{t('format.text')}</option>}
                {scope === 'table' && <option value="xml">{t('format.xml')}</option>}
                <option value="archive">{t('format.archive')}</option>
                <option value="sql">{t('format.sql')}</option>
              </select>
              <div id="import_notification"></div>
            </div>
          </div>

          <div className="card mb-3" id="format_specific_opts">
            <div className="card-header">{t('options.title')}</div>
            <div className="card-body">
              {copyFormat && options.table && <CopyOptionsList format={copyFormat} settings={copy[copyFormat]} table={options.table} onChange={(next) => setCopy((current) => ({ ...current, [copyFormat]: next }))} />}
              {settings.format === 'sql' && (
                <div id="sql_options" className="format_specific_options">
                  <div id="sql_general_opts">
                    <ul className="list-group">
                      {toggle('stop_on_error', label('sql.stop_on_error'))}
                      {toggle('sql_single_transaction', label('sql.single_transaction'))}
                    </ul>
                  </div>
                </div>
              )}
              {archive && (
                <div id="archive_options" className="format_specific_options">
                  <div id="archive_general_opts">
                    <ul className="list-group">
                      <li className="list-group-item">
                        {t('archive.contents')}
                        <ul className="list-group" id="ul_contents">
                          {(['both', 'structure', 'data'] as const).map((value) => (
                            <li className="list-group-item" key={value}>
                              <div className="form-check">
                                <input className="form-check-input" type="radio" name="contents" value={value} id={`radio_contents_${value}`} checked={settings.contents === value} onChange={() => set('contents', value)} />
                                <label className="form-check-label" htmlFor={`radio_contents_${value}`}>
                                  {t(`archive.contents_${value}`)}
                                </label>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </li>
                      {scope === 'server' && <li className="list-group-item">{label('archive.creates_database')}</li>}
                      {scope === 'schema' && <li className="list-group-item">{label('archive.schema_only')}</li>}
                      {scope === 'table' && <li className="list-group-item">{label('archive.table_only')}</li>}
                    </ul>
                  </div>

                  {definitions && (
                    <div id="archive_structure">
                      <h5 className="card-title mt-4 mb-2">{t('archive.structure_title')}</h5>
                      <ul className="list-group">
                        {toggle(
                          'clean',
                          label('archive.clean'),
                          settings.clean && (
                            <ul className="list-group" id="ul_clean">
                              {toggle('if_exists', label('archive.if_exists'))}
                            </ul>
                          ),
                        )}
                        {toggle('owner', label('archive.owner'))}
                        {toggle('privileges', label('archive.privileges'))}
                        {toggle('tablespaces', label('archive.tablespaces'))}
                        {toggle('comments', label('archive.comments'))}
                        {toggle('publications', label('archive.publications'))}
                        {toggle('subscriptions', label('archive.subscriptions'))}
                        {toggle('security_labels', label('archive.security_labels'))}
                        {tools?.policies && toggle('policies', label('archive.policies'))}
                        {tools?.table_access_method && toggle('table_access_method', label('archive.table_access_method'))}
                      </ul>
                    </div>
                  )}

                  {settings.contents !== 'structure' && (
                    <div id="archive_data">
                      <h5 className="card-title mt-4 mb-2">{t('archive.data_title')}</h5>
                      <ul className="list-group">
                        {settings.contents === 'data' && toggle('disable_triggers', label('archive.disable_triggers'))}
                        {settings.contents === 'both' && toggle('no_data_for_failed_tables', label('archive.no_data_for_failed_tables'))}
                        {tools?.statistics && toggle('statistics', label('archive.statistics'))}
                      </ul>
                    </div>
                  )}

                  <div id="archive_run">
                    <h5 className="card-title mt-4 mb-2">{t('archive.run_title')}</h5>
                    <ul className="list-group">
                      <li className="list-group-item">
                        <label className="form-label" htmlFor="text_jobs">
                          {label('archive.jobs')}
                        </label>
                        <input
                          className="form-control"
                          type="number"
                          name="jobs"
                          id="text_jobs"
                          min={1}
                          max={64}
                          value={settings.jobs}
                          onChange={(e) => setSettings((current) => ({ ...current, jobs: e.target.value, single_transaction: Number(e.target.value) > 1 ? false : current.single_transaction }))}
                        />
                      </li>
                      {Number(settings.jobs) <= 1 && toggle('single_transaction', label('archive.single_transaction'))}
                      {toggle('exit_on_error', label('archive.exit_on_error'))}
                      {toggle('set_session_authorization', label('archive.set_session_authorization'))}
                      {toggle('verbose', label('archive.verbose'))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div id="submit">
            <input id="buttonGo" className="btn btn-primary" type="submit" value={t('import')} />
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * The options of a table's rows in CSV or COPY's text or binary format, in the order of
 * phpMyAdmin's CSV options (#csv_options), followed by the COPY options phpMyAdmin has no
 * counterpart for: a header line, and the NULL and DEFAULT strings.
 */
function CopyOptionsList({ format, settings, table, onChange }: { format: CopyFormat; settings: CopySettings; table: NonNullable<ImportOptions['table']>; onChange: (next: CopySettings) => void }) {
  const { t } = useTranslation('import')
  const set = <K extends keyof CopySettings>(key: K, value: CopySettings[K]) => onChange({ ...settings, [key]: value })
  const label = (key: string) => <Trans t={t} i18nKey={key} components={{ code: <code />, i: <i /> }} />
  const id = (field: string) => `${format}_${field}`
  const binary = format === 'binary'
  // An XML file names its columns and spells NULL itself; only what to do with the rows is asked.
  const xml = format === 'xml'

  const toggle = (key: 'replace' | 'ignore' | 'col_names' | 'header_match', text: ReactNode, children?: ReactNode) => (
    <li className="list-group-item">
      <div className="form-check form-switch">
        <input className="form-check-input" type="checkbox" role="switch" name={id(key)} id={`checkbox_${id(key)}`} checked={settings[key]} onChange={(e) => set(key, e.target.checked)} />
        <label className="form-check-label" htmlFor={`checkbox_${id(key)}`}>
          {text}
        </label>
      </div>
      {children}
    </li>
  )
  const text = (key: 'terminated' | 'enclosed' | 'escaped' | 'new_line' | 'columns' | 'null' | 'default', caption: ReactNode, props: { size?: number; maxLength?: number; help?: ReactNode } = {}) => (
    <li className="list-group-item">
      <label htmlFor={`text_${id(key)}`} className="form-label">
        {caption}
      </label>
      <input className="form-control" type="text" name={id(key)} id={`text_${id(key)}`} size={props.size} maxLength={props.maxLength} value={settings[key]} onChange={(e) => set(key, e.target.value)} />
      {props.help && <div className="form-text">{props.help}</div>}
    </li>
  )

  return (
    <div id={`${format}_options`} className="format_specific_options">
      <div id={`${format}_general_opts`}>
        <ul className="list-group">
          {toggle('replace', label('copy.replace'), settings.replace && table.primary_key.length === 0 && <div className="form-text text-danger">{t('copy.no_primary_key')}</div>)}
          {!binary && !xml && text('terminated', t('copy.terminated'), { size: 2 })}
          {format === 'csv' && text('enclosed', t('copy.enclosed'), { size: 2, maxLength: 2 })}
          {format === 'csv' && text('escaped', t('copy.escaped'), { size: 2, maxLength: 2 })}
          {!binary && !xml && text('new_line', t('copy.new_line'), { size: 2 })}
          <li className="list-group-item">
            <label htmlFor={`number_${id('partial_import')}`} className="form-label">
              {t('copy.partial_import')}
            </label>
            <input className="form-control" type="number" name={id('partial_import')} id={`number_${id('partial_import')}`} min={0} value={settings.partial_import} onChange={(e) => set('partial_import', e.target.value)} />
          </li>
          {!xml && text(
            'columns',
            <>
              {t('copy.columns')} <Icon name="b_help" title={t('copy.columns_hint', { columns: table.columns.join(', ') })} />
            </>,
          )}
          {!binary && table.on_error && toggle('ignore', label('copy.ignore'))}
          {!binary &&
            !xml &&
            (format === 'csv' || table.text_header) &&
            toggle('col_names', label('copy.col_names'), settings.col_names && table.header_match && <ul className="list-group">{toggle('header_match', label('copy.header_match'))}</ul>)}
          {!binary && !xml && text('null', label('copy.null'), { help: t(`copy.null_help_${format}`) })}
          {!binary && !xml && table.default && text('default', label('copy.default'))}
        </ul>
      </div>
    </div>
  )
}
