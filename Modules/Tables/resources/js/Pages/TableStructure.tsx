import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
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
 * columns with their type, collation, attributes, nullability, default, comment and the
 * per-column actions; then the indexes (indexes.twig), the constraints, and the Information
 * card with space usage and row statistics (display_table_stats.twig).
 */
export default function TableStructure() {
  const { t } = useTranslation('tables')
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

  return (
    <>
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
                <th colSpan={5} className="action d-print-none">
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
                      <input type="checkbox" className="checkall" name="selected_fld[]" value={column.name} id={`checkbox_row_${index + 1}`} />
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
                    <td className="text-nowrap d-print-none">
                      {isPrimary ? (
                        <span className="text-muted">
                          <Icon name="b_primary" title={t('structure.actions.primary')} /> {t('structure.actions.primary')}
                        </span>
                      ) : (
                        <Link to={`${href}/constraints/add?type=primary_key&columns=${encodeURIComponent(column.name)}`}>
                          <Icon name="b_primary" title={t('structure.actions.primary')} /> {t('structure.actions.primary')}
                        </Link>
                      )}
                    </td>
                    <td className="text-nowrap d-print-none">
                      <Link to={`${href}/constraints/add?type=unique_constraint&columns=${encodeURIComponent(column.name)}`}>
                        <Icon name="b_unique" title={t('structure.actions.unique')} /> {t('structure.actions.unique')}
                      </Link>
                    </td>
                    <td className="text-nowrap d-print-none">
                      <Link to={`${href}/indexes/add?columns=${encodeURIComponent(column.name)}`}>
                        <Icon name="b_index" title={t('structure.actions.index')} /> {t('structure.actions.index')}
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </form>
      <hr className="d-print-none" />

      <div className="row">
        <div className="col-lg-7 col-12">
          <div className="card index_info mb-3">
            <div className="card-header" id="index_header">
              {t('structure.indexes')}
            </div>
            <div className="card-body">
              {data.indexes.length === 0 ? (
                <div className="alert alert-primary mb-0 no_indexes_defined">{t('structure.no_indexes')}</div>
              ) : (
                <div className="table-responsive">
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
                              <Icon name="b_edit" title={t('structure.actions.change')} /> {t('structure.actions.change')}
                            </Link>
                          </td>
                          <td className="d-print-none">
                            <Link to={`${href}/indexes/${index.oid}/drop`}>
                              <Icon name="b_drop" title={t('structure.actions.drop')} /> {t('structure.actions.drop')}
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
          </div>

          <div className="card mb-3">
            <div className="card-header">{t('structure.constraints')}</div>
            <div className="card-body">
              {allConstraints.length === 0 ? (
                <div className="alert alert-primary mb-0">{t('structure.no_constraints')}</div>
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
        </div>

        <div className="col-lg-5 col-12">
          <Information table={data.table} statistics={data.statistics} />
        </div>
      </div>
    </>
  )
}

/** phpMyAdmin's Information card: the comment, the space usage and the row statistics. */
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
                  <Fragment key={column.name}>
                    <tr>
                      <th className="name">{column.name}</th>
                      <td className="value">{stats[column.name] === null ? '' : String(stats[column.name])}</td>
                    </tr>
                  </Fragment>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
