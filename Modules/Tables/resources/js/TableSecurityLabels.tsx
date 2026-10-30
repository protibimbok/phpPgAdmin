import { useParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import SecurityLabelsCard from '@/components/SecurityLabelsCard'
import { resolveTable } from './api'

/**
 * The table Operations page's Security labels card (its own columns' too), rendered after the
 * page by the route: the table is found by the names in the URL.
 */
export default function TableSecurityLabels() {
  const { db = '', schema = '', table = '' } = useParams()
  const { data } = useRequest(() => resolveTable(db, schema, table), [db, schema, table])

  if (!data) return null

  return (
    <div className="container-fluid">
      <SecurityLabelsCard key={data.tid} db={db} catalog="pg_class" oid={data.tid} />
    </div>
  )
}
