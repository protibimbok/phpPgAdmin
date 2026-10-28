import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import { remotePublications, subscriptionOptions, subscriptions, type ConnectionFields, type Subscription, type SubscriptionData, type SubscriptionOptions } from '../api'

export interface SubscriptionDialogProps {
  show: boolean
  db: string
  subscription: Subscription | null
  onClose: () => void
  onSaved: () => void
}

const SSL_MODES = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']

const SYNC = ['off', 'local', 'remote_write', 'remote_apply', 'on']

const CONNECTION: (keyof ConnectionFields)[] = ['host', 'port', 'username', 'db', 'connect_timeout', 'passfile']

const SSL: (keyof ConnectionFields)[] = ['sslcert', 'sslkey', 'sslrootcert', 'sslcrl']

interface Form extends ConnectionFields {
  name: string
  subowner: string
  description: string
  password: string
  pub: string
  connect: boolean
  enabled: boolean
  copy_data: boolean
  create_slot: boolean
  slot_name: string
  slot_none: boolean
  sync: string
  binary: boolean
  streaming: string
  two_phase: boolean
  disable_on_error: boolean
  password_required: boolean
  run_as_owner: boolean
  origin: string
  failover: boolean
  refresh_pub: boolean
  copy_data_after_refresh: boolean
}

/**
 * The subscription editor after pgAdmin's subscription dialog (General, Connection, SSL and With
 * tabs) in the trigger editor's dialog layout: the name, owner and comment; the publisher's
 * connection, whose password is never shown (left blank it stays as it is); the publications,
 * which "Get publications" lists from the publisher as pgAdmin's get_publications does; and the
 * WITH options the server has. connect, copy_data and create_slot only apply to CREATE; an
 * existing subscription can refresh its publications instead. two_phase can be changed from
 * PostgreSQL 18 on.
 */
