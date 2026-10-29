import { useState, type FormEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import { urls } from '@/level'
import type { TreeNode } from '@/nodes/client'
import { nodeLink } from '@/nodes/links'
import { notifyError } from '@/notify'
import { searchData, searchObjects, searchOptions, type DataResult, type ObjectResult, type SearchOptions, type SearchType } from '../api'

const SEARCH_TYPES: SearchType[] = [1, 2, 3, 4, 5]

/**
 * The database's Search tab: phpMyAdmin's "Search in database" (database/search/main.twig and
 * results.twig), which counts the rows of each table holding the words and offers to browse or
 * delete them, and below it pgAdmin's search of the database's objects by name and type, each
 * found object linked to the page the navigation panel opens for it.
 */
export default function Search() {
  const db = useParams().db ?? ''
  const { data: options, error } = useRequest(() => searchOptions(db), [db])

  if (error) {
    return (
      <div className="container-fluid">
        <div className="alert alert-danger my-3" role="alert">
          {error.message}
        </div>
      </div>
    )
  }
  if (!options) return null

  return (
    <div className="container-fluid" key={db}>
      <DataSearch db={db} options={options} />
      <ObjectSearch db={db} options={options} />
    </div>
  )
}

const relationKey = (relation: { schema: string; name: string }) => `${relation.schema}.${relation.name}`

function DataSearch({ db, options }: { db: string; options: SearchOptions }) {
  const { t } = useTranslation('search')
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [type, setType] = useState<SearchType>(1)
  const [selected, setSelected] = useState<string[]>(() => options.relations.map(relationKey))
  const [column, setColumn] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<{ text: string; type: SearchType; rows: DataResult[]; total: number } | null>(null)
  const [deleting, setDeleting] = useState<DataResult | null>(null)

  /** A statement run on the database's SQL page, as phpMyAdmin's Browse and Delete links do. */
  /** Runs a statement on the SQL page; a DELETE comes confirmed already, so the page does not ask again. */
  const runOnSqlPage = (sql: string) => navigate(`${urls.database(db)}/sql?${new URLSearchParams({ sql, run: '1' })}`, { state: { confirmed: true } })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (text.trim() === '') return notifyError(t('data.no_text'))
    if (selected.length === 0) return notifyError(t('data.no_tables'))
    const relations = options.relations.filter((r) => selected.includes(relationKey(r))).map(({ schema, name }) => ({ schema, name }))
    setBusy(true)
    searchData(db, { text, type, relations, column }).then(
      ({ results: rows, total }) => {
        setBusy(false)
        setResults({ text, type, rows, total })
      },
      (err: unknown) => {
        setBusy(false)
        notifyError(errorMessage(err))
      },
    )
  }

  const hint = <Icon name="b_help" title={t('data.words_hint')} />

  return (
    <>
      <form id="db_search_form" name="db_search" onSubmit={submit}>
        <fieldset className="pma-fieldset">
          <legend>{t('data.title')}</legend>
          <p>
            <label htmlFor="criteriaSearchString" className="d-block">
              {t('data.words')}
            </label>
            <input id="criteriaSearchString" name="criteriaSearchString" className="w-75" type="text" value={text} onChange={(e) => setText(e.target.value)} />
          </p>
          <fieldset className="pma-fieldset">
            <legend>{t('data.find')}</legend>
            {SEARCH_TYPES.map((value) => (
              <div key={value}>
                <input type="radio" name="criteriaSearchType" id={`criteriaSearchTypeRadio${value}`} value={value} checked={type === value} onChange={() => setType(value)} />{' '}
                <label htmlFor={`criteriaSearchTypeRadio${value}`}>
                  {t(`data.type_${value}`)} {(value === 1 || value === 2) && hint}
                  {value === 5 && (
                    <a href="https://www.postgresql.org/docs/current/functions-matching.html#FUNCTIONS-POSIX-REGEXP" target="_blank" rel="noreferrer">
                      <Icon name="b_help" title={t('data.regex_docs')} />
                    </a>
                  )}
                </label>
              </div>
            ))}
          </fieldset>
          <fieldset className="pma-fieldset">
            <legend>{t('data.inside_tables')}</legend>
            <p>
              <a
                href="#"
                id="select_all"
                onClick={(e) => {
                  e.preventDefault()
                  setSelected(options.relations.map(relationKey))
                }}
              >
                {t('data.select_all')}
              </a>{' '}
              /{' '}
              <a
                href="#"
                id="unselect_all"
                onClick={(e) => {
                  e.preventDefault()
                  setSelected([])
                }}
              >
                {t('data.unselect_all')}
              </a>
            </p>
            <select className="resize-vertical" id="criteriaTables" name="criteriaTables[]" multiple value={selected} onChange={(e) => setSelected(Array.from(e.target.selectedOptions, (o) => o.value))}>
              {options.relations.map((relation) => (
                <option key={relationKey(relation)} value={relationKey(relation)}>
                  {relationKey(relation)}
                </option>
              ))}
            </select>
          </fieldset>
          <p>
            <label htmlFor="criteriaColumnName" className="d-block">
              {t('data.inside_column')}
            </label>
            <input id="criteriaColumnName" type="text" name="criteriaColumnName" className="w-75" value={column} onChange={(e) => setColumn(e.target.value)} />
          </p>
        </fieldset>
        <fieldset className="pma-fieldset tblFooters">
          <input id="buttonGo" className="btn btn-primary" type="submit" name="submit_search" value={t('go')} disabled={busy} />
        </fieldset>
      </form>

      {results && (
        <div id="searchresults">
          <table className="table table-striped caption-top w-auto">
            <caption className="tblHeaders">
              <Trans t={t} i18nKey="data.results" values={{ text: results.text, how: t(`data.type_${results.type}`) }} components={{ em: <em /> }} />
            </caption>
            <tbody>
              {results.rows.map((row) => (
                <tr className="noclick" key={relationKey(row)}>
                  <td className={row.error !== null ? 'text-danger' : undefined}>
                    {row.error !== null ? (
                      <>
                        <Trans t={t} i18nKey="data.failed" values={{ table: relationKey(row) }} components={{ strong: <strong /> }} /> {row.error}
                      </>
                    ) : (
                      <Trans t={t} i18nKey="data.matches" count={row.count} values={{ table: relationKey(row) }} components={{ strong: <strong /> }} />
                    )}
                  </td>
                  <td>
                    {row.count > 0 && (
                      <a
                        href="#"
                        className="browse_results"
                        onClick={(e) => {
                          e.preventDefault()
                          runOnSqlPage(row.select)
                        }}
                      >
                        {t('data.browse')}
                      </a>
                    )}
                  </td>
                  <td>
                    {row.count > 0 && row.delete !== null && (
                      <a
                        href="#"
                        className="delete_results"
                        onClick={(e) => {
                          e.preventDefault()
                          setDeleting(row)
                        }}
                      >
                        {t('data.delete')}
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.rows.length > 1 && (
            <p>
              <Trans t={t} i18nKey="data.total" count={results.total} components={{ strong: <strong />, em: <em /> }} />
            </p>
          )}
        </div>
      )}

      <ConfirmQuery
        show={deleting !== null}
        sql={deleting?.delete ?? ''}
        onConfirm={() => {
          const sql = deleting?.delete
          setDeleting(null)
          if (sql) runOnSqlPage(sql)
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}

/** The navigation panel's node for one step of an object's path. */
function treeNode(step: ObjectResult['path'][number], catalog: boolean): TreeNode {
  // pgAdmin names a catalog schema "PostgreSQL Catalog (pg_catalog)" and a foreign key "fk -> table".
  const label = step.type === 'schema' && catalog ? (/\(([^)]+)\)$/.exec(step.name)?.[1] ?? step.name) : step.type === 'foreign_key' ? step.name.split(' -> ')[0] : step.name

  return { id: `${step.type}/${step.oid}`, oid: step.oid, label, type: step.type, icon: '', inode: false, meta: {} }
}

function ObjectSearch({ db, options }: { db: string; options: SearchOptions }) {
  const { t } = useTranslation('search')
  const [text, setText] = useState('')
  const [type, setType] = useState('all')
  const [system, setSystem] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<ObjectResult[] | null>(null)
  const types = new Map(options.object_types.map((o) => [o.type, o]))

  function submit(e: FormEvent) {
    e.preventDefault()
    if (text.trim().length < 3) return notifyError(t('objects.too_short'))
    setBusy(true)
    searchObjects(db, { text, type, system }).then(
      (rows) => {
        setBusy(false)
        setResults(rows)
      },
      (err: unknown) => {
        setBusy(false)
        notifyError(errorMessage(err))
      },
    )
  }

  return (
    <>
      <form id="object_search_form" onSubmit={submit}>
        <fieldset className="pma-fieldset">
          <legend>{t('objects.title')}</legend>
          <p>
            <label htmlFor="objectSearchString" className="d-block">
              {t('objects.name')}
            </label>
            <input id="objectSearchString" className="w-75" type="text" value={text} onChange={(e) => setText(e.target.value)} />
          </p>
          <p>
            <label htmlFor="objectSearchType" className="d-block">
              {t('objects.type')}
            </label>
            <select id="objectSearchType" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">{t('objects.all_types')}</option>
              {[...options.object_types]
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((o) => (
                  <option key={o.type} value={o.type}>
                    {o.label}
                  </option>
                ))}
            </select>
          </p>
          <div>
            <input type="checkbox" id="objectSearchSystem" checked={system} onChange={(e) => setSystem(e.target.checked)} /> <label htmlFor="objectSearchSystem">{t('objects.system')}</label>
          </div>
        </fieldset>
        <fieldset className="pma-fieldset tblFooters">
          <input className="btn btn-primary" type="submit" value={t('go')} disabled={busy} />
        </fieldset>
      </form>

      {results && (
        <div id="objectresults">
          <table className="table table-striped caption-top w-auto">
            <caption className="tblHeaders">{t('objects.results', { count: results.length, text })}</caption>
            {results.length > 0 && (
              <thead>
                <tr>
                  <th>{t('objects.col_name')}</th>
                  <th>{t('objects.col_type')}</th>
                  <th>{t('objects.col_path')}</th>
                </tr>
              </thead>
            )}
            <tbody>
              {results.map((row, i) => {
                const catalog = row.catalog_level !== 'N'
                const nodes = row.path.map((step) => treeNode(step, catalog))
                const node = nodes.at(-1)
                const href = node ? nodeLink(node, { db, ancestors: nodes.slice(0, -1) }) : urls.database(db)
                const kind = types.get(row.type)

                return (
                  <tr key={`${row.type}:${i}`}>
                    <td>
                      <Link to={href}>{row.name}</Link>
                      {row.other_info && <span className="text-body-secondary"> ({row.other_info})</span>}
                    </td>
                    <td className="text-nowrap">
                      {kind?.icon && <Icon name={kind.icon} />} {kind?.label ?? row.type}
                    </td>
                    <td>{row.path.slice(0, -1).map((step) => step.name).join(' / ')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
