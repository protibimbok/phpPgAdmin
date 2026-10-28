import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { formatSize } from '@/format'
import { urls } from '@/level'
import { roleUrl } from '@roles/js/Pages/Roles'
import { logDownloadUrl, logFiles, logPage, type LogEntry, type LogFile, type LogPosition } from '../api'
import StatusNav from '../StatusNav'

/** phpMyAdmin's binary log viewer truncates a query to this many characters until "Show full queries". */
const TRUNCATE = 100

/** The message on one line, cut at TRUNCATE characters. */
function truncate(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length <= TRUNCATE ? line : `${line.slice(0, TRUNCATE)}…`
}

/** The lines PostgreSQL writes after an entry's message, under its own labels. */
const EXTRAS = [
  ['detail', 'DETAIL'],
  ['hint', 'HINT'],
  ['context', 'CONTEXT'],
  ['statement', 'STATEMENT'],
] as const

/** The file a page opens on: the newest one the server is writing to, else the newest. */
const initialFile = (files: LogFile[]) => (files.find((f) => f.current) ?? files[0])?.name ?? ''

/**
 * pgAdmin's server Logs panel laid out as phpMyAdmin's Binary log page: the card to pick a
 * file of the log directory (with its size, and the count and total of the files), then the
 * file a page at a time, newest page first, with « Previous / Next » and the full-text toggle
 * above the table. The csvlog and jsonlog formats give the process, user and database of each
 * entry; the stderr format only its log_line_prefix. "Plain text" shows the page as it is in
 * the file, and Download sends the whole file.
 */
