import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import SqlView from '@/components/SqlView'
import { resolveTable, tables } from '../api'

/** The DDL that recreates the table, as pgAdmin's "SQL" tab shows it. */
export default function TableDdl() {
  const { t } = useTranslation('tables')
  const { db = '', schema = '', table = '' } = useParams()
  const { data: sql, error } = useRequest(async () => {
    const { scid, tid } = await resolveTable(db, schema, table)

    return tables(db, scid).sql(tid)
  }, [db, schema, table])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (sql === undefined) return null

  return <SqlView sql={sql} title={t('ddl.title', { table: `${schema}.${table}` })} />
}
