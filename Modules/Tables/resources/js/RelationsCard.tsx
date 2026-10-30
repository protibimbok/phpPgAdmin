import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { urls } from '@/level'
import type { TableRelations } from './api'

export interface RelationsCardProps {
  db: string
  relations: TableRelations
  /** A partitioned table's partitions are on the Partitions card; only its parents are listed here. */
  partitioned: boolean
}

/**
 * The table's relations to other tables, as the classic phpPgAdmin's table Info page lists
 * them: a "Referenced by" card with the foreign keys pointing at the table, and an
 * "Inheritance" card with its parent tables and the tables (or partitions, with their bounds)
 * that inherit from it. A card with nothing to list is left out.
 */
export default function RelationsCard({ db, relations, partitioned }: RelationsCardProps) {
  const { t } = useTranslation('tables')
  const children = partitioned ? [] : relations.children
  const tableLink = (schema: string, name: string) => <Link to={urls.relation(db, schema, name, 'table')}>{`${schema}.${name}`}</Link>

  return (
    <>
      {relations.referenced_by.length > 0 && (
        <div className="card" id="referenced_by">
          <div className="card-header">{t('relations.referenced_by')}</div>
          <div className="card-body">
            <div className="table-responsive">
              <table className="table table-striped table-hover table-sm w-auto align-middle">
                <thead>
                  <tr>
                    <th>{t('relations.table')}</th>
                    <th>{t('relations.constraint')}</th>
                    <th>{t('relations.columns')}</th>
                    <th>{t('relations.references')}</th>
                    <th>{t('relations.definition')}</th>
                  </tr>
                </thead>
                <tbody>
                  {relations.referenced_by.map((key) => (
                    <tr key={key.oid}>
                      <td>{tableLink(key.schema, key.table)}</td>
                      <th>{key.name}</th>
                      <td dir="ltr">{key.columns}</td>
                      <td dir="ltr">{key.referenced_columns}</td>
                      <td>
                        <code dir="ltr">{key.definition}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {(relations.parents.length > 0 || children.length > 0) && (
        <div className="card" id="inheritance">
          <div className="card-header">{t('relations.inheritance')}</div>
          <div className="card-body">
            <table className="table table-striped table-hover table-sm w-auto align-middle">
              <thead>
                <tr>
                  <th>{t('relations.relation')}</th>
                  <th>{t('relations.table')}</th>
                  <th>{t('relations.bound')}</th>
                </tr>
              </thead>
              <tbody>
                {relations.parents.map((parent) => (
                  <tr key={`p${parent.oid}`}>
                    <td>{t('relations.parent')}</td>
                    <td>{tableLink(parent.schema, parent.name)}</td>
                    <td />
                  </tr>
                ))}
                {children.map((child) => (
                  <tr key={`c${child.oid}`}>
                    <td>{child.is_partition ? t('relations.partition') : t('relations.child')}</td>
                    <td>{tableLink(child.schema, child.name)}</td>
                    <td>{child.bound && <code dir="ltr">{child.bound}</code>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
