import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import SqlView from '@/components/SqlView'
import { databaseSql, resolveDatabase } from '../api'

/** The DDL that recreates the database, as pgAdmin's "SQL" tab shows it. */
export default function DatabaseDdl() {
  const { t } = useTranslation('databases')
  const db = useParams().db ?? ''
  const { data: sql, error } = useRequest(() => resolveDatabase(db).then(databaseSql), [db])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (sql === undefined) return null

  return <SqlView sql={sql} title={t('ddl.title', { database: db })} />
}
