import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import Modal from '@/components/Modal'
import SqlView from '@/components/SqlView'
import { treeState } from '@/layout/tree/treeState'
import { notify, notifyError, notifySuccess } from '@/notify'
import { urls } from '@/level'
import { qualifiedName, quoteIdent } from '@sql/js/sql'
import { PrivilegesLink } from '@roles/js/PrivilegesSection'
import { dropRoutineRow, listRoutineRows, resolveSchema, ROW_LABELS, routineRowSql, type Aggregate, type Operator, type Routine, type RoutineKind, type RoutineRow as Row } from '../api'
import AggregateDialog from '../dialogs/AggregateDialog'
import OperatorDialog from '../dialogs/OperatorDialog'
import ExecuteDialog from '../ExecuteDialog'

/**
 * The schema's "Routines" page, after phpMyAdmin's database/routines/index.twig: the heading,
 * the check-all / Export / Drop group, the filter box and the "Create new routine" button, then
 * the table of routines with their type and return type and the Edit, Execute, Export and Drop
 * links per row. Export shows the CREATE statement; Execute asks for the arguments and runs the
 * call on the SQL page. The schema's aggregates and operators are listed with the routines
 * and edited in dialogs, opened by the "Create new" menu, a row's Edit or the tree
 * (?edit=aggregate:OID or ?edit=operator:OID).
 */
export default function Routines() {
  const { t } = useTranslation('routines')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '' } = useParams()
  const navigate = useNavigate()
  const { data, error, reload } = useRequest(async () => {
    const scid = await resolveSchema(db, schema)

    return { scid, rows: await listRoutineRows(db, scid) }
  }, [db, schema])
  const [filter, setFilter] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<{ sql: string[]; run: () => Promise<void> } | null>(null)
  const [exported, setExported] = useState<{ title: string; sql: string | null } | null>(null)
  const [executing, setExecuting] = useState<Row | null>(null)
  const [editing, setEditing] = useState<{ kind: 'aggregate'; row: Aggregate | null } | { kind: 'operator'; row: Operator | null } | null>(null)
  const [createMenu, setCreateMenu] = useState(false)
  const createRoot = useRef<HTMLDivElement>(null)
  const [search, setSearch] = useSearchParams()

  // The tree links an aggregate or operator here with ?edit=<kind>:<oid>; open its dialog once the rows are in.
  useEffect(() => {
    const edit = search.get('edit')
    if (!edit || !data) return
    const [kind, oid] = edit.split(':')
    const row = data.rows.find((r) => r.kind === kind && String(r.oid) === oid)
    if (row?.kind === 'aggregate') setEditing({ kind: 'aggregate', row })
    else if (row?.kind === 'operator') setEditing({ kind: 'operator', row })
    setSearch((current) => {
      const next = new URLSearchParams(current)
      next.delete('edit')

      return next
    }, { replace: true })
  }, [search, data, setSearch])

  useEffect(() => {
    if (!createMenu) return
    const close = (e: MouseEvent) => {
      if (!createRoot.current?.contains(e.target as Node)) setCreateMenu(false)
    }
    document.addEventListener('mousedown', close)

    return () => document.removeEventListener('mousedown', close)
  }, [createMenu])
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
  const isRoutine = (row: Row): row is Routine & { kind: RoutineKind } => row.kind !== 'aggregate' && row.kind !== 'operator'

  /** The DROP a row's kind takes: a routine or aggregate by its argument types, an operator by its operands. */
  function dropStatement(row: Row): string {
    switch (row.kind) {
      case 'aggregate':
        return `DROP AGGREGATE ${qualifiedName(schema, row.name)}(${row.input_types});`
      case 'operator':
        return `DROP OPERATOR ${quoteIdent(schema)}.${row.name} (${row.lefttype ?? 'NONE'}, ${row.righttype ?? 'NONE'});`
      default:
        return `DROP ${row.kind === 'procedure' ? 'PROCEDURE' : 'FUNCTION'} ${qualifiedName(schema, row.name)}(${row.proargtypenames});`
    }
  }

  function saved() {
    setEditing(null)
    treeState.refresh()
    reload()
  }

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
    Promise.all(targets.map((row) => routineRowSql(db, scid, row))).then(
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
            await dropRoutineRow(db, scid, row)
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
          <div className="btn-group dropdown" ref={createRoot}>
            <Link className="ajax add_anchor btn btn-primary" to={`${base}/create`} role="button">
              <Icon name="b_routine_add" /> {t('create_new')}
            </Link>
            <button type="button" className="btn btn-primary dropdown-toggle dropdown-toggle-split" aria-expanded={createMenu} aria-label={t('create_other')} onClick={() => setCreateMenu((open) => !open)} />
            <ul className={`dropdown-menu dropdown-menu-end${createMenu ? ' show' : ''}`} data-bs-popper="static" onClick={() => setCreateMenu(false)}>
              <li>
                <a className="dropdown-item" href="#create-aggregate" onClick={(e) => { e.preventDefault(); setEditing({ kind: 'aggregate', row: null }) }}>
                  {t('aggregate.create_title')}
                </a>
              </li>
              <li>
                <a className="dropdown-item" href="#create-operator" onClick={(e) => { e.preventDefault(); setEditing({ kind: 'operator', row: null }) }}>
                  {t('operator.create_title')}
                </a>
              </li>
            </ul>
          </div>
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
                <th colSpan={5} />
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
                  <td>{ROW_LABELS[row.kind]}</td>
                  <td dir="ltr">{row.kind === 'procedure' ? '' : row.kind === 'aggregate' ? row.final_type : row.kind === 'operator' ? row.resulttype : row.prorettypename}</td>
                  <td>
                    {isRoutine(row) ? (
                      <Link className="ajax edit_anchor" to={`${base}/${row.kind}/${row.oid}/edit`}>
                        <Icon name="b_edit" /> {t('actions.edit')}
                      </Link>
                    ) : (
                      <a className="ajax edit_anchor" href="#edit" onClick={(e) => { e.preventDefault(); setEditing(row.kind === 'aggregate' ? { kind: 'aggregate', row } : { kind: 'operator', row }) }}>
                        <Icon name="b_edit" /> {t('actions.edit')}
                      </a>
                    )}
                  </td>
                  <td>{isRoutine(row) && <PrivilegesLink to={`${base}/${row.kind}/${row.oid}/edit`} />}</td>
                  <td>
                    {(row.kind === 'function' || row.kind === 'procedure') && (
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

      <AggregateDialog show={editing?.kind === 'aggregate'} db={db} scid={scid} aggregate={editing?.kind === 'aggregate' ? editing.row : null} onClose={() => setEditing(null)} onSaved={saved} />
      <OperatorDialog show={editing?.kind === 'operator'} db={db} scid={scid} operator={editing?.kind === 'operator' ? editing.row : null} onClose={() => setEditing(null)} onSaved={saved} />

      <ExecuteDialog
        show={executing !== null}
        db={db}
        scid={scid}
        routine={executing && isRoutine(executing) ? executing : null}
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
