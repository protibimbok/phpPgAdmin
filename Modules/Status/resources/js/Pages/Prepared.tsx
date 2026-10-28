import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import { urls } from '@/level'
import { notifyError, notifySuccess } from '@/notify'
import { listDatabases } from '@databases/js/api'
import { roleUrl } from '@roles/js/Pages/Roles'
import { finishPrepared, prepared, type PreparedTransaction } from '../api'
import StatusNav from '../StatusNav'

const COLUMNS = ['gid', 'database', 'owner', 'transaction', 'prepared'] as const

/** The statement finishPrepared runs, for the confirmation. */
const statement = (transaction: PreparedTransaction, action: 'commit' | 'rollback') => `${action === 'commit' ? 'COMMIT' : 'ROLLBACK'} PREPARED '${transaction.gid.replaceAll("'", "''")}';`

/**
 * pgAdmin's Prepared Transactions panel on a phpMyAdmin Status page: pg_prepared_xacts with
 * Commit and Rollback per transaction (each confirmed with its statement), and a notice when
 * max_prepared_transactions is 0, since then none can be prepared.
 */
export default function Prepared() {
  const { t } = useTranslation('status')
  const [database, setDatabase] = useState('')
  const [finish, setFinish] = useState<{ transaction: PreparedTransaction; action: 'commit' | 'rollback' } | null>(null)
  const { data, error, reload } = useRequest(() => prepared(database || undefined), [database])
  const { data: databases } = useRequest(() => listDatabases(), [])

  async function send({ transaction, action }: NonNullable<typeof finish>) {
    setFinish(null)
    try {
      await finishPrepared(transaction, action)
      notifySuccess(t(`prepared.done.${action}`, { gid: transaction.gid }))
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      reload()
    }
  }

  return (
    <div className="container-fluid">
      <StatusNav />

      <div className="card mb-3" id="tableFilter">
        <div className="card-header">{t('processes.filters')}</div>
        <div className="card-body">
          <form className="row row-cols-lg-auto gy-1 gx-3 align-items-center" onSubmit={(e) => { e.preventDefault(); reload() }}>
            <div className="col-12">
              <select className="form-select" aria-label={t('processes.database')} value={database} onChange={(e) => setDatabase(e.target.value)}>
                <option value="">{t('processes.all_databases')}</option>
                {(databases ?? []).map((d) => (
                  <option key={d.did} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12">
              <input className="btn btn-secondary" type="submit" value={t('processes.refresh')} />
            </div>
          </form>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error.message}
        </div>
      )}

      {data?.max_prepared_transactions === 0 && (
        <div className="row">
          <div className="alert alert-primary" role="alert">
            <Icon name="s_notice" /> {t('prepared.disabled')}
          </div>
        </div>
      )}

      <div className="responsivetable row">
        <table id="tableprepared" className="table table-striped table-hover w-auto">
          <thead>
            <tr>
              <th>{t('prepared.action')}</th>
              {COLUMNS.map((column) => (
                <th scope="col" key={column} className="text-nowrap">
                  {t(`prepared.columns.${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data && data.transactions.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1}>{t('prepared.none')}</td>
              </tr>
            )}
            {(data?.transactions ?? []).map((transaction) => (
              <tr key={transaction.gid}>
                <td className="text-nowrap">
                  <a href="#commit" onClick={(e) => { e.preventDefault(); setFinish({ transaction, action: 'commit' }) }}>
                    {t('prepared.commit')}
                  </a>{' '}
                  <a href="#rollback" onClick={(e) => { e.preventDefault(); setFinish({ transaction, action: 'rollback' }) }}>
                    {t('prepared.rollback')}
                  </a>
                </td>
                <td className="font-monospace">{transaction.gid}</td>
                <td>
                  <Link to={urls.database(transaction.database)}>{transaction.database}</Link>
                </td>
                <td>
                  <Link to={roleUrl(transaction.owner)}>{transaction.owner}</Link>
                </td>
                <td className="font-monospace text-end">{transaction.transaction}</td>
                <td className="text-nowrap">{transaction.prepared}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmQuery
        show={finish !== null}
        sql={finish ? statement(finish.transaction, finish.action) : ''}
        confirmLabel={finish?.action === 'rollback' ? t('prepared.rollback') : t('prepared.commit')}
        confirmClass={finish?.action === 'rollback' ? 'btn-danger' : 'btn-primary'}
        onClose={() => setFinish(null)}
        onConfirm={() => finish && void send(finish)}
      />
    </div>
  )
}
