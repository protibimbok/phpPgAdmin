import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import PreviewSql from '@/components/PreviewSql'
import { notifyError } from '@/notify'
import { listProcesses, type BackgroundProcess } from '@import/js/api'
import ProcessView from '@import/js/ProcessView'
import { maintenanceOptions, maintenanceSql, runMaintenance, type MaintenanceOperation, type MaintenanceSettings, type MaintenanceTarget } from './api'

const DEFAULTS: MaintenanceSettings = {
  verbose: false,
  full: false,
  freeze: false,
  analyze: false,
  disable_page_skipping: false,
  skip_locked: false,
  truncate: true,
  process_toast: true,
  process_main: true,
  skip_database_stats: false,
  only_database_stats: false,
  index_cleanup: 'auto',
  parallel: '',
  buffer_usage_limit: '',
  system: false,
  concurrently: false,
  tablespace: '',
}

type Switch = { [K in keyof MaintenanceSettings]: MaintenanceSettings[K] extends boolean ? K : never }[keyof MaintenanceSettings]

/**
 * pgAdmin's maintenance dialog as an Operations card of a database or a schema: the operation
 * (VACUUM, ANALYZE, REINDEX, and on a database CLUSTER), the options of that operation the
 * server has, and VERBOSE. A run is a background process shown above the form with its output
 * until it is dismissed, as on the Import page.
 */
