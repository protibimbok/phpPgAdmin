import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { formatSize } from '@/format'
import { urls, type RelationKind } from '@/level'
import { countRows, materializedViews, resolveSchema, tables, views, type Table, type View } from '../api'

interface Row {
  oid: number
  name: string
  kind: RelationKind
  typeKey: 'table' | 'partitioned' | 'view' | 'mview'
  /** The estimated row count, or null when it is not known. */
  rows: number | null
  size: number
  comment: string | null
  system: boolean
}

function fromTable(table: Table): Row {
  return {
    oid: table.oid,
    name: table.name,
    kind: 'table',
    typeKey: table.is_partitioned ? 'partitioned' : 'table',
    rows: table.reltuples < 0 ? null : Math.round(table.reltuples),
    size: table.size,
    comment: table.description,
    system: table.is_sys_table,
  }
}

function fromView(view: View, kind: 'view' | 'mview'): Row {
  return { oid: view.oid, name: view.name, kind, typeKey: kind, rows: null, size: view.size, comment: view.comment, system: false }
}

/**
 * A schema's "Structure" page: its tables, views and materialized views, laid out like
 * phpMyAdmin's database structure (database/structure/table_header.twig and
 * structure_table_row.twig): checkbox, name, the action icons, the estimated row count (click
 * for the exact one), type, size and comment, with the sums at the foot.
 */
export default function SchemaStructure() {
  const { t } = useTranslation('tables')
  const { db = '', schema = '' } = useParams()
  const { data, error } = useRequest(async () => {
    const scid = await resolveSchema(db, schema)
    const [tableRows, viewRows, mviewRows] = await Promise.all([tables(db, scid).list(), views(db, scid).list(), materializedViews(db, scid).list()])

    return {
      scid,
      rows: [...tableRows.map(fromTable), ...viewRows.map((v) => fromView(v, 'view')), ...mviewRows.map((v) => fromView(v, 'mview'))].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    }
  }, [db, schema])
  const [exact, setExact] = useState<Record<number, number>>({})

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) {
    return null
  }

  const { scid, rows } = data

  if (rows.length === 0) {
    return (
      <div className="alert alert-primary" role="alert">
        {t('none')}
      </div>
    )
  }

  const sumRows = rows.reduce((sum, row) => sum + (exact[row.oid] ?? row.rows ?? 0), 0)
  const sumSize = rows.reduce((sum, row) => sum + row.size, 0)

  function count(row: Row) {
    void countRows(db, scid, row.oid).then((n) => setExact((current) => ({ ...current, [row.oid]: n })))
  }

  return (
    <div id="tableslistcontainer">
      <div className="table-responsive">
        <table className="table table-striped table-hover table-sm w-auto data">
          <thead>
            <tr>
              <th className="d-print-none" />
              <th>{t('columns.table')}</th>
              <th colSpan={6} className="d-print-none">
                {t('columns.action')}
              </th>
              <th>
                {t('columns.rows')} <Icon name="b_help" title={t('columns.rows_hint')} />
              </th>
              <th>{t('columns.type')}</th>
              <th>{t('columns.size')}</th>
              <th>{t('columns.comment')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = urls.relation(db, schema, row.name, row.kind)
              const isTable = row.kind === 'table'

              return (
                <tr key={`${row.kind}_${row.oid}`} className={isTable ? undefined : 'is_view'}>
                  <td className="text-center d-print-none">
                    <input type="checkbox" name="selected_tbl[]" value={row.name} />
                  </td>
                  <th>
                    <Link to={`${href}/browse`}>{row.name}</Link>
                    {row.system && <span className="badge bg-secondary ms-2">{t('system')}</span>}
                  </th>
                  <td className="text-center d-print-none">
                    <Link to={`${href}/browse`}>
                      <Icon name="b_browse" title={t('actions.browse')} /> {t('actions.browse')}
                    </Link>
                  </td>
                  <td className="text-center d-print-none">
                    <Link to={href}>
                      <Icon name="b_props" title={t('actions.structure')} /> {t('actions.structure')}
                    </Link>
                  </td>
                  <td className="text-center d-print-none">
                    <Link to={`${href}/search`}>
                      <Icon name="b_select" title={t('actions.search')} /> {t('actions.search')}
                    </Link>
                  </td>
                  <td className="text-center d-print-none">
                    {isTable && (
                      <Link to={`${href}/insert`}>
                        <Icon name="b_insrow" title={t('actions.insert')} /> {t('actions.insert')}
                      </Link>
                    )}
                  </td>
                  <td className="text-center d-print-none">
                    {isTable && (
                      <Link to={`${href}/operations#truncate`}>
                        <Icon name="b_empty" title={t('actions.empty')} /> {t('actions.empty')}
                      </Link>
                    )}
                  </td>
                  <td className="text-center d-print-none">
                    <Link to={`${href}/operations#drop`}>
                      <Icon name="b_drop" title={t('actions.drop')} /> {t('actions.drop')}
                    </Link>
                  </td>
                  <td className="value tbl_rows font-monospace text-end">
                    {exact[row.oid] !== undefined ? (
                      exact[row.oid].toLocaleString()
                    ) : row.rows === null ? (
                      isTable ? (
                        <a href="#count" className="real_row_count" onClick={(e) => { e.preventDefault(); count(row) }}>
                          ?
                        </a>
                      ) : null
                    ) : (
                      <a href="#count" className="real_row_count" onClick={(e) => { e.preventDefault(); count(row) }}>
                        <bdi>~{row.rows.toLocaleString()}</bdi>
                      </a>
                    )}
                  </td>
                  <td className="text-nowrap">{t(`types.${row.typeKey}`)}</td>
                  <td className="value tbl_size font-monospace text-end">{formatSize(row.size)}</td>
                  <td>{row.comment}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot id="tbl_summary_row">
            <tr>
              <th className="d-print-none" />
              <th className="tbl_num text-nowrap">{t('total', { count: rows.length })}</th>
              <th colSpan={6} className="d-print-none">
                {t('sum')}
              </th>
              <th className="value tbl_rows font-monospace text-end">{sumRows.toLocaleString()}</th>
              <th />
              <th className="value tbl_size font-monospace text-end">{formatSize(sumSize)}</th>
              <th />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
