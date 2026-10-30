import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import { formatSize } from '@/format'
import { urls } from '@/level'
import { notifyError, notifySuccess } from '@/notify'
import { listDatabases } from '@databases/js/api'
import { roleUrl } from '@roles/js/Pages/Roles'
import { createRestorePoint, createSlot, dropSlot, replicationOverview, walReplay, type ReplicationOverview, type Slot, type SlotData } from '../api'
import LogicalReplication from './LogicalReplication'

/** phpMyAdmin's status_table.twig: a Variable / Value table. */
function StatusTable({ id, rows }: { id: string; rows: { name: string; value: ReactNode; status?: 'text-danger' | 'text-success' }[] }) {
  const { t } = useTranslation('replication')

  return (
    <table id={id} className="table w-auto">
      <thead>
        <tr>
          <th>{t('variable')}</th>
          <th>{t('value')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name}>
            <td>{row.name}</td>
            <td className="text-end font-monospace">
              <span className={row.status}>{row.value}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** A link that shows and hides what follows it, as phpMyAdmin's replication page toggles its sections. */
function Toggle({ id, label, children, paragraph = false }: { id: string; label: string; children: ReactNode; paragraph?: boolean }) {
  const [open, setOpen] = useState(false)
  const link = (
    <a href={`#${id}`} id={id} onClick={(e) => { e.preventDefault(); setOpen((o) => !o) }}>
      {label}
    </a>
  )

  return (
    <>
      {paragraph ? <p>{link}</p> : link}
      {open && children}
    </>
  )
}

const bytes = (value: number | null | undefined) => (value === null || value === undefined ? '' : formatSize(value))

/**
 * phpMyAdmin's Replication page for PostgreSQL: the "Primary replication" card (the WAL
 * position and settings as "Show primary status", the standbys of pg_stat_replication as "Show
 * connected replicas", and "Add replica replication user"), the "Replica replication" card on a
 * standby (its WAL receiver and replay as the status table, "Control replica" pausing and
 * resuming WAL replay), the replication slots with Drop and the form that adds one, and the
 * publications and subscriptions of a database.
 */
export default function Replication() {
  const { t } = useTranslation('replication')
  const { data, error, reload } = useRequest(() => replicationOverview(), [])
  const [confirm, setConfirm] = useState<{ sql: string; label: string; danger?: boolean; run: () => Promise<{ sql: string; lsn?: string }>; done: string | ((result: { sql: string; lsn?: string }) => string) } | null>(null)

  async function run(pending: NonNullable<typeof confirm>) {
    setConfirm(null)
    try {
      const result = await pending.run()
      notifySuccess(typeof pending.done === 'string' ? pending.done : pending.done(result))
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      reload()
    }
  }

  return (
    <div className="container-fluid">
      <div className="row">
        <h2>
          <Icon name="s_replication" /> {t('title')}
        </h2>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error.message}
        </div>
      )}

      {data && (
        <div className="row">
          <div id="replication" className="container-fluid">
            {!data.server.monitor && (
              <div className="alert alert-primary" role="alert">
                <Icon name="s_notice" /> {t('limited_privileges')}
              </div>
            )}
            <PrimaryCard
              data={data}
              onRestorePoint={(name) =>
                setConfirm({
                  sql: `SELECT pg_catalog.pg_create_restore_point('${name.replaceAll("'", "''")}');`,
                  label: t('restore_point.create'),
                  run: () => createRestorePoint(name),
                  done: (result) => t('restore_point.created', { name, lsn: result.lsn ?? '' }),
                })
              }
            />
            <ReplicaCard
              data={data}
              onReplay={(action) =>
                setConfirm({
                  sql: `SELECT pg_catalog.pg_wal_replay_${action}();`,
                  label: t(`replica.${action}`),
                  run: () => walReplay(action),
                  done: t(`replica.done_${action}`),
                })
              }
            />
            <SlotsCard
              data={data}
              onDrop={(slot) =>
                setConfirm({
                  sql: `SELECT pg_catalog.pg_drop_replication_slot('${slot.slot_name}');`,
                  label: t('slots.drop'),
                  danger: true,
                  run: () => dropSlot(slot.slot_name),
                  done: t('slots.dropped', { name: slot.slot_name }),
                })
              }
              onCreate={reload}
            />
          </div>
        </div>
      )}

      {data && <LogicalReplication />}

      <ConfirmQuery
        show={confirm !== null}
        sql={confirm?.sql ?? ''}
        confirmLabel={confirm?.label}
        confirmClass={confirm?.danger ? 'btn-danger' : 'btn-primary'}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && void run(confirm)}
      />
    </div>
  )
}

