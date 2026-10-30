import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import Modal from '@/components/Modal'
import ObjectSection from '@/components/ObjectSection'
import SqlView from '@/components/SqlView'
import { treeState } from '@/layout/tree/treeState'
import { collection, collectionUrl, type Statistics } from '@/nodes/client'
import { notifyError, notifySuccess } from '@/notify'
import NodeDialog, { type Field, type Values } from '../dialogs/NodeDialog'

/** A pg_cron job as GET …/cron_jobs lists it. */
export interface CronJob {
  oid: number
  name: string
  jobname: string | null
  schedule: string
  command: string
  database: string
  username: string
  active: boolean
  last_status: string | null
  last_start: string | null
  last_end: string | null
  last_message: string | null
}

const jobs = (db: string) => collection<CronJob>(collectionUrl(db, 'cron_jobs'))

/**
 * pg_cron's jobs in the database it is installed in, in the place pgAdmin gives pgAgent's: a
 * list after phpMyAdmin's Events (name, schedule, database, role, active, last run, with Edit,
 * Export and Drop), the job dialog (name, schedule, command, database, role, active, with
 * Preview SQL), and the runs of the job picked, from cron.job_run_details. Only reached from
 * the navigation tree's "pg_cron Jobs", which the tree shows only where pg_cron is installed.
 */
