import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { errorMessage } from '@/api/request'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import { treeState } from '@/layout/tree/treeState'
import { notifyError, notifySuccess } from '@/notify'
import { urls } from '@/level'
import { qualifiedName } from '@sql/js/sql'
import { detachPartition, partitions as partitionsOf, type Partition } from '../api'
import PartitionDialog from './PartitionDialog'

export interface PartitionsCardProps {
  db: string
  schema: string
  table: string
  scid: number
  tid: number
  scheme: string
  partitions: Partition[]
  onChanged: () => void
}

/**
 * phpMyAdmin's Partitions block of the structure page (table/structure/display_partitions.twig):
 * "Partitioned by:", then each partition with its bounds, row estimate and comment and the
 * actions (Browse and Structure of the partition, Analyze and Vacuum on the SQL page, Detach,
 * Drop), and an "Add partition" form in the footer.
 */
export default function PartitionsCard({ db, schema, table, scid, tid, scheme, partitions, onChanged }: PartitionsCardProps) {
  const { t } = useTranslation('tables')
  const navigate = useNavigate()
  const [dialog, setDialog] = useState(false)
  const [confirm, setConfirm] = useState<{ sql: string; run: () => Promise<void> } | null>(null)
  const sqlPage = (sql: string) => `${urls.relation(db, schema, table, 'table')}/sql?${new URLSearchParams({ sql, run: '1' })}`

  function askDetach(partition: Partition) {
    setConfirm({
      sql: `ALTER TABLE ${qualifiedName(schema, table)} DETACH PARTITION ${qualifiedName(partition.schema, partition.name)};`,
      run: async () => {
        try {
          await detachPartition(db, scid, tid, partition.oid)
          notifySuccess(t('partitions.detached', { name: partition.name }))
          treeState.refresh()
          onChanged()
        } catch (e) {
          notifyError(errorMessage(e))
        }
      },
    })
  }

  function askDrop(partition: Partition) {
    setConfirm({
      sql: `DROP TABLE ${qualifiedName(partition.schema, partition.name)};`,
      run: async () => {
        try {
          await partitionsOf(db, scid, tid).remove(partition.oid)
          notifySuccess(t('partitions.dropped', { name: partition.name }))
          treeState.refresh()
          onChanged()
        } catch (e) {
          notifyError(errorMessage(e))
        }
      },
    })
  }

  return (
    <div className="card" id="partitions">
      <div className="card-header">{t('partitions.title')}</div>
      <div className="card-body">
        <p>
          {t('partitions.partitioned_by')} <code>{scheme}</code>
        </p>
        {partitions.length === 0 ? (
          <div className="alert alert-primary">{t('partitions.none')}</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-striped table-hover table-sm w-auto align-middle">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('partitions.columns.partition')}</th>
                  <th>{t('partitions.columns.expression')}</th>
                  <th>{t('partitions.columns.rows')}</th>
                  <th>{t('partitions.columns.comment')}</th>
                  <th colSpan={6} className="d-print-none">
                    {t('partitions.columns.action')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {partitions.map((partition, index) => {
                  const href = urls.relation(db, partition.schema, partition.name, 'table')
                  const relation = qualifiedName(partition.schema, partition.name)

                  return (
                    <tr key={partition.oid} className="noclick">
                      <td>{index + 1}</td>
                      <th>
                        {partition.schema !== schema ? `${partition.schema}.` : ''}
                        {partition.name}
                        {partition.is_partitioned && <span className="badge bg-secondary ms-2">{t('partitions.sub_partitioned')}</span>}
                      </th>
                      <td>
                        <code dir="ltr">{partition.partition_value}</code>
                      </td>
                      <td className="value">{partition.reltuples < 0 ? '?' : Math.round(partition.reltuples).toLocaleString()}</td>
                      <td>{partition.description}</td>
                      <td className="d-print-none">
                        <Link to={`${href}/browse`}>
                          <Icon name="b_browse" /> {t('actions.browse')}
                        </Link>
                      </td>
                      <td className="d-print-none">
                        <Link to={href}>
                          <Icon name="b_props" /> {t('actions.structure')}
                        </Link>
                      </td>
                      <td className="d-print-none">
                        <a href="#analyze" onClick={(e) => { e.preventDefault(); navigate(sqlPage(`ANALYZE ${relation}`)) }}>
                          <Icon name="b_search" /> {t('partitions.actions.analyze')}
                        </a>
                      </td>
                      <td className="d-print-none">
                        <a href="#vacuum" onClick={(e) => { e.preventDefault(); navigate(sqlPage(`VACUUM ${relation}`)) }}>
                          <Icon name="b_tblanalyse" /> {t('partitions.actions.vacuum')}
                        </a>
                      </td>
                      <td className="d-print-none">
                        <a href="#detach" onClick={(e) => { e.preventDefault(); askDetach(partition) }}>
                          <Icon name="s_unlink" /> {t('partitions.actions.detach')}
                        </a>
                      </td>
                      <td className="d-print-none">
                        <a href="#drop" onClick={(e) => { e.preventDefault(); askDrop(partition) }}>
                          <Icon name="b_drop" /> {t('partitions.actions.drop')}
                        </a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card-footer d-print-none">
        <form onSubmit={(e) => { e.preventDefault(); setDialog(true) }}>
          {t('partitions.add_label')} <input className="btn btn-primary" type="submit" value={t('partitions.add_button')} />
        </form>
      </div>

      <PartitionDialog show={dialog} db={db} scid={scid} tid={tid} scheme={scheme} onClose={() => setDialog(false)} onSaved={() => { setDialog(false); treeState.refresh(); onChanged() }} />
      <ConfirmQuery show={confirm !== null} sql={confirm?.sql ?? ''} onClose={() => setConfirm(null)} onConfirm={() => { const pending = confirm; setConfirm(null); if (pending) void pending.run() }} />
    </div>
  )
}
