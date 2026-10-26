import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { notAvailable } from '@/unbuilt'
import { formatSize } from '@/format'
import { urls } from '@/level'
import type { Statistics } from '@/nodes/client'
import { columns, constraints, indexes, resolveTable, tables, type Column, type Constraint, type ConstraintType, type Index, type Table } from '../api'

const CONSTRAINT_TYPES: ConstraintType[] = ['primary_key', 'unique_constraint', 'foreign_key', 'check_constraint', 'exclusion_constraint']

interface Loaded {
  scid: number
  tid: number
  table: Table
  columns: Column[]
  indexes: Index[]
  constraints: { type: ConstraintType; rows: Constraint[] }[]
  statistics: Statistics | null
}

/**
 * A table's "Structure" page, after phpMyAdmin's table/structure/display_structure.twig: the
 * pills to the relation view, the columns with their type, collation, attributes, nullability,
 * default, comment, extra and the Change / Drop / More actions, the "With selected" bar, the
 * Print and Show create links, the add-columns form, then the Indexes card (indexes.twig), a
 * Constraints card and the Information card (display_table_stats.twig).
 */
export default function TableStructure() {
  const { t } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '', table = '' } = useParams()
  const { data, error } = useRequest(async (): Promise<Loaded> => {
    const { scid, tid } = await resolveTable(db, schema, table)
    const [properties, cols, idx, cons, statistics] = await Promise.all([
      tables(db, scid).properties(tid),
      columns(db, scid, tid).list(),
      indexes(db, scid, tid).list(),
      Promise.all(CONSTRAINT_TYPES.map((type) => constraints(db, scid, tid, type).list().then((rows) => ({ type, rows })))),
      tables(db, scid).statistics(tid).catch(() => null),
    ])

    return { scid, tid, table: properties, columns: cols, indexes: idx, constraints: cons, statistics }
  }, [db, schema, table])
  const [checked, setChecked] = useState<Set<number>>(new Set())

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  const href = urls.relation(db, schema, table, 'table')
  const primaryColumns = new Set((data.columns[0]?.indkey ?? '').split(' ').filter(Boolean).map(Number))
  const allConstraints = data.constraints.flatMap(({ type, rows }) => rows.map((row) => ({ type, row })))
  const allChecked = data.columns.length > 0 && data.columns.every((column) => checked.has(column.attnum))
  const last = data.columns[data.columns.length - 1]

  function toggle(attnum: number, value: boolean) {
    setChecked((current) => {
      const next = new Set(current)
      if (value) next.add(attnum)
      else next.delete(attnum)

      return next
    })
  }

  return (
    <>
      <ul className="nav nav-pills m-2 d-print-none">
        <li className="nav-item">
          <Link to={href} id="table_structure_id" className="nav-link active">
            <Icon name="b_props" /> {t('structure_bar.table_structure')}
          </Link>
        </li>
        <li className="nav-item">
          <a href="#constraints" id="table_relation_id" className="nav-link">
            <Icon name="b_relations" /> {t('structure_bar.relation_view')}
          </a>
        </li>
      </ul>

      <div id="structure_content">
        <form name="fieldsForm" id="fieldsForm" onSubmit={(e) => e.preventDefault()}>
          <div className="table-responsive-md">
            <table id="tablestructure" className="table table-striped table-hover w-auto align-middle">
              <thead>
                <tr>
                  <th className="d-print-none" />
                  <th>{t('structure.columns.number')}</th>
                  <th>{t('structure.columns.name')}</th>
                  <th>{t('structure.columns.type')}</th>
                  <th>{t('structure.columns.collation')}</th>
                  <th>{t('structure.columns.attributes')}</th>
                  <th>{t('structure.columns.null')}</th>
                  <th>{t('structure.columns.default')}</th>
                  <th>{t('structure.columns.comments')}</th>
                  <th>{t('structure.columns.extra')}</th>
                  <th colSpan={3} className="action d-print-none">
                    {t('structure.columns.action')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.columns.map((column, index) => {
                  const isPrimary = primaryColumns.has(column.attnum)

                  return (
                    <tr key={column.attnum}>
                      <td className="text-center d-print-none">
                        <input
                          type="checkbox"
                          className="checkall"
                          name="selected_fld[]"
                          value={column.name}
                          id={`checkbox_row_${index + 1}`}
                          checked={checked.has(column.attnum)}
                          onChange={(e) => toggle(column.attnum, e.target.checked)}
                        />
                      </td>
                      <td className="text-end">{index + 1}</td>
                      <th className="text-nowrap">
                        <label htmlFor={`checkbox_row_${index + 1}`}>
                          {column.description ? (
                            <span className="commented_column" title={column.description}>
                              {column.name}
                            </span>
                          ) : (
                            column.name
                          )}{' '}
                          {isPrimary && <Icon name="b_primary" title={t('structure.actions.primary')} />}
                          {column.is_fk && <Icon name="b_relations" title={t('structure.constraint_types.foreign_key')} />}
                        </label>
                      </th>
                      <td className="text-nowrap">
                        <bdo dir="ltr" lang="en">
                          {column.displaytypname}
                        </bdo>
                      </td>
                      <td>{column.collspcname}</td>
                      <td className="column_attribute text-nowrap">
                        {column.inheritedfrom ? t('structure.inherited_from', { table: column.inheritedfrom }) : ''}
                      </td>
                      <td>{column.attnotnull ? t('structure.no') : t('structure.yes')}</td>
                      <td className="text-nowrap">
                        {column.colconstype === 'g' ? (
                          <em>{column.genexpr}</em>
                        ) : column.defval !== null ? (
                          column.defval
                        ) : column.attnotnull ? (
                          <em>{t('structure.none')}</em>
                        ) : (
                          <em>{t('structure.null_value')}</em>
                        )}
                      </td>
                      <td>{column.description}</td>
                      <td className="text-nowrap">
                        {column.colconstype === 'i' && `${t('structure.identity')} (${column.attidentity === 'a' ? 'ALWAYS' : 'BY DEFAULT'})`}
                        {column.colconstype === 'g' && t('structure.generated')}
                      </td>
                      <td className="edit text-center d-print-none">
                        <Link to={`${href}/columns/${column.attnum}/change`} className="change_column_anchor">
                          <Icon name="b_edit" title={t('structure.actions.change')} /> {t('structure.actions.change')}
                        </Link>
                      </td>
                      <td className="drop text-center d-print-none">
                        <Link to={`${href}/columns/${column.attnum}/drop`} className="drop_column_anchor">
                          <Icon name="b_drop" title={t('structure.actions.drop')} /> {t('structure.actions.drop')}
                        </Link>
                      </td>
                      <td className="d-print-none">
                        <More label={tApp('more')}>
                          <li className="primary text-nowrap">
                            {isPrimary ? (
                              <span className="dropdown-item-text disabled">
                                <Icon name="b_primary" /> {t('structure.actions.primary')}
                              </span>
                            ) : (
                              <Link className="dropdown-item" to={`${href}/constraints/add?type=primary_key&columns=${encodeURIComponent(column.name)}`}>
                                <Icon name="b_primary" /> {t('structure.actions.primary')}
                              </Link>
                            )}
                          </li>
                          <li className="add_unique unique text-nowrap">
                            <Link className="dropdown-item" to={`${href}/constraints/add?type=unique_constraint&columns=${encodeURIComponent(column.name)}`}>
                              <Icon name="b_unique" /> {t('structure.actions.unique')}
                            </Link>
                          </li>
                          <li className="add_index text-nowrap">
                            <Link className="dropdown-item" to={`${href}/indexes/add?columns=${encodeURIComponent(column.name)}`}>
                              <Icon name="b_index" /> {t('structure.actions.index')}
                            </Link>
                          </li>
                          <li className="browse text-nowrap">
                            <Link className="dropdown-item" to={`${href}/browse?distinct=${encodeURIComponent(column.name)}`}>
                              <Icon name="b_browse" /> {t('structure.actions.browse')}
                            </Link>
                          </li>
                        </More>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* select_all.twig and the "With selected" buttons */}
          <div className="d-print-none">
            <Icon name="select_all_arrow" title={tApp('with_selected')} />
            <input type="checkbox" id="fieldsForm_checkall" className="checkall_box" title={tApp('check_all')} checked={allChecked} onChange={(e) => setChecked(e.target.checked ? new Set(data.columns.map((c) => c.attnum)) : new Set())} />{' '}
            <label htmlFor="fieldsForm_checkall">{tApp('check_all')}</label>
            <em className="with-selected">{tApp('with_selected')}</em>{' '}
            {(['browse', 'change', 'drop', 'primary', 'unique', 'index'] as const).map((action) => (
              <button key={action} className="btn btn-link mult_submit" type="button" title={checked.size === 0 ? tApp('check_all') : undefined}>
                <Icon name={{ browse: 'b_browse', change: 'b_edit', drop: 'b_drop', primary: 'b_primary', unique: 'b_unique', index: 'b_index' }[action]} /> {t(`structure_bar.${action}`)}
              </button>
            ))}
          </div>
        </form>
        <hr className="d-print-none" />

        <div className="d-print-none">
          <a href="#print" onClick={(e) => { e.preventDefault(); window.print() }}>
            <Icon name="b_print" /> {tApp('print')}
          </a>{' '}
          <Link to={`${href}/ddl`}>
            <Icon name="b_sql" /> {tApp('show_create')}
          </Link>
        </div>

        {/* "Add N column(s) after X" (display_structure.twig #addColumns): an inline form of bare
            controls. The form lands with phase 3. */}
        <form className="d-print-none" id="addColumns" name="addColumns" onSubmit={notAvailable}>
          <Icon name="b_insrow" title={t('structure_bar.add')} />
          &nbsp;{t('structure_bar.add')}{' '}
          <input type="number" name="num_fields" min={1} defaultValue={1} required aria-label={t('structure_bar.columns')} /> {t('structure_bar.columns')}
          &nbsp;
          <select name="after_field" aria-label={t('structure_bar.after', { column: '' })}>
            <option>{t('structure_bar.at_start')}</option>
            {last && <option>{t('structure_bar.after', { column: last.name })}</option>}
            <option>{t('structure_bar.at_end')}</option>
          </select>{' '}
          <input className="btn btn-primary" type="submit" value={tApp('go')} />
        </form>

        <div className="card index_info">
          <div className="card-header" id="index_header">
            {t('structure.indexes')}
          </div>
          <div className="card-body">
            {data.indexes.length === 0 ? (
              <div className="alert alert-primary no_indexes_defined">{t('structure.no_indexes')}</div>
            ) : (
              <div className="table-responsive jsresponsive">
                <table className="table table-striped table-hover table-sm w-auto align-middle" id="table_index">
                  <thead>
                    <tr>
                      <th colSpan={2} className="d-print-none">
                        {t('structure.index_columns.action')}
                      </th>
                      <th>{t('structure.index_columns.keyname')}</th>
                      <th>{t('structure.index_columns.type')}</th>
                      <th>{t('structure.index_columns.unique')}</th>
                      <th>{t('structure.index_columns.definition')}</th>
                      <th>{t('structure.index_columns.comment')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.indexes.map((index) => (
                      <tr key={index.oid} className="noclick">
                        <td className="edit_index d-print-none">
                          <Link to={`${href}/indexes/${index.oid}/edit`}>
                            <Icon name="b_edit" /> {t('structure.actions.change')}
                          </Link>
                        </td>
                        <td className="d-print-none">
                          <Link to={`${href}/indexes/${index.oid}/drop`}>
                            <Icon name="b_drop" /> {t('structure.actions.drop')}
                          </Link>
                        </td>
                        <th>{index.name}</th>
                        <td>{index.amname.toUpperCase()}</td>
                        <td>{index.indisunique ? t('structure.yes') : t('structure.no')}</td>
                        <td>
                          <code dir="ltr">{index.definition.replace(/^.*\bUSING\b/i, 'USING')}</code>
                        </td>
                        <td>{index.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="card-footer d-print-none">
            <form onSubmit={notAvailable}>
              {t('structure_bar.create_index')}
              <input className="mx-2" type="number" min={1} max={16} defaultValue={1} aria-label={t('structure_bar.columns_word')} />
              {t('structure_bar.columns_word')} <input className="btn btn-primary add_index" type="submit" value={tApp('go')} />
            </form>
          </div>
        </div>

        <div className="card" id="constraints">
          <div className="card-header">{t('structure.constraints')}</div>
          <div className="card-body">
            {allConstraints.length === 0 ? (
              <div className="alert alert-primary">{t('structure.no_constraints')}</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-striped table-hover table-sm w-auto align-middle">
                  <thead>
                    <tr>
                      <th>{t('structure.constraint_columns.name')}</th>
                      <th>{t('structure.constraint_columns.type')}</th>
                      <th>{t('structure.constraint_columns.definition')}</th>
                      <th>{t('structure.constraint_columns.comment')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allConstraints.map(({ type, row }) => (
                      <tr key={`${type}_${row.oid}`}>
                        <th>{row.name}</th>
                        <td className="text-nowrap">{t(`structure.constraint_types.${type}`)}</td>
                        <td>
                          <code dir="ltr">{row.definition}</code>
                        </td>
                        <td>{row.comment}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <Information table={data.table} statistics={data.statistics} />
      </div>
    </>
  )
}

/** phpMyAdmin's "More" dropdown of the column actions (HideStructureActions). */
function More({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)

    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="dropdown" ref={root}>
      <button className="btn btn-link p-0 dropdown-toggle" type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      <ul className={`dropdown-menu dropdown-menu-end${open ? ' show' : ''}`} data-bs-popper="static" onClick={() => setOpen(false)}>
        {children}
      </ul>
    </div>
  )
}

/** phpMyAdmin's Information card: the comment, then space usage and row statistics side by side. */
function Information({ table, statistics }: { table: Table; statistics: Statistics | null }) {
  const { t } = useTranslation('tables')
  const stats = statistics?.rows[0] ?? null
  const number = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0))
  const tableSize = stats ? number(stats['Table size']) : null
  const indexSize = stats ? number(stats['Indexes size']) : null
  const toastSize = stats && stats['Toast table size'] !== null && stats['Toast table size'] !== undefined ? String(stats['Toast table size']) : null

  return (
    <div id="tablestatistics" className="card">
      <div className="card-header">{t('structure.information')}</div>
      <div className="card-body">
        {table.description && (
          <>
            <strong>{t('structure.table_comments')}</strong>
            <em>
              <pre>{table.description}</pre>
            </em>
          </>
        )}

        {tableSize !== null && (
          <table className="table table-striped table-hover table-sm w-auto caption-top">
            <caption>{t('structure.space_usage')}</caption>
            <tbody>
              <tr>
                <th className="name">{t('structure.space.data')}</th>
                <td className="value">{formatSize(tableSize)}</td>
              </tr>
              <tr>
                <th className="name">{t('structure.space.index')}</th>
                <td className="value">{formatSize(indexSize ?? 0)}</td>
              </tr>
              {toastSize && (
                <tr>
                  <th className="name">{t('structure.space.toast')}</th>
                  <td className="value">{toastSize}</td>
                </tr>
              )}
              <tr>
                <th className="name">{t('structure.space.total')}</th>
                <td className="value">{formatSize(table.size)}</td>
              </tr>
            </tbody>
          </table>
        )}

        <table className="table table-striped table-hover table-sm w-auto caption-top">
          <caption>{t('structure.row_statistics')}</caption>
          <tbody>
            <tr>
              <th className="name">{t('structure.stats.type')}</th>
              <td className="value">{table.is_partitioned ? t('structure.stats.partitioned') : t('structure.stats.table')}</td>
            </tr>
            <tr>
              <th className="name">{t('structure.stats.rows')}</th>
              <td className="value">{table.reltuples < 0 ? '?' : Math.round(table.reltuples).toLocaleString()}</td>
            </tr>
            <tr>
              <th className="name">{t('structure.stats.owner')}</th>
              <td className="value">{table.relowner}</td>
            </tr>
            <tr>
              <th className="name">{t('structure.stats.tablespace')}</th>
              <td className="value">{table.spcname}</td>
            </tr>
          </tbody>
        </table>

        {stats && (
          <table className="table table-striped table-hover table-sm w-auto caption-top">
            <caption>{t('structure.statistics')}</caption>
            <tbody>
              {statistics!.columns
                .filter((column) => !['Table size', 'Indexes size', 'Toast table size'].includes(column.name))
                .map((column) => (
                  <tr key={column.name}>
                    <th className="name">{column.name}</th>
                    <td className="value">{stats[column.name] === null ? '' : String(stats[column.name])}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
        <div className="clearfloat" />
      </div>
    </div>
  )
}
