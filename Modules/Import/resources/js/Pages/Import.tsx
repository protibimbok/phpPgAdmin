import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { errorMessage, type ApiError } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { formatSize } from '@/format'
import { treeState } from '@/layout/tree/treeState'
import { notifyError } from '@/notify'
import { dismissProcess, getProcess, importOptions, listProcesses, startImport, stopProcess, type BackgroundProcess, type ImportOptions, type ImportScope, type ImportSettings, type ImportTarget } from '../api'

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

type Flag = { [K in keyof ImportSettings]: ImportSettings[K] extends boolean ? K : never }[keyof ImportSettings]

/** The format a file's name suggests, as phpMyAdmin picks the plugin matching the extension. */
function formatOf(name: string): ImportSettings['format'] | null {
  const base = name.toLowerCase().replace(/\.gz$/, '')
  if (/\.(sql|txt|psql|pgsql)$/.test(base)) return 'sql'
  if (/\.(dump|backup|bak|custom|tar|pgdump)$/.test(base)) return 'archive'

  return null
}

/**
 * The Import page of the server, a database and a schema, laid out like phpMyAdmin's
 * import.twig: the file (uploaded, or from the upload directory) and its character set, other
 * options, the format (SQL, run by psql, or a pg_dump archive, restored by pg_restore) and its
 * options. The import runs in the background; its output shows above the form until it is
 * dismissed, so an import started before the page was left is there when it is opened again.
 */
export default function Import({ scope }: { scope: ImportScope }) {
  const params = useParams()
  const target: ImportTarget = scope === 'server' ? {} : scope === 'database' ? { database: params.db } : { database: params.db, schema: params.schema }
  const { data: options, error } = useRequest(() => importOptions(target), [scope, params.db, params.schema])

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

  return <ImportForm key={`${scope}:${params.db}:${params.schema}`} scope={scope} target={target} options={options} />
}

function ImportForm({ scope, target, options }: { scope: ImportScope; target: ImportTarget; options: ImportOptions }) {
  const { t } = useTranslation('import')
  const [settings, setSettings] = useState<ImportSettings>(() => ({ ...DEFAULTS, charset: options.encodings.includes('UTF8') ? 'UTF8' : '' }))
  const [file, setFile] = useState<File | null>(null)
  const [source, setSource] = useState<'upload' | 'local'>('upload')
  const [upload, setUpload] = useState<{ loaded: number; total: number } | null>(null)
  const [processes, setProcesses] = useState<BackgroundProcess[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let current = true
    listProcesses(target).then(
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
  const tools = options.tools
  const program = archive ? 'pg_restore' : 'psql'
  const toolsProblem =
    tools === null ? t('tools.missing') : !(archive ? tools.pg_restore : tools.psql) ? t('tools.no_program', { program, directory: tools.directory }) : !archive && !tools.restricts ? t('tools.no_restrict', { version: tools.version }) : null
  const local = options.upload_dir !== null && (source === 'local' || options.upload_dir.files === null)

  function choose(chosen: File | null) {
    setFile(chosen)
    const format = chosen ? formatOf(chosen.name) : null
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

    return { ...target, ...rest, jobs: Number(jobs) || 1, local_file: local ? local_file : '' }
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
            const format = formatOf(e.target.value)
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
                <option value="sql">{t('format.sql')}</option>
                <option value="archive">{t('format.archive')}</option>
              </select>
              <div id="import_notification"></div>
            </div>
          </div>

          <div className="card mb-3" id="format_specific_opts">
            <div className="card-header">{t('options.title')}</div>
            <div className="card-body">
              {!archive && (
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

/** Output kept on the page at most; the start of a longer one is cut. */
const OUTPUT_LIMIT = 1048576

/**
 * One import, followed while it runs: its state and progress, and its output, read a piece at
 * a time from where the last read ended. Stop asks the runner to cancel it; Dismiss removes it
 * once it has ended.
 */
function ProcessView({ initial, onDismiss }: { initial: BackgroundProcess; onDismiss: () => void }) {
  const { t } = useTranslation('import')
  const [process, setProcess] = useState(initial)
  const [output, setOutput] = useState('')
  const [busy, setBusy] = useState(false)
  const outputRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let offset = 0
    let timer: number | undefined
    let stopped = false
    let wasRunning = initial.state === 'running'

    const poll = () => {
      getProcess(initial.id, offset).then(
        ({ process: next, output: chunk }) => {
          if (stopped) return
          setProcess(next)
          if (chunk.text !== '') {
            setOutput((text) => {
              const joined = text + chunk.text

              return joined.length > OUTPUT_LIMIT ? `…\n${joined.slice(joined.indexOf('\n', joined.length - OUTPUT_LIMIT) + 1)}` : joined
            })
          }
          offset = chunk.offset
          if (wasRunning && next.state !== 'running') {
            // What the import made shows in the navigation panel.
            treeState.refresh()
          }
          wasRunning = next.state === 'running'
          // An ended process is read on until its output is all in.
          if (next.state === 'running' || chunk.offset < chunk.size) timer = window.setTimeout(poll, chunk.offset < chunk.size ? 0 : 1000)
        },
        () => {
          if (!stopped) timer = window.setTimeout(poll, 3000)
        },
      )
    }
    poll()

    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [initial.id, initial.state])

  useEffect(() => {
    const pre = outputRef.current
    if (pre) pre.scrollTop = pre.scrollHeight
  }, [output])

  const running = process.state === 'running'
  const percent = process.size ? Math.min(100, Math.round((process.read / process.size) * 100)) : null
  const file = process.description
  const [alert, icon, message] = {
    running: ['alert-primary', 's_notice', t('process.running', { file })],
    finished: process.errors > 0 ? ['alert-warning', 's_notice', t('process.finished_errors', { file, errors: process.errors })] : ['alert-success', 's_success', t('process.finished', { file })],
    failed: ['alert-danger', 's_error', process.errors > 0 ? t('process.failed_errors', { file, code: process.exit_code, errors: process.errors }) : t('process.failed', { file, code: process.exit_code })],
    killed: ['alert-warning', 's_notice', t('process.killed', { file })],
    lost: ['alert-danger', 's_error', t('process.lost', { file })],
  }[process.state]

  async function stop() {
    setBusy(true)
    try {
      setProcess(await stopProcess(process.id))
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function dismiss() {
    setBusy(true)
    try {
      await dismissProcess(process.id)
      onDismiss()
    } catch (err) {
      setBusy(false)
      notifyError(errorMessage(err))
    }
  }

  return (
    <div className="card mb-3" id={`import_process_${process.id}`}>
      <div className="card-header">{t('process.title', { file, target: process.schema ?? process.database ?? t('process.server') })}</div>
      <div className="card-body">
        <div className={`alert ${alert}`} role="alert">
          <Icon name={icon} /> {message}
        </div>
        {running && percent !== null && (
          <div className="progress mb-3" role="progressbar" aria-label={t('process.progress')} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-bar progress-bar-striped progress-bar-animated" style={{ width: `${percent}%` }}>
              {percent}%
            </div>
          </div>
        )}
        <p className="card-text">
          <code>{process.command.join(' ')}</code>
        </p>
        {output !== '' && (
          <pre ref={outputRef} className="border rounded p-2 mb-3 overflow-auto" style={{ maxHeight: '20rem' }}>
            {output}
          </pre>
        )}
        {running ? (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void stop()}>
            {t('process.stop')}
          </button>
        ) : (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void dismiss()}>
            {t('process.dismiss')}
          </button>
        )}
      </div>
    </div>
  )
}
