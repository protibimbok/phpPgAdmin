import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import { constraints as constraintsOf, exclusionOptions, type Column, type Constraint, type ConstraintType, type ExclusionConstraintData, type ExclusionOptions, type TableOptions } from '../api'

export interface ConstraintDialogProps {
  show: boolean
  db: string
  scid: number
  tid: number
  columns: Column[]
  options?: TableOptions | null
  /** The constraint to edit; a new one of the given type when left out. */
  constraint?: { type: ConstraintType; row: Constraint } | null
  newType?: ConstraintType
  onClose: () => void
  onSaved: () => void
}

/** One column of an exclusion constraint as the form edits it. */
interface ExclusionRow {
  name: string
  opClass: string
  desc: boolean
  nullsFirst: boolean
  operator: string
}

const emptyRow = (name = ''): ExclusionRow => ({ name, opClass: '', desc: false, nullsFirst: false, operator: '' })

/**
 * A small dialog in the index dialog's shape for the constraints phpMyAdmin has no page for:
 * it renames and comments an existing one (what ALTER CONSTRAINT allows) and adds a check,
 * unique, primary key or exclusion constraint. The exclusion form follows pgAdmin's: the
 * access method, one row per column with its operator class, order (btree only) and operator,
 * and the INCLUDE list, fillfactor, tablespace, WHERE and deferral under "Advanced options".
 */
