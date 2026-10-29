import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { notAvailable } from '@/unbuilt'
import { urls, useLevel, type RelationKind } from '@/level'
import { relationColumns, type RelationColumn } from '../api'
import DateTimeInput from '../fields/DateTimeInput'
import ForeignSelect from '../fields/ForeignSelect'
import { fieldKind, fractionDigits, hasTimeZone, inputDataType, integerRange, validationError, type DateKind } from '../fields/kinds'
import QueryResults from '../results/QueryResults'
import { defaultMaxRows, type GridNav } from '../results/ResultsGrid'
import { useGridActions } from '../results/useGridActions'
import { qualifiedName, quoteIdent, quoteLiteral } from '../sql'
import { useQueryRunner } from '../useQueryRunner'

/** phpMyAdmin's operators per type class (Types::getTypeOperators), with PostgreSQL's case-insensitive and regexp forms. */
const TEXT_OPERATORS = ['LIKE', 'LIKE %...%', 'NOT LIKE', 'NOT LIKE %...%', 'ILIKE', 'ILIKE %...%', 'NOT ILIKE', '=', '!=', 'REGEXP', 'REGEXP ^...$', 'NOT REGEXP', "= ''", "!= ''", 'IN (...)', 'NOT IN (...)', 'BETWEEN', 'NOT BETWEEN']
const NUMBER_OPERATORS = ['=', '>', '>=', '<', '<=', '!=', 'LIKE', 'LIKE %...%', 'NOT LIKE', 'NOT LIKE %...%', 'IN (...)', 'NOT IN (...)', 'BETWEEN', 'NOT BETWEEN']
const UUID_OPERATORS = ['=', '!=', 'LIKE', 'LIKE %...%', 'NOT LIKE', 'NOT LIKE %...%', 'IN (...)', 'NOT IN (...)']
const ENUM_OPERATORS = ['=', '!=']
const NULL_OPERATORS = ['IS NULL', 'IS NOT NULL']
const UNARY = new Set([...NULL_OPERATORS, "= ''", "!= ''"])

/** The operators a column's type class gets, as Types::getTypeOperators: text and binary types the LIKE family, an enum equality only, the rest the comparisons. */
function operatorsFor(column: RelationColumn): string[] {
  const kind = fieldKind(column)
  let base: string[]
  if (kind === 'enum') base = ENUM_OPERATORS
  else if (kind === 'uuid') base = UUID_OPERATORS
  else if (kind === 'char' || kind === 'text' || kind === 'json' || kind === 'binary' || column.type_name.startsWith('_')) base = TEXT_OPERATORS
  else base = NUMBER_OPERATORS

  return column.nullable ? [...base, ...NULL_OPERATORS] : base
}

interface Criterion {
  operator: string
  value: string
  /** What phpMyAdmin's rules for the column object to in the value, shown after the field. */
  error?: string | null
}

/**
 * phpMyAdmin's table search (table/search/index.twig): a "query by example" row per column
 * with its operator and value, the extra options (columns to show, DISTINCT, a WHERE body of
 * your own, rows per page, order), and the matching rows in the results grid under the form.
 */
