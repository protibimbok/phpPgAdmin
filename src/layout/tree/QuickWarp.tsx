import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { errorMessage } from '@/api/request'
import Icon from '@/components/Icon'
import { urls, useLevel } from '@/level'
import { notifyError } from '@/notify'
import { usePreference } from '@/preferences'
import { clearQuickWarp, loadQuickWarp, quickWarpLabel, recordRecent, toggleFavorite, useQuickWarp } from './recentFavorites'
import { NUM_FAVORITE_TABLES, NUM_RECENT_TABLES } from './treeState'

/**
 * phpMyAdmin's quick warp above the tree (navigation/tree/quick_warp.twig and
 * RecentFavoriteTable::getHtml): a Recent and a Favorites button, each opening its list on
 * hover. A table page records its table in Recent; a list whose length setting is 0 is not shown.
 */
export default function QuickWarp() {
  const { t } = useTranslation()
  const lists = useQuickWarp()
  const level = useLevel()
  const numRecent = usePreference<number>(NUM_RECENT_TABLES)
  const numFavorite = usePreference<number>(NUM_FAVORITE_TABLES)

  // Read again when a length changes: the server cuts the lists to it.
  useEffect(() => {
    void loadQuickWarp().catch(() => undefined)
  }, [numRecent, numFavorite])
  useEffect(() => clearQuickWarp, [])

  // Every page of a table records it, as phpMyAdmin's Header does for any page with a table.
  const { db, schema, table } = level
  useEffect(() => {
    if (level.name !== 'table' || db === undefined || schema === undefined || table === undefined || numRecent <= 0) return
    void recordRecent({ database: db, schema, table }).catch(() => undefined)
  }, [level.name, db, schema, table, numRecent])

  if (numRecent <= 0 && numFavorite <= 0) return null

  return (
    <div className="pma_quick_warp">
      {numRecent > 0 && (
        <div className="drop_list">
          <button title={t('quick_warp.recent_title')} className="drop_button btn">
            {t('quick_warp.recent')}
          </button>
          <ul id="pma_recent_list">
            {lists.recent.length === 0 ? (
              <li className="warp_link">{t('quick_warp.no_recent')}</li>
            ) : (
              lists.recent.map((entry) => (
                <li className="warp_link" key={`${entry.database}.${entry.schema}.${entry.table}`}>
                  <Link to={urls.relation(entry.database, entry.schema, entry.table, entry.kind)}>{quickWarpLabel(entry)}</Link>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
      {numFavorite > 0 && (
        <div className="drop_list">
          <button title={t('quick_warp.favorites_title')} className="drop_button btn">
            {t('quick_warp.favorites')}
          </button>
          <ul id="pma_favorite_list">
            {lists.favorite.length === 0 ? (
              <li className="warp_link">{t('quick_warp.no_favorites')}</li>
            ) : (
              lists.favorite.map((entry) => (
                <li className="warp_link" key={`${entry.database}.${entry.schema}.${entry.table}`}>
                  <a
                    className="ajax favorite_table_anchor"
                    href="#remove-favorite"
                    title={t('quick_warp.remove_favorite')}
                    onClick={(e) => {
                      e.preventDefault()
                      toggleFavorite(entry).catch((err: unknown) => notifyError(errorMessage(err)))
                    }}
                  >
                    <Icon name="b_favorite" />
                  </a>
                  <Link to={urls.relation(entry.database, entry.schema, entry.table, entry.kind)}>{quickWarpLabel(entry)}</Link>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
      <div className="clearfloat" />
    </div>
  )
}
