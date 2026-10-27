import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import Modal from '@/components/Modal'
import SqlView from '@/components/SqlView'
import { treeState } from '@/layout/tree/treeState'
import { notify, notifyError, notifySuccess } from '@/notify'
import { urls } from '@/level'
import { qualifiedName } from '@sql/js/sql'
import { dropSequence, resolveSchema, sequences as sequencesOf, type Sequence } from '../api'

/**
 * The schema's "Sequences" page, laid out like phpMyAdmin's Routines page (there is no MySQL
 * counterpart): the heading, the check-all / Export / Drop group, the filter box and the
 * "Create new sequence" button, then the table with each sequence's current value, increment,
 * bounds, cache, cycle flag and owning column, and the Edit, Export and Drop links.
 */
export default function Sequences() {
  const { t } = useTranslation('sequences')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '' } = useParams()
  const { data, error, reload } = useRequest(async () => {
    const scid = await resolveSchema(db, schema)

    return { scid, rows: await sequencesOf(db, scid).list() }
  }, [db, schema])
  const [filter, setFilter] = useState('')
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [confirm, setConfirm] = useState<{ sql: string[]; run: () => Promise<void>; cascadeBox?: boolean } | null>(null)
  const [cascade, setCascade] = useState(false)
  const [exported, setExported] = useState<{ title: string; sql: string | null } | null>(null)
  const rows = useMemo(() => {
    const needle = filter.trim().toUpperCase()

    return (data?.rows ?? []).filter((row) => needle === '' || row.name.toUpperCase().includes(needle))
  }, [data, filter])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  const { scid } = data
  const base = `${urls.schema(db, schema)}/sequences`
  const allChecked = rows.length > 0 && rows.every((row) => checked.has(row.oid))
  const selected = () => rows.filter((row) => checked.has(row.oid))

  function toggle(oid: number, value: boolean) {
    setChecked((current) => {
      const next = new Set(current)
      if (value) next.add(oid)
      else next.delete(oid)

      return next
    })
  }

  function exportRows(targets: Sequence[]) {
    if (targets.length === 0) return notify(t('none_selected'), 'error')
    setExported({ title: targets.length === 1 ? t('export_title', { name: targets[0].name }) : t('export_title_many'), sql: null })
    Promise.all(targets.map((row) => sequencesOf(db, scid).sql(row.oid))).then(
      (parts) => setExported((current) => (current ? { ...current, sql: parts.join('\n\n') } : null)),
      (e: unknown) => {
        setExported(null)
        notifyError(errorMessage(e))
      },
    )
  }

  function askDrop(targets: Sequence[]) {
    if (targets.length === 0) return notify(t('none_selected'), 'error')
    setCascade(false)
    setConfirm({
      sql: targets.map((row) => `DROP SEQUENCE ${qualifiedName(schema, row.name)};`),
      cascadeBox: true,
      run: async () => {
        let done = 0
        try {
          for (const row of targets) {
            await dropSequence(db, scid, row.oid, cascadeRef.current)
            done++
          }
          notifySuccess(targets.length === 1 ? t('dropped', { name: targets[0].name }) : t('dropped_many', { count: done }))
        } catch (e) {
          notifyError(errorMessage(e))
        } finally {
          setChecked(new Set())
          treeState.refresh()
          reload()
        }
      },
    })
  }

  cascadeRef.current = cascade

  return (
    <div className="container-fluid my-3">
      <h2>
        <Icon name="b_events" /> {t('title')}
      </h2>

      <div className="d-flex flex-wrap my-3">
        {data.rows.length > 0 && (
          <>
            <div>
              <div className="input-group">
                <div className="input-group-text">
                  <div className="form-check mb-0">
                    <input className="form-check-input checkall_box" type="checkbox" id="checkAllCheckbox" checked={allChecked} onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((r) => r.oid)) : new Set())} />
                    <label className="form-check-label" htmlFor="checkAllCheckbox">
                      {tApp('check_all')}
                    </label>
                  </div>
                </div>
                <button className="btn btn-outline-secondary" id="bulkActionExportButton" type="button" title={t('actions.export')} onClick={() => exportRows(selected())}>
                  <Icon name="b_export" /> {t('actions.export')}
                </button>
                <button className="btn btn-outline-secondary" id="bulkActionDropButton" type="button" title={t('actions.drop')} onClick={() => askDrop(selected())}>
                  <Icon name="b_drop" /> {t('actions.drop')}
                </button>
              </div>
            </div>

            <div className="ms-auto">
              <div className="input-group">
                <span className="input-group-text">
                  <Icon name="b_search" title={tApp('search')} />
                </span>
                <input className="form-control" name="filterText" type="text" id="filterText" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={tApp('search')} aria-label={tApp('search')} />
              </div>
            </div>
          </>
        )}

        <div className={data.rows.length > 0 ? 'ms-2' : undefined}>
          <Link className="ajax add_anchor btn btn-primary" to={`${base}/create`} role="button">
            <Icon name="b_plus" /> {t('create_new')}
          </Link>
        </div>
      </div>

      <form id="sequencesForm" onSubmit={(e) => e.preventDefault()}>
        {data.rows.length === 0 ? (
          <div id="nothing2display">
            <div className="alert alert-primary" role="alert">
              <Icon name="s_notice" /> {t('none')}
            </div>
          </div>
        ) : (
          <table id="sequencesTable" className="table table-striped table-hover data w-auto">
            <thead>
              <tr>
                <th />
                <th>{t('columns.name')}</th>
                <th>{t('columns.current_value')}</th>
                <th>{t('columns.increment')}</th>
                <th>{t('columns.minimum')}</th>
                <th>{t('columns.maximum')}</th>
                <th>{t('columns.cache')}</th>
                <th>{t('columns.cycled')}</th>
                <th>{t('columns.owned_by')}</th>
                <th>{t('columns.comment')}</th>
                <th colSpan={3} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.oid}>
                  <td>
                    <input type="checkbox" className="checkall" checked={checked.has(row.oid)} onChange={(e) => toggle(row.oid, e.target.checked)} aria-label={row.name} />
                  </td>
                  <td>
                    <strong>{row.name}</strong>
                    {row.relpersistence && <span className="badge bg-secondary ms-2">UNLOGGED</span>}
                  </td>
                  <td className="text-end font-monospace">{String(row.current_value)}</td>
                  <td className="text-end font-monospace">{String(row.increment)}</td>
                  <td className="text-end font-monospace">{String(row.minimum)}</td>
                  <td className="text-end font-monospace">{String(row.maximum)}</td>
                  <td className="text-end font-monospace">{String(row.cache)}</td>
                  <td>{row.cycled ? tApp('yes') : tApp('no')}</td>
                  <td>{row.owned_table ? `${row.owned_table}.${row.owned_column}` : ''}</td>
                  <td>{row.comment}</td>
                  <td>
                    <Link className="ajax edit_anchor" to={`${base}/${encodeURIComponent(row.name)}/edit`}>
                      <Icon name="b_edit" /> {t('actions.edit')}
                    </Link>
                  </td>
                  <td>
                    <a className="ajax export_anchor" href="#export" onClick={(e) => { e.preventDefault(); exportRows([row]) }}>
                      <Icon name="b_export" /> {t('actions.export')}
                    </a>
                  </td>
                  <td>
                    <a className="ajax drop_anchor" href="#drop" onClick={(e) => { e.preventDefault(); askDrop([row]) }}>
                      <Icon name="b_drop" /> {t('actions.drop')}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </form>

      <Modal show={exported !== null} title={exported?.title ?? ''} size="lg" onClose={() => setExported(null)}>
        {exported?.sql === null ? tApp('loading') : <SqlView sql={exported?.sql ?? ''} />}
      </Modal>

      <ConfirmQuery
        show={confirm !== null}
        sql={(confirm?.sql ?? []).map((s) => (cascade ? s.replace(/;$/, ' CASCADE;') : s))}
        confirmLabel={tApp('ok')}
        onClose={() => setConfirm(null)}
        onConfirm={() => { const pending = confirm; setConfirm(null); if (pending) void pending.run() }}
      >
        {confirm?.cascadeBox && (
          <div className="form-check mt-2">
            <input className="form-check-input" type="checkbox" id="confirm_cascade" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />
            <label className="form-check-label" htmlFor="confirm_cascade">
              {t('cascade')}
            </label>
          </div>
        )}
      </ConfirmQuery>
    </div>
  )
}

/** The CASCADE box as last rendered, for the pending drop to read. */
const cascadeRef: { current: boolean } = { current: false }
