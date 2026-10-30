import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import Icon from '@/components/Icon'

export type SearchTab = 'search' | 'zoom' | 'replace'

/**
 * The pills over phpMyAdmin's three table search pages (table/search, zoom_search and
 * find_replace index.twig): Table search, Zoom search, Find and replace.
 */
export default function SearchTabs({ relationUrl, active }: { relationUrl: string; active: SearchTab }) {
  const { t } = useTranslation('sql')
  const className = (tab: SearchTab) => `nav-link${tab === active ? ' active' : ''} disableAjax`

  return (
    <ul className="nav nav-pills m-2">
      <li className="nav-item">
        <Link className={className('search')} to={`${relationUrl}/search`}>
          <Icon name="b_search" /> {t('search.table_search')}
        </Link>
      </li>
      <li className="nav-item">
        <Link className={className('zoom')} to={`${relationUrl}/search/zoom`}>
          <Icon name="b_select" /> {t('search.zoom_search')}
        </Link>
      </li>
      <li className="nav-item">
        <Link className={className('replace')} to={`${relationUrl}/search/replace`}>
          <Icon name="b_find_replace" /> {t('search.find_replace')}
        </Link>
      </li>
    </ul>
  )
}
