import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { urls } from '@/level'
import { dataDictionary, type DictionaryTable } from '../api'

/**
 * phpMyAdmin's data dictionary (database/data_dictionary/index.twig), linked from the bottom of
 * the database's Structure page: for every table of the database (?schema= for one schema's)
 * its comment, its columns with their type, NULL, default, the column a foreign key links them
 * to and their comment, and its indexes. Print prints just the dictionary.
 */
export default function DataDictionary() {
  const { t } = useTranslation('schemas')
  const { t: tApp } = useTranslation()
  const db = useParams().db ?? ''
  const [search] = useSearchParams()
  const schema = search.get('schema')
  const { data, error } = useRequest(() => dataDictionary(db, schema), [db, schema])

  const print = (
    <p className="d-print-none">
      <button type="button" className="btn btn-secondary jsPrintButton" onClick={() => window.print()}>
        <Icon name="b_print" /> {tApp('print')}
      </button>
    </p>
  )

  if (error) {
    return (
      <div className="container-fluid">
        <div className="alert alert-danger my-3" role="alert">
          {error.message}
        </div>
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="container-fluid" id="data_dictionary">
      <h1>{schema ? `${data.database}.${schema}` : data.database}</h1>
      {data.comment && (
        <p>
          {t('data_dictionary.database_comment')} <em>{data.comment}</em>
        </p>
      )}

      {print}

      <div>
        {data.tables.map((table) => (
          <DictionaryEntry key={`${table.schema}.${table.name}`} db={db} table={table} qualified={schema === null} />
        ))}
      </div>

      {print}
    </div>
  )
}

function DictionaryEntry({ db, table, qualified }: { db: string; table: DictionaryTable; qualified: boolean }) {
  const { t } = useTranslation('schemas')
  const { t: tApp } = useTranslation()
  const hasRelation = table.columns.some((column) => column.links.length > 0)
  const nullable = new Map(table.columns.map((column) => [column.name, column.nullable]))

  return (
    <div>
      <h2>{qualified ? `${table.schema}.${table.name}` : table.name}</h2>
      {table.comment && (
        <p>
          {t('data_dictionary.table_comments')} <em>{table.comment}</em>
        </p>
      )}

      <table className="table table-striped align-middle">
        <thead>
          <tr>
            <th>{t('data_dictionary.column')}</th>
            <th>{t('data_dictionary.type')}</th>
            <th>{t('data_dictionary.null')}</th>
            <th>{t('data_dictionary.default')}</th>
            {hasRelation && <th>{t('data_dictionary.links_to')}</th>}
            <th>{t('data_dictionary.comments')}</th>
          </tr>
        </thead>
        <tbody>
          {table.columns.map((column) => (
            <tr key={column.name}>
              <td className="text-nowrap">
                {column.name}
                {column.primary_key && (
                  <>
                    {' '}
                    <em>({t('data_dictionary.primary')})</em>
                  </>
                )}
              </td>
              <td lang="en" dir="ltr" className="text-nowrap">
                {column.type}
              </td>
              <td>{column.nullable ? tApp('yes') : tApp('no')}</td>
              <td className="text-nowrap">{column.default === null && column.nullable ? <em>NULL</em> : column.default}</td>
              {hasRelation && (
                <td>
                  {column.links.map((link, i) => (
                    <span key={i}>
                      {i > 0 && <br />}
                      <Link to={urls.relation(db, link.schema, link.table)}>{link.schema === table.schema ? link.table : `${link.schema}.${link.table}`}</Link> -&gt; {link.column}
                    </span>
                  ))}
                </td>
              )}
              <td>{column.comment}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {table.indexes.length > 0 ? (
        <>
          <h3>{t('data_dictionary.indexes')}</h3>
          <table className="table table-striped align-middle">
            <thead>
              <tr>
                <th>{t('data_dictionary.keyname')}</th>
                <th>{t('data_dictionary.type')}</th>
                <th>{t('data_dictionary.unique')}</th>
                <th>{t('data_dictionary.column')}</th>
                <th>{t('data_dictionary.collation')}</th>
                <th>{t('data_dictionary.null')}</th>
                <th>{t('data_dictionary.comment')}</th>
              </tr>
            </thead>
            <tbody>
              {table.indexes.map((index) =>
                index.columns.map((column, i) => (
                  <tr key={`${index.name}:${i}`}>
                    {i === 0 && (
                      <>
                        <td rowSpan={index.columns.length}>
                          {index.name}
                          {index.primary && (
                            <>
                              {' '}
                              <em>({t('data_dictionary.primary')})</em>
                            </>
                          )}
                        </td>
                        <td rowSpan={index.columns.length}>{index.method.toUpperCase()}</td>
                        <td rowSpan={index.columns.length}>{index.unique ? tApp('yes') : tApp('no')}</td>
                      </>
                    )}
                    <td dir="ltr">
                      {column.name}
                      {column.included && <em> ({t('data_dictionary.included')})</em>}
                    </td>
                    <td>{column.collation}</td>
                    <td>{nullable.has(column.name) ? (nullable.get(column.name) ? tApp('yes') : tApp('no')) : ''}</td>
                    {i === 0 && <td rowSpan={index.columns.length}>{index.comment}</td>}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </>
      ) : (
        <p>{t('data_dictionary.no_index')}</p>
      )}
    </div>
  )
}
