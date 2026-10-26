import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import { notAvailable } from '@/unbuilt'
import Icon from '@/components/Icon'
import { databaseProperties, resolveDatabase } from '../api'

/**
 * The database's "Operations" page, laid out like phpMyAdmin's database/operations/index.twig:
 * one card per operation (comment, create table, rename, remove, copy), then the properties
 * ALTER DATABASE can change as a form card where phpMyAdmin has its Collation card, and the
 * encoding and collations, which PostgreSQL fixes at creation, as text. The forms that change
 * the database arrive with phase 3; until then they look as phpMyAdmin's do and answer with a
 * notice.
 */
export default function Operations() {
  const { t } = useTranslation('databases')
  const db = useParams().db ?? ''
  const { data, error } = useRequest(() => resolveDatabase(db).then(databaseProperties), [db])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="container-fluid">
      <form id="formDatabaseComment" onSubmit={notAvailable}>
        <div className="card mb-2">
          <div className="card-header">
            <Icon name="b_comment" /> {t('operations.comment')}
          </div>
          <div className="card-body">
            <div className="row g-3">
              <div className="col-auto">
                <label className="visually-hidden" htmlFor="databaseCommentInput">
                  {t('operations.comment')}
                </label>
                <input className="form-control textfield" id="databaseCommentInput" type="text" defaultValue={data.comments ?? ''} />
              </div>
            </div>
          </div>
          <div className="card-footer text-end">
            <input className="btn btn-primary" type="submit" value={t('operations.go')} />
          </div>
        </div>
      </form>

      <form id="createTableMinimalForm" className="card mb-2" onSubmit={notAvailable}>
        <div className="card-header">
          <Icon name="b_table_add" /> {t('operations.create_table')}
        </div>
        <div className="card-body row row-cols-lg-auto g-3">
          <div className="col-md-6">
            <label htmlFor="createTableNameInput" className="form-label">
              {t('operations.table_name')}
            </label>
            <input type="text" className="form-control" id="createTableNameInput" maxLength={63} required />
          </div>
          <div className="col-md-6">
            <label htmlFor="createTableNumFieldsInput" className="form-label">
              {t('operations.number_of_columns')}
            </label>
            <input type="number" className="form-control" id="createTableNumFieldsInput" min={1} defaultValue={4} required />
          </div>
        </div>
        <div className="card-footer text-end">
          <input className="btn btn-primary" type="submit" value={t('operations.create')} />
        </div>
      </form>

      <form id="rename_db_form" onSubmit={notAvailable}>
        <div className="card mb-2">
          <div className="card-header">
            <Icon name="b_edit" /> {t('operations.rename')}
          </div>
          <div className="card-body">
            <div className="row g-3">
              <div className="col-auto">
                <label className="visually-hidden" htmlFor="new_db_name">
                  {t('operations.new_name')}
                </label>
                <input className="form-control textfield" id="new_db_name" type="text" maxLength={63} defaultValue={db} required />
              </div>
            </div>
          </div>
          <div className="card-footer text-end">
            <input className="btn btn-primary" type="submit" value={t('operations.go')} />
          </div>
        </div>
      </form>

      <div className="card mb-2">
        <div className="card-header">
          <Icon name="b_deltbl" /> {t('operations.remove')}
        </div>
        <div className="card-body">
          <div className="card-text">
            <a id="drop_db_anchor" className="text-danger" href="#drop" onClick={notAvailable}>
              {t('operations.drop')}
            </a>
          </div>
        </div>
      </div>

      <form id="copy_db_form" onSubmit={notAvailable}>
        <div className="card mb-2">
          <div className="card-header">
            <Icon name="b_edit" /> {t('operations.copy')}
          </div>
          <div className="card-body">
            <div className="mb-3 row g-3">
              <div className="col-auto">
                <label className="visually-hidden" htmlFor="copyDbNameInput">
                  {t('operations.copy_name')}
                </label>
                <input className="form-control textfield" id="copyDbNameInput" type="text" maxLength={63} defaultValue={db} required />
              </div>
            </div>

            <div className="form-check">
              <input className="form-check-input" type="checkbox" id="checkbox_switch" />
              <label className="form-check-label" htmlFor="checkbox_switch">
                {t('operations.switch_to_new')}
              </label>
            </div>
          </div>
          <div className="card-footer text-end">
            <input className="btn btn-primary" type="submit" value={t('operations.go')} />
          </div>
        </div>
      </form>

      <form id="db_properties_form" onSubmit={notAvailable}>
        <div className="card mb-2">
          <div className="card-header">
            <Icon name="s_db" /> {t('operations.properties')}
          </div>
          <div className="card-body">
            <div className="mb-3 row row-cols-lg-auto g-3">
              <div className="col-md-6">
                <label htmlFor="dbOwnerSelect" className="form-label">
                  {t('operations.fields.owner')}
                </label>
                <select className="form-select" id="dbOwnerSelect" defaultValue={data.datowner}>
                  <option value={data.datowner}>{data.datowner}</option>
                </select>
              </div>
              <div className="col-md-6">
                <label htmlFor="dbTablespaceSelect" className="form-label">
                  {t('operations.fields.tablespace')}
                </label>
                <select className="form-select" id="dbTablespaceSelect" defaultValue={data.spcname ?? ''}>
                  <option value={data.spcname ?? ''}>{data.spcname ?? ''}</option>
                </select>
              </div>
              <div className="col-md-6">
                <label htmlFor="dbConnLimitInput" className="form-label">
                  {t('operations.fields.connection_limit')}
                </label>
                <input type="number" className="form-control" id="dbConnLimitInput" min={-1} defaultValue={data.datconnlimit} required />
              </div>
            </div>

            <div className="form-check">
              <input className="form-check-input" type="checkbox" id="checkbox_allow_connections" defaultChecked={data.datallowconn} />
              <label className="form-check-label" htmlFor="checkbox_allow_connections">
                {t('operations.fields.allow_connections')}
              </label>
            </div>
            <div className="form-check">
              <input className="form-check-input" type="checkbox" id="checkbox_is_template" defaultChecked={data.is_template} />
              <label className="form-check-label" htmlFor="checkbox_is_template">
                {t('operations.fields.template')}
              </label>
            </div>
          </div>
          <div className="card-footer text-end">
            <input className="btn btn-primary" type="submit" value={t('operations.go')} />
          </div>
        </div>
      </form>

      <div className="card mb-2">
        <div className="card-header">
          <Icon name="s_asci" /> {t('operations.fields.collation')}
        </div>
        <div className="card-body">
          <div className="card-text">
            <div>
              {t('operations.fields.encoding')}: <span dir="ltr">{data.encoding}</span>
            </div>
            <div>
              {t('operations.fields.collation')}: <span dir="ltr">{data.datcollate}</span>
            </div>
            <div>
              {t('operations.fields.ctype')}: <span dir="ltr">{data.datctype}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
