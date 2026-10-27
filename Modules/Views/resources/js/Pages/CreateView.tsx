import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import { urls, useLevel } from '@/level'
import { resolveView, viewsOf, type ViewKind } from '../api'
import ViewForm from '../ViewForm'

/**
 * phpMyAdmin's /view/create page: the create-view form (prefilled from "?sql=" when a query
 * is handed over) at a schema, or the same form editing the view the URL names.
 */
export default function CreateView({ mode }: { mode: 'create' | 'edit' }) {
  const { t } = useTranslation('views')
  const { db = '', schema = '', view: name = '' } = useParams()
  const kind: ViewKind = useLevel().kind === 'mview' ? 'mview' : 'view'
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { data, error } = useRequest(async () => {
    if (mode === 'create') return null
    const { scid, vid } = await resolveView(db, schema, name, kind)

    return { kind, properties: await viewsOf(db, scid, kind).properties(vid) }
  }, [db, schema, name, kind, mode])

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
      <h2>{mode === 'edit' ? t('form.edit_heading', { name: `${schema}.${name}` }) : t('form.create_heading', { schema })}</h2>
      <ViewForm
        key={`${mode}-${db}-${schema}-${name}`}
        db={db}
        schema={schema}
        view={data}
        initialSql={search.get('sql') ?? ''}
        onSaved={(node, savedKind, savedSchema) => navigate(urls.relation(db, savedSchema, node.label, savedKind))}
      />
    </>
  )
}
