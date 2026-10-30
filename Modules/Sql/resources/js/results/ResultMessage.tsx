import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import Icon from '@/components/Icon'
import { useSession } from '@/session'
import type { StatementResult } from '../api'
import HighlightedSql from '../editor/HighlightedSql'
import { explainSql, loadOptions, majorVersion, mayAnalyze, stripExplain } from '../explain/options'
import { explainJson } from '../explain/detect'

/** The plan card, with its icons, loads only when a plan is shown. */
const ExplainPlan = lazy(() => import('../explain/ExplainPlan'))

export interface ResultMessageProps {
  result: StatementResult
  /** The "Edit" link: where it takes the query (the SQL page of the level), or what it does. */
  edit?: string | (() => void)
  /** Shown for a SELECT: runs EXPLAIN on it, or the statement without its EXPLAIN. */
  onExplain?: (sql: string) => void
  onRefresh?: () => void
  /** Runs the statement as changed in the inline editor. */
  onRun?: (sql: string) => void
  rolledBack?: boolean
}

/**
 * phpMyAdmin's message above a result (Generator::getMessage): the outcome in an alert, the
 * statement highlighted below it, and the Edit inline / Edit / Explain SQL / Refresh links in
 * the footer; or, for a failure, its error box (Generator::mysqlDie). An EXPLAIN (FORMAT JSON)
 * result gets the plan card under its message: pgAdmin's graphical, analysis and statistics views.
 */