export default function MaintenanceCard({ target }: { target: MaintenanceTarget }) {
  const { t } = useTranslation('maintenance')
  const { t: tApp } = useTranslation()
  const { data: options } = useRequest(() => maintenanceOptions(target), [target.database, target.schema])
  const [operation, setOperation] = useState<MaintenanceOperation>('VACUUM')
  const [settings, setSettings] = useState<MaintenanceSettings>(DEFAULTS)
  const [processes, setProcesses] = useState<BackgroundProcess[]>([])
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ sql: string | null; error?: string } | null>(null)

  useEffect(() => {
    let current = true
    listProcesses(target, 'maintenance').then(
      (list) => current && setProcesses(list),
      () => undefined,
    )

    return () => {
      current = false
    }
  }, [target.database, target.schema])

  if (!options) return null

  const version = options.version
  const database = target.schema === undefined
  const set = <K extends keyof MaintenanceSettings>(key: K, value: MaintenanceSettings[K]) => setSettings((current) => ({ ...current, [key]: value }))
  const id = (key: string) => `maintenance_${key}`
  const code = { code: <code /> }

  /** What the operation takes from the form: the switches it has, at the values set. */
  function request(): Partial<MaintenanceSettings> {
    const s = settings
    switch (operation) {
      case 'VACUUM':
        return {
          verbose: s.verbose,
          full: s.full,
          freeze: s.freeze,
          analyze: s.analyze,
          disable_page_skipping: !s.full && s.disable_page_skipping,
          skip_locked: s.skip_locked,
          ...(s.full ? {} : { truncate: s.truncate }),
          ...(version >= 140000 ? { process_toast: s.process_toast } : {}),
          ...(version >= 160000 ? { process_main: s.process_main, skip_database_stats: s.skip_database_stats, only_database_stats: database && s.only_database_stats, buffer_usage_limit: s.buffer_usage_limit } : {}),
          index_cleanup: s.index_cleanup,
          parallel: s.full ? '' : s.parallel,
        }
      case 'ANALYZE':
        return { verbose: s.verbose, skip_locked: s.skip_locked, ...(version >= 160000 ? { buffer_usage_limit: s.buffer_usage_limit } : {}) }
      case 'REINDEX':
        return database && s.system ? { verbose: s.verbose, system: true } : { verbose: s.verbose, concurrently: s.concurrently, ...(version >= 140000 ? { tablespace: s.tablespace } : {}) }
      case 'CLUSTER':
        return { verbose: s.verbose }
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (options?.tools === null || options?.tools.psql === false) return notifyError(t('no_psql'))
    setBusy(true)
    runMaintenance(target, operation, request()).then(
      (process) => {
        setBusy(false)
        setProcesses((list) => [process, ...list])
      },
      (err: unknown) => {
        setBusy(false)
        notifyError(errorMessage(err))
      },
    )
  }

  function showPreview() {
    setPreview({ sql: null })
    maintenanceSql(target, operation, request()).then(
      (sql) => setPreview({ sql }),
      (err: unknown) => setPreview({ sql: null, error: errorMessage(err) }),
    )
  }

  const toggle = (key: Switch, option: string, children?: ReactNode) => (
    <li className="list-group-item">
      <div className="form-check form-switch">
        <input className="form-check-input" type="checkbox" role="switch" id={id(key)} checked={settings[key]} onChange={(e) => set(key, e.target.checked)} />
        <label className="form-check-label" htmlFor={id(key)}>
          <code>{option}</code> <small className="text-body-secondary">{t(`help.${key}`)}</small>
        </label>
      </div>
      {children}
    </li>
  )
  const operations: MaintenanceOperation[] = database ? ['VACUUM', 'ANALYZE', 'REINDEX', 'CLUSTER'] : ['VACUUM', 'ANALYZE', 'REINDEX']
  const s = settings

  return (
    <>
      {processes.map((process) => (
        <ProcessView key={process.id} initial={process} onDismiss={() => setProcesses((list) => list.filter((entry) => entry.id !== process.id))} />
      ))}

      <form id="maintenance_form" onSubmit={submit}>
        <div className="card mb-2">
          <div className="card-header">
            <Icon name="b_tblops" /> {t('title')}
          </div>
          <div className="card-body">
            <div className="mb-3">
              {operations.map((value) => (
                <div className="form-check form-check-inline" key={value}>
                  <input className="form-check-input" type="radio" name="maintenance_operation" id={id(`op_${value}`)} value={value} checked={operation === value} onChange={() => setOperation(value)} />
                  <label className="form-check-label" htmlFor={id(`op_${value}`)}>
                    {value}
                  </label>
                </div>
              ))}
              <div className="form-text">
                <Trans t={t} i18nKey={`about.${operation}${database ? '' : '_schema'}`} components={code} />
              </div>
            </div>

            <ul className="list-group">
              {operation === 'VACUUM' && (
                <>
                  {toggle('full', 'FULL')}
                  {toggle('freeze', 'FREEZE')}
                  {toggle('analyze', 'ANALYZE')}
                  {!s.full && toggle('disable_page_skipping', 'DISABLE_PAGE_SKIPPING')}
                  {toggle('skip_locked', 'SKIP_LOCKED')}
                  {!s.full && toggle('truncate', 'TRUNCATE')}
                  {version >= 140000 && toggle('process_toast', 'PROCESS_TOAST')}
                  {version >= 160000 && toggle('process_main', 'PROCESS_MAIN')}
                  {version >= 160000 && toggle('skip_database_stats', 'SKIP_DATABASE_STATS')}
                  {version >= 160000 && database && toggle('only_database_stats', 'ONLY_DATABASE_STATS')}
                  <li className="list-group-item">
                    <label className="form-label" htmlFor={id('index_cleanup')}>
                      <code>INDEX_CLEANUP</code> <small className="text-body-secondary">{t('help.index_cleanup')}</small>
                    </label>
                    <select className="form-select" id={id('index_cleanup')} value={s.index_cleanup} onChange={(e) => set('index_cleanup', e.target.value as MaintenanceSettings['index_cleanup'])}>
                      <option value="auto">AUTO</option>
                      <option value="on">ON</option>
                      <option value="off">OFF</option>
                    </select>
                  </li>
                  {!s.full && (
                    <li className="list-group-item">
                      <label className="form-label" htmlFor={id('parallel')}>
                        <code>PARALLEL</code> <small className="text-body-secondary">{t('help.parallel')}</small>
                      </label>
                      <input className="form-control" type="number" min={0} max={1024} id={id('parallel')} value={s.parallel} onChange={(e) => set('parallel', e.target.value)} />
                    </li>
                  )}
                </>
              )}
              {operation === 'ANALYZE' && toggle('skip_locked', 'SKIP_LOCKED')}
              {(operation === 'VACUUM' || operation === 'ANALYZE') && version >= 160000 && (
                <li className="list-group-item">
                  <label className="form-label" htmlFor={id('buffer_usage_limit')}>
                    <code>BUFFER_USAGE_LIMIT</code> <small className="text-body-secondary">{t('help.buffer_usage_limit')}</small>
                  </label>
                  <input className="form-control" type="text" id={id('buffer_usage_limit')} placeholder="256kB" value={s.buffer_usage_limit} onChange={(e) => set('buffer_usage_limit', e.target.value)} />
                </li>
              )}
              {operation === 'REINDEX' && (
                <>
                  {database && toggle('system', 'SYSTEM')}
                  {!(database && s.system) && toggle('concurrently', 'CONCURRENTLY')}
                  {version >= 140000 && !(database && s.system) && (
                    <li className="list-group-item">
                      <label className="form-label" htmlFor={id('tablespace')}>
                        <code>TABLESPACE</code> <small className="text-body-secondary">{t('help.tablespace')}</small>
                      </label>
                      <select className="form-select" id={id('tablespace')} value={s.tablespace} onChange={(e) => set('tablespace', e.target.value)}>
                        <option value=""></option>
                        {options.tablespaces.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </li>
                  )}
                </>
              )}
              {toggle('verbose', 'VERBOSE')}
            </ul>
          </div>
          <div className="card-footer text-end">
            <input className="btn btn-secondary preview_sql me-2" type="button" value={tApp('preview_sql')} onClick={showPreview} />
            <input className="btn btn-primary" type="submit" value={t('go')} disabled={busy} />
          </div>
        </div>
      </form>

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </>
  )
}