/**
 * "Create a named restore point": pg_create_restore_point, which a primary writes into its WAL
 * for a point-in-time recovery to stop at. It needs wal_level replica or logical.
 */
function RestorePoint({ onCreate }: { onCreate: (name: string) => void }) {
  const { t } = useTranslation('replication')
  const { t: tApp } = useTranslation()
  const [name, setName] = useState('')

  return (
    <Toggle id="primary_restore_point_href" label={t('restore_point.title')}>
      <form
        id="restore_point_form"
        className="row row-cols-lg-auto g-2 align-items-center my-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim() !== '') onCreate(name.trim())
        }}
      >
        <div className="col-12">
          <label htmlFor="restore_point_name" className="col-form-label">
            {t('restore_point.name')}
          </label>
        </div>
        <div className="col-12">
          <input type="text" className="form-control" id="restore_point_name" name="restore_point_name" maxLength={63} required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="col-12">
          <input type="submit" className="btn btn-primary" id="restore_point_go" value={tApp('go')} />
        </div>
        <div className="col-12 form-text">{t('restore_point.help')}</div>
      </form>
    </Toggle>
  )
}

function PrimaryCard({ data, onRestorePoint }: { data: ReplicationOverview; onRestorePoint: (name: string) => void }) {
  const { t } = useTranslation('replication')
  const { server, replicas } = data
  const configured = (!server.in_recovery && server.wal_level !== 'minimal' && server.max_wal_senders > 0) || replicas.length > 0
  // A standby cannot write WAL, and wal_level minimal has no restore points to write.
  const restorePoint = !server.in_recovery && server.wal_level !== 'minimal' && server.restore_point

  if (!configured) {
    return (
      <div className="card mb-2">
        <div className="card-header">{t('primary.title')}</div>
        <div className="card-body">
          {server.in_recovery ? (
            t('primary.standby')
          ) : (
            <>
              {t('primary.not_configured_before')}
              <Link to={`/server/variables?${new URLSearchParams({ filter: server.wal_level === 'minimal' ? 'wal_level' : 'max_wal_senders' })}`}>{t('primary.configure')}</Link>
              {t('primary.not_configured_after')}
            </>
          )}
          {restorePoint && (
            <ul className="mt-2">
              <li>
                <RestorePoint onCreate={onRestorePoint} />
              </li>
            </ul>
          )}
        </div>
      </div>
    )
  }

  const position = server.current_lsn === null ? [] : [
    { name: t('primary.current_lsn'), value: server.current_lsn },
    { name: t('primary.current_walfile'), value: server.current_walfile ?? '' },
  ]

  return (
    <div className="card mb-2">
      <div className="card-header">{t('primary.title')}</div>
      <div className="card-body">
        {t(server.in_recovery ? 'primary.cascading' : 'primary.configured')}
        <ul>
          <li>
            <Toggle id="primary_status_href" label={t('primary.show_status')}>
              <div id="replication_primary_section">
                <StatusTable id="serverprimaryreplicationsummary" rows={[...position, ...data.primary_settings.map((s) => ({ name: s.name, value: s.value }))]} />
              </div>
            </Toggle>
          </li>
          <li>
            <Toggle id="primary_replicas_href" label={t('primary.show_replicas')} paragraph>
              <Replicas data={data} />
            </Toggle>
          </li>
          <li>
            <Link to="/server/roles/create?replication=1" id="primary_addreplicauser_href">
              {t('primary.add_user')}
            </Link>
          </li>
          {restorePoint && (
            <li>
              <RestorePoint onCreate={onRestorePoint} />
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}

/** The standbys streaming from this server, shown under "Show connected replicas". */
function Replicas({ data }: { data: ReplicationOverview }) {
  const { t } = useTranslation('replication')

  return (
    <div id="replication_replicas_section">
      <table className="table table-striped table-hover w-auto">
        <thead>
          <tr>
            {['application', 'host', 'user', 'state', 'sync_state', 'sent_lsn', 'write_lsn', 'flush_lsn', 'replay_lsn', 'replay_lag', 'behind'].map((c) => (
              <th key={c} className="text-nowrap">
                {t(`replicas.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.replicas.length === 0 && (
            <tr>
              <td colSpan={11}>{t('replicas.none')}</td>
            </tr>
          )}
          {data.replicas.map((r) => (
            <tr key={r.pid}>
              <td>{r.application_name}</td>
              <td className="font-monospace">{r.client_addr === null ? (r.client_port === -1 ? t('replicas.socket') : '') : `${r.client_hostname ?? r.client_addr}:${r.client_port}`}</td>
              <td>{r.usename !== null && <Link to={roleUrl(r.usename)}>{r.usename}</Link>}</td>
              <td>{r.state}</td>
              <td>{r.sync_state}</td>
              <td className="text-end font-monospace">{r.sent_lsn}</td>
              <td className="text-end font-monospace">{r.write_lsn}</td>
              <td className="text-end font-monospace">{r.flush_lsn}</td>
              <td className="text-end font-monospace">{r.replay_lsn}</td>
              <td className="text-end font-monospace">{r.replay_lag}</td>
              <td className="text-end">{bytes(r.replay_lag_bytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!data.server.monitor && (
        <div className="alert alert-primary" role="alert">
          <Icon name="s_notice" /> {t('replicas.own_only')}
        </div>
      )}
    </div>
  )
}

function ReplicaCard({ data, onReplay }: { data: ReplicationOverview; onReplay: (action: 'pause' | 'resume') => void }) {
  const { t } = useTranslation('replication')
  const { receiver } = data

  return (
    <div className="card mb-2">
      <div className="card-header">{t('replica.title')}</div>
      <div className="card-body">
        {!data.server.in_recovery || receiver === null ? (
          t('replica.not_configured')
        ) : (
          <div id="replica_configuration_gui">
            {receiver.status !== 'streaming' && (
              <div className="alert alert-danger" role="alert">
                <Icon name="s_error" /> {t('replica.receiver_not_running')}
              </div>
            )}
            {receiver.replay_paused && (
              <div className="alert alert-danger" role="alert">
                <Icon name="s_error" /> {t('replica.replay_paused')}
              </div>
            )}
            <p>{t('replica.configured')}</p>
            <ul>
              <li>
                <Toggle id="replica_status_href" label={t('replica.show_status')}>
                  <div id="replication_replica_section">
                    <StatusTable
                      id="serverreplicareplicationsummary"
                      rows={[
                        { name: t('replica.status'), value: receiver.status ?? t('replica.stopped'), status: receiver.status === 'streaming' ? 'text-success' : 'text-danger' },
                        { name: t('replica.sender'), value: receiver.sender_host === null ? '' : `${receiver.sender_host}:${receiver.sender_port}` },
                        { name: t('replica.slot'), value: receiver.slot_name ?? '' },
                        { name: t('replica.timeline'), value: receiver.received_tli ?? '' },
                        { name: t('replica.receive_lsn'), value: receiver.receive_lsn ?? '' },
                        { name: t('replica.replay_lsn'), value: receiver.replay_lsn ?? '' },
                        { name: t('replica.behind'), value: bytes(receiver.replay_lag_bytes) },
                        { name: t('replica.replay_timestamp'), value: receiver.replay_timestamp ?? '' },
                        { name: t('replica.replay'), value: receiver.replay_paused ? t('replica.paused') : t('replica.running'), status: receiver.replay_paused ? 'text-danger' : 'text-success' },
                        { name: t('replica.last_msg_send_time'), value: receiver.last_msg_send_time ?? '' },
                        { name: t('replica.last_msg_receipt_time'), value: receiver.last_msg_receipt_time ?? '' },
                        { name: t('replica.conninfo'), value: receiver.conninfo ?? '' },
                        ...data.standby_settings.map((s) => ({ name: s.name, value: s.value })),
                      ]}
                    />
                  </div>
                </Toggle>
              </li>
              <li>
                <Toggle id="replica_control_href" label={t('replica.control')}>
                  <div id="replica_control_gui">
                    <ul>
                      <li>
                        <a href="#replay" onClick={(e) => { e.preventDefault(); onReplay(receiver.replay_paused ? 'resume' : 'pause') }}>
                          {receiver.replay_paused ? t('replica.resume') : t('replica.pause')}
                        </a>
                      </li>
                    </ul>
                  </div>
                </Toggle>
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

const SLOT_COLUMNS = ['name', 'type', 'plugin', 'database', 'active', 'wal_status', 'restart_lsn', 'confirmed_flush_lsn', 'retained'] as const

function SlotsCard({ data, onDrop, onCreate }: { data: ReplicationOverview; onDrop: (slot: Slot) => void; onCreate: () => void }) {
  const { t } = useTranslation('replication')
  const { t: tApp } = useTranslation()
  const { data: databases } = useRequest(() => listDatabases(), [])
  const [form, setForm] = useState<SlotData>({ name: '', type: 'physical', reserve: true, database: '', plugin: 'pgoutput', two_phase: false })
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<SlotData>) => setForm((f) => ({ ...f, ...patch }))

  async function create() {
    if (busy) return
    setBusy(true)
    try {
      await createSlot(form)
      notifySuccess(t('slots.created', { name: form.name }))
      set({ name: '' })
      onCreate()
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function cell(slot: Slot, column: (typeof SLOT_COLUMNS)[number]): ReactNode {
    switch (column) {
      case 'name':
        return <strong>{slot.slot_name}</strong>
      case 'type':
        return slot.temporary ? `${slot.slot_type} (${t('slots.temporary')})` : slot.slot_type
      case 'plugin':
        return slot.plugin
      case 'database':
        return slot.database !== null && <Link to={urls.database(slot.database)}>{slot.database}</Link>
      case 'active':
        return slot.active ? `${tApp('yes')}${slot.active_pid === null ? '' : ` (${slot.active_pid})`}` : tApp('no')
      case 'wal_status':
        return slot.invalidation_reason ? `${slot.wal_status ?? ''} (${slot.invalidation_reason})` : slot.wal_status
      case 'restart_lsn':
        return slot.restart_lsn
      case 'confirmed_flush_lsn':
        return slot.confirmed_flush_lsn
      case 'retained':
        return bytes(slot.retained_bytes)
    }
  }

  return (
    <div className="card mb-2" id="replication_slots">
      <div className="card-header">{t('slots.title')}</div>
      <div className="card-body">
        {data.slots.length === 0 ? (
          <p>{t('slots.none')}</p>
        ) : (
          <table className="table table-striped table-hover w-auto">
            <thead>
              <tr>
                {SLOT_COLUMNS.map((c) => (
                  <th key={c} className="text-nowrap">
                    {t(`slots.columns.${c}`)}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {data.slots.map((slot) => (
                <tr key={slot.slot_name}>
                  {SLOT_COLUMNS.map((c) => (
                    <td key={c} className={['restart_lsn', 'confirmed_flush_lsn', 'retained'].includes(c) ? 'text-end font-monospace text-nowrap' : 'text-nowrap'}>
                      {cell(slot, c)}
                    </td>
                  ))}
                  <td>
                    <a className="drop_anchor" href="#drop" onClick={(e) => { e.preventDefault(); onDrop(slot) }}>
                      <Icon name="b_drop" /> {t('slots.drop')}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form className="row row-cols-lg-auto gy-1 gx-3 align-items-center" onSubmit={(e) => { e.preventDefault(); void create() }}>
          <div className="col-12">
            <label className="col-form-label" htmlFor="slot_name">
              {t('slots.add')}
            </label>
          </div>
          <div className="col-12">
            <input className="form-control" id="slot_name" name="slot_name" type="text" maxLength={63} placeholder={t('slots.columns.name')} value={form.name} onChange={(e) => set({ name: e.target.value })} required />
          </div>
          <div className="col-12">
            <select className="form-select" name="slot_type" aria-label={t('slots.columns.type')} value={form.type} onChange={(e) => set({ type: e.target.value as SlotData['type'] })}>
              <option value="physical">physical</option>
              <option value="logical">logical</option>
            </select>
          </div>
          {form.type === 'physical' ? (
            <div className="col-12">
              <div className="form-check">
                <input className="form-check-input" type="checkbox" id="slot_reserve" checked={form.reserve ?? false} onChange={(e) => set({ reserve: e.target.checked })} />
                <label className="form-check-label" htmlFor="slot_reserve">
                  {t('slots.reserve')}
                </label>
              </div>
            </div>
          ) : (
            <>
              <div className="col-12">
                <select className="form-select" name="slot_database" aria-label={t('slots.columns.database')} value={form.database} onChange={(e) => set({ database: e.target.value })} required>
                  <option value="">{t('slots.choose_database')}</option>
                  {(databases ?? []).map((d) => (
                    <option key={d.did} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-12">
                <input className="form-control" name="slot_plugin" type="text" aria-label={t('slots.columns.plugin')} value={form.plugin} onChange={(e) => set({ plugin: e.target.value })} />
              </div>
              <div className="col-12">
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" id="slot_two_phase" checked={form.two_phase ?? false} onChange={(e) => set({ two_phase: e.target.checked })} />
                  <label className="form-check-label" htmlFor="slot_two_phase">
                    {t('slots.two_phase')}
                  </label>
                </div>
              </div>
            </>
          )}
          <div className="col-12">
            <input className="btn btn-primary" type="submit" value={tApp('go')} />
          </div>
        </form>
      </div>
    </div>
  )
}
