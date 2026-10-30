import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { errorMessage } from '@/api/request'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import { notifyError, notifySuccess } from '@/notify'
import { urls, useLevel } from '@/level'
import { preference, savePreferences, usePreference } from '@/preferences'
import { createBookmark, deleteBookmark, listBookmarks, listHistory, type Bookmark, type HistoryEntry } from '../api'
import SqlEditor, { type SqlEditorHandle } from '../editor/SqlEditor'
import { CONFIRM, CONSOLE_ALWAYS_EXPAND, CONSOLE_ENTER_EXECUTES, CONSOLE_HEIGHT, CONSOLE_START_HISTORY, isDestructive } from '../preferences'

/** phpMyAdmin's console settings (Config\Settings\Console), the role's settings on the Features page. */
interface Options {
  alwaysExpand: boolean
  startHistory: boolean
  enterExecutes: boolean
}

const OPEN_KEY = 'pgaConsoleOpen'

const DEFAULTS: Options = { alwaysExpand: false, startHistory: false, enterExecutes: false }

/** A query shown in the console: one the role ran before, or a bookmark. */
interface Message {
  key: string
  sql: string
  database: string | null
  failed?: boolean
  time?: string
  bookmark?: Bookmark
}

type Card = 'options' | 'bookmarks' | 'add' | 'debug' | null

/** When this page was loaded: the Debug SQL card lists the statements run since. */
const PAGE_LOADED = Date.now()

type DebugOrder = 'count' | 'exec' | 'time'

/** A statement in the Debug SQL card: one run, or (ordered by count) every run of the same text in the same database. */
interface DebugQuery {
  key: string
  sql: string
  database: string | null
  count: number
  /** Milliseconds, all runs together. */
  time: number
  failed: boolean
  started: string
}

/** The history as a .sql file, oldest first, as the classic phpPgAdmin's history Download writes it. */
function historyFile(entries: HistoryEntry[]): string {
  const lines = [`-- phpPgAdmin SQL history, ${new Date().toISOString()}`, '']
  for (const entry of [...entries].reverse()) {
    lines.push(`-- ${entry.started_at}${entry.database ? ` ${entry.database}` : ''}${entry.status === 'error' ? ' (failed)' : ''}`)
    const sql = entry.sql.trimEnd()
    lines.push(sql.endsWith(';') ? sql : `${sql};`, '')
  }

  return lines.join('\n')
}

/** Below this height a drag folds the console, as phpMyAdmin's resizer does. */
const MIN_HEIGHT = 32

const isSelect = (sql: string) => /^\s*(SELECT|WITH|VALUES|TABLE|EXPLAIN)\b/i.test(sql)

/**
 * phpMyAdmin's console (console/display.twig): the bar fixed to the bottom of every page that
 * unfolds into the query history, a query box, and the Options and Bookmarks cards. Running
 * a query opens the SQL page of the database it belongs to with the statement run, as the
 * console's hidden form does in phpMyAdmin.
 */
