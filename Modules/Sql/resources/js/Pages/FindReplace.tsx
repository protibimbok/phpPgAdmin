import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import { urls, useLevel, type RelationKind } from '@/level'
import { findReplace, findReplacePreview, relationColumns, type CommandResult, type FindReplacePreview, type FindReplaceRequest } from '../api'
import { fieldKind } from '../fields/kinds'
import ResultMessage from '../results/ResultMessage'
import SearchTabs from './SearchTabs'

/**
 * phpMyAdmin's table "Find and replace" (table/find_replace/index.twig, find_replace.js): the
 * text to find, its replacement, the column and the regular expression switch; Go shows the
 * preview of the values found beside what they become (replace_preview.twig) and folds the
 * form away behind its "Show find and replace criteria" link; Replace asks, runs the UPDATE
 * and shows the query's message.
 */
export default function FindReplace() {
  const { t } = useTranslation('sql')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '', table = '' } = useParams()
  const kind: RelationKind = useLevel().kind ?? 'table'
  const relationUrl = urls.relation(db, schema, table, kind)
  const { data: info, error } = useRequest(() => relationColumns(db, schema, table), [db, schema, table])
  // phpMyAdmin lists the columns of its CHAR type class: the text types.
  const columns = (info?.columns ?? []).filter((c) => {
    const k = fieldKind(c)

    return k === 'char' || (k === 'text' && c.type_name !== 'xml')
  })

  const [find, setFind] = useState('')
  const [replaceWith, setReplaceWith] = useState('')
  const [column, setColumn] = useState<string | null>(null)
  const [useRegex, setUseRegex] = useState(false)
  const [formShown, setFormShown] = useState(true)
  const [preview, setPreview] = useState<{ request: FindReplaceRequest; data: FindReplacePreview } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<CommandResult | null>(null)
  const [busy, setBusy] = useState(false)

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }
  if (!info) return null

  const chosen = column ?? columns[0]?.name ?? ''

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const request: FindReplaceRequest = { schema, table, column: chosen, find, replace_with: replaceWith, use_regex: useRegex }
    setBusy(true)
    setDone(null)
    try {
      setPreview({ request, data: await findReplacePreview(db, request) })
      setFailure(null)
      setFormShown(false)
    } catch (err) {
      setPreview(null)
      setFailure(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function replace() {
    if (!preview || busy) return
    setConfirming(false)
    setBusy(true)
    try {
      setDone(await findReplace(db, preview.request))
      setFailure(null)
      setPreview(null)
      setFormShown(true)
    } catch (err) {
      setFailure(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SearchTabs relationUrl={relationUrl} active="replace" />

      {done && <ResultMessage result={done} edit={`${relationUrl}/sql?${new URLSearchParams({ sql: done.sql })}`} />}

      {formShown && (
        <form name="insertForm" id="find_replace_form" className="ajax lock-page" onSubmit={submit}>
          <div className="card">
            <div className="card-header">{t('search.find_replace')}</div>
            <div className="card-body">
              <div className="mb-3">
                <label className="form-label" htmlFor="findInput">
                  {t('replace.find')}
                </label>
                <input className="form-control" type="text" name="find" id="findInput" required value={find} onChange={(e) => setFind(e.target.value)} />
              </div>
              <div className="mb-3">
                <label className="form-label" htmlFor="replaceWithInput">
                  {t('replace.replace_with')}
                </label>
                <input className="form-control" type="text" name="replaceWith" id="replaceWithInput" value={replaceWith} onChange={(e) => setReplaceWith(e.target.value)} />
              </div>
              <div className="mb-3">
                <label className="form-label" htmlFor="columnIndexSelect">
                  {t('replace.column')}
                </label>
                <select className="form-select" name="columnIndex" id="columnIndexSelect" value={chosen} onChange={(e) => setColumn(e.target.value)}>
                  {columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-check">
                <input className="form-check-input" type="checkbox" name="useRegex" id="useRegex" checked={useRegex} onChange={(e) => setUseRegex(e.target.checked)} />
                <label className="form-check-label" htmlFor="useRegex">
                  {t('replace.use_regex')}
                </label>
              </div>
            </div>
            <div className="card-footer">
              <input className="btn btn-primary" type="submit" name="submit" value={tApp('go')} disabled={busy} />
            </div>
          </div>
        </form>
      )}

      {preview && (
        <div id="toggle_find_div">
          <a
            id="toggle_find"
            href="#toggle"
            onClick={(e) => {
              e.preventDefault()
              setFormShown((shown) => !shown)
            }}
          >
            {formShown ? t('replace.hide_criteria') : t('replace.show_criteria')}
          </a>
        </div>
      )}

      <div id="sqlqueryresultsouter">
        {failure && (
          <div className="alert alert-danger" role="alert">
            {failure}
          </div>
        )}
        {preview && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!busy) setConfirming(true)
            }}
          >
            <div className="card">
              <div className="card-header">{t('replace.preview_title')}</div>
              <div className="card-body">
                <table className="table table-striped w-auto">
                  <thead>
                    <tr>
                      <th>{t('replace.count')}</th>
                      <th>{t('replace.original')}</th>
                      <th>{t('replace.replaced')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.data.rows.map((row, i) => (
                      <tr key={i}>
                        <td className="text-end">{row.count}</td>
                        <td>{row.original}</td>
                        <td>{row.replaced}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card-footer">
                <input className="btn btn-secondary" type="submit" name="replace" value={t('replace.replace')} disabled={busy} />
              </div>
            </div>
          </form>
        )}
      </div>

      <ConfirmQuery show={confirming && preview !== null} sql={preview?.data.sql ?? ''} onConfirm={() => void replace()} onClose={() => setConfirming(false)} />
    </>
  )
}
