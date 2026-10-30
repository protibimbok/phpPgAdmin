import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import { urls } from '@/level'
import { notify, notifySuccess } from '@/notify'
import { diagram, type DesignerTable } from '@designer/js/api'
import { quoteIdent, quoteLiteral } from '../sql'

/** phpMyAdmin's criteria operators, as PostgreSQL writes them: REGEXP is ~. */
const OPERATORS = ['=', '>', '>=', '<', '<=', '!=', 'LIKE', 'LIKE %...%', 'NOT LIKE', 'NOT LIKE %...%', 'IN (...)', 'NOT IN (...)', 'BETWEEN', 'NOT BETWEEN', 'IS NULL', 'IS NOT NULL', 'REGEXP', 'REGEXP ^...$', 'NOT REGEXP'] as const
type Operator = (typeof OPERATORS)[number]
const WITHOUT_ARGUMENT: Operator[] = ['IS NULL', 'IS NOT NULL']

interface Column {
  id: number
  /** "schema.table", the table's key; "" when none is chosen. */
  table: string
  column: string
  show: boolean
  tableAlias: string
  columnAlias: string
  criteria: boolean
  sort: '' | 'ASC' | 'DESC'
  logical: 'AND' | 'OR'
  opColumn: string
  op: Operator
  rhs: 'text' | 'anotherColumn'
  text: string
  rhsTable: string
  rhsColumn: string
}

const blank = (id: number): Column => ({ id, table: '', column: '', show: true, tableAlias: '', columnAlias: '', criteria: false, sort: '', logical: 'AND', opColumn: '', op: '=', rhs: 'text', text: '', rhsTable: '', rhsColumn: '' })

const keyOf = (t: DesignerTable) => `${t.schema}.${t.name}`

/** A criterion's right-hand side for text: one literal, a list (IN), two (BETWEEN), with LIKE's and REGEXP's wrapping. */
function condition(c: Column, ref: string, tables: Map<string, DesignerTable>, aliasOf: (key: string) => string): string {
  const lhs = `${ref}.${quoteIdent(c.opColumn || c.column)}`
  if (WITHOUT_ARGUMENT.includes(c.op)) return `${lhs} ${c.op}`
  if (c.rhs === 'anotherColumn') {
    const other = tables.get(c.rhsTable)
    const otherRef = other ? aliasOf(c.rhsTable) : quoteIdent(c.rhsTable)
    return `${lhs} ${c.op.replace(/ .*$/, '').replace('REGEXP', '~')} ${otherRef}.${quoteIdent(c.rhsColumn)}`
  }
  const values = c.text.split(',').map((v) => v.trim())
  switch (c.op) {
    case 'LIKE %...%':
      return `${lhs} LIKE ${quoteLiteral(`%${c.text}%`)}`
    case 'NOT LIKE %...%':
      return `${lhs} NOT LIKE ${quoteLiteral(`%${c.text}%`)}`
    case 'IN (...)':
    case 'NOT IN (...)':
      return `${lhs} ${c.op.replace(' (...)', '')} (${[...new Set(values)].map(quoteLiteral).join(', ')})`
    case 'BETWEEN':
    case 'NOT BETWEEN':
      return `${lhs} ${c.op} ${quoteLiteral(values[0] ?? '')} AND ${quoteLiteral(values[1] ?? '')}`
    case 'REGEXP':
      return `${lhs} ~ ${quoteLiteral(c.text)}`
    case 'REGEXP ^...$':
      return `${lhs} ~ ${quoteLiteral(`^${c.text}$`)}`
    case 'NOT REGEXP':
      return `${lhs} !~ ${quoteLiteral(c.text)}`
    default:
      return `${lhs} ${c.op} ${quoteLiteral(c.text)}`
  }
}

/**
 * The query the columns make, as phpMyAdmin's query_generator.ts writes it: the columns shown
 * (with their aliases), FROM the tables used, each table after the first LEFT JOINed on a
 * foreign key it has with one already in the query (a comma otherwise), WHERE the criteria
 * joined by their AND/OR, ORDER BY the sorted columns.
 */
