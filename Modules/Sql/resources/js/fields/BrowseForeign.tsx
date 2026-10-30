import { Fragment, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useRequest } from '@/api/useRequest'
import Modal from '@/components/Modal'
import { preference } from '@/preferences'
import { browseForeignValues, type ForeignKey } from '../api'
import { LIMIT_CHARS, MAX_ROWS } from '../preferences'

export interface BrowseForeignProps {
  show: boolean
  db: string
  foreignKey: ForeignKey
  /** The field's value now: its key is shown in bold. */
  value: string
  /** A value was picked; the window closes. */
  onPick: (key: string) => void
  onClose: () => void
}

/** phpMyAdmin's RepeatCells: the header row comes again after this many rows. */
const REPEAT_CELLS = 100

/**
 * phpMyAdmin's "Browse foreign values" window (BrowseForeigners, table/browse_foreigners/*):
 * the Search box with Go, the page selector and Show all over a table that lists every value
 * twice, by key on the left and by description on the right. Clicking a key or a description
 * puts the key into the field.
 */
export default function BrowseForeign({ show, ...props }: BrowseForeignProps) {
  const { t } = useTranslation('sql')

  return (
    <Modal show={show} id="browseForeignModal" size="lg" title={t('fields.browse_foreign')} onClose={props.onClose}>
      {show && <BrowseForeignBody {...props} />}
    </Modal>
  )
}

function BrowseForeignBody({ db, foreignKey, value, onPick }: Omit<BrowseForeignProps, 'show'>) {
  const { t } = useTranslation('sql')
  const { t: tApp } = useTranslation()
  const maxRows = preference<number>(MAX_ROWS)
  const limitChars = preference<number>(LIMIT_CHARS)
  const [filter, setFilter] = useState('')
  const [request, setRequest] = useState({ search: '', offset: 0, all: false })
  const { data, error } = useRequest(() => browseForeignValues(db, foreignKey, { ...request, limit: maxRows }), [db, foreignKey.schema, foreignKey.table, foreignKey.column, request.search, request.offset, request.all])

  const total = data?.total ?? 0
  const pageCount = Math.ceil(total / maxRows)
  const pageNow = Math.floor(request.offset / maxRows) + 1

  function submit(e: FormEvent) {
    e.preventDefault()
    // React carries the event up through the portal: the insert or search form around the field must not submit too.
    e.stopPropagation()
    // A new search starts again at the first page, as browseForeignDialog resets "pos".
    setRequest({ search: filter, offset: filter === request.search ? request.offset : 0, all: false })
  }

  const header = (
    <tr>
      <th>{t('fields.keyname')}</th>
      <th>{t('fields.description')}</th>
      <td width="20%" />
      <th>{t('fields.description')}</th>
      <th>{t('fields.keyname')}</th>
    </tr>
  )

  // The right half keeps the server's order, by description; the left half is sorted by key.
  const byDescription = data?.values ?? []
  const byKey = [...byDescription].sort((a, b) => compareKeys(a.key ?? '', b.key ?? ''))

  function cell(entry: { key: string | null; display: string | null }, nowrap: boolean) {
    const key = entry.key ?? ''
    const description = entry.display ?? ''
    const long = description.length > limitChars
    const shown = long ? `${description.slice(0, limitChars)}...` : description
    const link = (
      <a
        className="foreign_value"
        data-key={key}
        href="#use-value"
        title={long ? `${t('fields.use_this_value')}: ${description}` : t('fields.use_this_value')}
        onClick={(e) => {
          e.preventDefault()
          onPick(key)
        }}
      >
        {nowrap ? key : shown}
      </a>
    )

    return <td className={nowrap ? 'text-nowrap' : undefined}>{value !== '' && key === value ? <strong>{link}</strong> : link}</td>
  }

  return (
    <>
      <form className="ajax" id="browse_foreign_form" name="browse_foreign_from" onSubmit={submit}>
        <fieldset className="row g-3 align-items-center mb-3">
          <div className="col-auto">
            <label className="form-label" htmlFor="input_foreign_filter">
              {t('fields.browse_search')}
            </label>
          </div>
          <div className="col-auto">
            <input className="form-control" type="text" name="foreign_filter" id="input_foreign_filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="col-auto">
            <input className="btn btn-primary" type="submit" name="submit_foreign_filter" value={tApp('go')} />
          </div>
          <div className="col-auto">
            {total > maxRows && (
              <>
                {t('grid.page_number')}{' '}
                <select className="pageselector ajax" name="pos" value={request.all ? 0 : request.offset} onChange={(e) => setRequest({ search: request.search, offset: Number(e.target.value), all: false })} aria-label={t('grid.page_number')}>
                  {pageOptions(pageCount, pageNow).map((page) => (
                    <option key={page} value={(page - 1) * maxRows}>
                      {page}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          <div className="col-auto">
            {total > maxRows && (
              <input className="btn btn-secondary" type="button" id="foreign_showAll" name="foreign_showAll" value={t('grid.show_all')} onClick={() => setRequest({ search: filter, offset: 0, all: true })} />
            )}
          </div>
        </fieldset>
      </form>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error.message}
        </div>
      )}

      <table className="table table-striped table-hover" id="browse_foreign_table">
        {byDescription.length > 0 && (
          <>
            <thead>{header}</thead>
            <tfoot>{header}</tfoot>
            <tbody>
              {byKey.map((left, i) => (
                <Fragment key={i}>
                  {i > 0 && i % REPEAT_CELLS === 0 && header}
                  <tr className="noclick">
                    {cell(left, true)}
                    {cell(left, false)}
                    <td width="20%" />
                    {cell(byDescription[i], false)}
                    {cell(byDescription[i], true)}
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </>
        )}
      </table>
    </>
  )
}

/** PHP's asort order: numeric strings by value, the rest as text. */
function compareKeys(a: string, b: string): number {
  const numeric = /^-?\d+(\.\d+)?$/
  if (numeric.test(a) && numeric.test(b)) return Number(a) - Number(b)

  return a < b ? -1 : a > b ? 1 : 0
}

/** The pages Util::pageselector offers: every one up to 200, beyond that the first and last five, those near the current page and every tenth, hundredth… */
function pageOptions(pageCount: number, current: number): number[] {
  if (pageCount < 200) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const pages = new Set<number>()
  for (let i = 1; i <= 5; i++) pages.add(i)
  for (let i = pageCount - 5; i <= pageCount; i++) pages.add(i)
  for (let i = current - 10; i <= current + 10; i++) if (i >= 1 && i <= pageCount) pages.add(i)
  for (let step = Math.max(1, Math.floor(pageCount / 20)), i = step; i <= pageCount; i += step) pages.add(i)
  for (let dist = 2; current + dist <= pageCount || current - dist >= 1; dist *= 2) {
    if (current + dist <= pageCount) pages.add(current + dist)
    if (current - dist >= 1) pages.add(current - dist)
  }

  return [...pages].sort((a, b) => a - b)
}
