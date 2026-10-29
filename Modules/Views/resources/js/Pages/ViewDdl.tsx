import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import DependencyPanel from '@/components/DependencyPanel'
import SqlView from '@/components/SqlView'
import { useLevel } from '@/level'
import { resolveView, viewsOf, type ViewKind } from '../api'

/** The DDL that recreates the view, as pgAdmin's "SQL" tab shows it, and its Dependencies and Dependents. */
export default function ViewDdl() {
  const { t } = useTranslation('views')
  const { db = '', schema = '', view = '' } = useParams()
  const kind: ViewKind = useLevel().kind === 'mview' ? 'mview' : 'view'
  const { data, error } = useRequest(async () => {
    const { scid, vid } = await resolveView(db, schema, view, kind)

    return { node: viewsOf(db, scid, kind), vid, sql: await viewsOf(db, scid, kind).sql(vid) }
  }, [db, schema, view, kind])

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
      <SqlView sql={data.sql} title={t('ddl.title', { view: `${schema}.${view}` })} />
      <DependencyPanel dependencies={() => data.node.dependencies(data.vid)} dependents={() => data.node.dependents(data.vid)} reloadKey={`${db}/${kind}/${data.vid}`} />
    </>
  )
}