export default function CronJobs() {
  const db = useParams().db ?? ''
  const { t } = useTranslation('dbobjects')
  const { t: tApp } = useTranslation()
  const [search, setSearch] = useSearchParams()
  const { data, error, reload } = useRequest(() => jobs(db).list(), [db])
  const [editing, setEditing] = useState<{ row: CronJob | null } | null>(null)
  const [exported, setExported] = useState<{ title: string; sql: string | null } | null>(null)
  const [dropping, setDropping] = useState<CronJob[] | null>(null)
  const [runs, setRuns] = useState<{ job: CronJob; stats: Statistics | null } | null>(null)

  // The navigation panel opens a job by its id: ?open=12.
  const open = search.get('open')
  useEffect(() => {
    if (!data || !open) return
    const row = data.find((r) => String(r.oid) === open)
    if (row) setEditing({ row })
    setSearch(
      (params) => {
        params.delete('open')
        return params
      },
      { replace: true },
    )
  }, [data, open, setSearch])

  if (error) {
    return (
      <div className="container-fluid">
        <div className="alert alert-danger my-3" role="alert">
          {error.message}
        </div>
      </div>
    )
  }
  if (!data) return null

  const changed = () => {
    treeState.refresh()
    reload()
  }

  function exportSql(rows: CronJob[]) {
    setExported({ title: rows.length === 1 ? t('export_title', { name: rows[0].name }) : t('export_title_many'), sql: null })
    Promise.all(rows.map((row) => jobs(db).sql(row.oid))).then(
      (parts) => setExported((current) => (current ? { ...current, sql: parts.join('\n\n') } : null)),
      (e: unknown) => {
        setExported(null)
        notifyError(errorMessage(e))
      },
    )
  }

  function showRuns(job: CronJob) {
    setRuns({ job, stats: null })
    jobs(db)
      .statistics(job.oid)
      .then(
        (stats) => setRuns((current) => (current?.job.oid === job.oid ? { job, stats } : current)),
        (e: unknown) => {
          setRuns(null)
          notifyError(errorMessage(e))
        },
      )
  }

  const row = editing?.row ?? null
  const fields: Field[] = [
    { key: 'jobname', label: t('cron_job.fields.name'), kind: 'text', readOnly: row !== null, required: true },
    { key: 'schedule', label: t('cron_job.fields.schedule'), kind: 'text', required: true, placeholder: '0 3 * * *', hint: t('cron_job.schedule_hint') },
    { key: 'command', label: t('cron_job.fields.command'), kind: 'textarea', required: true },
    { key: 'database', label: t('cron_job.fields.database'), kind: 'text', hint: t('cron_job.database_hint') },
    { key: 'username', label: t('cron_job.fields.username'), kind: 'text' },
    { key: 'active', label: t('cron_job.fields.active'), kind: 'checkbox' },
  ]
  const initial: Values = row
    ? { jobname: row.jobname ?? '', schedule: row.schedule, command: row.command, database: row.database, username: row.username, active: row.active }
    : { jobname: '', schedule: '', command: '', database: db, username: '', active: true }

  return (
    <div className="container-fluid my-3">
      <ObjectSection<CronJob>
        id="cron_jobs"
        icon="b_events"
        title={t('cron_job.title')}
        rows={data}
        empty={t('cron_job.none')}
        createLabel={t('cron_job.create')}
        createIcon="b_event_add"
        onCreate={() => setEditing({ row: null })}
        columns={[
          { label: t('cron_job.fields.schedule'), render: (r) => <code>{r.schedule}</code> },
          { label: t('cron_job.fields.database'), render: (r) => r.database },
          { label: t('cron_job.fields.username'), render: (r) => r.username },
          { label: t('cron_job.fields.active'), render: (r) => (r.active ? tApp('yes') : tApp('no')) },
          {
            label: t('cron_job.last_run'),
            render: (r) =>
              r.last_start === null ? (
                <em>{t('cron_job.never')}</em>
              ) : (
                <span title={r.last_message ?? undefined}>
                  {r.last_status} ({r.last_start})
                </span>
              ),
          },
          {
            label: '',
            render: (r) => (
              <a href="#runs" className="cron_job_runs text-nowrap" onClick={(e) => { e.preventDefault(); showRuns(r) }}>
                <Icon name="b_browse" /> {t('cron_job.runs')}
              </a>
            ),
          },
        ]}
        onEdit={(r) => setEditing({ row: r })}
        onExport={exportSql}
        onDrop={(rows) => setDropping(rows)}
        noneSelected={t('none_selected')}
        labels={{ name: t('columns.name'), edit: t('actions.edit'), export: t('actions.export'), drop: t('actions.drop') }}
      />

      {runs && (
        <div className="card mb-3" id="cron_job_runs">
          <div className="card-header">{t('cron_job.runs_of', { name: runs.job.name })}</div>
          <div className="card-body">
            {runs.stats === null ? (
              tApp('loading')
            ) : runs.stats.rows.length === 0 ? (
              <p className="mb-0">{t('cron_job.no_runs')}</p>
            ) : (
              <table className="table table-striped table-hover w-auto mb-0">
                <thead>
                  <tr>
                    {['status', 'start_time', 'end_time', 'database', 'username', 'return_message'].map((c) => (
                      <th key={c}>{t(`cron_job.run_columns.${c}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.stats.rows.map((r) => (
                    <tr key={String(r.runid)}>
                      {['status', 'start_time', 'end_time', 'database', 'username', 'return_message'].map((c) => (
                        <td key={c}>{r[c] === null ? <i>NULL</i> : String(r[c])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <NodeDialog
        show={editing !== null}
        id="cronJobDialog"
        title={row ? t('cron_job.edit_title', { name: row.name }) : t('cron_job.create_title')}
        fields={fields}
        initial={initial}
        save={(values) => (row ? jobs(db).update(row.oid, values) : jobs(db).create(values))}
        preview={(values) => jobs(db).modifiedSql(values, row?.oid)}
        savedMessage={(values) => (row ? t('altered', { name: row.name }) : t('created', { name: String(values.jobname) }))}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          changed()
        }}
      />

      <Modal show={exported !== null} title={exported?.title ?? ''} size="lg" onClose={() => setExported(null)}>
        {exported?.sql === null ? tApp('loading') : <SqlView sql={exported?.sql ?? ''} />}
      </Modal>

      <ConfirmQuery
        show={dropping !== null}
        sql={(dropping ?? []).map((r) => `SELECT cron.unschedule(${r.oid});`)}
        confirmLabel={tApp('ok')}
        onClose={() => setDropping(null)}
        onConfirm={() => {
          const rows = dropping ?? []
          setDropping(null)
          void (async () => {
            try {
              for (const r of rows) await jobs(db).remove(r.oid)
              notifySuccess(rows.length === 1 ? t('dropped', { name: rows[0].name }) : t('dropped_many', { count: rows.length }))
            } catch (e) {
              notifyError(errorMessage(e))
            } finally {
              changed()
            }
          })()
        }}
      />
    </div>
  )
}
