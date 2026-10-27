import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
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
import { dropRoutine, KIND_LABELS, listRoutines, resolveSchema, routines as routinesOf, type Routine, type RoutineKind } from '../api'
import ExecuteDialog from '../ExecuteDialog'

type Row = Routine & { kind: RoutineKind }

/**
 * The schema's "Routines" page, after phpMyAdmin's database/routines/index.twig: the heading,
 * the check-all / Export / Drop group, the filter box and the "Create new routine" button, then
 * the table of routines with their type and return type and the Edit, Execute, Export and Drop
 * links per row. Export shows the CREATE statement; Execute asks for the arguments and runs the
 * call on the SQL page.
 */
export default function Routines() {
  const { t } = useTranslation('routines')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '' } = useParams()
  const navigate = useNavigate()
  const { data, error, reload } = useRequest(async () => {
    const scid = await resolveSchema(db, schema)

    return { scid, rows: await listRoutines(db, scid) }
  }, [db, schema])
  const [filter, setFilter] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<{ sql: string[]; run: () => Promise<void> } | null>(null)
  const [exported, setExported] = useState<{ title: string; sql: string | null } | null>(null)
  const [executing, setExecuting] = useState<Row | null>(null)
  const rows = useMemo(() => {
    const needle = filter.trim().toUpperCase()

    return (data?.rows ?? []).filter((row) => needle === '' || row.signature.toUpperCase().includes(needle))
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
  const base = `${urls.schema(db, schema)}/routines`
  const keyOf = (row: Row) => `${row.kind}_${row.oid}`
  const allChecked = rows.length > 0 && rows.every((row) => checked.has(keyOf(row)))
  const selected = () => rows.filter((row) => checked.has(keyOf(row)))
  const dropStatement = (row: Row) => `DROP ${row.kind === 'procedure' ? 'PROCEDURE' : 'FUNCTION'} ${qualifiedName(schema, row.name)}(${row.proargtypenames});`

  function toggle(key: string, value: boolean) {
    setChecked((current) => {
      const next = new Set(current)
      if (value) next.add(key)
      else next.delete(key)

      return next
    })
  }

  /** phpMyAdmin's Export: the CREATE statement(s) in a dialog. */
  function exportRows(targets: Row[]) {
    if (targets.length === 0) return notify(t('none_selected'), 'error')
    setExported({ title: targets.length === 1 ? t('export_title', { name: targets[0].signature }) : t('export_title_many'), sql: null })
    Promise.all(targets.map((row) => routinesOf(db, scid, row.kind).sql(row.oid))).then(
      (parts) => setExported((current) => (current ? { ...current, sql: parts.join('\n\n') } : null)),
      (e: unknown) => {
        setExported(null)
        notifyError(errorMessage(e))
      },
    )
  }

  function askDrop(targets: Row[]) {
    if (targets.length === 0) return notify(t('none_selected'), 'error')
    setConfirm({
      sql: targets.map(dropStatement),
      run: async () => {
        let done = 0
        try {
          for (const row of targets) {
            await dropRoutine(db, scid, row.kind, row.oid)
            done++
          }
          notifySuccess(targets.length === 1 ? t('dropped', { name: targets[0].signature }) : t('dropped_many', { count: done }))
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

  return (
    <div className="container-fluid my-3">
      <h2>
        <Icon name="b_routines" /> {t('title')}
      </h2>

      <div className="d-flex flex-wrap my-3">
        {data.rows.length > 0 && (
          <>
            <div>
              <div className="input-group">
                <div className="input-group-text">
                  <div className="form-check mb-0">
                    <input className="form-check-input checkall_box" type="checkbox" id="checkAllCheckbox" checked={allChecked} onChange={(e) => setChecked(e.target.checked ? new Set(rows.map(keyOf)) : new Set())} />
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
            <Icon name="b_routine_add" /> {t('create_new')}
          </Link>
        </div>
      </div>

      <form id="rteListForm" className="ajax" onSubmit={(e) => e.preventDefault()}>
        {data.rows.length === 0 ? (
          <div id="nothing2display">
            <div className="alert alert-primary" role="alert">
              <Icon name="s_notice" /> {t('none')}
            </div>
          </div>
        ) : (
          <table id="routinesTable" className="table table-striped table-hover data w-auto">
            <thead>
              <tr>
                <th />
                <th>{t('columns.name')}</th>
                <th>{t('columns.type')}</th>
                <th>{t('columns.returns')}</th>
                <th colSpan={4} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={keyOf(row)} data-filter-row={row.signature.toUpperCase()}>
                  <td>
                    <input type="checkbox" className="checkall" name="item_name[]" value={row.signature} checked={checked.has(keyOf(row))} onChange={(e) => toggle(keyOf(row), e.target.checked)} aria-label={row.signature} />
                  </td>
                  <td>
                    <strong>{row.signature}</strong>
                  </td>
                  <td>{KIND_LABELS[row.kind]}</td>
                  <td dir="ltr">{row.kind === 'procedure' ? '' : row.prorettypename}</td>
                  <td>
                    <Link className="ajax edit_anchor" to={`${base}/${row.kind}/${row.oid}/edit`}>
                      <Icon name="b_edit" /> {t('actions.edit')}
                    </Link>
                  </td>
                  <td>
                    {row.kind !== 'trigger_function' && (
                      <a className="ajax exec_anchor" href="#execute" onClick={(e) => { e.preventDefault(); setExecuting(row) }}>
                        <Icon name="b_nextpage" /> {t('actions.execute')}
                      </a>
                    )}
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

      <ConfirmQuery show={confirm !== null} sql={confirm?.sql ?? ''} confirmLabel={tApp('ok')} onClose={() => setConfirm(null)} onConfirm={() => { const pending = confirm; setConfirm(null); if (pending) void pending.run() }} />

      <ExecuteDialog
        show={executing !== null}
        db={db}
        scid={scid}
        routine={executing}
        schema={schema}
        onClose={() => setExecuting(null)}
        onRun={(sql) => {
          setExecuting(null)
          navigate(`${urls.schema(db, schema)}/sql?${new URLSearchParams({ sql, run: '1' })}`)
        }}
      />
    </div>
  )
}
