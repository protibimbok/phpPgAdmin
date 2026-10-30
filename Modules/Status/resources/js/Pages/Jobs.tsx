import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import Modal from '@/components/Modal'
import { urls } from '@/level'
import { notifyError, notifySuccess } from '@/notify'
import { dismissProcess, listAllProcesses, stopProcess, type BackgroundProcess, type ProcessState } from '@import/js/api'
import ProcessView from '@import/js/ProcessView'
import StatusNav from '../StatusNav'

/** The kinds of background process there are; the type select offers them. */
const TYPES = ['import', 'maintenance']

const STATE_ICONS: Record<ProcessState, string> = { running: 's_notice', finished: 's_success', failed: 's_error', killed: 's_cancel', lost: 's_error' }

/** h:mm:ss from seconds. */
function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

const time = (iso: string | null) => (iso === null ? '' : new Date(iso).toLocaleString())

/**
 * pgAdmin's Processes panel on a Status page: every background process the role started on
 * this server (imports, maintenance commands), whatever page started it, newest first, with
 * its state, start and end times and duration. Each row can show its output (the process card
 * of the Import page, followed live, in a dialog), stop it while it runs, or dismiss it once it
 * has ended. The list reloads every two seconds while a process runs.
 */
export default function Jobs() {
  const { t } = useTranslation('status')
  const [type, setType] = useState('')
  const [viewing, setViewing] = useState<BackgroundProcess | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const { data, error, reload } = useRequest(() => listAllProcesses(type || undefined), [type])
  const running = (data ?? []).some((process) => process.state === 'running')

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      setNow(Date.now())
      reload()
    }, 2000)

    return () => window.clearInterval(timer)
  }, [running, reload])

  async function stop(process: BackgroundProcess) {
    try {
      await stopProcess(process.id)
      notifySuccess(t('jobs.stopping', { description: process.description }))
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      reload()
    }
  }

  async function dismiss(process: BackgroundProcess) {
    try {
      await dismissProcess(process.id)
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      reload()
    }
  }

  const processes = data ?? []

  return (
    <div className="container-fluid">
      <StatusNav />

      <div className="card mb-3" id="tableFilter">
        <div className="card-header">{t('processes.filters')}</div>
        <div className="card-body">
          <form className="row row-cols-lg-auto gy-1 gx-3 align-items-center" onSubmit={(e) => { e.preventDefault(); reload() }}>
            <div className="col-12">
              <select className="form-select" aria-label={t('jobs.columns.type')} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">{t('jobs.all_types')}</option>
                {TYPES.map((name) => (
                  <option key={name} value={name}>
                    {t(`jobs.types.${name}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12">
              <input className="btn btn-secondary" type="submit" value={t('processes.refresh')} />
            </div>
          </form>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error.message}
        </div>
      )}

      <div className="responsivetable row">
        <table id="tablejobs" className="table table-striped table-hover w-auto">
          <thead>
            <tr>
              <th>{t('jobs.action')}</th>
              {(['type', 'description', 'target', 'state', 'started', 'finished', 'duration', 'errors'] as const).map((column) => (
                <th scope="col" key={column} className={`text-nowrap${column === 'duration' || column === 'errors' ? ' text-end' : ''}`}>
                  {t(`jobs.columns.${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data && processes.length === 0 && (
              <tr>
                <td colSpan={9}>{t('jobs.none')}</td>
              </tr>
            )}
            {processes.map((process) => {
              const ended = process.ended_at === null ? now : Date.parse(process.ended_at)

              return (
                <tr key={process.id} id={`job_${process.id}`}>
                  <td className="text-nowrap">
                    <a href="#output" className="view_output" onClick={(e) => { e.preventDefault(); setViewing(process) }}>
                      <Icon name="b_browse" /> {t('jobs.view')}
                    </a>{' '}
                    {process.state === 'running' ? (
                      <a href="#stop" className="stop_job" onClick={(e) => { e.preventDefault(); void stop(process) }}>
                        <Icon name="s_cancel" /> {t('jobs.stop')}
                      </a>
                    ) : (
                      <a href="#dismiss" className="dismiss_job" onClick={(e) => { e.preventDefault(); void dismiss(process) }}>
                        <Icon name="b_close" /> {t('jobs.dismiss')}
                      </a>
                    )}
                  </td>
                  <td className="text-nowrap">{TYPES.includes(process.type) ? t(`jobs.types.${process.type}`) : process.type}</td>
                  <td>{process.description}</td>
                  <td className="text-nowrap">
                    <Target process={process} />
                  </td>
                  <td className="text-nowrap">
                    <Icon name={STATE_ICONS[process.state]} /> {t(`jobs.states.${process.state}`)}
                    {process.exit_code !== null && process.state === 'failed' ? ` (${process.exit_code})` : ''}
                  </td>
                  <td className="text-nowrap">{time(process.started_at)}</td>
                  <td className="text-nowrap">{time(process.ended_at)}</td>
                  <td className="font-monospace text-end">{duration((ended - Date.parse(process.started_at)) / 1000)}</td>
                  <td className="font-monospace text-end">{process.errors}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Modal show={viewing !== null} size="xl" title={viewing ? t('jobs.output_title', { description: viewing.description }) : ''} onClose={() => { setViewing(null); reload() }}>
        {viewing && <ProcessView key={viewing.id} initial={viewing} onDismiss={() => { setViewing(null); reload() }} />}
      </Modal>
    </div>
  )
}

/** Where the process ran: the server, or its database, schema and table, each a link. */
function Target({ process }: { process: BackgroundProcess }) {
  const { t } = useTranslation('status')
  if (process.database === null) return <em>{t('jobs.server')}</em>

  return (
    <>
      <Link to={urls.database(process.database)}>{process.database}</Link>
      {process.schema !== null && (
        <>
          {' » '}
          <Link to={urls.schema(process.database, process.schema)}>{process.schema}</Link>
          {process.table !== null && (
            <>
              {' » '}
              <Link to={urls.relation(process.database, process.schema, process.table)}>{process.table}</Link>
            </>
          )}
        </>
      )}
    </>
  )
}
