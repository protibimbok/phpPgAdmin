import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'

/** The catalog an object is in, which SECURITY LABEL addresses it by. */
export type LabelCatalog = 'pg_class' | 'pg_proc' | 'pg_type' | 'pg_namespace' | 'pg_authid' | 'pg_database'

export interface SecurityLabel {
  provider: string
  label: string
}

interface LabelState {
  labels: SecurityLabel[]
  providers: string[]
  columns: { attnum: number; name: string }[]
}

export interface SecurityLabelsCardProps {
  /** The database the object is in; null for a role, labelled from the maintenance database. */
  db: string | null
  catalog: LabelCatalog
  oid: number
}

const base = (db: string | null) => (db === null ? '/api/server/security_labels' : `/api/databases/${encodeURIComponent(db)}/security_labels`)

/**
 * pgAdmin's "Security labels" grid as an Operations card: a row per label provider with its
 * label, Remove per row and Add label, then Preview SQL and Go, which run SECURITY LABEL FOR …
 * ON … IS … (IS NULL for a removed row). A relation's card also labels its columns, picked in
 * the Object select. The card is left out when the server has no label provider loaded (sepgsql,
 * dummy_seclabel) and the object has no label, since SECURITY LABEL would only fail.
 */
export default function SecurityLabelsCard({ db, catalog, oid }: SecurityLabelsCardProps) {
  const { t } = useTranslation()
  const [subid, setSubid] = useState(0)
  const query = (sub: number) => `${base(db)}?${new URLSearchParams({ catalog, oid: String(oid), subid: String(sub) })}`
  const { data: object } = useRequest(() => api.get<LabelState>(query(0)), [db, catalog, oid])
  const { data: current, reload } = useRequest(() => api.get<LabelState>(query(subid)), [db, catalog, oid, subid])
  const [labels, setLabels] = useState<SecurityLabel[]>([])
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (current) setLabels(current.labels)
  }, [current])

  if (!object || !current) return null
  if (object.providers.length === 0 && object.labels.length === 0 && current.labels.length === 0) return null

  const body = () => ({ catalog, oid, subid, labels })
  const providers = [...new Set([...object.providers, ...labels.map((l) => l.provider)])].filter(Boolean)
  const update = (index: number, change: Partial<SecurityLabel>) => setLabels(labels.map((l, i) => (i === index ? { ...l, ...change } : l)))

  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await api.post<LabelState>(base(db), body())
      notifySuccess(t('security_labels.saved'))
      reload()
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    api.post<{ sql: string }>(`${base(db)}/sql`, body()).then(
      (r) => setPreview({ sql: r.sql === '' ? t('nothing_to_change') : r.sql, error: null }),
      (err: unknown) => setPreview({ sql: null, error: errorMessage(err) }),
    )
  }

  return (
    <form id="securityLabelsForm" onSubmit={save}>
      <div className="card mb-2">
        <div className="card-header">{t('security_labels.title')}</div>
        <div className="card-body">
          {object.columns.length > 0 && (
            <div className="mb-3">
              <label htmlFor="seclabel_object" className="me-2">
                {t('security_labels.object')}
              </label>
              <select id="seclabel_object" name="seclabel_object" value={subid} onChange={(e) => setSubid(Number(e.target.value))}>
                <option value={0}>{t('security_labels.this_object')}</option>
                {object.columns.map((c) => (
                  <option key={c.attnum} value={c.attnum}>
                    {t('security_labels.column', { name: c.name })}
                  </option>
                ))}
              </select>
            </div>
          )}
          <table className="table table-sm table-borderless w-auto mb-0" id="seclabels">
            <thead>
              <tr>
                <th>{t('security_labels.provider')}</th>
                <th>{t('security_labels.label')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {labels.map((label, index) => (
                <tr key={index}>
                  <td>
                    <select name={`seclabel_provider_${index}`} value={label.provider} onChange={(e) => update(index, { provider: e.target.value })} required>
                      <option value="" />
                      {providers.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input type="text" size={40} name={`seclabel_label_${index}`} value={label.label} onChange={(e) => update(index, { label: e.target.value })} required />
                  </td>
                  <td>
                    <button type="button" className="btn btn-link p-0" onClick={() => setLabels(labels.filter((_, i) => i !== index))}>
                      <Icon name="b_drop" /> {t('security_labels.remove')}
                    </button>
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={3}>
                  <button type="button" className="btn btn-link p-0" id="seclabel_add" onClick={() => setLabels([...labels, { provider: object.providers[0] ?? '', label: '' }])}>
                    <Icon name="b_plus" /> {t('security_labels.add')}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="card-footer text-end">
          <input className="btn btn-secondary preview_sql me-2" type="button" value={t('preview_sql')} onClick={showPreview} />
          <input className="btn btn-primary" type="submit" value={t('go')} disabled={busy} />
        </div>
      </div>
      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </form>
  )
}
