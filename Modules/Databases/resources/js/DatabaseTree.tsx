import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { urls } from '@/level'
import NodeChildren from '@/layout/tree/NodeChildren'
import TreeItem from '@/layout/tree/TreeItem'
import { databaseNodes } from './api'

/**
 * The databases as the first level of phpMyAdmin's navigation tree: a "New" item, then one
 * item per database, each opening to the containers of the objects inside it.
 */
export default function DatabaseTree() {
  const { t } = useTranslation('databases')
  const { data } = useRequest(() => databaseNodes(), [])
  const databases = data ?? []

  return (
    <ul>
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

      {databases.map((database, index) => (
        <TreeItem
          key={database.id}
          path={database.label}
          label={database.label}
          title={database.meta.description ?? database.label}
          href={urls.database(database.label)}
          icon="s_db"
          className="database"
          expandable={database.inode}
          last={index === databases.length - 1}
        >
          <NodeChildren db={database.label} ancestors={[database]} />
        </TreeItem>
      ))}
    </ul>
  )
}
