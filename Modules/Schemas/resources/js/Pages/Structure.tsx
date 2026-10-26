import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { urls } from '@/level'
import { listSchemas } from '../api'

/**
 * A database's "Structure" page: its schemas, laid out like phpMyAdmin's list of a database's
 * tables (database/structure/index.twig): a checkbox column, the name linking to the schema,
 * action icons, then the details, and a summary row at the foot.
 */
export default function Structure() {
  const { t } = useTranslation('schemas')
  const db = useParams().db ?? ''
  const { data: schemas, error } = useRequest(() => listSchemas(db), [db])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (schemas === undefined) {
    return null
  }

  if (schemas.length === 0) {
    return (
      <div className="alert alert-primary" role="alert">
        {t('none')}
      </div>
    )
  }

  return (
    <div id="tableslistcontainer">
      <div className="table-responsive">
        <table className="table table-striped table-hover table-sm w-auto data">
          <thead>
            <tr>
              <th className="d-print-none" />
              <th>{t('columns.schema')}</th>
              <th colSpan={2} className="d-print-none">
                {t('columns.action')}
              </th>
              <th>{t('columns.owner')}</th>
              <th>{t('columns.comment')}</th>
            </tr>
          </thead>
          <tbody>
            {schemas.map((schema) => {
              const href = urls.schema(db, schema.name)

              return (
                <tr key={schema.oid}>
                  <td className="text-center d-print-none">
                    <input type="checkbox" className="checkall" name="selected_schema[]" value={schema.name} />
                  </td>
                  <th>
                    <Link to={href}>{schema.name}</Link>
                    {schema.is_sys_obj && <span className="badge bg-secondary ms-2">{t('system')}</span>}
                  </th>
                  <td className="text-center d-print-none">
                    <Link to={href}>
                      <Icon name="b_props" title={t('actions.structure')} /> {t('actions.structure')}
                    </Link>
                  </td>
                  <td className="text-center d-print-none">
                    <Link to={href}>
                      <Icon name="b_browse" title={t('actions.browse')} /> {t('actions.browse')}
                    </Link>
                  </td>
                  <td>{schema.namespaceowner}</td>
                  <td>{schema.description}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot id="tbl_summary_row">
            <tr>
              <th className="d-print-none" />
              <th className="tbl_num text-nowrap">{t('total', { count: schemas.length })}</th>
              <th colSpan={4} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
