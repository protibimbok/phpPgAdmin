import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import Icon from '@/components/Icon'
import { listDatabases, type Database } from './api'

/**
 * The databases as the first level of phpMyAdmin's navigation tree: a "New" item, then one
 * item per database, each with the database icon and connecting lines drawn by the theme.
 */
export default function DatabaseTree() {
  const { t } = useTranslation('databases')
  const [databases, setDatabases] = useState<Database[]>([])

  useEffect(() => {
    listDatabases().then(setDatabases, () => setDatabases([]))
  }, [])

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

      {databases.map((database, index) => {
        const last = index === databases.length - 1
        const href = `/database/${encodeURIComponent(database.name)}`

        return (
          <li key={database.name} className={`database${last ? ' last' : ''}`}>
            <div className="block">
              <i />
              {/* The line on to the next item; the last item has none. */}
              {!last && <b />}
            </div>
            <div className="block second">
              <Link to={href}>
                <Icon name="s_db" title={t('columns.database')} />
              </Link>
            </div>
            <Link className="hover_show_full" to={href} title={database.name}>
              {database.name}
            </Link>
            <div className="clearfloat" />
          </li>
        )
      })}
    </ul>
  )
}
