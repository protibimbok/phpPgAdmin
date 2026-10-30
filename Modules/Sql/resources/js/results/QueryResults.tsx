import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import i18next from 'i18next'
import { copyText } from '@/clipboard'
import Icon from '@/components/Icon'
import { urls } from '@/level'
import { notifyError } from '@/notify'
import CreateViewModal from '@views/js/CreateViewModal'
import type { QueryResponse, RowsResult } from '../api'
import BookmarkForm from './BookmarkForm'
import { explainJson } from '../explain/detect'
import { isSpatialType } from '../gis/geometry'
import ResultMessage from './ResultMessage'
import ResultsGrid, { type GridNav, type ResultsGridProps } from './ResultsGrid'

export interface QueryResultsProps {
  response: QueryResponse
  nav: GridNav
  /** Another page or order of a result: the statement that gave it is run again, alone. */
  onNavigate: (nav: GridNav, sql: string) => void
  /** The "Edit" link of each message: a page for the statement, or what to do with it. */
  edit?: (sql: string) => string | (() => void)
  onExplain?: (sql: string) => void
  /** Runs the statement of a result again, alone. */
  onRefresh?: (sql: string) => void
  onRun?: (sql: string) => void
  /** Row and bulk actions and sort keys for an editable result; the page knows the source. */
  grid?: Pick<ResultsGridProps, 'rowActions' | 'bulkActions' | 'sortKeys' | 'cellEditor'>
  /** The database the statements ran in; given, a SELECT's results end with the "Bookmark this SQL query" card. */
  bookmarkDatabase?: string
}

/** The page that exports a query's rows, in the database the query ran in (the server's maintenance database without one). */
export function exportQueryUrl(db: string | undefined): string {
  return db === undefined ? '/server/export/query' : `${urls.database(db)}/export/query`
}

/**
 * What a run shows: one message per statement, and under a row-returning one its grid and the
 * "Query results operations" card, as phpMyAdmin's sql/sql_query_results.twig lays it out.
 */
export default function QueryResults({ response, nav, onNavigate, edit, onExplain, onRefresh, onRun, grid, bookmarkDatabase }: QueryResultsProps) {
  const { t } = useTranslation('sql')
  const { t: tApp } = useTranslation()
  const [createView, setCreateView] = useState<string | null>(null)
  const navigate = useNavigate()
  const { db } = useParams()
  // A batch that failed inside a transaction took its earlier statements with it.
  const failed = response.results[response.results.length - 1]?.kind === 'error'

  return (
    <div id="sqlqueryresultsouter">
      {response.results.map((result, i) => (
        <div key={i} className="sqlqueryresults">
          <ResultMessage
            result={result}
            edit={edit?.(result.sql)}
            onExplain={onExplain}
            onRefresh={onRefresh && (() => onRefresh(result.sql))}
            onRun={onRun}
            rolledBack={response.rolled_back && (failed || i === response.results.length - 1)}
          />
          {/* A JSON plan is shown by the plan card under the message, not as its one QUERY PLAN cell. */}
          {result.kind === 'rows' && result.row_count > 0 && !explainJson(result) && (
            <ResultsGrid
              result={result}
              nav={nav}
              onNavigate={(next) => onNavigate(next, result.sql)}
              {...grid}
              footer={
                <div className="card mb-3 d-print-none">
                  <div className="card-header">{t('operations.title')}</div>
                  <div className="card-body">
                    <button type="button" className="btn btn-link jsPrintButton" onClick={() => window.print()}>
                      <Icon name="b_print" /> {tApp('print')}
                    </button>
                    <a href="#copy" className="btn" id="copyToClipBoard" onClick={(e) => { e.preventDefault(); copyGrid(result) }}>
                      <Icon name="b_insrow" /> {tApp('copy_to_clipboard')}
                    </a>
                    <a href="#export" className="btn" onClick={(e) => { e.preventDefault(); navigate(exportQueryUrl(db), { state: { sql: result.sql } }) }}>
                      <Icon name="b_tblexport" /> {t('operations.export')}
                    </a>
                    <a href="#chart" className="btn" onClick={(e) => { e.preventDefault(); navigate(db === undefined ? '/server/chart' : `${urls.database(db)}/chart`, { state: { sql: result.sql } }) }}>
                      <Icon name="b_chart" /> {t('operations.display_chart')}
                    </a>
                    {result.columns.some((c) => isSpatialType(c.type_name)) && (
                      <a href="#gis" className="btn" id="visualizeGis" onClick={(e) => { e.preventDefault(); navigate(db === undefined ? '/server/gis-visualization' : `${urls.database(db)}/gis-visualization`, { state: { sql: result.sql } }) }}>
                        <Icon name="b_globe" /> {t('operations.visualize_gis')}
                      </a>
                    )}
                    <span>
                      <a href="#create-view" className="btn create_view ajax" onClick={(e) => { e.preventDefault(); setCreateView(result.sql) }}>
                        <Icon name="b_view_add" /> {t('operations.create_view')}
                      </a>
                    </span>
                  </div>
                </div>
              }
            />
          )}
          {bookmarkDatabase && result.kind === 'rows' && <BookmarkForm database={bookmarkDatabase} sql={result.sql} />}
        </div>
      ))}
      <CreateViewModal show={createView !== null} db={bookmarkDatabase ?? db} sql={createView ?? ''} onClose={() => setCreateView(null)} />
    </div>
  )
}

/** The grid as tab-separated text, header first, the way phpMyAdmin's "Copy to clipboard" copies it. */
function copyGrid(result: RowsResult): void {
  const lines = [result.columns.map((c) => c.name).join('\t'), ...result.rows.map((row) => row.map((v) => (v === null ? 'NULL' : v)).join('\t'))]
  void copyText(lines.join('\n')).then((ok) => {
    if (!ok) notifyError(i18next.t('copy_failed'))
  })
}
