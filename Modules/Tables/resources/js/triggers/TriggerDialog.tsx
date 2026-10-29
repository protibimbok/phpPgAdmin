import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import { triggers as triggersOf, type Column, type Trigger, type TriggerData, type TriggerOptions, type TriggerParent } from '../api'

export interface TriggerDialogProps {
  show: boolean
  db: string
  scid: number
  parent: TriggerParent
  relOid: number
  columns: Column[]
  options: TriggerOptions | null
  /** The trigger to edit; a new one when null. */
  trigger: Trigger | null
  onClose: () => void
  onSaved: () => void
}

const TIMES = ['BEFORE', 'AFTER', 'INSTEAD OF']
const EVENTS = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] as const

/**
 * phpMyAdmin's trigger editor (database/triggers/editor_form.twig) in a dialog, with
 * PostgreSQL's fields where MySQL's were: the name, the time (BEFORE, AFTER, INSTEAD OF), the
 * events (several at once, UPDATE OF columns), FOR EACH ROW or STATEMENT, the trigger
 * function and its arguments, the WHEN condition, a constraint trigger's deferral, the
 * transition tables, the comment and whether the trigger is enabled. Go saves through the
 * trigger node; Preview SQL shows the statements.
 */
export default function TriggerDialog({ show, db, scid, parent, relOid, columns, options, trigger, onClose, onSaved }: TriggerDialogProps) {
  const { t } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const [name, setName] = useState('')
  const [fires, setFires] = useState('BEFORE')
  const [events, setEvents] = useState<Set<string>>(new Set(['INSERT']))
  const [updateColumns, setUpdateColumns] = useState<string[]>([])
  const [row, setRow] = useState(true)
  const [fn, setFn] = useState('')
  const [args, setArgs] = useState('')
  const [when, setWhen] = useState('')
  const [constraint, setConstraint] = useState(false)
  const [deferrable, setDeferrable] = useState(false)
  const [deferred, setDeferred] = useState(false)
  const [oldTable, setOldTable] = useState('')
  const [newTable, setNewTable] = useState('')
  const [comment, setComment] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!show) return
    if (trigger) {
      setName(trigger.name)
      setFires(trigger.fires)
      setEvents(new Set([trigger.evnt_insert && 'INSERT', trigger.evnt_update && 'UPDATE', trigger.evnt_delete && 'DELETE', trigger.evnt_truncate && 'TRUNCATE'].filter((e): e is string => Boolean(e))))
      setUpdateColumns(trigger.columns)
      setRow(trigger.is_row_trigger)
      setFn(trigger.tfunction)
      setArgs(trigger.tgargs ?? '')
      setWhen(trigger.whenclause ?? '')
      setConstraint(trigger.is_constraint_trigger)
      setDeferrable(trigger.tgdeferrable)
      setDeferred(trigger.tginitdeferred)
      setOldTable(trigger.tgoldtable ?? '')
      setNewTable(trigger.tgnewtable ?? '')
      setComment(trigger.description ?? '')
      setEnabled(trigger.is_enable_trigger !== 'D')
    } else {
      setName('')
      setFires(parent === 'view' ? 'INSTEAD OF' : 'BEFORE')
      setEvents(new Set(['INSERT']))
      setUpdateColumns([])
      setRow(true)
      setFn(options?.functions[0] ?? '')
      setArgs('')
      setWhen('')
      setConstraint(false)
      setDeferrable(false)
      setDeferred(false)
      setOldTable('')
      setNewTable('')
      setComment('')
      setEnabled(true)
    }
  }, [show, trigger, parent, options])

  const collection = () => triggersOf(db, scid, parent, relOid)

  function data(): TriggerData {
    return {
      name,
      fires,
      evnt_insert: events.has('INSERT'),
      evnt_update: events.has('UPDATE'),
      evnt_delete: events.has('DELETE'),
      evnt_truncate: events.has('TRUNCATE'),
      columns: events.has('UPDATE') ? updateColumns : [],
      is_row_trigger: row,
      is_constraint_trigger: constraint,
      tgdeferrable: constraint && deferrable,
      tginitdeferred: constraint && deferrable && deferred,
      tfunction: fn,
      tgargs: args,
      whenclause: when,
      tgoldtable: oldTable,
      tgnewtable: newTable,
      description: comment,
      // Ticked keeps an ENABLE REPLICA or ALWAYS trigger as it is.
      is_enable_trigger: !enabled ? 'D' : trigger && trigger.is_enable_trigger !== 'D' ? trigger.is_enable_trigger : 'O',
    }
  }

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      if (trigger) await collection().update(trigger.oid, data())
      else await collection().create(data())
      notifySuccess(trigger ? t('triggers.altered', { name }) : t('triggers.created', { name }))
      onSaved()
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    collection()
      .modifiedSql(data(), trigger?.oid)
      .then(
        (sql) => setPreview({ sql, error: null }),
        (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
      )
  }

  function toggleEvent(event: string, on: boolean) {
    setEvents((current) => {
      const next = new Set(current)
      if (on) next.add(event)
      else next.delete(event)

      return next
    })
  }

  return (
    <>
      <Modal
        show={show}
        onClose={onClose}
        id="triggerDialogModal"
        size="lg"
        title={trigger ? t('triggers.edit_title', { name: trigger.name }) : t('triggers.create_title')}
        footer={
          <>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
              {tApp('go')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={showPreview}>
              {tApp('preview_sql')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {tApp('close')}
            </button>
          </>
        }
      >
        <form className="rte_form" onSubmit={(e) => { e.preventDefault(); void save() }}>
          <table className="rte_table table table-borderless table-sm">
            <tbody>
              <tr>
                <td>{t('triggers.name')}</td>
                <td>
                  <input type="text" name="item_name" maxLength={63} value={name} onChange={(e) => setName(e.target.value)} required />
                </td>
              </tr>
              <tr>
                <td>{t('triggers.time')}</td>
                <td>
                  <select name="item_timing" value={fires} onChange={(e) => setFires(e.target.value)}>
                    {TIMES.filter((time) => (parent === 'view' ? time === 'INSTEAD OF' : time !== 'INSTEAD OF')).map((time) => (
                      <option key={time} value={time}>
                        {time}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
              <tr>
                <td>{t('triggers.event')}</td>
                <td>
                  {EVENTS.map((event) => (
                    <label key={event} className="me-3">
                      <input type="checkbox" name={`item_event_${event.toLowerCase()}`} checked={events.has(event)} onChange={(e) => toggleEvent(event, e.target.checked)} /> {event}
                    </label>
                  ))}
                  {events.has('UPDATE') && columns.length > 0 && (
                    <div className="mt-1">
                      <label htmlFor="trigger_update_columns" className="me-2">
                        {t('triggers.update_of')}
                      </label>
                      <select id="trigger_update_columns" multiple size={Math.min(5, Math.max(2, columns.length))} value={updateColumns} onChange={(e) => setUpdateColumns(Array.from(e.target.selectedOptions, (o) => o.value))}>
                        {columns.map((column) => (
                          <option key={column.attnum} value={column.name}>
                            {column.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </td>
              </tr>
              <tr>
                <td>{t('triggers.for_each')}</td>
                <td>
                  <select name="item_level" value={row ? 'ROW' : 'STATEMENT'} onChange={(e) => setRow(e.target.value === 'ROW')}>
                    <option value="ROW">ROW</option>
                    <option value="STATEMENT">STATEMENT</option>
                  </select>
                </td>
              </tr>
              <tr>
                <td>{t('triggers.function')}</td>
                <td>
                  <input type="text" name="item_function" list="trigger_functions" value={fn} onChange={(e) => setFn(e.target.value)} required />
                  <datalist id="trigger_functions">
                    {(options?.functions ?? []).map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                </td>
              </tr>
              <tr>
                <td>{t('triggers.arguments')}</td>
                <td>
                  <input type="text" name="item_args" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="'a', 'b'" />
                </td>
              </tr>
              <tr>
                <td>{t('triggers.when')}</td>
                <td>
                  <input type="text" name="item_when" size={50} value={when} onChange={(e) => setWhen(e.target.value)} placeholder="OLD.col <> NEW.col" />
                </td>
              </tr>
              {parent === 'table' && (
                <tr>
                  <td>{t('triggers.constraint')}</td>
                  <td>
                    <label className="me-3">
                      <input type="checkbox" checked={constraint} onChange={(e) => setConstraint(e.target.checked)} /> {t('triggers.constraint_trigger')}
                    </label>
                    {constraint && (
                      <>
                        <label className="me-3">
                          <input type="checkbox" checked={deferrable} onChange={(e) => setDeferrable(e.target.checked)} /> {t('triggers.deferrable')}
                        </label>
                        {deferrable && (
                          <label>
                            <input type="checkbox" checked={deferred} onChange={(e) => setDeferred(e.target.checked)} /> {t('triggers.deferred')}
                          </label>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              )}
              {!row && (
                <tr>
                  <td>{t('triggers.transition')}</td>
                  <td>
                    <input type="text" name="item_old_table" value={oldTable} onChange={(e) => setOldTable(e.target.value)} placeholder={t('triggers.old_table')} aria-label={t('triggers.old_table')} />{' '}
                    <input type="text" name="item_new_table" value={newTable} onChange={(e) => setNewTable(e.target.value)} placeholder={t('triggers.new_table')} aria-label={t('triggers.new_table')} />
                  </td>
                </tr>
              )}
              <tr>
                <td>{t('triggers.comment')}</td>
                <td>
                  <input type="text" name="item_comment" value={comment} onChange={(e) => setComment(e.target.value)} />
                </td>
              </tr>
              <tr>
                <td>{t('triggers.enabled')}</td>
                <td>
                  <input type="checkbox" name="item_enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                </td>
              </tr>
            </tbody>
          </table>
        </form>
      </Modal>
      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </>
  )
}