export default function Console() {
  const { t } = useTranslation('sql')
  const navigate = useNavigate()
  const level = useLevel()
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === '1'
    } catch {
      return false
    }
  })
  const options: Options = {
    alwaysExpand: usePreference<boolean>(CONSOLE_ALWAYS_EXPAND),
    startHistory: usePreference<boolean>(CONSOLE_START_HISTORY),
    enterExecutes: usePreference<boolean>(CONSOLE_ENTER_EXECUTES),
  }
  /** The console's Options card changes the same settings as the Settings page. */
  const setOptions = (next: Options | ((current: Options) => Options)) => {
    const value = typeof next === 'function' ? next(options) : next
    savePreferences({ [CONSOLE_ALWAYS_EXPAND]: value.alwaysExpand, [CONSOLE_START_HISTORY]: value.startHistory, [CONSOLE_ENTER_EXECUTES]: value.enterExecutes }).catch((e: unknown) => notifyError(errorMessage(e)))
  }
  const savedHeight = usePreference<number>(CONSOLE_HEIGHT)
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  // The open console never covers the page's top 25px, as Console.show() keeps it.
  const height = dragHeight ?? Math.max(MIN_HEIGHT, Math.min(savedHeight, window.innerHeight - 25))
  const [card, setCard] = useState<Card>(null)
  const [query, setQuery] = useState('')
  const [history, setHistory] = useState<HistoryEntry[] | null>(null)
  const [historyShown, setHistoryShown] = useState(() => preference<boolean>(CONSOLE_START_HISTORY))
  const [cleared, setCleared] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [bookmarks, setBookmarks] = useState<Bookmark[] | null>(null)
  const [newBookmark, setNewBookmark] = useState({ label: '', database: '', shared: false, sql: '' })
  const [confirming, setConfirming] = useState<{ sql: string; database: string | null } | null>(null)
  const [debugOrder, setDebugOrder] = useState<DebugOrder>('exec')
  const editor = useRef<SqlEditorHandle>(null)
  const content = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0')
    } catch {
      // Not remembered, then.
    }
  }, [open])

  const loadHistory = useCallback(() => {
    listHistory(50).then(setHistory, (e: unknown) => notifyError(errorMessage(e)))
  }, [])

  const loadBookmarks = useCallback(() => {
    listBookmarks().then(setBookmarks, (e: unknown) => notifyError(errorMessage(e)))
  }, [])

  useEffect(() => {
    if (open && historyShown && history === null) loadHistory()
  }, [open, historyShown, history, loadHistory])

  useEffect(() => {
    if (card === 'bookmarks' && bookmarks === null) loadBookmarks()
  }, [card, bookmarks, loadBookmarks])

  useEffect(() => {
    if (card === 'debug') loadHistory()
  }, [card, loadHistory])

  /** phpMyAdmin's Debug SQL: the statements run since the page was loaded, with the time each took. */
  const debugQueries = useMemo<DebugQuery[]>(() => {
    const runs = (history ?? [])
      .filter((entry) => Date.parse(entry.started_at) >= PAGE_LOADED - 1000)
      .reverse()
      .map((entry): DebugQuery => ({ key: `d${entry.id}`, sql: entry.sql, database: entry.database, count: 1, time: entry.duration_ms ?? 0, failed: entry.status === 'error', started: entry.started_at }))
    if (debugOrder === 'exec') return runs
    if (debugOrder === 'time') return [...runs].sort((a, b) => b.time - a.time)
    const groups = new Map<string, DebugQuery>()
    for (const run of runs) {
      const key = `${run.database ?? ''}\u0000${run.sql}`
      const group = groups.get(key)
      groups.set(key, group ? { ...group, count: group.count + 1, time: group.time + run.time, failed: group.failed || run.failed } : { ...run, key: `g${run.key}` })
    }

    return [...groups.values()].sort((a, b) => b.count - a.count)
  }, [history, debugOrder])

  /** Download the history already loaded (or the last 50 statements) as a .sql file. */
  async function downloadHistory() {
    try {
      const entries = history ?? (await listHistory(50))
      if (history === null) setHistory(entries)
      const url = URL.createObjectURL(new Blob([historyFile(entries)], { type: 'application/sql' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'history.sql'
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      notifyError(errorMessage(e))
    }
  }

  // The list scrolls to its end as phpMyAdmin's does, so the newest message and the box are in view.
  useEffect(() => {
    if (open && content.current) content.current.scrollTop = content.current.scrollHeight
  }, [open, history, historyShown, cleared])

  const messages = useMemo<Message[]>(() => {
    if (!historyShown || !history) return []

    return [...history]
      .reverse()
      .map((entry) => ({ key: `h${entry.id}`, sql: entry.sql, database: entry.database, failed: entry.status === 'error', time: entry.started_at }))
      .filter((m) => !cleared.has(m.key))
  }, [history, historyShown, cleared])

  /**
   * phpMyAdmin's ConsoleResizer: dragging the open toolbar (not its buttons) sets the height of
   * the messages, a drag below the least height folds the console, and the height is kept.
   */
  function startResize(e: ReactMouseEvent<HTMLDivElement>) {
    if (!open || e.button !== 0 || e.target !== e.currentTarget || !content.current) return
    e.preventDefault()
    const startY = e.clientY
    const startHeight = content.current.offsetHeight
    let result = startHeight
    const move = (event: MouseEvent) => {
      result = startHeight + startY - Math.max(35, event.clientY)
      const box = content.current
      const atBottom = box !== null && box.scrollTop + box.clientHeight + 16 >= box.scrollHeight
      setDragHeight(Math.max(MIN_HEIGHT, result))
      if (atBottom) requestAnimationFrame(() => content.current && (content.current.scrollTop = content.current.scrollHeight))
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      if (result <= MIN_HEIGHT) {
        setDragHeight(null)
        setOpen(false)
      } else if (result === startHeight) {
        setDragHeight(null)
      } else {
        savePreferences({ [CONSOLE_HEIGHT]: Math.round(result) })
          .catch((err: unknown) => notifyError(errorMessage(err)))
          .finally(() => setDragHeight(null))
      }
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  /** Run a statement on the SQL page of the database it belongs to, or of the one the page is at. */
  function execute(sql: string, database: string | null = level.db ?? null) {
    if (!/[A-Za-z]/.test(sql)) return
    // phpMyAdmin's console asks confirmQuery() first: "Confirm DROP queries" holds a destructive statement.
    if (preference<boolean>(CONFIRM) && isDestructive(sql)) return setConfirming({ sql, database })
    run(sql, database)
  }

  function run(sql: string, database: string | null) {
    const target = database === null ? '/server/sql' : `${urls.database(database)}/sql`
    navigate(`${target}?${new URLSearchParams({ sql, run: '1' })}`, { state: { confirmed: true } })
    setQuery('')
    setHistory(null)
  }

  function toggleExpanded(key: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)

      return next
    })
  }

  function openAdd(sql: string, database: string | null) {
    setNewBookmark({ label: '', database: database ?? level.db ?? '', shared: false, sql })
    setCard('add')
  }

  async function saveBookmark() {
    if (newBookmark.label.trim() === '' || newBookmark.database.trim() === '' || newBookmark.sql.trim() === '') return
    try {
      await createBookmark({ database: newBookmark.database.trim(), label: newBookmark.label.trim(), sql: newBookmark.sql, shared: newBookmark.shared })
      notifySuccess(t('bookmark.created'))
      setBookmarks(null)
      setCard('bookmarks')
    } catch (e) {
      notifyError(errorMessage(e))
    }
  }

  async function removeBookmark(bookmark: Bookmark) {
    try {
      await deleteBookmark(bookmark.id)
      setBookmarks((current) => current?.filter((b) => b.id !== bookmark.id) ?? null)
    } catch (e) {
      notifyError(errorMessage(e))
    }
  }

  function renderMessage(message: Message) {
    const isExpanded = options.alwaysExpand || expanded.has(message.key)
    const classes = ['message', message.bookmark ? 'bookmark' : 'history', isExpanded ? 'expanded' : 'collapsed', isSelect(message.sql) ? 'select' : '', message.failed ? 'failed' : '']

    return (
      <div key={message.key} className={classes.filter(Boolean).join(' ')} onClick={() => toggleExpanded(message.key)}>
        <div className="action_content" onClick={(e) => e.stopPropagation()}>
          <span className="action collapse" onClick={() => toggleExpanded(message.key)}>
            {t('console.collapse')}
          </span>
          <span className="action expand" onClick={() => toggleExpanded(message.key)}>
            {t('console.expand')}
          </span>
          <span className="action requery" onClick={() => execute(message.sql, message.database)}>
            {t('console.requery')}
          </span>
          <span
            className="action edit"
            onClick={() => {
              setQuery(message.sql)
              setCard(null)
              editor.current?.focus()
            }}
          >
            {t('console.edit')}
          </span>
          {message.bookmark ? (
            <span className="action delete_bookmark" onClick={() => void removeBookmark(message.bookmark!)}>
              {t('console.delete')}
            </span>
          ) : (
            <>
              {isSelect(message.sql) && (
                <span className="action explain" onClick={() => execute(/^\s*EXPLAIN\b/i.test(message.sql) ? message.sql : `EXPLAIN ${message.sql}`, message.database)}>
                  {t('console.explain')}
                </span>
              )}
              {isSelect(message.sql) && !/^\s*EXPLAIN\b/i.test(message.sql) && !/\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(message.sql) && (
                <span className="action explain_analyze" onClick={() => execute(`EXPLAIN (ANALYZE, BUFFERS) ${message.sql}`, message.database)}>
                  {t('console.explain_analyze')}
                </span>
              )}
              <span className="action bookmark" onClick={() => openAdd(message.sql, message.database)}>
                {t('console.bookmark')}
              </span>
            </>
          )}
          {message.failed && <span className="text failed">{t('console.failed')}</span>}
          {message.database && (
            <span className="text targetdb">
              {t('console.database')}: <span>{message.database}</span>
            </span>
          )}
          {message.time && (
            <span className="text query_time">
              {t('console.queried_time')}: <span>{new Date(message.time).toLocaleString()}</span>
            </span>
          )}
        </div>
        {message.bookmark && <span className={`bookmark_label${message.bookmark.shared ? ' shared' : ''}`}>{message.bookmark.label}</span>}
        <span className="query">{message.sql}</span>
      </div>
    )
  }

  return (
    <div id="pma_console_container" className="d-print-none">
      <div id="pma_console">
        <div className={`toolbar${open ? '' : ' collapsed'}`} onMouseDown={startResize}>
          <div className="switch_button console_switch" onClick={() => setOpen((o) => !o)}>
            <Icon name="console" /> <span>{t('console.title')}</span>
          </div>
          {/* phpMyAdmin's ConsoleMessages.clear(): the messages are hidden, the stored history is kept. */}
          <div className="button clear" onClick={() => setCleared((current) => new Set([...current, ...messages.map((m) => m.key)]))}>
            <span>{t('console.clear')}</span>
          </div>
          <div
            className={`button history${historyShown ? ' active' : ''}`}
            onClick={() => {
              // Showing the history brings back what Clear hid, except the failed queries (showHistory()).
              if (!historyShown) setCleared((current) => new Set((history ?? []).filter((e) => e.status === 'error' && current.has(`h${e.id}`)).map((e) => `h${e.id}`)))
              setHistoryShown((h) => !h)
            }}
          >
            <span>{t('console.history')}</span>
          </div>
          <div className="button download_history" title={t('console.download_history_title')} onClick={() => void downloadHistory()}>
            <span>{t('console.download_history')}</span>
          </div>
          <div className={`button options${card === 'options' ? ' active' : ''}`} onClick={() => setCard(card === 'options' ? null : 'options')}>
            <span>{t('console.options')}</span>
          </div>
          <div className={`button bookmarks${card === 'bookmarks' || card === 'add' ? ' active' : ''}`} onClick={() => setCard(card === null ? 'bookmarks' : null)}>
            <span>{t('console.bookmarks')}</span>
          </div>
          <div className={`button debug${card === 'debug' ? ' active' : ''}`} onClick={() => { setOpen(true); setCard(card === 'debug' ? null : 'debug') }}>
            <span>{t('console.debug')}</span>
          </div>
        </div>

        {open && (
          <>
            <div className="content" ref={content} style={{ height }}>
              <div className="console_message_container">
                <div className="message welcome">
                  <span>{options.enterExecutes ? t('console.press_enter') : t('console.press_ctrl_enter')}</span>
                </div>
                {messages.map(renderMessage)}
              </div>
              <div className="query_input">
                <span className="console_query_input">
                  <SqlEditor ref={editor} value={query} onChange={setQuery} onSubmit={() => execute(query)} ariaLabel={t('console.title')} lineNumbers={false} enterSubmits={options.enterExecutes} className="console-editor" />
                </span>
              </div>
            </div>

            <div className={`mid_layer${card ? ' show' : ''}`} onClick={() => setCard(null)} />

            <div className={`card${card === 'bookmarks' || card === 'add' ? ' show' : ''}`} id="pma_bookmarks">
              <div className="toolbar">
                <div className="switch_button" onClick={() => setCard(null)}>
                  <span>{t('console.bookmarks')}</span>
                </div>
                <div className="button refresh" onClick={loadBookmarks}>
                  <span>{t('console.refresh')}</span>
                </div>
                <div className="button add" onClick={() => openAdd(query, level.db ?? null)}>
                  <span>{t('console.add')}</span>
                </div>
              </div>
              <div className="content bookmark">
                <div className="message welcome">
                  <span>{t('console.bookmarks_welcome')}</span>
                </div>
                {(bookmarks ?? []).map((bookmark) => renderMessage({ key: `b${bookmark.id}`, sql: bookmark.sql, database: bookmark.database, bookmark }))}
              </div>
              <div className={`mid_layer${card === 'add' ? ' show' : ''}`} onClick={() => setCard('bookmarks')} />
              <div className={`card add${card === 'add' ? ' show' : ''}`}>
                <div className="toolbar">
                  <div className="switch_button" onClick={() => setCard('bookmarks')}>
                    <span>{t('console.add_bookmark')}</span>
                  </div>
                </div>
                <div className="content add_bookmark">
                  <div className="options">
                    <label>
                      {t('console.label')}: <input type="text" name="label" value={newBookmark.label} onChange={(e) => setNewBookmark((b) => ({ ...b, label: e.target.value }))} />
                    </label>
                    <label>
                      {t('console.target_database')}: <input type="text" name="targetdb" value={newBookmark.database} onChange={(e) => setNewBookmark((b) => ({ ...b, database: e.target.value }))} />
                    </label>
                    <label>
                      <input type="checkbox" name="shared" checked={newBookmark.shared} onChange={(e) => setNewBookmark((b) => ({ ...b, shared: e.target.checked }))} />
                      {t('console.share')}
                    </label>
                    <button className="btn btn-primary" type="button" name="submit" onClick={() => void saveBookmark()}>
                      {t('console.ok')}
                    </button>
                  </div>
                  <div className="query_input">
                    <span className="bookmark_add_input">
                      <SqlEditor value={newBookmark.sql} onChange={(sql) => setNewBookmark((b) => ({ ...b, sql }))} ariaLabel={t('console.add_bookmark')} lineNumbers={false} className="console-editor" />
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className={`card${card === 'debug' ? ' show' : ''} ${debugOrder === 'count' ? 'grouped' : 'ungrouped'}`} id="debug_console">
              <div className="toolbar">
                <div className="switch_button" onClick={() => setCard(null)}>
                  <span>{t('console.debug')}</span>
                </div>
                {(['count', 'exec', 'time'] as const).map((order) => (
                  <div key={order} className={`button order_by sort_${order}${debugOrder === order ? ' active' : ''}`} onClick={() => setDebugOrder(order)}>
                    <span>{t(`console.debug_sort_${order}`)}</span>
                  </div>
                ))}
                <div className="button refresh" onClick={loadHistory}>
                  <span>{t('console.refresh')}</span>
                </div>
              </div>
              <div className="content debug">
                <div className="message welcome">
                  <span>
                    {debugQueries.length === 0
                      ? t('console.debug_none')
                      : t('console.debug_summary', {
                          count: debugQueries.reduce((sum, query) => sum + query.count, 0),
                          time: debugQueries.reduce((sum, query) => sum + query.time, 0).toLocaleString(undefined, { maximumFractionDigits: 1 }),
                        })}
                  </span>
                </div>
                <div className="debugLog">
                  {debugQueries.map((query) => (
                    <div key={query.key} className={`message ${expanded.has(query.key) || options.alwaysExpand ? 'expanded' : 'collapsed'}${query.failed ? ' failed' : ''}`} onClick={() => toggleExpanded(query.key)}>
                      <div className="action_content" onClick={(e) => e.stopPropagation()}>
                        <span className="action collapse" onClick={() => toggleExpanded(query.key)}>
                          {t('console.collapse')}
                        </span>
                        <span className="action expand" onClick={() => toggleExpanded(query.key)}>
                          {t('console.expand')}
                        </span>
                        <span className="action requery" onClick={() => execute(query.sql, query.database)}>
                          {t('console.requery')}
                        </span>
                        {debugOrder === 'count' && <span className="text count">{t('console.debug_count', { count: query.count })}</span>}
                        <span className="text time">{t('console.debug_time', { time: query.time.toLocaleString(undefined, { maximumFractionDigits: 3 }) })}</span>
                        {query.failed && <span className="text failed">{t('console.failed')}</span>}
                        {query.database && (
                          <span className="text targetdb">
                            {t('console.database')}: <span>{query.database}</span>
                          </span>
                        )}
                      </div>
                      <span className="query">{query.sql}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className={`card${card === 'options' ? ' show' : ''}`} id="pma_console_options">
              <div className="toolbar">
                <div className="switch_button" onClick={() => setCard(null)}>
                  <span>{t('console.options')}</span>
                </div>
                <div className="button default" onClick={() => setOptions(DEFAULTS)}>
                  <span>{t('console.set_default')}</span>
                </div>
              </div>
              <div className="content">
                <label>
                  <input type="checkbox" name="always_expand" checked={options.alwaysExpand} onChange={(e) => setOptions((o) => ({ ...o, alwaysExpand: e.target.checked }))} />
                  {t('console.always_expand')}
                </label>
                <br />
                <label>
                  <input type="checkbox" name="start_history" checked={options.startHistory} onChange={(e) => setOptions((o) => ({ ...o, startHistory: e.target.checked }))} />
                  {t('console.start_history')}
                </label>
                <br />
                <label>
                  <input type="checkbox" name="enter_executes" checked={options.enterExecutes} onChange={(e) => setOptions((o) => ({ ...o, enterExecutes: e.target.checked }))} />
                  {t('console.enter_executes')}
                </label>
                <br />
              </div>
            </div>
          </>
        )}
      </div>
      <ConfirmQuery
        show={confirming !== null}
        sql={confirming?.sql ?? ''}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          const pending = confirming
          setConfirming(null)
          if (pending) run(pending.sql, pending.database)
        }}
      />
    </div>
  )
}