export default function Logs() {
  const { t } = useTranslation('status')
  const { data: list, error: listError } = useRequest(() => logFiles(), [])
  const [selected, setSelected] = useState('')
  const [plain, setPlain] = useState(false)
  const [shown, setShown] = useState<{ name: string; plain: boolean; position: LogPosition } | null>(null)
  const [full, setFull] = useState(false)
  const { data: page, error: pageError, loading } = useRequest(
    () => (shown ? logPage(shown.name, shown.position, shown.plain) : Promise.resolve(undefined)),
    [shown],
  )

  // Open the current file on its last page once the list arrives.
  useEffect(() => {
    if (!list || shown) return
    const name = initialFile(list.files)
    if (name === '') return
    setSelected(name)
    setShown({ name, plain: false, position: { before: list.files.find((f) => f.name === name)!.size } })
  }, [list, shown])

  function go(e: FormEvent) {
    e.preventDefault()
    const file = list?.files.find((f) => f.name === selected)
    if (file) setShown({ name: file.name, plain, position: { before: file.size } })
  }

  const move = (position: LogPosition) => shown && setShown({ ...shown, position })
  const total = (list?.files ?? []).reduce((sum, f) => sum + f.size, 0)
  const structured = page?.format !== 'stderr'
  const columns = structured ? (['time', 'pid', 'user', 'database', 'severity', 'message'] as const) : (['prefix', 'severity', 'message'] as const)

  const navigation = page && (
    <div className="text-center">
      {page.start > 0 && (
        <>
          <a href="#previous" title={t('logs.previous')} onClick={(e) => { e.preventDefault(); move({ before: page.start }) }}>
            &laquo;
          </a>{' '}
          -{' '}
        </>
      )}
      {!shown?.plain && (
        <a href="#full" onClick={(e) => { e.preventDefault(); setFull((f) => !f) }}>
          <Icon name={full ? 's_partialtext' : 's_fulltext'} title={full ? t('logs.truncate') : t('logs.full')} />
        </a>
      )}{' '}
      <span className="text-body-secondary">{t('logs.range', { start: page.start.toLocaleString(), end: page.end.toLocaleString(), size: page.size.toLocaleString() })}</span>
      {page.end < page.size && (
        <>
          {' '}-{' '}
          <a href="#next" title={t('logs.next')} onClick={(e) => { e.preventDefault(); move({ offset: page.end }) }}>
            &raquo;
          </a>
        </>
      )}
    </div>
  )

  return (
    <div className="container-fluid">
      <StatusNav />

      <h2>
        <Icon name="s_tbl" /> {t('logs.heading')}
      </h2>

      {listError && (
        <div className="alert alert-danger" role="alert">
          {listError.message}
        </div>
      )}

      {list && list.files.length === 0 && (
        <div className="alert alert-primary" role="alert">
          <Icon name="s_notice" /> {list.collector ? t('logs.empty', { directory: list.directory }) : t('logs.no_collector', { destination: list.destination })}
        </div>
      )}

      {list && list.files.length > 0 && (
        <form className="card mb-3" onSubmit={go}>
          <div className="card-header">{t('logs.select')}</div>
          <div className="card-body">
            <select name="log" value={selected} onChange={(e) => setSelected(e.target.value)}>
              {list.files.map((file) => (
                <option key={file.name} value={file.name}>
                  {file.name} ({formatSize(file.size)}){file.current ? ` ${t('logs.current')}` : ''}
                </option>
              ))}
            </select>{' '}
            {t('logs.files', { count: list.files.length })}, {formatSize(total)}{' '}
            <a href={logDownloadUrl(selected)} download={selected}>
              <Icon name="b_save" /> {t('logs.download')}
            </a>
            <div className="mt-2">
              <input type="checkbox" id="logPlain" checked={plain} onChange={(e) => setPlain(e.target.checked)} /> <label htmlFor="logPlain">{t('logs.plain')}</label>
            </div>
          </div>
          <div className="card-footer">
            <input className="btn btn-primary" type="submit" value={t('logs.go')} />
          </div>
        </form>
      )}

      {pageError && (
        <div className="alert alert-danger" role="alert">
          {pageError.message}
        </div>
      )}

      {page && shown?.plain && page.text !== undefined && (
        <>
          {navigation}
          <pre id="logText" className="border rounded p-2 mt-2" style={{ opacity: loading ? 0.5 : 1 }}>
            {page.text}
          </pre>
        </>
      )}

      {page && page.entries && (
        <table className="table table-striped table-hover align-middle" id="logTable" style={{ opacity: loading ? 0.5 : 1 }}>
          <thead>
            <tr>
              <td colSpan={columns.length}>{navigation}</td>
            </tr>
            <tr className="text-nowrap">
              {columns.map((column) => (
                <th key={column}>{t(`logs.columns.${column}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.entries.length === 0 && (
              <tr>
                <td colSpan={columns.length}>{t('logs.none')}</td>
              </tr>
            )}
            {page.entries.map((entry, i) => (
              <EntryRow key={`${page.start}-${i}`} entry={entry} structured={structured} full={full} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** One entry: the message cut to a line until "Show full queries", which also shows its detail, hint, context and statement. */
function EntryRow({ entry, structured, full }: { entry: LogEntry; structured: boolean; full: boolean }) {
  const message = entry.message ?? ''

  return (
    <tr className="noclick">
      <td className="text-nowrap">{entry.time}</td>
      {structured && (
        <>
          <td className="text-end">{entry.pid}</td>
          <td>{entry.user && <Link to={roleUrl(entry.user)}>{entry.user}</Link>}</td>
          <td>{entry.database && <Link to={urls.database(entry.database)}>{entry.database}</Link>}</td>
        </>
      )}
      <td className="text-nowrap">{entry.severity}</td>
      <td>
        {full ? (
          <div className="font-monospace" style={{ whiteSpace: 'pre-wrap' }}>
            {message}
            {EXTRAS.filter(([key]) => entry[key]).map(([key, label]) => (
              <div key={key}>
                <strong>{label}:</strong> {entry[key]}
              </div>
            ))}
          </div>
        ) : (
          <span className="font-monospace" title={message}>
            {truncate(message)}
          </span>
        )}
      </td>
    </tr>
  )
}