export function generateQuery(columns: Column[], tables: Map<string, DesignerTable>): string | null {
  const used = columns.filter((c) => c.table !== '' && c.column !== '')
  if (used.length === 0) return null
  const aliases = new Map<string, string>()
  for (const c of used) if (!aliases.has(c.table) || (c.tableAlias && !aliases.get(c.table))) aliases.set(c.table, c.tableAlias)
  const name = (key: string) => {
    const t = tables.get(key)
    return t ? `${quoteIdent(t.schema)}.${quoteIdent(t.name)}` : quoteIdent(key)
  }
  const aliasOf = (key: string) => (aliases.get(key) ? quoteIdent(aliases.get(key) as string) : name(key))

  const select = used
    .filter((c) => c.show)
    .map((c) => `${aliasOf(c.table)}.${c.column === '*' ? '*' : quoteIdent(c.column)}${c.columnAlias ? ` AS ${quoteIdent(c.columnAlias)}` : ''}`)
  const from: string[] = []
  const placed: string[] = []
  for (const key of aliases.keys()) {
    const table = tables.get(key)
    const alias = aliases.get(key) ? ` AS ${quoteIdent(aliases.get(key) as string)}` : ''
    let join = ''
    if (table && placed.length > 0) {
      // A foreign key of this table to one placed, or of a placed one to this.
      for (const other of placed) {
        const o = tables.get(other)
        if (!o) continue
        const out = table.foreign_keys.find((fk) => fk.ref_oid === o.oid)
        const back = o.foreign_keys.find((fk) => fk.ref_oid === table.oid)
        const fk = out ?? back
        if (!fk) continue
        const [from1, from2] = out ? [aliasOf(key), aliasOf(other)] : [aliasOf(other), aliasOf(key)]
        const on = fk.columns.map((col, i) => `${from1}.${quoteIdent(col)} = ${from2}.${quoteIdent(fk.ref_columns[i])}`).join(' AND ')
        join = `\n\tLEFT JOIN ${name(key)}${alias} ON ${on}`
        break
      }
    }
    from.push(join || `${placed.length > 0 ? '\n\t, ' : ''}${name(key)}${alias}`)
    placed.push(key)
  }

  let where = ''
  used
    .filter((c) => c.criteria)
    .forEach((c, i) => {
      where += `${i > 0 ? ` ${c.logical} ` : ''}${condition(c, aliasOf(c.table), tables, aliasOf)}`
    })
  const order = used.filter((c) => c.sort !== '' && c.column !== '*').map((c) => `${aliasOf(c.table)}.${quoteIdent(c.column)} ${c.sort}`)

  return `SELECT ${select.length > 0 ? select.join(', ') : '*'}\nFROM ${from.join('')}${where ? `\nWHERE ${where}` : ''}${order.length > 0 ? `\nORDER BY ${order.join(', ')}` : ''};`
}

/**
 * phpMyAdmin's database "Query" tab, its Multi-table query (database/multi_table_query/form.twig):
 * a card per column (table and column, Show, table and column aliases, and the criteria: sort,
 * AND/OR, the column, the operator and text or another column), "+ Add column", the query they
 * make (Update query), Copy query, and Submit query, which runs it on the SQL page. The tables,
 * columns and foreign keys are the Designer's, schema-qualified.
 */
