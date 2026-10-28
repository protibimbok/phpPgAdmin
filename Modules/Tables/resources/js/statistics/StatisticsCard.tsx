import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import { treeState } from '@/layout/tree/treeState'
import { notifyError, notifySuccess } from '@/notify'
import { qualifiedName } from '@sql/js/sql'
import { extendedStatistics, type Column, type ExtendedStatistics } from '../api'
import StatisticsDialog from './StatisticsDialog'

export interface StatisticsCardProps {
  db: string
  scid: number
  table: string
  columns: Column[]
  statistics: ExtendedStatistics[]
  onChanged: () => void
}

/**
 * The extended statistics of a table, laid out like the structure page's Indexes card: each
 * object with the kinds it collects, the columns and expressions it covers, its target and
 * comment, with Edit and Drop, and a "Create statistics" form in the footer. MySQL has no
 * counterpart; pgAdmin keeps these under the schema, but they describe this table.
 */
export default function StatisticsCard({ db, scid, table, columns, statistics, onChanged }: StatisticsCardProps) {
  const { t } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const [dialog, setDialog] = useState<{ statistics: ExtendedStatistics | null } | null>(null)
  const [confirm, setConfirm] = useState<{ sql: string; run: () => Promise<void> } | null>(null)

  function askDrop(row: ExtendedStatistics) {
    setConfirm({
      sql: `DROP STATISTICS ${qualifiedName(row.schema, row.name)};`,
      run: async () => {
        try {
          await extendedStatistics(db, scid).remove(row.oid)
          notifySuccess(t('structure.extended_statistics.dropped', { name: row.name }))
          treeState.refresh()
          onChanged()
        } catch (e) {
          notifyError(errorMessage(e))
        }
      },
    })
  }

  return (
    <div className="card" id="statistics">
      <div className="card-header">{t('structure.extended_statistics.title')}</div>
      <div className="card-body">
        {statistics.length === 0 ? (
          <div className="alert alert-primary">{t('structure.extended_statistics.none')}</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-striped table-hover table-sm w-auto align-middle" id="table_statistics">
              <thead>
                <tr>
                  <th colSpan={2} className="d-print-none">
                    {t('structure.index_columns.action')}
                  </th>
                  <th>{t('structure.extended_statistics.columns_head.name')}</th>
                  <th>{t('structure.extended_statistics.columns_head.kinds')}</th>
                  <th>{t('structure.extended_statistics.columns_head.on')}</th>
                  <th>{t('structure.extended_statistics.columns_head.target')}</th>
                  <th>{t('structure.extended_statistics.columns_head.comment')}</th>
                </tr>
              </thead>
              <tbody>
                {statistics.map((row) => (
                  <tr key={row.oid} className="noclick">
                    <td className="d-print-none">
                      <a href="#edit-statistics" onClick={(e) => { e.preventDefault(); setDialog({ statistics: row }) }}>
                        <Icon name="b_edit" /> {t('structure.index_actions.edit')}
                      </a>
                    </td>
                    <td className="d-print-none">
                      <a href="#drop-statistics" onClick={(e) => { e.preventDefault(); askDrop(row) }}>
                        <Icon name="b_drop" /> {t('structure.index_actions.drop')}
                      </a>
                    </td>
                    <th>{row.schema !== row.table_schema ? `${row.schema}.${row.name}` : row.name}</th>
                    <td>{row.stat_types.length === 0 ? t('structure.extended_statistics.all_kinds') : row.stat_types.join(', ')}</td>
                    <td>
                      <code dir="ltr">{[...row.columns, ...(row.expression_list ? [row.expression_list] : [])].join(', ')}</code>
                    </td>
                    <td className="value">{row.stattarget < 0 ? t('structure.extended_statistics.target_default') : row.stattarget}</td>
                    <td>{row.comment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card-footer d-print-none">
        <form onSubmit={(e) => { e.preventDefault(); setDialog({ statistics: null }) }}>
          {t('structure.extended_statistics.create_label')} <input className="btn btn-primary" type="submit" value={tApp('go')} />
        </form>
      </div>

      <StatisticsDialog show={dialog !== null} db={db} scid={scid} table={table} columns={columns} statistics={dialog?.statistics ?? null} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); treeState.refresh(); onChanged() }} />
      <ConfirmQuery show={confirm !== null} sql={confirm?.sql ?? ''} onClose={() => setConfirm(null)} onConfirm={() => { const pending = confirm; setConfirm(null); if (pending) void pending.run() }} />
    </div>
  )
}