export default function Search() {
  const { t } = useTranslation('sql')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '', table = '' } = useParams()
  const kind: RelationKind = useLevel().kind ?? 'table'
  const navigate = useNavigate()
  const { data: info, error } = useRequest(() => relationColumns(db, schema, table), [db, schema, table])
  const columns = useMemo(() => info?.columns ?? [], [info])

  const [criteria, setCriteria] = useState<Record<string, Criterion>>({})
  const [shown, setShown] = useState<string[] | null>(null)
  const [distinct, setDistinct] = useState(false)
  const [customWhere, setCustomWhere] = useState('')
  const [maxRows, setMaxRows] = useState(defaultMaxRows())
  const [orderBy, setOrderBy] = useState('')
  const [direction, setDirection] = useState<'ASC' | 'DESC'>('ASC')
  const [extraOpen, setExtraOpen] = useState(false)
  const [sql, setSql] = useState<string | null>(null)
  const [nav, setNav] = useState<GridNav>({ pos: 0, maxRows: defaultMaxRows(), order: [] })
  const runner = useQueryRunner(db)

  const relationUrl = urls.relation(db, schema, table, kind)
  const first = runner.response?.results[0]
  const actions = useGridActions({
    db,
    source: runner.response?.source ?? null,
    result: first?.kind === 'rows' ? first : null,
    reload: () => sql !== null && run(sql, nav),
    changeUrl: `${relationUrl}/change`,
  })

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!info) return null

  const selected = shown ?? columns.map((c) => c.name)

  function criterion(name: string, column: RelationColumn): Criterion {
    return criteria[name] ?? { operator: operatorsFor(column)[0], value: '' }
  }

  /** A change to a criterion: the number rules run on every value of an IN or BETWEEN list, as verifyAfterSearchFieldChange does. */
  function setCriterion(column: RelationColumn, next: Criterion) {
    const kind = fieldKind(column)
    let error: string | null = null
    if ((kind === 'int' || kind === 'float') && !next.operator.includes('LIKE')) {
      const values = next.operator.includes('IN') || next.operator.includes('BETWEEN') ? next.value.split(',').map((v) => v.trim()) : [next.value.trim()]
      const problem = values.map((v) => validationError(column, v)).find(Boolean)
      error = problem ? t(`fields.${problem.key}`, problem.params) : null
    }
    setCriteria((c) => ({ ...c, [column.name]: { ...next, error } }))
  }

  /** The query the form stands for, as phpMyAdmin's Search::buildSqlQuery composes it. */
  function buildSql(): string {
    const list = selected.length === columns.length ? '*' : selected.map(quoteIdent).join(', ')
    let query = `SELECT ${distinct ? 'DISTINCT ' : ''}${list} FROM ${qualifiedName(schema, table)}`
    const where = customWhere.trim() !== '' ? customWhere.trim() : columns.map((c) => condition(c, criterion(c.name, c))).filter(Boolean).join(' AND ')
    if (where !== '') query += ` WHERE ${where}`
    if (orderBy !== '') query += ` ORDER BY ${quoteIdent(orderBy)} ${direction}`

    return query
  }

  function run(statement: string, next: GridNav) {
    setNav(next)
    void runner.run({ sql: statement, limit: next.maxRows, offset: next.pos, order: next.order, count: true })
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const invalid = columns.findIndex((c) => criteria[c.name]?.error)
    if (invalid !== -1) {
      document.getElementById(`fieldID_${invalid}`)?.focus()

      return
    }
    const statement = buildSql()
    setSql(statement)
    run(statement, { pos: 0, maxRows, order: [] })
  }

  return (
    <>
      <ul className="nav nav-pills m-2">
        <li className="nav-item">
          <Link className="nav-link active disableAjax" to={`${relationUrl}/search`}>
            <Icon name="b_search" /> {t('search.table_search')}
          </Link>
        </li>
        <li className="nav-item">
          <a className="nav-link disableAjax" href="#zoom" onClick={notAvailable}>
            <Icon name="b_select" /> {t('search.zoom_search')}
          </a>
        </li>
        <li className="nav-item">
          <a className="nav-link disableAjax" href="#find-replace" onClick={notAvailable}>
            <Icon name="b_find_replace" /> {t('search.find_replace')}
          </a>
        </li>
      </ul>

      <form name="insertForm" id="tbl_search_form" className="ajax lock-page" onSubmit={submit}>
        <div className="card">
          <div className="card-header">{t('search.legend')}</div>
          <div className="card-body">
            <div id="fieldset_table_qbe">
              <div className="table-responsive-md jsresponsive">
                <table className="table table-striped table-hover table-sm w-auto">
                  <thead>
                    <tr>
                      <th>{t('search.column')}</th>
                      <th>{t('search.type')}</th>
                      <th>{t('search.collation')}</th>
                      <th>{t('search.operator')}</th>
                      <th>{t('search.value')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((column, index) => {
                      const current = criterion(column.name, column)
                      const unary = UNARY.has(current.operator)

                      return (
                        <tr key={column.name} className="noclick">
                          <th>{column.name}</th>
                          <td dir="ltr">{column.type}</td>
                          <td>{column.collation ?? ''}</td>
                          <td>
                            <select
                              className="column-operator"
                              id={`ColumnOperator${index}`}
                              name={`criteriaColumnOperators[${index}]`}
                              value={current.operator}
                              onChange={(e) => setCriterion(column, { ...current, operator: e.target.value })}
                            >
                              {operatorsFor(column).map((op) => (
                                <option key={op} value={op}>
                                  {op}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td data-type={column.type_name}>
                            {!unary && <CriterionInput db={db} column={column} index={index} criterion={current} onChange={(value) => setCriterion(column, { ...current, value })} />}
                            {!unary && current.error && (
                              <label className="error" htmlFor={`fieldID_${index}`}>
                                {current.error}
                              </label>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <button className="btn btn-sm btn-secondary" type="button" aria-expanded={extraOpen} aria-controls="searchExtraOptions" onClick={() => setExtraOpen((o) => !o)}>
                {t('grid.extra_options')}
              </button>
            </div>
            <div className={`collapse mt-3${extraOpen ? ' show' : ''}`} id="searchExtraOptions">
              <fieldset>
                <div className="mb-3">
                  <label className="form-label" htmlFor="columnsToDisplaySelect">
                    {t('search.select_columns')}
                  </label>
                  <select
                    className="form-select resize-vertical"
                    id="columnsToDisplaySelect"
                    name="columnsToDisplay[]"
                    size={Math.min(columns.length, 10)}
                    multiple
                    value={selected}
                    onChange={(e) => setShown([...e.target.selectedOptions].map((o) => o.value))}
                  >
                    {columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-check mb-3">
                  <input className="form-check-input" type="checkbox" name="distinct" value="DISTINCT" id="oDistinct" checked={distinct} onChange={(e) => setDistinct(e.target.checked)} />
                  <label className="form-check-label" htmlFor="oDistinct" dir="ltr" lang="en">
                    DISTINCT
                  </label>
                </div>
              </fieldset>

              <div className="mb-3">
                <label className="form-label" htmlFor="customWhereClauseInput">
                  <em>{t('search.or')}</em> {t('search.custom_where')}{' '}
                  <a href="https://www.postgresql.org/docs/current/functions.html" target="_blank" rel="noopener noreferrer">
                    <Icon name="b_help" title={tApp('postgresql_documentation')} />
                  </a>
                </label>
                <input className="form-control" id="customWhereClauseInput" type="text" name="customWhereClause" size={64} value={customWhere} onChange={(e) => setCustomWhere(e.target.value)} />
              </div>

              <div className="mb-3">
                <label className="form-label" htmlFor="maxRowsInput">
                  {t('search.rows_per_page')}
                </label>
                <input className="form-control" id="maxRowsInput" type="number" name="session_max_rows" min={1} value={maxRows} required onChange={(e) => setMaxRows(Math.max(1, Number(e.target.value) || 1))} />
              </div>

              <fieldset>
                <legend className="visually-hidden">{t('search.display_order')}</legend>
                <div className="mb-3">
                  <label className="form-label" htmlFor="orderByColumnSelect">
                    {t('search.order_by')}
                  </label>
                  <select className="form-select" id="orderByColumnSelect" name="orderByColumn" value={orderBy} onChange={(e) => setOrderBy(e.target.value)}>
                    <option value="" />
                    {columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-check">
                  <input className="form-check-input" type="radio" name="order" id="orderByAscRadio" value="ASC" checked={direction === 'ASC'} onChange={() => setDirection('ASC')} />
                  <label className="form-check-label" htmlFor="orderByAscRadio">
                    {t('grid.ascending')}
                  </label>
                </div>
                <div className="form-check">
                  <input className="form-check-input" type="radio" name="order" id="orderByDescRadio" value="DESC" checked={direction === 'DESC'} onChange={() => setDirection('DESC')} />
                  <label className="form-check-label" htmlFor="orderByDescRadio">
                    {t('grid.descending')}
                  </label>
                </div>
              </fieldset>
            </div>
          </div>
          <div className="card-footer">
            <input className="btn btn-primary" type="submit" name="submit" value={tApp('go')} />
          </div>
        </div>
      </form>

      {runner.error && (
        <div className="alert alert-danger" role="alert">
          {runner.error.message}
        </div>
      )}
      {runner.response && (
        <QueryResults
          response={runner.response}
          nav={nav}
          onNavigate={(next) => sql !== null && run(sql, next)}
          edit={(statement) => `${relationUrl}/sql?${new URLSearchParams({ sql: statement })}`}
          onExplain={(statement) => navigate(`${relationUrl}/sql?${new URLSearchParams({ sql: statement, run: '1' })}`)}
          onRefresh={() => sql !== null && run(sql, nav)}
          grid={{ rowActions: actions.rowActions, bulkActions: actions.bulkActions, cellEditor: actions.cellEditor }}
        />
      )}
      {actions.modal}
    </>
  )
}

/**
 * One column's condition, as phpMyAdmin's Search::getWhereClause writes it: the value quoted,
 * "%…%" wrapped for the LIKE %...% operators, split on commas for IN and BETWEEN; "" when the
 * value is empty and the operator needs one.
 */
function condition(column: RelationColumn, { operator, value }: Criterion): string {
  const name = quoteIdent(column.name)
  if (UNARY.has(operator)) return `${name} ${operator}`
  if (value === '') return ''

  const regexp = (op: string) => (op === 'REGEXP' ? '~' : op === 'NOT REGEXP' ? '!~' : op)

  switch (operator) {
    case 'LIKE %...%':
      return `${name} LIKE ${quoteLiteral(`%${value}%`)}`
    case 'NOT LIKE %...%':
      return `${name} NOT LIKE ${quoteLiteral(`%${value}%`)}`
    case 'ILIKE %...%':
      return `${name} ILIKE ${quoteLiteral(`%${value}%`)}`
    case 'REGEXP ^...$':
      return `${name} ~ ${quoteLiteral(`^${value}$`)}`
    case 'IN (...)':
    case 'NOT IN (...)': {
      const values = value.split(',').map((v) => v.trim())
      const nulls = values.some((v) => v === '')
      const parts: string[] = []
      const list = values.filter((v) => v !== '').map(quoteLiteral)
      if (list.length > 0) parts.push(`${name} ${operator.replace(' (...)', '')} (${list.join(', ')})`)
      if (nulls) parts.push(`${name} IS NULL`)

      return parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0] ?? ''
    }
    case 'BETWEEN':
    case 'NOT BETWEEN': {
      const [from = '', to = ''] = value.split(',').map((v) => v.trim())

      return `${name} ${operator} ${quoteLiteral(from)} AND ${quoteLiteral(to)}`
    }
    default:
      return `${name} ${regexp(operator)} ${quoteLiteral(value)}`
  }
}

interface CriterionInputProps {
  db: string
  column: RelationColumn
  index: number
  criterion: Criterion
  onChange: (value: string) => void
}

/**
 * The value box of one criterion, as table/search/input_box.twig picks it: a foreign key's
 * dropdown, an enum's select, a date or timestamp field with its picker (a time gets none),
 * a text field with the type's range for the number rules otherwise.
 */
function CriterionInput({ db, column, index, criterion, onChange }: CriterionInputProps) {
  const id = `fieldID_${index}`
  const name = `criteriaValues[${index}]`
  const kind = fieldKind(column)

  if (column.foreign_key) {
    return <ForeignSelect db={db} foreignKey={column.foreign_key} id={id} name={name} label={column.name} value={criterion.value} onChange={onChange} />
  }

  if (kind === 'enum') {
    return (
      <select name={name} id={id} value={criterion.value} onChange={(e) => onChange(e.target.value)} aria-label={column.name}>
        <option value="" />
        {(column.enum_values ?? []).map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    )
  }

  if (kind === 'date' || kind === 'datetime') {
    return <DateTimeInput kind={kind as DateKind} decimals={fractionDigits(column)} withTimeZone={hasTimeZone(column)} name={name} id={id} size={40} data-type={inputDataType(column)} value={criterion.value} onValueChange={onChange} aria-label={column.name} />
  }

  const range = kind === 'int' ? integerRange(column.type_name) : null
  const listed = criterion.operator.includes('IN') || criterion.operator.includes('BETWEEN') || criterion.operator.includes('LIKE')

  return (
    <input
      type="text"
      inputMode={!listed && kind === 'int' ? 'numeric' : !listed && kind === 'float' ? 'decimal' : undefined}
      name={name}
      data-type={inputDataType(column) || column.type_name.toUpperCase()}
      data-min={range?.[0]}
      data-max={range?.[1]}
      size={40}
      className="textfield"
      id={id}
      value={criterion.value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={column.name}
    />
  )
}
