import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import i18next from 'i18next'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useLocation, useSearchParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import { notify, dismiss, type Notification } from '@/notify'
import { preference } from '@/preferences'
import { useSession } from '@/session'
import { urls, useLevel } from '@/level'
import { format } from 'sql-formatter'
import type { SQLNamespace } from '@codemirror/lang-sql'
import { errorMessage } from '@/api/request'
import { notifyError, notifySuccess } from '@/notify'
import { createBookmark, createMacro, deleteBookmark, fetchCatalog, listBookmarks, listMacros, relationColumns, type Bookmark, type Macro, type RelationColumn } from '../api'
import SqlEditor, { type SqlEditorHandle } from '../editor/SqlEditor'
import MacrosDialog, { nextMacroName } from '../macros/MacrosDialog'
import MacrosMenu, { macroKeyOf } from '../macros/MacrosMenu'
import QueryResults from '../results/QueryResults'
import { defaultMaxRows, type GridNav } from '../results/ResultsGrid'
import { useGridActions } from '../results/useGridActions'
import { qualifiedName, quoteIdent, quoteLiteral } from '../sql'
import { CONFIRM, isDestructive } from '../preferences'
import { useQueryRunner } from '../useQueryRunner'
import type { QueryResponse } from '../api'
import { codePointOffset, statementAt } from '../editor/statements'

/** Where phpMyAdmin keeps the query it saves as you type, for "Get auto-saved query". */
const AUTO_SAVE_KEY = 'autoSavedSql'

/**
 * What a Go runs out of the query box: the selected text when there is a selection (pgAdmin's
 * "Execute script" runs only what is selected), the statement at the cursor for "Execute
 * query", else all of it. "from" is where the text starts in the box, to mark an error there.
 */
interface BoxPart {
  sql: string
  from: number
  whole: boolean
}

/** phpMyAdmin's TextareaRows: how tall the column list is. */
const TEXTAREA_ROWS = 15

/** phpMyAdmin's Bookmark::getVariableCount(): every [VARIABLE] and [VARIABLE1]… placeholder counts. */
function bookmarkVariableCount(sql: string): number {
  return sql.match(/\[VARIABLE[0-9]*\]/g)?.length ?? 0
}

/**
 * phpMyAdmin's Bookmark::applyVariables(): a comment around a placeholder is taken away, so that
 * the bookmark runs as it is without values, and [VARIABLEn] ([VARIABLE] for the first) becomes
 * the n-th value with its quotes doubled, to go inside a string literal the query writes.
 */
