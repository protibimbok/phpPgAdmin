import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { formatSize } from '@/format'
import { urls, useLevel } from '@/level'
import type { Statistics } from '@/nodes/client'
import type { Column } from '@tables/js/api'
import { resolveView, viewColumns, viewsOf, type AnyView, type MaterializedView, type ViewKind } from '../api'

interface Loaded {
  scid: number
  vid: number
  view: AnyView
  columns: Column[]
  statistics: Statistics | null
}

/**
 * A view's "Structure" page, after phpMyAdmin's display_structure.twig for a view: the columns
 * with their type, collation, nullability, default and comment, with no row actions (a view's
 * columns are its query's), then the "Edit view", Print and Show create links. Below, the
 * Information card: the view's definition, options and, for a materialized view, its size and
 * statistics.
 */
export default function ViewStructure() {
  const { t } = useTranslation('views')
  const { t: tTables } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '', view: name = '' } = useParams()
  const kind: ViewKind = useLevel().kind === 'mview' ? 'mview' : 'view'
  const { data, error } = useRequest(async (): Promise<Loaded> => {
    const { scid, vid } = await resolveView(db, schema, name, kind)
    const [view, columns, statistics] = await Promise.all([
      viewsOf(db, scid, kind).properties(vid),
      viewColumns(db, scid, vid, kind),
      kind === 'mview' ? viewsOf(db, scid, kind).statistics(vid).catch(() => null) : Promise.resolve(null),
    ])

    return { scid, vid, view, columns, statistics }
  }, [db, schema, name, kind])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  const href = urls.relation(db, schema, name, kind)

  return (
    <div id="structure_content">
      <form name="fieldsForm" id="fieldsForm" onSubmit={(e) => e.preventDefault()}>
        <input type="hidden" name="table_type" value="view" />
        <div className="table-responsive-md">
          <table id="tablestructure" className="table table-striped table-hover w-auto align-middle">
            <thead>
              <tr>
                <th>{tTables('structure.columns.number')}</th>
                <th>{tTables('structure.columns.name')}</th>
                <th>{tTables('structure.columns.type')}</th>
                <th>{tTables('structure.columns.collation')}</th>
                <th>{tTables('structure.columns.attributes')}</th>
                <th>{tTables('structure.columns.null')}</th>
                <th>{tTables('structure.columns.default')}</th>
                <th>{tTables('structure.columns.comments')}</th>
                <th>{tTables('structure.columns.extra')}</th>
              </tr>
            </thead>
            <tbody>
              {data.columns.map((column, index) => (
                <tr key={column.attnum}>
                  <td className="text-end">{index + 1}</td>
                  <th className="text-nowrap">
                    {column.description ? (
                      <span className="commented_column" title={column.description}>
                        {column.name}
                      </span>
                    ) : (
                      column.name
                    )}
                  </th>
                  <td className="text-nowrap">
                    <bdo dir="ltr" lang="en">
                      {column.displaytypname}
                    </bdo>
                  </td>
                  <td>{column.collspcname}</td>
                  <td className="column_attribute text-nowrap" />
                  <td>{column.attnotnull ? tTables('structure.no') : tTables('structure.yes')}</td>
                  <td className="text-nowrap">{column.defval !== null ? column.defval : <em>{tTables('structure.none')}</em>}</td>
                  <td>{column.description}</td>
                  <td className="text-nowrap" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </form>

      {/* display_structure.twig #structure-action-links for a view: Edit view, Print; Show create is ours. */}
      <div id="structure-action-links" className="d-print-none">
        <Link to={`${href}/edit`}>
          <Icon name="b_edit" /> {t('structure.edit_view')}
        </Link>{' '}
        <button type="button" className="btn btn-link p-0 jsPrintButton" onClick={() => window.print()}>
          <Icon name="b_print" /> {tApp('print')}
        </button>{' '}
        <Link to={`${href}/ddl`}>
          <Icon name="b_sql" /> {tApp('show_create')}
        </Link>
      </div>

      <Information kind={kind} view={data.view} statistics={data.statistics} />
    </div>
  )
}

/** The Information card, after phpMyAdmin's display_table_stats.twig: comment, the definition, the options, a materialized view's space and statistics. */
function Information({ kind, view, statistics }: { kind: ViewKind; view: AnyView; statistics: Statistics | null }) {
  const { t } = useTranslation('views')
  const { t: tTables } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const stats = statistics?.rows[0] ?? null
  const number = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0))
  const mview = kind === 'mview' ? (view as MaterializedView) : null

  return (
    <div id="tablestatistics" className="card">
      <div className="card-header">{tTables('structure.information')}</div>
      <div className="card-body">
        {view.comment && (
          <>
            <strong>{t('structure.comment')}</strong>
            <em>
              <pre>{view.comment}</pre>
            </em>
          </>
        )}

        <table className="table table-striped table-hover table-sm w-auto caption-top">
          <caption>{t('structure.definition')}</caption>
          <tbody>
            <tr>
              <td>
                <pre className="mb-0">
                  <code className="sql" dir="ltr">
                    {view.definition}
                  </code>
                </pre>
              </td>
            </tr>
          </tbody>
        </table>

        <table className="table table-striped table-hover table-sm w-auto caption-top">
          <caption>{t('structure.options')}</caption>
          <tbody>
            <tr>
              <th className="name">{tTables('structure.stats.type')}</th>
              <td className="value">{kind === 'mview' ? tTables('types.mview') : tTables('types.view')}</td>
            </tr>
            <tr>
              <th className="name">{tTables('structure.stats.owner')}</th>
              <td className="value">{view.owner}</td>
            </tr>
            {kind === 'view' && 'check_option' in view && (
              <tr>
                <th className="name">WITH CHECK OPTION</th>
                <td className="value">{view.check_option ? view.check_option.toUpperCase() : tApp('no')}</td>
              </tr>
            )}
            {kind === 'view' && 'security_barrier' in view && (
              <tr>
                <th className="name">{t('form.security_barrier')}</th>
                <td className="value">{view.security_barrier ? tApp('yes') : tApp('no')}</td>
              </tr>
            )}
            {mview && (
              <>
                <tr>
                  <th className="name">{t('structure.populated')}</th>
                  <td className="value">{mview.with_data ? tApp('yes') : tApp('no')}</td>
                </tr>
                <tr>
                  <th className="name">{tTables('structure.stats.tablespace')}</th>
                  <td className="value">{mview.spcname}</td>
                </tr>
                {mview.amname && (
                  <tr>
                    <th className="name">{tTables('structure.stats.access_method')}</th>
                    <td className="value">{mview.amname}</td>
                  </tr>
                )}
                <tr>
                  <th className="name">{tTables('structure.space.total')}</th>
                  <td className="value">{formatSize(view.size)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>

        {stats && (
          <table className="table table-striped table-hover table-sm w-auto caption-top">
            <caption>{tTables('structure.statistics')}</caption>
            <tbody>
              {statistics!.columns.map((column) => (
                <tr key={column.name}>
                  <th className="name">{column.name}</th>
                  <td className="value">{stats[column.name] === null ? '' : ['Table size', 'Indexes size'].includes(column.name) ? formatSize(number(stats[column.name])) : String(stats[column.name])}</td>
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
