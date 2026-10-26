import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FILTER_MINIMUM, PAGE_SIZE } from './treeState'

export interface TreeListProps<T> {
  items: T[]
  /** The text the fast filter matches and the page selector counts. */
  label: (item: T) => string
  render: (item: T, index: number, visible: T[]) => ReactNode
  /** Items per page; the first level shows more than the containers. */
  pageSize?: number
  /** Rendered before the items, outside filtering and paging: the "New" item. */
  head?: ReactNode
  /** Rendered after the items: the tree controls. */
  tail?: ReactNode
  /** Classes for the fast filter's <li>; phpMyAdmin's first level uses "db_fast_filter". */
  filterClass?: string
}

/**
 * A list of tree items with phpMyAdmin's two helpers for long lists: the fast filter
 * (navigation/tree/fast_filter.twig), which filters as you type once the list reaches
 * NavigationTreeDisplayItemFilterMinimum items, and the page selector (list_navigator.twig)
 * once it exceeds MaxNavigationItems.
 */
export default function TreeList<T>({ items, label, render, pageSize = PAGE_SIZE, head, tail, filterClass }: TreeListProps<T>) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase()

    return needle === '' ? items : items.filter((item) => label(item).toLowerCase().includes(needle))
  }, [items, filter, label])

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pages - 1)
  const visible = filtered.slice(current * pageSize, (current + 1) * pageSize)

  return (
    <>
      {items.length >= FILTER_MINIMUM && (
        <li className={['fast_filter', filterClass].filter(Boolean).join(' ')}>
          <form className="fast_filter" onSubmit={(e) => e.preventDefault()}>
            <div className="input-group">
              <input
                className="searchClause form-control"
                type="text"
                value={filter}
                onChange={(e) => { setFilter(e.target.value); setPage(0) }}
                aria-label={t('tree.filter')}
                placeholder={t('tree.filter')}
              />
              <button className="btn btn-outline-secondary searchClauseClear" type="button" aria-label={t('tree.clear_filter')} onClick={() => setFilter('')}>
                X
              </button>
            </div>
          </form>
        </li>
      )}
      {pages > 1 && (
        <li>
          <div className="pageselector">
            {current > 0 && (
              <>
                <a href="#first" title={t('tree.first_page')} onClick={(e) => { e.preventDefault(); setPage(0) }}>&lt;&lt;</a>{' '}
                <a href="#prev" title={t('tree.previous_page')} onClick={(e) => { e.preventDefault(); setPage(current - 1) }}>&lt;</a>{' '}
              </>
            )}
            <select className="form-select form-select-sm d-inline-block w-auto" value={current} onChange={(e) => setPage(Number(e.target.value))} aria-label={t('tree.page')}>
              {Array.from({ length: pages }, (_, i) => (
                <option key={i} value={i}>
                  {i + 1}
                </option>
              ))}
            </select>
            {current < pages - 1 && (
              <>
                {' '}
                <a href="#next" title={t('tree.next_page')} onClick={(e) => { e.preventDefault(); setPage(current + 1) }}>&gt;</a>{' '}
                <a href="#last" title={t('tree.last_page')} onClick={(e) => { e.preventDefault(); setPage(pages - 1) }}>&gt;&gt;</a>
              </>
            )}
          </div>
        </li>
      )}
      {head}
      {visible.map((item, index) => render(item, index, visible))}
      {tail}
    </>
  )
}