function applyBookmarkVariables(sql: string, values: string[]): string {
  let query = sql.replace(/\/\*([\s\S]*?\[VARIABLE[0-9]*\][\s\S]*?)\*\//gi, '$1')
  for (let i = 1; i <= bookmarkVariableCount(sql); i++) {
    const value = (values[i - 1] ?? '').replaceAll("'", "''")
    query = query.replaceAll(`[VARIABLE${i}]`, value)
    if (i === 1) query = query.replaceAll('[VARIABLE]', value)
  }

  return query
}

/**
 * The SQL page (sql/query.twig) at every level: the query box with its quick buttons and
 * column list when a table is open, the options in the card's footer, then the results of the
 * last run below. Ctrl+Enter runs the query, as it does in phpMyAdmin; a macro's key (Ctrl+0…9,
 * Alt+F1…F12, pgAdmin's set) runs that macro.
 */
export default function SqlPage() {
  const { pathname } = useLocation()

  return <SqlPageAt key={pathname} />
}

function SqlPageAt() {
  const { t } = useTranslation('sql')
  const { t: tApp } = useTranslation()
  const { user } = useSession()
  const level = useLevel()
  const db = level.db ?? null
  const [search, setSearch] = useSearchParams()
  const editor = useRef<SqlEditorHandle>(null)

  const [query, setQuery] = useState(() => search.get('sql') ?? defaultQuery(level))
  const [ran, setRan] = useState<string | null>(null)
  const [nav, setNav] = useState<GridNav>({ pos: 0, maxRows: defaultMaxRows(), order: [] })
  const [confirming, setConfirming] = useState<BoxPart | null>(null)
  const [errorMark, setErrorMark] = useState<{ from: number; to: number } | null>(null)
  const [delimiter, setDelimiter] = useState(';')
  const [showAgain, setShowAgain] = useState(false)
  const [retain, setRetain] = useState(false)
  const [rollback, setRollback] = useState(false)
  const [transaction, setTransaction] = useState(false)
  const [bind, setBind] = useState(false)
  const [parameters, setParameters] = useState<Record<string, string>>({})
  const [boxShown, setBoxShown] = useState(true)
  const [bookmarkLabel, setBookmarkLabel] = useState('')
  const [bookmarkShared, setBookmarkShared] = useState(false)
  const [bookmarkReplace, setBookmarkReplace] = useState(false)
  const [chosenBookmark, setChosenBookmark] = useState('')
  const [bookmarkAction, setBookmarkAction] = useState<'0' | '1' | '2'>('0')
  const [bookmarkVariables, setBookmarkVariables] = useState<string[]>([])
  const [manageMacros, setManageMacros] = useState(false)
  const runner = useQueryRunner(db)
  const queryRef = useRef(query)
  queryRef.current = query
  const { data: macroData, reload: reloadMacros } = useRequest(() => listMacros(), [])
  const macros = macroData?.macros ?? []
  const { data: bookmarks, reload: reloadBookmarks } = useRequest(() => (db === null ? Promise.resolve([] as Bookmark[]) : listBookmarks(db)), [db])
  // The catalog feeds the editor's completions; "schema.table" keys plus the public schema's tables by bare name.
  const { data: catalog } = useRequest(() => (db === null ? Promise.resolve(null) : fetchCatalog(db)), [db])
  const completions = useMemo<SQLNamespace | undefined>(() => {
    if (!catalog) return undefined
    const names: Record<string, string[]> = {}
    for (const schema of catalog.schemas) {
      for (const relation of schema.relations) {
        names[`${schema.name}.${relation.name}`] = relation.columns
        if (schema.name === 'public') names[relation.name] = relation.columns
      }
    }

    return names
  }, [catalog])
  const loading = useRef<Notification | null>(null)

  const relation = level.name === 'table' && level.db && level.schema && level.table ? { db: level.db, schema: level.schema, name: level.table } : null
  const firstResult = runner.response?.results[0]
  const source = runner.response?.source ?? null
  const actions = useGridActions({
    db: db ?? '',
    source,
    result: firstResult?.kind === 'rows' && runner.response?.results.length === 1 ? firstResult : null,
    reload: () => ran !== null && navigate(nav),
    changeUrl: db !== null && source ? `${urls.relation(db, source.schema, source.table, 'table')}/change` : null,
  })
  const { data: columns } = useRequest(async () => (relation ? (await relationColumns(relation.db, relation.schema, relation.name)).columns : null), [relation?.db, relation?.schema, relation?.name])
  const parameterNames = useMemo(() => (bind ? findParameters(query) : []), [bind, query])

  // The query is saved as it is typed, as phpMyAdmin saves it to localStorage.
  useEffect(() => {
    try {
      if (query !== '') localStorage.setItem(AUTO_SAVE_KEY, query)
    } catch {
      // Storage may be unavailable; the button then has nothing to restore.
    }
  }, [query])

  useEffect(() => {
    if (runner.running) {
      loading.current = notify(tApp('loading'), 'notice', null)
    } else if (loading.current) {
      dismiss(loading.current)
      loading.current = null
    }
  }, [runner.running, tApp])

  /** Run a statement and show its results, leaving the query box as it is. */
  function run(sql: string, next: GridNav = { pos: 0, maxRows: nav.maxRows, order: [] }): Promise<QueryResponse | null> {
    const text = bind ? bindParameters(sql, parameters) : sql
    setRan(text)
    setNav(next)

    return runner.run({ sql: text, delimiter, limit: next.maxRows, offset: next.pos, order: next.order, rollback, transaction })
  }

  /**
   * Run the box's query the way phpMyAdmin's Go does: once it succeeded the box is cleared and
   * folded unless the options keep it; a part of the box (a selection, the statement at the
   * cursor) leaves the box as it is. When a statement fails the box stays open with the text the
   * error position points at underlined, as pgAdmin marks it.
   */
  function executePart(part: BoxPart, next?: GridNav) {
    setErrorMark(null)
    editor.current?.clearError()
    const sent = bind ? bindParameters(part.sql, parameters) : part.sql
    void run(part.sql, next).then((response) => {
      if (!response) return
      const failed = response.results.find((r) => r.kind === 'error')
      if (!failed) {
        if (part.whole) {
          if (!showAgain) setQuery('')
          if (!retain) setBoxShown(false)
        }

        return
      }
      setBoxShown(true)
      // The position counts in the text the server got, which is the box's only when no
      // parameter was bound into it and the box still holds it.
      const position = failed.kind === 'error' ? failed.error.position : undefined
      if (position === undefined || failed.kind !== 'error' || sent !== part.sql || queryRef.current.slice(part.from, part.from + part.sql.length) !== part.sql) return
      const from = part.from + failed.start + codePointOffset(failed.sql, position - 1)
      const box = queryRef.current
      const lineEnd = box.indexOf('\n', from) === -1 ? box.length : box.indexOf('\n', from)
      const space = box.slice(from, lineEnd).search(/\s/)
      let to = space === -1 ? lineEnd : from + space
      let start = from
      // "at end of input": the position is past the text, so the last character is marked.
      if (to <= start) {
        start = Math.max(0, Math.min(from, box.length) - 1)
        to = start + 1
      }
      setErrorMark({ from: start, to })
    })
  }

  function execute(sql: string, next?: GridNav) {
    executePart({ sql, from: 0, whole: true }, next)
  }

  // The mark waits for the box to be shown again when it was folded.
  useEffect(() => {
    if (errorMark && boxShown) editor.current?.markError(errorMark.from, errorMark.to)
  }, [errorMark, boxShown])

  /** pgAdmin runs a macro's SQL as it stands, without touching the editor. */
  const runMacro = (macro: Macro) => run(macro.sql)

  // The macro keys work anywhere on the page, when the browser lets them through.
  const macrosRef = useRef(macros)
  macrosRef.current = macros
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = macroKeyOf(e)
      if (key === null) return
      const macro = macrosRef.current.find((m) => m.key === key)
      if (!macro) return
      e.preventDefault()
      runMacro(macro)
    }
    document.addEventListener('keydown', onKey)

    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delimiter, rollback, transaction, bind, parameters, nav.maxRows])

  /** pgAdmin's "Add to macros": the box's query saved under the next free "Macro N" name. */
  function addToMacros() {
    if (query.trim() === '') return notifyError(t('macros.empty'))
    const name = nextMacroName(macros.map((m) => m.name), t)
    createMacro({ name, sql: query }).then(
      () => {
        notifySuccess(t('macros.added', { name }))
        reloadMacros()
      },
      (err: unknown) => notifyError(errorMessage(err)),
    )
  }

  function submit(e?: FormEvent) {
    e?.preventDefault()
    const selected = editor.current?.selection()
    ask(selected ? { sql: selected.text, from: selected.from, whole: false } : { sql: query, from: 0, whole: true })
  }

  /** pgAdmin's "Execute query" (Alt+F5): the statement the cursor is in, or the selection. */
  function runStatement() {
    const selected = editor.current?.selection()
    if (selected) return ask({ sql: selected.text, from: selected.from, whole: false })
    const statement = statementAt(query, editor.current?.cursor() ?? 0, delimiter)
    if (statement) ask({ sql: statement.sql, from: statement.from, whole: false })
  }

  function ask(part: BoxPart) {
    // One run at a time from the box: Go, Enter on it or Ctrl+Enter while a batch runs does
    // nothing, as phpMyAdmin's ajax.js holds a second submit of the form back.
    if (runner.busy() || part.sql.trim() === '') return
    // phpMyAdmin's "Confirm DROP queries": a destructive statement waits for the user's OK.
    if (preference<boolean>(CONFIRM) && isDestructive(part.sql)) return setConfirming(part)
    go(part)
  }

  /** The Go of the query box, once confirmed: the bookmark the box names, then the query. */
  function go(part: BoxPart) {
    if (runner.busy()) return
    if (bookmarkLabel.trim() !== '' && db !== null) {
      createBookmark({ database: db, label: bookmarkLabel.trim(), sql: query, shared: bookmarkShared, replace: bookmarkReplace }).then(
        () => {
          notifySuccess(t('bookmark.created'))
          setBookmarkLabel('')
          reloadBookmarks()
        },
        (err: unknown) => notifyError(errorMessage(err)),
      )
    }
    executePart(part)
  }

  /** The "Bookmarked SQL query" card's Go: run the chosen bookmark, show it, or delete it. */
  function useBookmark(e: FormEvent) {
    e.preventDefault()
    const bookmark = bookmarks?.find((b) => String(b.id) === chosenBookmark)
    if (!bookmark) return
    if (bookmarkAction === '2') {
      deleteBookmark(bookmark.id).then(
        () => {
          notifySuccess(t('bookmark.deleted'))
          setChosenBookmark('')
          reloadBookmarks()
        },
        (err: unknown) => notifyError(errorMessage(err)),
      )

      return
    }
    // Submit runs the bookmark with its variables filled in; View only shows it as it was saved.
    const sql = bookmarkAction === '0' ? applyBookmarkVariables(bookmark.sql, bookmarkVariables) : bookmark.sql
    setQuery(sql)
    if (bookmarkAction === '0' && !runner.busy()) execute(sql)
  }

  function formatQuery() {
    try {
      setQuery(format(query, { language: 'postgresql', keywordCase: 'upper' }))
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  // A link that carries a query (Edit from the Browse page, the console) puts it in the box,
  // and runs it when it says so (Explain SQL, a console run). A destructive statement waits for
  // "Confirm DROP queries" unless the page that sent it asked already (its navigation state
  // says so, which a link from elsewhere cannot carry).
  const urlSql = search.get('sql')
  const autorun = search.get('run') === '1'
  const { state: locationState } = useLocation()
  useEffect(() => {
    if (urlSql === null) return
    setQuery(urlSql)
    if (autorun && urlSql.trim() !== '') {
      const asked = (locationState as { confirmed?: boolean } | null)?.confirmed === true
      if (!asked && preference<boolean>(CONFIRM) && isDestructive(urlSql)) setConfirming({ sql: urlSql, from: 0, whole: true })
      else execute(urlSql)
    }
    setSearch((params) => {
      params.delete('sql')
      params.delete('run')

      return params
    }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSql, autorun])

  /**
   * Another page, order or a refresh of a result: its statement runs again on its own, as
   * phpMyAdmin's navigation sends the displayed query, never the rest of the batch it came from.
   */
  function navigate(next: GridNav, sql: string | null = ran) {
    if (sql === null) return
    setRan(sql)
    setNav(next)
    void runner.run({ sql, delimiter, limit: next.maxRows, offset: next.pos, order: next.order, rollback, transaction })
  }

  function quick(kind: 'select_all' | 'select' | 'insert' | 'update' | 'delete') {
    if (!relation) return
    const name = qualifiedName(relation.schema, relation.name)
    const names = (columns ?? []).map((c) => quoteIdent(c.name))
    const values = (columns ?? []).map((_, i) => quoteLiteral(`[value-${i + 1}]`))
    const text = {
      select_all: `SELECT * FROM ${name} WHERE true`,
      select: `SELECT ${names.join(', ')} FROM ${name} WHERE true`,
      insert: `INSERT INTO ${name}(${names.join(', ')}) VALUES (${values.join(', ')})`,
      update: `UPDATE ${name} SET ${names.map((n, i) => `${n} = ${values[i]}`).join(', ')} WHERE true`,
      delete: `DELETE FROM ${name} WHERE false`,
    }[kind]
    setQuery(text)
    editor.current?.focus()
  }

  function insertColumns(select: HTMLSelectElement | null) {
    if (!select) return
    const chosen = [...select.selectedOptions].map((option) => option.value)
    if (chosen.length > 0) editor.current?.insert(chosen.join(', '))
  }

  const legend = legendFor(level, user.server.host, user.server.port)

  return (
    <>
      <ConfirmQuery
        show={confirming !== null}
        sql={confirming?.sql ?? ''}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          const part = confirming
          setConfirming(null)
          if (part) go(part)
        }}
      />
      {!boxShown && (
        <a id="togglequerybox" href="#querybox" onClick={(e) => { e.preventDefault(); setBoxShown(true) }}>
          {t('show_query_box')}
        </a>
      )}

      {boxShown && (
        <form className="ajax lock-page" id="sqlqueryform" name="sqlform" onSubmit={submit}>
          <a id="querybox" />
          <div className="card mb-3">
            <div className="card-header">{legend}</div>
            <div className="card-body">
              <div id="queryfieldscontainer">
                <div className="row">
                  <div className="col">
                    <div className="mb-3">
                      <SqlEditor ref={editor} id="sqlquery" value={query} onChange={setQuery} onSubmit={submit} onRunStatement={runStatement} ariaLabel={t('query')} autoFocus schema={completions} defaultSchema={level.schema ?? 'public'} />
                    </div>
                    <div id="querymessage">
                      {runner.running && (
                        <>
                          {t('running')}{' '}
                          <a href="#cancel" onClick={(e) => { e.preventDefault(); runner.cancel() }}>
                            {t('message.cancel')}
                          </a>
                        </>
                      )}
                    </div>

                    <div className="btn-toolbar" role="toolbar">
                      {relation && (
                        <div className="btn-group me-2" role="group">
                          <input type="button" value="SELECT *" id="selectall" className="btn btn-secondary button sqlbutton" onClick={() => quick('select_all')} />
                          <input type="button" value="SELECT" id="select" className="btn btn-secondary button sqlbutton" onClick={() => quick('select')} />
                          <input type="button" value="INSERT" id="insert" className="btn btn-secondary button sqlbutton" onClick={() => quick('insert')} />
                          <input type="button" value="UPDATE" id="update" className="btn btn-secondary button sqlbutton" onClick={() => quick('update')} />
                          <input type="button" value="DELETE" id="delete" className="btn btn-secondary button sqlbutton" onClick={() => quick('delete')} />
                        </div>
                      )}
                      <div className="btn-group me-2" role="group">
                        <input type="button" value={t('buttons.clear')} id="clear" className="btn btn-secondary button sqlbutton" onClick={() => setQuery('')} />
                        <input type="button" value={t('buttons.format')} id="format" className="btn btn-secondary button sqlbutton" onClick={formatQuery} />
                      </div>
                      <MacrosMenu macros={macros} onManage={() => setManageMacros(true)} onAdd={addToMacros} onRun={runMacro} />
                      <input
                        type="button"
                        value={t('buttons.auto_saved')}
                        id="saved"
                        className="btn btn-secondary button sqlbutton"
                        onClick={() => {
                          try {
                            const saved = localStorage.getItem(AUTO_SAVE_KEY)
                            if (saved) setQuery(saved)
                          } catch {
                            // Nothing to restore.
                          }
                        }}
                      />
                    </div>

                    <div className="my-3">
                      <div className="form-check">
                        <input className="form-check-input" type="checkbox" name="parameterized" id="parameterized" checked={bind} onChange={(e) => setBind(e.target.checked)} />
                        <label className="form-check-label" htmlFor="parameterized">
                          {t('buttons.bind_parameters')}
                        </label>
                      </div>
                    </div>
                    <div className="mb-3" id="parametersDiv">
                      {parameterNames.map((name) => (
                        <div key={name} className="row row-cols-lg-auto g-3 align-items-center mb-2">
                          <div className="col-12">
                            <label className="form-label mb-0" htmlFor={`parameter_${name}`}>
                              :{name}
                            </label>
                          </div>
                          <div className="col-12">
                            <input
                              type="text"
                              className="form-control parameter"
                              id={`parameter_${name}`}
                              value={parameters[name] ?? ''}
                              onChange={(e) => setParameters((p) => ({ ...p, [name]: e.target.value }))}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {relation && columns && columns.length > 0 && (
                    <div className="col-xl-2 col-lg-3">
                      <div className="mb-3">
                        <label className="visually-hidden" htmlFor="fieldsSelect">
                          {t('columns')}
                        </label>
                        <select className="form-select resize-vertical" id="fieldsSelect" name="dummy" size={TEXTAREA_ROWS} multiple>
                          {columns.map((column: RelationColumn) => (
                            <option key={column.attnum} value={quoteIdent(column.name)} title={column.comment ?? undefined}>
                              {column.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <input
                        type="button"
                        className="btn btn-secondary button"
                        id="insertBtn"
                        name="insert"
                        value="<<"
                        title={t('insert')}
                        onClick={() => insertColumns(document.getElementById('fieldsSelect') as HTMLSelectElement | null)}
                      />
                    </div>
                  )}
                </div>
              </div>

              {db !== null && (
                <div className="row row-cols-lg-auto g-3 align-items-center">
                  <div className="col-6">
                    <label className="form-label" htmlFor="bkm_label">
                      {t('bookmark.this_query')}
                    </label>
                  </div>
                  <div className="col-6">
                    <input className="form-control" type="text" name="bkm_label" id="bkm_label" value={bookmarkLabel} onChange={(e) => setBookmarkLabel(e.target.value)} />
                  </div>
                  {bookmarkLabel.length > 0 && (
                    <>
                      <div className="col-12">
                        <div className="form-check form-check-inline">
                          <input className="form-check-input" type="checkbox" name="bkm_all_users" id="id_bkm_all_users" value="true" checked={bookmarkShared} onChange={(e) => setBookmarkShared(e.target.checked)} />
                          <label className="form-check-label" htmlFor="id_bkm_all_users">
                            {t('bookmark.all_users')}
                          </label>
                        </div>
                      </div>
                      <div className="col-12">
                        <div className="form-check form-check-inline">
                          <input className="form-check-input" type="checkbox" name="bkm_replace" id="id_bkm_replace" value="true" checked={bookmarkReplace} onChange={(e) => setBookmarkReplace(e.target.checked)} />
                          <label className="form-check-label" htmlFor="id_bkm_replace">
                            {t('bookmark.replace')}
                          </label>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="card-footer">
              <div className="row row-cols-lg-auto g-3 align-items-center">
                <div className="col-12">
                  <div className="input-group me-2">
                    <span className="input-group-text">{t('options.delimiter')}</span>
                    <label className="visually-hidden" htmlFor="id_sql_delimiter">
                      {t('options.delimiter')}
                    </label>
                    <input className="form-control" type="text" name="sql_delimiter" size={3} value={delimiter} id="id_sql_delimiter" onChange={(e) => setDelimiter(e.target.value)} />
                  </div>
                </div>
                <div className="col-12">
                  <div className="form-check form-check-inline">
                    <input className="form-check-input" type="checkbox" name="show_query" value="1" id="checkbox_show_query" checked={showAgain} onChange={(e) => setShowAgain(e.target.checked)} />
                    <label className="form-check-label" htmlFor="checkbox_show_query">
                      {t('options.show_again')}
                    </label>
                  </div>
                </div>
                <div className="col-12">
                  <div className="form-check form-check-inline">
                    <input className="form-check-input" type="checkbox" name="retain_query_box" value="1" id="retain_query_box" checked={retain} onChange={(e) => setRetain(e.target.checked)} />
                    <label className="form-check-label" htmlFor="retain_query_box">
                      {t('options.retain')}
                    </label>
                  </div>
                </div>
                <div className="col-12">
                  <div className="form-check form-check-inline">
                    <input className="form-check-input" type="checkbox" name="rollback_query" value="1" id="rollback_query" checked={rollback} onChange={(e) => setRollback(e.target.checked)} />
                    <label className="form-check-label" htmlFor="rollback_query">
                      {t('options.rollback')}
                    </label>
                  </div>
                </div>
                <div className="col-12">
                  <div className="form-check">
                    <input className="form-check-input" type="checkbox" name="transaction" id="transaction" checked={transaction} onChange={(e) => setTransaction(e.target.checked)} />
                    <label className="form-check-label" htmlFor="transaction">
                      {t('options.transaction')}
                    </label>
                  </div>
                </div>
                <div className="col-12">
                  <input className="btn btn-secondary" type="button" id="button_run_statement" value={t('buttons.run_statement')} title={t('buttons.run_statement_title')} onClick={runStatement} />
                  <input className="btn btn-primary ms-1" type="submit" id="button_submit_query" name="SQL" value={tApp('go')} title={t('buttons.go_title')} />
                </div>
              </div>
            </div>
          </div>
        </form>
      )}

      {boxShown && bookmarks && bookmarks.length > 0 && (
        <form className="card mb-3" onSubmit={useBookmark}>
          <div className="card-header">{t('bookmark.bookmarked')}</div>
          <div className="card-body">
            <div className="row row-cols-lg-auto g-3 align-items-center">
              <div className="col-6">
                <label className="form-label" htmlFor="id_bookmark">
                  {t('bookmark.bookmark')}
                </label>
              </div>
              <div className="col-6">
                <select
                  className="form-select"
                  name="id_bookmark"
                  id="id_bookmark"
                  value={chosenBookmark}
                  onChange={(e) => {
                    setChosenBookmark(e.target.value)
                    setBookmarkVariables([])
                  }}
                >
                  <option value="">&nbsp;</option>
                  {bookmarks.map((bookmark) => (
                    <option key={bookmark.id} value={bookmark.id} data-varcount={bookmarkVariableCount(bookmark.sql)}>
                      {bookmark.label}
                      {bookmark.shared ? ` (${t('bookmark.shared')})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              {(['0', '1', '2'] as const).map((value) => (
                <div key={value} className="form-check form-check-inline col-12">
                  <input className="form-check-input" type="radio" name="action_bookmark" value={value} id={`radio_bookmark_${value}`} checked={bookmarkAction === value} onChange={() => setBookmarkAction(value)} />
                  <label className="form-check-label" htmlFor={`radio_bookmark_${value}`}>
                    {t(value === '0' ? 'bookmark.submit' : value === '1' ? 'bookmark.view_only' : 'bookmark.delete')}
                  </label>
                </div>
              ))}
            </div>

            {(() => {
              const chosen = bookmarks.find((b) => String(b.id) === chosenBookmark)
              const count = chosen ? bookmarkVariableCount(chosen.sql) : 0

              return (
                count > 0 && (
                  <div id="bookmarkVariablesSection">
                    {t('bookmark.variables')}
                    <div className="row row-cols-auto" id="bookmarkVariables">
                      {Array.from({ length: count }, (_, i) => (
                        <div className="mb-3" key={i}>
                          <label htmlFor={`bookmarkVariable${i + 1}`}>{t('bookmark.variable', { number: i + 1 })}</label>
                          <input
                            className="form-control"
                            type="text"
                            size={10}
                            name={`bookmark_variable[${i + 1}]`}
                            id={`bookmarkVariable${i + 1}`}
                            value={bookmarkVariables[i] ?? ''}
                            onChange={(e) => setBookmarkVariables((current) => Object.assign([...current], { [i]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )
              )
            })()}
          </div>
          <div className="card-footer text-end">
            <input className="btn btn-secondary" type="submit" name="SQL" id="button_submit_bookmark" value={tApp('go')} />
          </div>
        </form>
      )}

      {runner.error && (
        <div className="alert alert-danger" role="alert">
          {runner.error.message}
        </div>
      )}

      {runner.response && (
        <QueryResults
          response={runner.response}
          nav={nav}
          onNavigate={navigate}
          edit={(sql) => () => {
            setQuery(sql)
            setBoxShown(true)
            editor.current?.focus()
            window.scrollTo({ top: 0 })
          }}
          onExplain={(sql) => {
            setQuery(sql)
            execute(sql)
          }}
          onRefresh={(sql) => navigate(nav, sql)}
          onRun={(sql) => {
            setQuery(sql)
            execute(sql)
          }}
          grid={{ rowActions: actions.rowActions, bulkActions: actions.bulkActions, cellEditor: actions.cellEditor }}
          bookmarkDatabase={db ?? undefined}
        />
      )}
      {actions.modal}
      <MacrosDialog
        show={manageMacros}
        macros={macros}
        keys={macroData?.keys ?? []}
        currentSql={query}
        onClose={() => setManageMacros(false)}
        onSaved={() => {
          setManageMacros(false)
          reloadMacros()
        }}
      />
    </>
  )
}

/**
 * The card's heading, as phpMyAdmin's legend: "Run SQL query/queries on table db.table:" with
 * the object linked (here schema.table) and the documentation icon after the colon.
 */
function legendFor(level: ReturnType<typeof useLevel>, host: string, port: number) {
  const docs = (
    <a href="https://www.postgresql.org/docs/current/sql-select.html" target="_blank" rel="noopener noreferrer">
      <Icon name="b_help" title={i18next.t('postgresql_documentation')} />
    </a>
  )

  switch (level.name) {
    case 'database':
      return (
        <>
          <Trans ns="sql" i18nKey="legend.database" values={{ database: level.db }} components={{ db: <Link to={urls.database(level.db!)} /> }} /> {docs}
        </>
      )
    case 'schema':
      return (
        <>
          <Trans ns="sql" i18nKey="legend.schema" values={{ schema: level.schema }} components={{ sch: <Link to={urls.schema(level.db!, level.schema!)} /> }} /> {docs}
        </>
      )
    case 'table':
      return (
        <>
          <Trans
            ns="sql"
            i18nKey="legend.table"
            values={{ table: `${level.schema}.${level.table}` }}
            components={{ tbl: <Link to={urls.relation(level.db!, level.schema!, level.table!, level.kind)} /> }}
          />{' '}
          {docs}
        </>
      )
    default:
      return (
        <>
          <Trans ns="sql" i18nKey="legend.server" values={{ server: `${host}:${port}` }} /> {docs}
        </>
      )
  }
}

/** What the box holds before anything is typed: phpMyAdmin's DefaultQueryTable, "SELECT * FROM %t WHERE 1". */
function defaultQuery(level: ReturnType<typeof useLevel>): string {
  return level.name === 'table' && level.schema && level.table ? `SELECT * FROM ${qualifiedName(level.schema, level.table)} WHERE true` : ''
}

/** The :name parameters of a query, in order of appearance; "::type" casts and quoted text do not count. */
export function findParameters(sql: string): string[] {
  const names: string[] = []
  const pattern = /'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\/|(?<![:\w]):([A-Za-z_]\w*)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(sql)) !== null) {
    if (match[1] && !names.includes(match[1])) names.push(match[1])
  }

  return names
}

/** The query with each :name replaced by its value as a quoted literal. */
export function bindParameters(sql: string, values: Record<string, string>): string {
  return sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\/|(?<![:\w]):([A-Za-z_]\w*)/g, (whole, name?: string) =>
    name && name in values ? quoteLiteral(values[name]) : whole,
  )
}