export default function MultiTableQuery() {
  const db = useParams().db ?? ''
  const { t } = useTranslation('sql')
  const { t: tApp } = useTranslation()
  const navigate = useNavigate()
  const { data, error } = useRequest(() => diagram(db), [db])
  const [columns, setColumns] = useState<Column[]>(() => [blank(1), blank(2), blank(3)])
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(true)

  if (error) {
    return (
      <div className="alert alert-danger m-3" role="alert">
        {error.message}
      </div>
    )
  }
  const tables = new Map((data?.tables ?? []).map((x) => [keyOf(x), x]))
  const set = (id: number, patch: Partial<Column>) => setColumns((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const columnOptions = (key: string) => (
    <>
      <option value="">{t('mtq.select_column')}</option>
      {key !== '' && <option value="*">*</option>}
      {(tables.get(key)?.columns ?? []).map((col) => (
        <option key={col.name} value={col.name}>
          {col.name}
        </option>
      ))}
    </>
  )
  const tableOptions = (
    <>
      <option value="">{t('mtq.select_table')}</option>
      {[...tables.keys()].map((key) => (
        <option key={key} value={key}>
          {key}
        </option>
      ))}
    </>
  )

  function update() {
    const sql = generateQuery(columns, tables)
    if (sql === null) return notify(t('mtq.nothing_selected'), 'error')
    setQuery(sql)
  }

  return (
    <div className="container-fluid my-3">
      <div className="mb-3">
        <button className="btn btn-sm btn-secondary" type="button" aria-expanded={shown} aria-controls="queryWindow" onClick={() => setShown((s) => !s)}>
          {t('mtq.query_window')}
        </button>
      </div>
      {shown && (
        <div className="mb-3" id="queryWindow">
          <form onSubmit={(e) => e.preventDefault()}>
            <div className="card">
              <div className="card-body">
                <div className="row g-3 mb-3">
                  {columns.map((c) => (
                    <div className="col" key={c.id}>
                      <div className="card">
                        <fieldset className="card-body position-relative">
                          <select className="tableNameSelect" value={c.table} onChange={(e) => set(c.id, { table: e.target.value, column: '', opColumn: '' })}>
                            {tableOptions}
                          </select>
                          <span>.</span>
                          <select className="columnNameSelect" value={c.column} onChange={(e) => set(c.id, { column: e.target.value })}>
                            {columnOptions(c.table)}
                          </select>
                          <br />
                          <input type="checkbox" className="show_col" id={`show_${c.id}`} checked={c.show} onChange={(e) => set(c.id, { show: e.target.checked })} /> <label htmlFor={`show_${c.id}`}>{t('mtq.show')}</label>
                          <br />
                          <input type="text" placeholder={t('mtq.table_alias')} className="table_alias" value={c.tableAlias} onChange={(e) => set(c.id, { tableAlias: e.target.value })} />
                          <input type="text" placeholder={t('mtq.column_alias')} className="col_alias" value={c.columnAlias} onChange={(e) => set(c.id, { columnAlias: e.target.value })} />
                          <br />
                          <input type="checkbox" className="criteria_col" title={t('mtq.use_criteria')} checked={c.criteria} onChange={(e) => set(c.id, { criteria: e.target.checked })} />{' '}
                          <button className="btn btn-link p-0 jsCriteriaButton" type="button" onClick={() => set(c.id, { criteria: !c.criteria })}>
                            {t('mtq.criteria')}
                          </button>
                          {c.criteria && (
                            <div className="jsCriteriaOptions">
                              <table className="table table-sm table-borderless align-middle w-auto">
                                <tbody>
                                  <tr className="sort_order">
                                    <td>{t('mtq.sort')}</td>
                                    <td>
                                      <input type="radio" name={`sort_${c.id}`} checked={c.sort === 'ASC'} onChange={() => set(c.id, { sort: 'ASC' })} /> {t('mtq.ascending')}
                                    </td>
                                    <td>
                                      <input type="radio" name={`sort_${c.id}`} checked={c.sort === 'DESC'} onChange={() => set(c.id, { sort: 'DESC' })} /> {t('mtq.descending')}
                                    </td>
                                  </tr>
                                  <tr className="logical_operator">
                                    <td>{t('mtq.add_as')}</td>
                                    <td>
                                      <input type="radio" name={`logical_${c.id}`} className="logical_op" checked={c.logical === 'AND'} onChange={() => set(c.id, { logical: 'AND' })} /> AND
                                    </td>
                                    <td>
                                      <input type="radio" name={`logical_${c.id}`} className="logical_op" checked={c.logical === 'OR'} onChange={() => set(c.id, { logical: 'OR' })} /> OR
                                    </td>
                                  </tr>
                                  <tr>
                                    <td>{t('mtq.column')}</td>
                                    <td colSpan={2}>
                                      <select className="columnNameSelect opColumn" value={c.opColumn} onChange={(e) => set(c.id, { opColumn: e.target.value })}>
                                        {columnOptions(c.table)}
                                      </select>
                                    </td>
                                  </tr>
                                  <tr>
                                    <td>{t('mtq.op')}</td>
                                    <td>
                                      <select className="criteria_op" value={c.op} onChange={(e) => set(c.id, { op: e.target.value as Operator })}>
                                        {OPERATORS.map((op) => (
                                          <option key={op} value={op}>
                                            {op}
                                          </option>
                                        ))}
                                      </select>
                                    </td>
                                    <td>
                                      {!WITHOUT_ARGUMENT.includes(c.op) && (
                                        <select className="criteria_rhs" value={c.rhs} onChange={(e) => set(c.id, { rhs: e.target.value as Column['rhs'] })}>
                                          <option value="text">{t('mtq.text')}</option>
                                          <option value="anotherColumn">{t('mtq.another_column')}</option>
                                        </select>
                                      )}
                                    </td>
                                  </tr>
                                  {!WITHOUT_ARGUMENT.includes(c.op) && c.rhs === 'anotherColumn' && (
                                    <tr className="rhs_table">
                                      <td />
                                      <td>
                                        <select className="tableNameSelect" value={c.rhsTable} onChange={(e) => set(c.id, { rhsTable: e.target.value, rhsColumn: '' })}>
                                          {tableOptions}
                                        </select>
                                        <span>.</span>
                                      </td>
                                      <td>
                                        <select className="columnNameSelect" value={c.rhsColumn} onChange={(e) => set(c.id, { rhsColumn: e.target.value })}>
                                          {columnOptions(c.rhsTable)}
                                        </select>
                                      </td>
                                    </tr>
                                  )}
                                  {!WITHOUT_ARGUMENT.includes(c.op) && c.rhs === 'text' && (
                                    <tr className="rhs_text">
                                      <td />
                                      <td colSpan={2}>
                                        <input type="text" className="rhs_text_val" placeholder={t(c.op.includes('IN') && !c.op.includes('LIKE') ? 'mtq.free_text_list' : c.op.includes('BETWEEN') ? 'mtq.free_text_two' : 'mtq.free_text')} value={c.text} onChange={(e) => set(c.id, { text: e.target.value })} />
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          )}
                          <button type="button" className="btn-close position-absolute top-0 end-0 jsRemoveColumn" aria-label={t('mtq.remove_column')} onClick={() => setColumns((cs) => cs.filter((x) => x.id !== c.id))} />
                        </fieldset>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mb-3">
                  <input className="btn btn-secondary" type="button" value={t('mtq.add_column')} id="add_column_button" onClick={() => setColumns((cs) => [...cs, blank(Math.max(0, ...cs.map((x) => x.id)) + 1)])} />
                </div>

                <div>
                  <textarea id="MultiSqlquery" className="form-control font-monospace" cols={80} rows={4} name="sql_query" dir="ltr" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
              </div>

              <div className="card-footer">
                <input className="btn btn-secondary" type="button" id="update_query_button" value={t('mtq.update_query')} onClick={update} />{' '}
                <input
                  className="btn btn-secondary"
                  type="button"
                  id="copy_query"
                  value={t('mtq.copy_query')}
                  onClick={() => {
                    if (query === '') return notify(t('mtq.empty_query'), 'error')
                    void navigator.clipboard?.writeText(query)
                    notifySuccess(tApp('copied'))
                  }}
                />{' '}
                <input
                  className="btn btn-primary"
                  type="button"
                  id="submit_query"
                  value={t('mtq.submit_query')}
                  onClick={() => {
                    if (query.trim() === '') return notify(t('mtq.empty_query'), 'error')
                    navigate(`${urls.database(db)}/sql?${new URLSearchParams({ sql: query, run: '1' })}`)
                  }}
                />
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
