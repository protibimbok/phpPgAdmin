import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { useLevel } from '@/level'
import { urls } from '@/level'
import NodeChildren from '@/layout/tree/NodeChildren'
import TreeItem from '@/layout/tree/TreeItem'
import TreeList from '@/layout/tree/TreeList'
import { FIRST_LEVEL_PAGE_SIZE, useTreeState } from '@/layout/tree/treeState'
import { usePreference } from '@/preferences'
import { databaseNodes } from './api'

/**
 * The databases as the first level of phpMyAdmin's navigation tree: a "New" item, then one
 * item per database, each opening to the containers of the objects inside it, with the fast
 * filter and page selector for long lists.
 */
export default function DatabaseTree() {
  const firstLevelPageSize = usePreference<number>(FIRST_LEVEL_PAGE_SIZE)
  const { t } = useTranslation('databases')
  const level = useLevel()
  const state = useTreeState()
  const { data } = useRequest(() => databaseNodes(), [state.version()])
  const databases = data ?? []

  return (
    <ul>
      <TreeList
        items={databases}
        label={(database) => database.label}
        pageSize={firstLevelPageSize}
        filterClass="db_fast_filter"
        head={
          <li className={`first new_database italics${databases.length === 0 ? ' last' : ''}`}>
            <div className="block">
              <i className="first" />
            </div>
            <div className="block second">
              <Link to="/server/databases">
                <Icon name="b_newdb" title={t('new')} />
              </Link>
            </div>
            <Link className="hover_show_full" to="/server/databases" title={t('new')}>
              {t('new')}
            </Link>
            <div className="clearfloat" />
          </li>
        }
        render={(database, index, visible) => {
          const current = state.isLinked() && level.db === database.label

          return (
            <TreeItem
              key={database.id}
              path={database.label}
              label={database.label}
              title={database.meta.description ?? database.label}
              href={urls.database(database.label)}
              icon="s_db"
              className="database"
              expandable={database.inode}
              last={index === visible.length - 1}
              selected={current && level.name === 'database'}
              autoOpen={current && level.name !== 'database'}
            >
              <NodeChildren db={database.label} ancestors={[database]} />
            </TreeItem>
          )
        }}
      />
    </ul>
  )
}