export default function ResultMessage({ result, edit, onExplain, onRefresh, onRun, rolledBack }: ResultMessageProps) {
  const { t } = useTranslation('sql')
  const { t: tApp } = useTranslation()
  const [inline, setInline] = useState<string | null>(null)
  const { user } = useSession()
  const plan = useMemo(() => explainJson(result), [result])
  // Explain SQL and Explain analyze run pgAdmin's EXPLAIN (FORMAT JSON, …) with the options last chosen on a plan card.
  const explain = (analyze: boolean) => explainSql(result.sql, loadOptions(), analyze, majorVersion(user.server.version))

  if (result.kind === 'error') {
    return (
      <div className="alert alert-danger" role="alert">
        <h1>{t('message.error')}</h1>
        <p>
          <strong>{t('message.sql_query')}</strong> <CopyLink text={result.sql} />
          {edit !== undefined && (
            <EditLink edit={edit}>
              <Icon name="b_edit" title={t('message.edit')} />
            </EditLink>
          )}
        </p>
        <HighlightedSql sql={result.sql} />
        <p>
          <strong>{t('message.server_said')}</strong>
        </p>
        <code>
          {result.error.sqlstate && `${result.error.sqlstate}: `}
          {result.error.message}
          {result.error.detail && (
            <>
              <br />
              {t('message.detail')} {result.error.detail}
            </>
          )}
          {result.error.hint && (
            <>
              <br />
              {t('message.hint')} {result.error.hint}
            </>
          )}
        </code>
      </div>
    )
  }

  const seconds = (result.duration_ms / 1000).toFixed(4)
  let message: ReactNode
  if (result.kind === 'rows') {
    const first = result.offset
    const last = result.offset + result.row_count - 1
    message =
      result.row_count === 0
        ? `${t('message.empty')} (${t('message.query_took', { seconds })})`
        : `${t('message.showing_rows', { first, last })} (${result.total_rows !== null ? `${t('message.total', { count: result.total_rows })}, ` : ''}${t('message.query_took', { seconds })})`
  } else {
    message = `${commandMessage(result.command_tag, result.affected_rows, t)} (${t('message.query_took', { seconds })})`
  }

  const isSelect = /^\s*(SELECT|WITH|VALUES|TABLE)\b/i.test(result.sql)
  const explained = /^\s*EXPLAIN\b/i.test(result.sql)

  return (
    <div className="result_query">
      <div className="alert alert-success" role="alert">
        <Icon name="s_success" /> {message}
        {rolledBack && ` ${t('message.rolled_back')}`}
      </div>
      {result.notices.map((notice, i) => (
        <div key={i} className="alert alert-primary" role="alert">
          <Icon name="s_notice" /> {notice}
        </div>
      ))}
      <div className="sqlOuter">
        {inline === null ? (
          <HighlightedSql sql={result.sql} />
        ) : (
          <form
            id="sql_query_edit_form"
            onSubmit={(e) => {
              e.preventDefault()
              onRun?.(inline)
              setInline(null)
            }}
          >
            <textarea id="sql_query_edit" name="sql_query_edit" value={inline} onChange={(e) => setInline(e.target.value)} aria-label={t('message.sql_query')} rows={5} />
            <input type="submit" className="btn btn-secondary btn_save" value={tApp('go')} />{' '}
            <input type="button" className="btn btn-secondary btn_cancel" value={t('message.cancel')} onClick={() => setInline(null)} />
          </form>
        )}
      </div>
      <div className="tools d-print-none">
        {onRun && (
          <>
            {' '}
            [&nbsp;
            <a href="#inline" className="inline_edit_sql" onClick={(e) => { e.preventDefault(); setInline(result.sql) }}>
              {t('message.edit_inline')}
            </a>
            &nbsp;]
          </>
        )}
        {edit !== undefined && (
          <>
            {' '}
            [&nbsp;
            <EditLink edit={edit}>{t('message.edit')}</EditLink>
            &nbsp;]
          </>
        )}
        {onExplain && (isSelect || explained) && (
          <>
            {' '}
            [&nbsp;
            <a
              href="#explain"
              onClick={(e) => {
                e.preventDefault()
                onExplain(explained ? stripExplain(result.sql) : explain(false))
              }}
            >
              {explained ? t('message.skip_explain') : t('message.explain')}
            </a>
            &nbsp;]
          </>
        )}
        {/* ANALYZE runs the statement, so only one that reads: no INSERT, UPDATE, DELETE or MERGE in a WITH. */}
        {onExplain && isSelect && !explained && mayAnalyze(result.sql) && (
          <>
            {' '}
            [&nbsp;
            <a
              href="#explain-analyze"
              onClick={(e) => {
                e.preventDefault()
                onExplain(explain(true))
              }}
            >
              {t('message.explain_analyze')}
            </a>
            &nbsp;]
          </>
        )}
        {onRefresh && (isSelect || explained) && (
          <>
            {' '}
            [&nbsp;
            <a href="#refresh" onClick={(e) => { e.preventDefault(); onRefresh() }}>
              {t('message.refresh')}
            </a>
            &nbsp;]
          </>
        )}
      </div>
      {plan && (
        <Suspense fallback={null}>
          <ExplainPlan plan={plan} sql={result.sql} onExplain={onExplain} />
        </Suspense>
      )}
    </div>
  )
}

/** The message a command gets, by its tag: "3 rows inserted.", "1 row deleted.", "Your SQL query has been executed successfully." */
function commandMessage(tag: string, affected: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  const verb = tag.split(' ')[0]
  switch (verb) {
    case 'INSERT':
      return t('message.inserted', { count: affected })
    case 'DELETE':
      return t('message.deleted', { count: affected })
    case 'UPDATE':
    case 'MERGE':
    case 'COPY':
      return t('message.affected', { count: affected })
    default:
      return t('message.success')
  }
}

function EditLink({ edit, className, children }: { edit: string | (() => void); className?: string; children: ReactNode }) {
  return typeof edit === 'string' ? (
    <Link to={edit} className={className}>
      {children}
    </Link>
  ) : (
    <a href="#edit" className={className} onClick={(e) => { e.preventDefault(); edit() }}>
      {children}
    </a>
  )
}

function CopyLink({ text }: { text: string }) {
  const { t } = useTranslation('sql')
  const [copied, setCopied] = useState(false)

  return (
    <a
      href="#copy"
      className="copyQueryBtn"
      onClick={(e) => {
        e.preventDefault()
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 2000)
        })
      }}
    >
      {copied ? t('message.copied') : t('message.copy')}
    </a>
  )
}
