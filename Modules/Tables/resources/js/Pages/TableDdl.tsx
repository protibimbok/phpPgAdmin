import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import DependencyPanel from '@/components/DependencyPanel'
import SqlView from '@/components/SqlView'
import { resolveTable, tables } from '../api'

/** The DDL that recreates the table, as pgAdmin's "SQL" tab shows it, and its Dependencies and Dependents. */
export default function TableDdl() {
  const { t } = useTranslation('tables')
  const { db = '', schema = '', table = '' } = useParams()
  const { data, error } = useRequest(async () => {
    const { scid, tid } = await resolveTable(db, schema, table)

    return { node: tables(db, scid), tid, sql: await tables(db, scid).sql(tid) }
  }, [db, schema, table])

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
      <SqlView sql={data.sql} title={t('ddl.title', { table: `${schema}.${table}` })} />
      <DependencyPanel dependencies={() => data.node.dependencies(data.tid)} dependents={() => data.node.dependents(data.tid)} reloadKey={`${db}/${data.tid}`} />
    </>
  )
}
