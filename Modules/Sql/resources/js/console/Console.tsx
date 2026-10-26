import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { errorMessage } from '@/api/request'
import Icon from '@/components/Icon'
import { notifyError, notifySuccess } from '@/notify'
import { urls, useLevel } from '@/level'
import { clearHistory, createBookmark, deleteBookmark, listBookmarks, listHistory, type Bookmark, type HistoryEntry } from '../api'
import SqlEditor, { type SqlEditorHandle } from '../editor/SqlEditor'

/** phpMyAdmin's console settings (Config\Settings\Console), kept per browser. */
interface Options {
  alwaysExpand: boolean
  startHistory: boolean
  enterExecutes: boolean
}

const OPTIONS_KEY = 'pgaConsoleOptions'
const OPEN_KEY = 'pgaConsoleOpen'

const DEFAULTS: Options = { alwaysExpand: false, startHistory: false, enterExecutes: false }

function readOptions(): Options {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') as Partial<Options>) }
  } catch {
    return DEFAULTS
  }
}

/** A query shown in the console: one the role ran before, or a bookmark. */
interface Message {
  key: string
  sql: string
  database: string | null
  failed?: boolean
  time?: string
  bookmark?: Bookmark
}

type Card = 'options' | 'bookmarks' | 'add' | null

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
  const [options, setOptions] = useState<Options>(readOptions)
  const [card, setCard] = useState<Card>(null)
  const [query, setQuery] = useState('')
  const [history, setHistory] = useState<HistoryEntry[] | null>(null)
  const [historyShown, setHistoryShown] = useState(() => readOptions().startHistory)
  const [cleared, setCleared] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [bookmarks, setBookmarks] = useState<Bookmark[] | null>(null)
  const [newBookmark, setNewBookmark] = useState({ label: '', database: '', shared: false, sql: '' })
  const editor = useRef<SqlEditorHandle>(null)
  const content = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0')
    } catch {
      // Not remembered, then.
    }
  }, [open])

  useEffect(() => {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(options))
    } catch {
      // Not remembered, then.
    }
  }, [options])

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

  /** Run a statement on the SQL page of the database it belongs to, or of the one the page is at. */
  function execute(sql: string, database: string | null = level.db ?? null) {
    if (!/[A-Za-z]/.test(sql)) return
    const target = database === null ? '/server/sql' : `${urls.database(database)}/sql`
    navigate(`${target}?${new URLSearchParams({ sql, run: '1' })}`)
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
        <div className={`toolbar${open ? '' : ' collapsed'}`}>
          <div className="switch_button console_switch" onClick={() => setOpen((o) => !o)}>
            <Icon name="console" /> <span>{t('console.title')}</span>
          </div>
          <div
            className="button clear"
            onClick={() => {
              setCleared(new Set(messages.map((m) => m.key)))
              void clearHistory().then(() => setHistory([]))
            }}
          >
            <span>{t('console.clear')}</span>
          </div>
          <div className={`button history${historyShown ? ' active' : ''}`} onClick={() => setHistoryShown((h) => !h)}>
            <span>{t('console.history')}</span>
          </div>
          <div className={`button options${card === 'options' ? ' active' : ''}`} onClick={() => setCard(card === 'options' ? null : 'options')}>
            <span>{t('console.options')}</span>
          </div>
          <div className={`button bookmarks${card === 'bookmarks' || card === 'add' ? ' active' : ''}`} onClick={() => setCard(card === null ? 'bookmarks' : null)}>
            <span>{t('console.bookmarks')}</span>
          </div>
        </div>

        {open && (
          <>
            <div className="content" ref={content}>
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
    </div>
  )
}