export default function SubscriptionDialog({ show, db, subscription, onClose, onSaved }: SubscriptionDialogProps) {
  const { t } = useTranslation('replication')
  const { t: tApp } = useTranslation()
  const [options, setOptions] = useState<SubscriptionOptions | null>(null)
  const [form, setForm] = useState<Form>(blank(null))
  const [remote, setRemote] = useState<string[] | null>(null)
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!show) return
    setForm(blank(subscription))
    setRemote(null)
    subscriptionOptions(db).then(
      (o) => {
        setOptions(o)
        // PostgreSQL 18 streams large transactions in parallel by default.
        if (!subscription && o.version >= 180000) setForm((f) => ({ ...f, streaming: 'parallel' }))
      },
      () => setOptions({ roles: [], version: 0, conninfo_visible: false }),
    )
  }, [show, subscription, db])

  const version = options?.version ?? 0
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))
  const pubList = form.pub.split(',').map((p) => p.trim()).filter(Boolean)
  const connection = () => ({ ...Object.fromEntries([...CONNECTION, ...SSL, 'sslmode', 'sslcompression'].map((k) => [k, form[k as keyof ConnectionFields]])), ...(form.password ? { password: form.password } : {}) })

  function data(): SubscriptionData {
    const common: SubscriptionData = {
      ...connection(),
      name: form.name,
      subowner: form.subowner,
      description: form.description,
      pub: pubList,
      enabled: form.enabled,
      slot_name: form.slot_name,
      slot_none: form.slot_none,
      sync: form.sync,
      ...(version >= 140000 ? { binary: form.binary, streaming: form.streaming } : {}),
      ...(version >= 150000 ? { disable_on_error: form.disable_on_error } : {}),
      ...(version >= 160000 ? { password_required: form.password_required, run_as_owner: form.run_as_owner, origin: form.origin } : {}),
      ...(version >= 170000 ? { failover: form.failover } : {}),
    }
    if (subscription) {
      return { ...common, ...(version >= 180000 ? { two_phase: form.two_phase } : {}), refresh_pub: form.refresh_pub, copy_data_after_refresh: form.copy_data_after_refresh }
    }

    return { ...common, connect: form.connect, copy_data: form.copy_data, create_slot: form.create_slot, ...(version >= 150000 ? { two_phase: form.two_phase } : {}) }
  }

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      if (subscription) await subscriptions(db).update(subscription.oid, data())
      else await subscriptions(db).create(data())
      notifySuccess(subscription ? t('subscriptions.altered', { name: form.name }) : t('subscriptions.created', { name: form.name }))
      onSaved()
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    subscriptions(db)
      .modifiedSql(data(), subscription?.oid)
      .then(
        (sql) => setPreview({ sql: sql || tApp('nothing_to_change'), error: null }),
        (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
      )
  }

  function fetchPublications() {
    remotePublications(db, connection(), subscription?.oid).then(setRemote, (e: unknown) => notifyError(errorMessage(e)))
  }

  function togglePub(name: string, on: boolean) {
    set({ pub: (on ? [...pubList, name] : pubList.filter((p) => p !== name)).join(', ') })
  }

  const check = (name: keyof Form, label: string, hint?: string) => (
    <Row key={name} label={label}>
      <input type="checkbox" name={name} checked={form[name] as boolean} onChange={(e) => set({ [name]: e.target.checked })} />
      {hint && <div className="form-text">{hint}</div>}
    </Row>
  )
  const text = (name: keyof Form, label: string, extra: Record<string, string | number> = {}) => (
    <Row key={name} label={label}>
      <input type="text" name={name} dir="ltr" value={form[name] as string} onChange={(e) => set({ [name]: e.target.value })} {...extra} />
    </Row>
  )

  return (
    <>
      <Modal
        show={show}
        onClose={onClose}
        id="subscriptionDialogModal"
        size="lg"
        title={subscription ? t('subscriptions.edit_title', { name: subscription.name }) : t('subscriptions.create_title')}
        footer={
          <>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
              {tApp('go')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={showPreview}>
              {tApp('preview_sql')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {tApp('close')}
            </button>
          </>
        }
      >
        <form
          className="rte_form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <table className="rte_table table table-borderless table-sm">
            <tbody>
              <Section title={t('subscriptions.general')} />
              {text('name', t('columns.name'), { maxLength: 63 })}
              <Row label={t('columns.owner')}>
                <select name="subowner" value={form.subowner} onChange={(e) => set({ subowner: e.target.value })}>
                  <option value="">{t('current_role')}</option>
                  {(options?.roles ?? []).map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label={t('columns.comment')}>
                <input type="text" name="description" size={50} value={form.description} onChange={(e) => set({ description: e.target.value })} />
              </Row>

              <Section title={t('subscriptions.connection')} />
              {subscription && !subscription.conninfo_visible && (
                <tr>
                  <td colSpan={2}>
                    <div className="alert alert-primary mb-0" role="alert">
                      {t('subscriptions.conninfo_hidden')}
                    </div>
                  </td>
                </tr>
              )}
              {CONNECTION.map((field) => text(field, t(`subscriptions.fields.${field}`)))}
              <Row label={t('subscriptions.fields.password')}>
                <input type="password" name="password" autoComplete="new-password" value={form.password} onChange={(e) => set({ password: e.target.value })} placeholder={subscription?.has_password ? t('subscriptions.password_kept') : ''} />
              </Row>
              <Row label={t('subscriptions.fields.sslmode')}>
                <select name="sslmode" value={form.sslmode} onChange={(e) => set({ sslmode: e.target.value })}>
                  <option value="" />
                  {SSL_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </Row>
              {SSL.map((field) => text(field, t(`subscriptions.fields.${field}`)))}
              <Row label={t('subscriptions.fields.sslcompression')}>
                <select name="sslcompression" value={form.sslcompression} onChange={(e) => set({ sslcompression: e.target.value })}>
                  <option value="" />
                  <option value="1">{tApp('yes')}</option>
                  <option value="0">{tApp('no')}</option>
                </select>
              </Row>

              <Section title={t('subscriptions.columns.publications')} />
              <Row label={t('subscriptions.columns.publications')}>
                <input type="text" name="pub" size={50} dir="ltr" value={form.pub} onChange={(e) => set({ pub: e.target.value })} required />{' '}
                <button type="button" className="btn btn-secondary btn-sm" onClick={fetchPublications}>
                  {t('subscriptions.get_publications')}
                </button>
                {remote && (
                  <div className="mt-1">
                    {remote.length === 0 && t('subscriptions.no_remote')}
                    {remote.map((name) => (
                      <label key={name} className="me-3">
                        <input type="checkbox" checked={pubList.includes(name)} onChange={(e) => togglePub(name, e.target.checked)} /> {name}
                      </label>
                    ))}
                  </div>
                )}
                <div className="form-text">{t('subscriptions.publications_hint')}</div>
              </Row>

              <Section title={t('subscriptions.with')} />
              {!subscription && check('connect', 'connect', t('subscriptions.hints.connect'))}
              {check('enabled', 'enabled')}
              {!subscription && check('create_slot', 'create_slot', t('subscriptions.hints.create_slot'))}
              {!subscription && check('copy_data', 'copy_data')}
              <Row label="slot_name">
                <input type="text" name="slot_name" dir="ltr" maxLength={63} value={form.slot_name} onChange={(e) => set({ slot_name: e.target.value })} readOnly={form.slot_none} placeholder={subscription ? '' : form.name} />{' '}
                <label>
                  <input type="checkbox" name="slot_none" checked={form.slot_none} onChange={(e) => set({ slot_none: e.target.checked })} /> NONE
                </label>
              </Row>
              <Row label="synchronous_commit">
                <select name="sync" value={form.sync} onChange={(e) => set({ sync: e.target.value })}>
                  {SYNC.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </Row>
              {version >= 140000 && check('binary', 'binary')}
              {version >= 140000 && (
                <Row label="streaming">
                  <select name="streaming" value={form.streaming} onChange={(e) => set({ streaming: e.target.value })}>
                    {['off', 'on', ...(version >= 160000 ? ['parallel'] : [])].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </Row>
              )}
              {version >= 150000 && (!subscription || version >= 180000) && check('two_phase', 'two_phase')}
              {version >= 150000 && check('disable_on_error', 'disable_on_error')}
              {version >= 160000 && check('password_required', 'password_required')}
              {version >= 160000 && check('run_as_owner', 'run_as_owner')}
              {version >= 160000 && (
                <Row label="origin">
                  <select name="origin" value={form.origin} onChange={(e) => set({ origin: e.target.value })}>
                    <option value="any">any</option>
                    <option value="none">none</option>
                  </select>
                </Row>
              )}
              {version >= 170000 && check('failover', 'failover')}
              {subscription && check('refresh_pub', t('subscriptions.refresh'), t('subscriptions.hints.refresh'))}
              {subscription && form.refresh_pub && check('copy_data_after_refresh', t('subscriptions.copy_after_refresh'))}
            </tbody>
          </table>
        </form>
      </Modal>
      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{children}</td>
    </tr>
  )
}

function Section({ title }: { title: string }) {
  return (
    <tr>
      <th colSpan={2}>{title}</th>
    </tr>
  )
}

/** The form for a new subscription with PostgreSQL's defaults, or for an existing one as it stands. */
function blank(subscription: Subscription | null): Form {
  return {
    host: subscription?.host ?? '',
    port: subscription?.port ?? '',
    username: subscription?.username ?? '',
    db: subscription?.db ?? '',
    connect_timeout: subscription?.connect_timeout ?? '',
    passfile: subscription?.passfile ?? '',
    sslmode: subscription?.sslmode ?? '',
    sslcompression: subscription?.sslcompression ?? '',
    sslcert: subscription?.sslcert ?? '',
    sslkey: subscription?.sslkey ?? '',
    sslrootcert: subscription?.sslrootcert ?? '',
    sslcrl: subscription?.sslcrl ?? '',
    name: subscription?.name ?? '',
    subowner: subscription?.subowner ?? '',
    description: subscription?.description ?? '',
    password: '',
    pub: (subscription?.pub ?? []).join(', '),
    connect: true,
    enabled: subscription?.enabled ?? true,
    copy_data: true,
    create_slot: true,
    slot_name: subscription?.slot_name ?? '',
    slot_none: subscription !== null && subscription.slot_name === null,
    sync: subscription?.sync ?? 'off',
    binary: subscription?.binary ?? false,
    streaming: subscription?.streaming ?? 'off',
    two_phase: subscription?.two_phase ?? false,
    disable_on_error: subscription?.disable_on_error ?? false,
    password_required: subscription?.password_required ?? true,
    run_as_owner: subscription?.run_as_owner ?? false,
    origin: subscription?.origin ?? 'any',
    failover: subscription?.failover ?? false,
    refresh_pub: false,
    copy_data_after_refresh: false,
  }
}
