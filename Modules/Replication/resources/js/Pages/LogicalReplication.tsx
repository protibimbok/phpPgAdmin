import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Modal from '@/components/Modal'
import ObjectSection from '@/components/ObjectSection'
import SqlView from '@/components/SqlView'
import { treeState } from '@/layout/tree/treeState'
import { notifyError, notifySuccess } from '@/notify'
import { listDatabases } from '@databases/js/api'
import { roleUrl } from '@roles/js/Pages/Roles'
import { quoteIdent } from '@sql/js/sql'
import { publications as publicationsOf, subscriptions as subscriptionsOf, type Publication, type Subscription } from '../api'
import PublicationDialog from '../dialogs/PublicationDialog'
import SubscriptionDialog from '../dialogs/SubscriptionDialog'

const EVENTS = ['insert', 'update', 'delete', 'truncate'] as const

/**
 * The publications and subscriptions of one database, chosen with ?db= as phpMyAdmin chooses a
 * primary connection: each listed as the Types page lists its objects (ObjectSection) and edited
 * in a dialog. ?open=publication:<name> or ?open=subscription:<name> opens that dialog on
 * arrival, which is how the tree reaches them.
 */
export default function LogicalReplication() {
  const { t } = useTranslation('replication')
  const { t: tApp } = useTranslation()
  const [search, setSearch] = useSearchParams()
  const db = search.get('db') ?? ''
  const [choice, setChoice] = useState(db)
  const { data: databases } = useRequest(() => listDatabases(), [])
  const { data, error, reload } = useRequest(async () => (db === '' ? null : { publications: await publicationsOf(db).list(), subscriptions: await subscriptionsOf(db).list() }), [db])
  const [publicationDialog, setPublicationDialog] = useState<{ publication: Publication | null } | null>(null)
  const [subscriptionDialog, setSubscriptionDialog] = useState<{ subscription: Subscription | null } | null>(null)
  const [exported, setExported] = useState<{ title: string; sql: string | null } | null>(null)
  const [confirm, setConfirm] = useState<{ sql: string[]; run: () => Promise<void> } | null>(null)

  useEffect(() => setChoice(db), [db])

  const open = search.get('open')
  useEffect(() => {
    if (!data || !open) return
    const [node, ...rest] = open.split(':')
    const name = rest.join(':')
    if (node === 'publication') {
      const publication = data.publications.find((p) => p.name === name)
      if (publication) setPublicationDialog({ publication })
    } else if (node === 'subscription') {
      const subscription = data.subscriptions.find((s) => s.name === name)
      if (subscription) setSubscriptionDialog({ subscription })
    }
    setSearch((params) => { params.delete('open'); return params }, { replace: true })
  }, [data, open, setSearch])

  const changed = () => {
    treeState.refresh()
    reload()
  }

  function exportSql(names: string[], loads: Promise<string>[]) {
    setExported({ title: names.length === 1 ? t('export_title', { name: names[0] }) : t('export_title_many'), sql: null })
    Promise.all(loads).then(
      (parts) => setExported((current) => (current ? { ...current, sql: parts.join('\n\n') } : null)),
      (e: unknown) => {
        setExported(null)
        notifyError(errorMessage(e))
      },
    )
  }

  function askDrop(statements: string[], remove: () => Promise<unknown>, message: string) {
    setConfirm({
      sql: statements,
      run: async () => {
        try {
          await remove()
          notifySuccess(message)
        } catch (e) {
          notifyError(errorMessage(e))
        } finally {
          changed()
        }
      },
    })
  }

  const labels = { name: t('columns.name'), edit: t('actions.edit'), export: t('actions.export'), drop: t('actions.drop') }

  return (
    <>
      <div className="row">
        <div className="container-fluid">
          <div className="card mb-2" id="logical_replication">
            <div className="card-header">{t('logical.title')}</div>
            <div className="card-body">
              <form
                className="row row-cols-lg-auto gy-1 gx-3 align-items-center"
                onSubmit={(e) => {
                  e.preventDefault()
                  setSearch((params) => { if (choice) params.set('db', choice); else params.delete('db'); return params })
                }}
              >
                <div className="col-12">
                  <label className="col-form-label" htmlFor="logical_db">
                    {t('logical.database')}
                  </label>
                </div>
                <div className="col-12">
                  <select className="form-select" id="logical_db" name="db" value={choice} onChange={(e) => setChoice(e.target.value)}>
                    <option value="" />
                    {(databases ?? []).map((d) => (
                      <option key={d.did} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-12">
                  <input id="goButton" className="btn btn-primary" type="submit" value={tApp('go')} />
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error.message}
        </div>
      )}

      {data && (
        <>
          <ObjectSection<Publication>
            id="publications"
            icon="s_replication"
            title={t('publications.title')}
            rows={data.publications}
            empty={t('publications.none')}
            createLabel={t('publications.create_new')}
            createIcon="b_plus"
            onCreate={() => setPublicationDialog({ publication: null })}
            columns={[
              { label: t('publications.columns.tables'), render: (row) => (row.all_table ? <em>{t('publications.all_tables')}</em> : <code dir="ltr">{[...row.pubtable.map((p) => p.table_name ?? ''), ...row.pubschema.map((s) => `${s}.*`)].join(', ')}</code>) },
              { label: t('publications.columns.publishes'), render: (row) => EVENTS.filter((e) => row[`evnt_${e}`]).join(', ') },
              { label: t('publications.columns.via_root'), render: (row) => (row.publish_via_partition_root ? tApp('yes') : tApp('no')) },
              { label: t('columns.owner'), render: (row) => <Link to={roleUrl(row.pubowner)}>{row.pubowner}</Link> },
              { label: t('columns.comment'), render: (row) => row.description },
            ]}
            onEdit={(row) => setPublicationDialog({ publication: row })}
            onExport={(rows) => exportSql(rows.map((r) => r.name), rows.map((row) => publicationsOf(db).sql(row.oid)))}
            onDrop={(rows) =>
              askDrop(
                rows.map((row) => `DROP PUBLICATION ${quoteIdent(row.name)};`),
                async () => { for (const row of rows) await publicationsOf(db).remove(row.oid) },
                rows.length === 1 ? t('publications.dropped', { name: rows[0].name }) : t('dropped_many', { count: rows.length }),
              )
            }
            noneSelected={t('none_selected')}
            labels={labels}
          />

          <ObjectSection<Subscription>
            id="subscriptions"
            icon="s_replication"
            title={t('subscriptions.title')}
            rows={data.subscriptions}
            empty={t('subscriptions.none')}
            createLabel={t('subscriptions.create_new')}
            createIcon="b_plus"
            onCreate={() => setSubscriptionDialog({ subscription: null })}
            columns={[
              { label: t('subscriptions.columns.enabled'), render: (row) => (row.enabled ? tApp('yes') : tApp('no')) },
              { label: t('subscriptions.columns.publisher'), render: (row) => (row.conninfo_visible ? <code dir="ltr">{`${row.host}${row.port ? `:${row.port}` : ''}/${row.db}`}</code> : '') },
              { label: t('subscriptions.columns.publications'), render: (row) => row.pub.join(', ') },
              { label: t('subscriptions.columns.slot'), render: (row) => row.slot_name ?? <em>NONE</em> },
              { label: t('subscriptions.columns.worker'), render: (row) => (row.worker?.pid ? t('subscriptions.running', { pid: row.worker.pid }) : t('subscriptions.not_running')) },
              { label: t('subscriptions.columns.received_lsn'), render: (row) => <span className="font-monospace">{row.worker?.received_lsn}</span> },
              { label: t('subscriptions.columns.last_message'), render: (row) => row.worker?.last_msg_receipt_time },
              { label: t('subscriptions.columns.errors'), render: (row) => (row.worker?.apply_error_count == null ? '' : `${row.worker.apply_error_count} / ${row.worker.sync_error_count ?? 0}`) },
              { label: t('columns.owner'), render: (row) => <Link to={roleUrl(row.subowner)}>{row.subowner}</Link> },
              { label: t('columns.comment'), render: (row) => row.description },
            ]}
            onEdit={(row) => setSubscriptionDialog({ subscription: row })}
            onExport={(rows) => exportSql(rows.map((r) => r.name), rows.map((row) => subscriptionsOf(db).sql(row.oid)))}
            onDrop={(rows) =>
              askDrop(
                rows.map((row) => `DROP SUBSCRIPTION ${quoteIdent(row.name)};`),
                async () => { for (const row of rows) await subscriptionsOf(db).remove(row.oid) },
                rows.length === 1 ? t('subscriptions.dropped', { name: rows[0].name }) : t('dropped_many', { count: rows.length }),
              )
            }
            noneSelected={t('none_selected')}
            labels={labels}
          />

          <PublicationDialog show={publicationDialog !== null} db={db} publication={publicationDialog?.publication ?? null} onClose={() => setPublicationDialog(null)} onSaved={() => { setPublicationDialog(null); changed() }} />
          <SubscriptionDialog show={subscriptionDialog !== null} db={db} subscription={subscriptionDialog?.subscription ?? null} onClose={() => setSubscriptionDialog(null)} onSaved={() => { setSubscriptionDialog(null); changed() }} />
        </>
      )}

      <Modal show={exported !== null} title={exported?.title ?? ''} size="lg" onClose={() => setExported(null)}>
        {exported?.sql === null ? tApp('loading') : <SqlView sql={exported?.sql ?? ''} />}
      </Modal>

      <ConfirmQuery
        show={confirm !== null}
        sql={confirm?.sql ?? []}
        confirmLabel={tApp('ok')}
        confirmClass="btn-danger"
        onClose={() => setConfirm(null)}
        onConfirm={() => { const pending = confirm; setConfirm(null); if (pending) void pending.run() }}
      />
    </>
  )
}
