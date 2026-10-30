import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { api, errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import { urls } from '@/level'
import { notifyError, notifySuccess } from '@/notify'

interface AutovacuumTable {
  oid: number
  schema: string
  name: string
  /** 'r' table, 'm' materialized view, 'p' partitioned table */
  relkind: string
  options: { name: string; value: string }[]
  reset_sql: string
}

/**
 * Classic phpPgAdmin's Admin → Autovacuum, as a card of the database's Operations page: every
 * table and materialized view with autovacuum settings of its own (its reloptions and its
 * TOAST table's), with Edit (the relation's Storage card on its Operations page) and Remove
 * custom settings (ALTER TABLE … RESET (…), after the confirmation).
 */
export default function AutovacuumTablesCard({ db }: { db: string }) {
  const { t } = useTranslation('databases')
  const { t: tApp } = useTranslation()
  const url = `/api/databases/${encodeURIComponent(db)}/autovacuum_tables`
  const { data, error, reload } = useRequest(() => api.get<{ rows: AutovacuumTable[] }>(url).then((r) => r.rows), [url])
  const [confirm, setConfirm] = useState<AutovacuumTable | null>(null)

  async function reset(row: AutovacuumTable) {
    try {
      await api.post(`${url}/${row.oid}/reset`)
      notifySuccess(t('autovacuum.reset_done', { name: `${row.schema}.${row.name}` }))
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      reload()
    }
  }

  return (
    <div className="card mb-2" id="autovacuum_tables">
      <div className="card-header">
        <Icon name="b_tblops" /> {t('autovacuum.title')}
      </div>
      <div className="card-body">
        {error ? (
          <div className="alert alert-danger mb-0" role="alert">
            {error.message}
          </div>
        ) : data === undefined ? (
          tApp('loading')
        ) : data.length === 0 ? (
          <div className="card-text">{t('autovacuum.none')}</div>
        ) : (
          <table className="table table-striped table-hover w-auto data mb-0">
            <thead>
              <tr>
                <th>{t('autovacuum.schema')}</th>
                <th>{t('autovacuum.table')}</th>
                <th>{t('autovacuum.settings')}</th>
                <th colSpan={2}>{t('autovacuum.action')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.oid}>
                  <td>{row.schema}</td>
                  <td>
                    <strong>{row.name}</strong>
                  </td>
                  <td>
                    <code dir="ltr">{row.options.map((o) => `${o.name}=${o.value}`).join(', ')}</code>
                  </td>
                  <td>
                    <Link to={`${urls.relation(db, row.schema, row.name, row.relkind === 'm' ? 'mview' : 'table')}/operations#${row.relkind === 'm' ? 'tableOptionsForm' : 'tableStorageForm'}`}>
                      <Icon name="b_edit" /> {t('autovacuum.edit')}
                    </Link>
                  </td>
                  <td>
                    <a
                      href="#reset"
                      className="reset_autovacuum"
                      onClick={(e) => {
                        e.preventDefault()
                        setConfirm(row)
                      }}
                    >
                      <Icon name="b_drop" /> {t('autovacuum.reset')}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmQuery
        show={confirm !== null}
        sql={confirm?.reset_sql ?? ''}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const pending = confirm
          setConfirm(null)
          if (pending) void reset(pending)
        }}
      />
    </div>
  )
}
