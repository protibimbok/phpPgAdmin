import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { notify, dismiss, type Notification } from '@/notify'
import { urls, useLevel, type RelationKind } from '@/level'
import { indexes, resolveTable, type Index } from '@tables/js/api'
import { relationColumns, runQuery, type Order, type RowsResult } from '../api'
import HighlightedSql from '../editor/HighlightedSql'
import QueryResults from '../results/QueryResults'
import { DEFAULT_MAX_ROWS, type GridNav, type SortKey } from '../results/ResultsGrid'
import { useGridActions } from '../results/useGridActions'
import { parseOrder, qualifiedName, quoteIdent, serializeOrder } from '../sql'

/**
 * A relation's "Browse" page: phpMyAdmin's /sql route with "SELECT * FROM t", the message
 * above the grid and the grid itself, the page, page size and order kept in the URL so a
 * reload and the browser's back button land where they were. "?distinct=col" browses a
 * column's distinct values with their counts, as the structure page's "Browse distinct
 * values" does.
 */
export default function Browse() {
  const { t } = useTranslation('sql')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '', table = '' } = useParams()
  const kind: RelationKind = useLevel().kind ?? 'table'
  const [search, setSearch] = useSearchParams()
  const navigateTo = useNavigate()
  const location = useLocation()
  const loading = useRef<Notification | null>(null)
  /** What the insert/edit form just did, shown above the grid the way phpMyAdmin shows the result of the statement. */
  const flash = (location.state as { flash?: { message: string; sql: string[] } } | null)?.flash

  const distinct = search.get('distinct')
  const pos = Math.max(0, Number(search.get('pos') ?? 0) || 0)
  const rowsParam = search.get('rows')
  const maxRows = rowsParam === 'all' ? null : Math.max(1, Number(rowsParam ?? DEFAULT_MAX_ROWS) || DEFAULT_MAX_ROWS)
  const order = useMemo(() => parseOrder(search.get('order')), [search])
  const nav: GridNav = { pos, maxRows, order }

  const relation = qualifiedName(schema, table)
  const sql = distinct
    ? `SELECT COUNT(*) AS ${quoteIdent(t('rows_column'))}, ${quoteIdent(distinct)} FROM ${relation} GROUP BY ${quoteIdent(distinct)} ORDER BY ${quoteIdent(t('rows_column'))} DESC`
    : `SELECT * FROM ${relation}`

  // The table's columns come first: without an order of its own the grid sorts by the primary
  // key, as pgAdmin's data view does, so a row stays where it was after an update.
  const { data: info, error: infoError } = useRequest(() => relationColumns(db, schema, table), [db, schema, table])
  const defaultOrder = useMemo<Order[]>(() => (info && !distinct ? info.primary_keys.map((name) => ({ name, desc: false })) : []), [info, distinct])
  const effectiveOrder = order.length > 0 ? order : defaultOrder

  const { data, error: queryError, loading: running, reload } = useRequest(
    () => (info ? runQuery(db, { sql, limit: maxRows, offset: pos, order: effectiveOrder, count: true }) : Promise.resolve(null)),
    [db, sql, maxRows, pos, serializeOrder(effectiveOrder), info],
  )
  const error = infoError ?? queryError

  // The table's indexes, for "Sort by key"; a view has none.
  const { data: tableIndexes } = useRequest(async () => {
    if (kind !== 'table' || distinct) return []
    const { scid, tid } = await resolveTable(db, schema, table)

    return indexes(db, scid, tid).list()
  }, [db, schema, table, kind, distinct])

  useEffect(() => {
    if (running && data) {
      loading.current = notify(tApp('loading'), 'notice', null)
    } else if (loading.current) {
      dismiss(loading.current)
      loading.current = null
    }
  }, [running, data, tApp])

  const first = data?.results[0]
  const source = data?.source ?? null
  const relationUrl = urls.relation(db, schema, table, kind)
  const actions = useGridActions({ db, source, result: first?.kind === 'rows' ? first : null, reload, changeUrl: distinct ? null : `${relationUrl}/change` })
  const sortKeys = useMemo<SortKey[]>(() => {
    if (!tableIndexes || first?.kind !== 'rows') return []

    return sortKeysFor(source?.primary_keys ?? [], tableIndexes, first)
  }, [tableIndexes, first, source])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  function navigate(next: GridNav) {
    setSearch((params) => {
      params.set('pos', String(next.pos))
      if (next.maxRows === null) params.set('rows', 'all')
      else if (next.maxRows === DEFAULT_MAX_ROWS) params.delete('rows')
      else params.set('rows', String(next.maxRows))
      if (next.order.length > 0) params.set('order', serializeOrder(next.order))
      else params.delete('order')

      return params
    })
  }

  const sqlPage = `${relationUrl}/sql`

  return (
    <>
      {flash && (
        <div className="result_query">
          <div className="alert alert-success" role="alert">
            <Icon name="s_success" /> {flash.message}
          </div>
          <div className="sqlOuter">
            <HighlightedSql sql={flash.sql.join(';\n')} />
          </div>
        </div>
      )}
      <QueryResults
        response={data}
        nav={nav}
        onNavigate={navigate}
        edit={(statement) => `${sqlPage}?${new URLSearchParams({ sql: statement })}`}
        onExplain={(statement) => navigateTo(`${sqlPage}?${new URLSearchParams({ sql: statement, run: '1' })}`)}
        onRefresh={reload}
        onRun={(statement) => navigateTo(`${sqlPage}?${new URLSearchParams({ sql: statement, run: '1' })}`)}
        grid={{ sortKeys, rowActions: actions.rowActions, bulkActions: actions.bulkActions, cellEditor: actions.cellEditor }}
        bookmarkDatabase={db}
      />
      {actions.modal}
    </>
  )
}

/**
 * phpMyAdmin's "Sort by key" choices: the primary key first (pgAdmin's index collection leaves
 * it out, so it comes from the result's source), then one per index, each ascending and
 * descending by the index's columns. An index on an expression has no column to sort by and is
 * left out.
 */
function sortKeysFor(primaryKeys: string[], tableIndexes: Index[], result: RowsResult): SortKey[] {
  const byAttnum = new Map<number, string>()
  const present = new Set<string>()
  for (const column of result.columns) {
    if (column.attnum !== null) {
      byAttnum.set(column.attnum, column.name)
      present.add(column.name)
    }
  }

  const candidates: { label: string; columns: string[] }[] = []
  if (primaryKeys.length > 0 && primaryKeys.every((name) => present.has(name))) {
    candidates.push({ label: 'PRIMARY', columns: primaryKeys })
  }
  for (const index of tableIndexes) {
    if (index.indisprimary) continue
    const attnums = index.indkey.split(' ').filter(Boolean).map(Number)
    if (attnums.some((n) => n === 0 || !byAttnum.has(n))) continue
    candidates.push({ label: index.name, columns: attnums.map((n) => byAttnum.get(n)!) })
  }

  return candidates.flatMap(({ label, columns }) => {
    const order: Order[] = columns.map((name) => ({ name, desc: false }))

    return [
      { label: `${label} (ASC)`, order },
      { label: `${label} (DESC)`, order: order.map((o) => ({ ...o, desc: true })) },
    ]
  })
}