export default function ConstraintDialog({ show, db, scid, tid, columns, options = null, constraint, newType = 'check_constraint', onClose, onSaved }: ConstraintDialogProps) {
  const { t } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const type = constraint?.type ?? newType
  const exclusion = !constraint && type === 'exclusion_constraint'
  const [name, setName] = useState('')
  const [comment, setComment] = useState('')
  const [expression, setExpression] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [method, setMethod] = useState('gist')
  const [rows, setRows] = useState<ExclusionRow[]>([])
  const [addCount, setAddCount] = useState(1)
  const [advanced, setAdvanced] = useState(false)
  const [include, setInclude] = useState<string[]>([])
  const [fillfactor, setFillfactor] = useState('')
  const [tablespace, setTablespace] = useState('')
  const [where, setWhere] = useState('')
  const [deferrable, setDeferrable] = useState(false)
  const [deferred, setDeferred] = useState(false)
  const [notValid, setNotValid] = useState(false)
  const [nullsNotDistinct, setNullsNotDistinct] = useState(false)
  const [lookups, setLookups] = useState<ExclusionOptions>({ oper_classes: [], operators: {} })
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!show) return
    setName(constraint?.row.name ?? '')
    setComment(constraint?.row.comment ?? '')
    setExpression(constraint?.row.consrc ?? '')
    setChosen([])
    setMethod('gist')
    setRows([emptyRow(columns[0]?.name ?? '')])
    setAddCount(1)
    setAdvanced(false)
    setInclude([])
    setFillfactor('')
    setTablespace('')
    setWhere('')
    setDeferrable(false)
    setDeferred(false)
    setNotValid(false)
    setNullsNotDistinct(false)
  }, [show, constraint, columns])

  const typeOf = (columnName: string) => columns.find((c) => c.name === columnName)?.cltype ?? ''
  const pickedTypes = useMemo(() => [...new Set(rows.map((row) => typeOf(row.name)).filter(Boolean))], [rows, columns]) // eslint-disable-line react-hooks/exhaustive-deps
  const typesKey = pickedTypes.join('\u0000')

  // The operator classes follow the access method and the operators the types of the columns picked.
  useEffect(() => {
    if (!show || !exclusion) return
    let stale = false
    exclusionOptions(db, scid, tid, method, pickedTypes).then(
      (found) => {
        if (!stale) setLookups(found)
      },
      (e: unknown) => notifyError(errorMessage(e)),
    )

    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, exclusion, db, scid, tid, method, typesKey])

  const btree = method === 'btree'
  const picked = rows.filter((row) => row.name !== '')

  function data(): Record<string, unknown> {
    if (constraint) return { name: name || undefined, comment }
    // convalidated true adds NOT VALID: the check templates read pgAdmin's inverted flag.
    if (type === 'check_constraint') return { name: name || undefined, consrc: expression, convalidated: notValid, comment: comment || undefined }
    if (exclusion) {
      const exclude: ExclusionConstraintData = {
        name: name || undefined,
        amname: method,
        columns: picked.map((row) => ({
          column: row.name,
          oper_class: row.opClass || undefined,
          ...(btree ? { order: !row.desc, nulls_order: row.nullsFirst } : {}),
          operator: row.operator,
        })),
        include: include.filter(Boolean),
        indconstraint: where || undefined,
        fillfactor: fillfactor || undefined,
        spcname: tablespace || undefined,
        condeferrable: deferrable,
        condeferred: deferrable && deferred,
        comment: comment || undefined,
      }

      return exclude as unknown as Record<string, unknown>
    }

    return {
      name: name || undefined,
      columns: chosen.filter(Boolean).map((column) => ({ column })),
      comment: comment || undefined,
      ...(type === 'unique_constraint' && nullsNotDistinct ? { indnullsnotdistinct: true } : {}),
    }
  }

  /** The reason the exclusion form cannot be saved yet, if any. */
  function incomplete(): string | null {
    if (!exclusion) return null
    if (picked.length === 0) return t('constraint_dialog.no_columns')
    if (picked.some((row) => row.operator.trim() === '')) return t('constraint_dialog.no_operator')

    return null
  }

  function showPreview() {
    const problem = incomplete()
    if (problem) return notifyError(problem)
    setPreview({ sql: null, error: null })
    constraintsOf(db, scid, tid, type)
      .modifiedSql(data(), constraint?.row.oid)
      .then(
        (sql) => setPreview({ sql, error: null }),
        (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
      )
  }

  async function save() {
    const problem = incomplete()
    if (problem) return notifyError(problem)
    setBusy(true)
    try {
      if (constraint) await constraintsOf(db, scid, tid, type).update(constraint.row.oid, data())
      else await constraintsOf(db, scid, tid, type).create(data())
      notifySuccess(tApp('query_executed'))
      onSaved()
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const updateRow = (i: number, patch: Partial<ExclusionRow>) => setRows((current) => current.map((row, j) => (j === i ? { ...row, ...patch } : row)))

  const field = (id: string, label: string, control: React.ReactNode) => (
    <div>
      <div className="label">
        <strong>
          <label htmlFor={id}>{label}</label>
        </strong>
      </div>
      {control}
    </div>
  )

  return (
    <>
      <Modal
        show={show}
        onClose={onClose}
        id="constraintDialogModal"
        size={exclusion ? 'lg' : undefined}
        title={constraint ? t('constraint_dialog.edit_title', { name: constraint.row.name }) : t('constraint_dialog.add_title', { type: t(`structure.constraint_types.${type}`) })}
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
        <form id="index_frm" onSubmit={(e) => { e.preventDefault(); void save() }}>
          <fieldset className="pma-fieldset">
            <div className="index_info">
              {field('input_constraint_name', t('constraint_dialog.name'), <input type="text" id="input_constraint_name" size={25} maxLength={63} value={name} onChange={(e) => setName(e.target.value)} />)}

              {!constraint && type === 'check_constraint' &&
                field('input_constraint_expression', t('constraint_dialog.expression'), <input type="text" id="input_constraint_expression" size={30} value={expression} onChange={(e) => setExpression(e.target.value)} placeholder="price > 0" required />)}

              {!constraint && type === 'check_constraint' && (
                <div>
                  <input type="checkbox" id="constraint_not_valid" checked={notValid} onChange={(e) => setNotValid(e.target.checked)} />{' '}
                  <label htmlFor="constraint_not_valid">{t('constraint_dialog.not_valid')}</label>
                </div>
              )}

              {!constraint && type === 'unique_constraint' && (options?.version ?? 0) >= 150000 && (
                <div>
                  <input type="checkbox" id="constraint_nulls_not_distinct" checked={nullsNotDistinct} onChange={(e) => setNullsNotDistinct(e.target.checked)} />{' '}
                  <label htmlFor="constraint_nulls_not_distinct">NULLS NOT DISTINCT</label>
                </div>
              )}

              {!constraint && type !== 'check_constraint' && !exclusion &&
                field(
                  'select_constraint_columns',
                  t('constraint_dialog.columns'),
                  <select id="select_constraint_columns" multiple size={Math.min(8, Math.max(3, columns.length))} value={chosen} onChange={(e) => setChosen(Array.from(e.target.selectedOptions, (o) => o.value))}>
                    {columns.map((column) => (
                      <option key={column.attnum} value={column.name}>
                        {column.name} [{column.displaytypname}]
                      </option>
                    ))}
                  </select>,
                )}

              {exclusion &&
                field(
                  'select_constraint_method',
                  t('constraint_dialog.access_method'),
                  <select id="select_constraint_method" value={method} onChange={(e) => setMethod(e.target.value)}>
                    {[...new Set([method, ...(options?.exclusion_methods ?? ['btree', 'gist', 'spgist', 'hash'])])].map((am) => (
                      <option key={am} value={am}>
                        {am.toUpperCase()}
                      </option>
                    ))}
                  </select>,
                )}

              {constraint?.row.consrc && (
                <div>
                  <div className="label">
                    <strong>{t('constraint_dialog.expression')}</strong>
                  </div>
                  <code dir="ltr">{constraint.row.consrc}</code>
                </div>
              )}
              {constraint && !constraint.row.consrc && constraint.row.definition && (
                <div>
                  <div className="label">
                    <strong>{t('constraint_dialog.definition')}</strong>
                  </div>
                  <code dir="ltr">{constraint.row.definition}</code>
                </div>
              )}

              {!exclusion && field('input_constraint_comment', t('constraint_dialog.comment'), <input type="text" id="input_constraint_comment" size={30} maxLength={1024} value={comment} onChange={(e) => setComment(e.target.value)} />)}

              {exclusion && (
                <>
                  <div className="mb-3">
                    <button className="btn btn-sm btn-secondary" type="button" aria-expanded={advanced} aria-controls="constraintAdvancedOptions" onClick={() => setAdvanced((o) => !o)}>
                      {t('constraint_dialog.advanced')}
                    </button>
                  </div>
                  <div className={`collapse mb-3${advanced ? ' show' : ''}`} id="constraintAdvancedOptions">
                    {field(
                      'select_constraint_include',
                      t('constraint_dialog.include'),
                      <select id="select_constraint_include" multiple size={Math.min(5, Math.max(2, columns.length))} value={include} onChange={(e) => setInclude(Array.from(e.target.selectedOptions, (o) => o.value))}>
                        {columns.map((column) => (
                          <option key={column.attnum} value={column.name}>
                            {column.name} [{column.displaytypname}]
                          </option>
                        ))}
                      </select>,
                    )}
                    {field('input_constraint_fillfactor', t('constraint_dialog.fillfactor'), <input type="text" id="input_constraint_fillfactor" size={30} value={fillfactor} onChange={(e) => setFillfactor(e.target.value)} />)}
                    {field(
                      'select_constraint_tablespace',
                      t('constraint_dialog.tablespace'),
                      <select id="select_constraint_tablespace" value={tablespace} onChange={(e) => setTablespace(e.target.value)}>
                        <option value="" />
                        {(options?.tablespaces ?? []).map((space) => (
                          <option key={space} value={space}>
                            {space}
                          </option>
                        ))}
                      </select>,
                    )}
                    {field('input_constraint_where', t('constraint_dialog.where'), <input type="text" id="input_constraint_where" size={30} value={where} onChange={(e) => setWhere(e.target.value)} />)}
                    <div>
                      <input type="checkbox" id="constraint_deferrable" checked={deferrable} onChange={(e) => setDeferrable(e.target.checked)} />{' '}
                      <label htmlFor="constraint_deferrable">{t('constraint_dialog.deferrable')}</label>
                      &nbsp;&nbsp;
                      <input type="checkbox" id="constraint_deferred" checked={deferred} disabled={!deferrable} onChange={(e) => setDeferred(e.target.checked)} />{' '}
                      <label htmlFor="constraint_deferred">{t('constraint_dialog.deferred')}</label>
                    </div>
                    {field('input_constraint_comment', t('constraint_dialog.comment'), <input type="text" id="input_constraint_comment" size={30} maxLength={1024} value={comment} onChange={(e) => setComment(e.target.value)} />)}
                  </div>

                  <div className="clearfloat" />

                  <table className="table align-middle" id="index_columns">
                    <thead>
                      <tr>
                        <th>{t('constraint_dialog.column')}</th>
                        <th>{t('constraint_dialog.oper_class')}</th>
                        {btree && <th>{t('constraint_dialog.order')}</th>}
                        {btree && <th>{t('constraint_dialog.nulls')}</th>}
                        <th>{t('constraint_dialog.operator')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => {
                        const operators = lookups.operators[typeOf(row.name)] ?? []

                        return (
                          <tr className="noclick" key={i}>
                            <td>
                              <select value={row.name} aria-label={t('constraint_dialog.column')} onChange={(e) => updateRow(i, { name: e.target.value, operator: '' })}>
                                <option value="">-- {t('constraint_dialog.ignore')} --</option>
                                {columns.map((column) => (
                                  <option key={column.attnum} value={column.name}>
                                    {column.name} [{column.displaytypname}]
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <select value={row.opClass} aria-label={t('constraint_dialog.oper_class')} onChange={(e) => updateRow(i, { opClass: e.target.value })}>
                                <option value="">{t('constraint_dialog.default_class')}</option>
                                {lookups.oper_classes.map((opc) => (
                                  <option key={opc} value={opc}>
                                    {opc}
                                  </option>
                                ))}
                              </select>
                            </td>
                            {btree && (
                              <td>
                                <select value={row.desc ? 'DESC' : 'ASC'} aria-label={t('constraint_dialog.order')} onChange={(e) => updateRow(i, { desc: e.target.value === 'DESC' })}>
                                  <option value="ASC">ASC</option>
                                  <option value="DESC">DESC</option>
                                </select>
                              </td>
                            )}
                            {btree && (
                              <td>
                                <select value={row.nullsFirst ? 'FIRST' : 'LAST'} aria-label={t('constraint_dialog.nulls')} onChange={(e) => updateRow(i, { nullsFirst: e.target.value === 'FIRST' })}>
                                  <option value="FIRST">NULLS FIRST</option>
                                  <option value="LAST">NULLS LAST</option>
                                </select>
                              </td>
                            )}
                            <td>
                              <input type="text" list={`constraint_operators_${i}`} size={6} value={row.operator} placeholder="&&" aria-label={t('constraint_dialog.operator')} onChange={(e) => updateRow(i, { operator: e.target.value })} />
                              <datalist id={`constraint_operators_${i}`}>
                                {operators.map((op) => (
                                  <option key={op} value={op} />
                                ))}
                              </datalist>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div className="add_more">
                    <input type="number" className="mx-2" min={1} max={16} value={addCount} onChange={(e) => setAddCount(Math.max(1, Number(e.target.value) || 1))} aria-label={t('constraint_dialog.add_columns', { count: addCount })} />
                    <div className="add_fields">
                      <input className="btn btn-secondary" type="button" value={t('constraint_dialog.add_columns', { count: addCount })} onClick={() => setRows((current) => [...current, ...Array.from({ length: addCount }, () => emptyRow())])} />
                    </div>
                  </div>
                </>
              )}
            </div>
          </fieldset>
        </form>
      </Modal>

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </>
  )
}
