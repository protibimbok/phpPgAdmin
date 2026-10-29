import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import DependencyPanel from '@/components/DependencyPanel'
import SqlView from '@/components/SqlView'
import StatisticsPanel from '@/components/StatisticsPanel'
import { databases, databaseSql, resolveDatabase } from '../api'

/** The DDL that recreates the database, as pgAdmin's "SQL" tab shows it, its Statistics, and its Dependencies and Dependents. */
export default function DatabaseDdl() {
  const { t } = useTranslation('databases')
  const db = useParams().db ?? ''
  const { data, error } = useRequest(() => resolveDatabase(db).then(async (did) => ({ did, sql: await databaseSql(did) })), [db])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (data === undefined) return null

  return (
    <>
      <SqlView sql={data.sql} title={t('ddl.title', { database: db })} />
      <StatisticsPanel load={() => databases.statistics(data.did)} reloadKey={`${db}/${data.did}`} />
      <DependencyPanel dependencies={() => databases.dependencies(data.did)} dependents={() => databases.dependents(data.did)} reloadKey={`${db}/${data.did}`} />
    </>
  )
}
