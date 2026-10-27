import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '@/components/Icon'
import { notAvailable } from '@/unbuilt'
import CreateViewModal from '@views/js/CreateViewModal'
import type { QueryResponse, RowsResult } from '../api'
import BookmarkForm from './BookmarkForm'
import ResultMessage from './ResultMessage'
import ResultsGrid, { type GridNav, type ResultsGridProps } from './ResultsGrid'

export interface QueryResultsProps {
  response: QueryResponse
  nav: GridNav
  onNavigate: (nav: GridNav) => void
  /** The "Edit" link of each message: a page for the statement, or what to do with it. */
  edit?: (sql: string) => string | (() => void)
  onExplain?: (sql: string) => void
  onRefresh?: () => void
  onRun?: (sql: string) => void
  /** Row and bulk actions and sort keys for an editable result; the page knows the source. */
  grid?: Pick<ResultsGridProps, 'rowActions' | 'bulkActions' | 'sortKeys' | 'cellEditor'>
  /** The database the statements ran in; given, a SELECT's results end with the "Bookmark this SQL query" card. */
  bookmarkDatabase?: string
}

/**
 * What a run shows: one message per statement, and under a row-returning one its grid and the
 * "Query results operations" card, as phpMyAdmin's sql/sql_query_results.twig lays it out.
 */
export default function QueryResults({ response, nav, onNavigate, edit, onExplain, onRefresh, onRun, grid, bookmarkDatabase }: QueryResultsProps) {
  const { t } = useTranslation('sql')
  const { t: tApp } = useTranslation()
  const [createView, setCreateView] = useState<string | null>(null)

  return (
    <div id="sqlqueryresultsouter">
      {response.results.map((result, i) => (
        <div key={i} className="sqlqueryresults">
          <ResultMessage
            result={result}
            edit={edit?.(result.sql)}
            onExplain={onExplain}
            onRefresh={onRefresh}
            onRun={onRun}
            rolledBack={response.rolled_back && i === response.results.length - 1}
          />
          {result.kind === 'rows' && result.row_count > 0 && (
            <ResultsGrid
              result={result}
              nav={nav}
              onNavigate={onNavigate}
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
                    <a href="#export" className="btn" onClick={notAvailable}>
                      <Icon name="b_tblexport" /> {t('operations.export')}
                    </a>
                    <a href="#chart" className="btn" onClick={notAvailable}>
                      <Icon name="b_chart" /> {t('operations.display_chart')}
                    </a>
                    <span>
                      <a href="#create-view" className="btn create_view ajax" onClick={(e) => { e.preventDefault(); if (bookmarkDatabase) setCreateView(result.sql); else notAvailable() }}>
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
      {bookmarkDatabase && <CreateViewModal show={createView !== null} db={bookmarkDatabase} sql={createView ?? ''} onClose={() => setCreateView(null)} />}
    </div>
  )
}

/** The grid as tab-separated text, header first, the way phpMyAdmin's "Copy to clipboard" copies it. */
function copyGrid(result: RowsResult): void {
  const lines = [result.columns.map((c) => c.name).join('\t'), ...result.rows.map((row) => row.map((v) => (v === null ? 'NULL' : v)).join('\t'))]
  void navigator.clipboard?.writeText(lines.join('\n'))
}
