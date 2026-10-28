import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import { runWizard, wizardObjects, wizardSql, type WizardGrant, type WizardObject } from './api'

/** The relkind / prokind a wizard row names, as the object list's Type column says it. */
const TYPES: Record<string, string> = { r: 'table', p: 'partitioned', v: 'view', m: 'mview', f: 'foreign', S: 'sequence' }

/**
 * pgAdmin's Grant Wizard on the schema's Privileges page: check the objects (tables, views,
 * sequences, functions, procedures), pick a role and the privileges, and each object gets the
 * ones it accepts in a single run.
 */
export default function GrantWizard({ db, scid, roles }: { db: string; scid: number; roles: string[] }) {
  const { t } = useTranslation('roles')
  const { t: tApp } = useTranslation()
  const { data: objects } = useRequest(() => wizardObjects(db, scid), [db, scid])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [grantee, setGrantee] = useState('')
  const [privileges, setPrivileges] = useState<Set<string>>(new Set())
  const [withGrant, setWithGrant] = useState(false)
  const [filter, setFilter] = useState('')
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)

  const key = (o: WizardObject) => `${o.kind}:${o.oid}`
  const visible = useMemo(() => (objects ?? []).filter((o) => o.name.toLowerCase().includes(filter.trim().toLowerCase())), [objects, filter])
  const offered = useMemo(() => [...new Set((objects ?? []).filter((o) => checked.has(key(o))).flatMap((o) => o.allowed))], [objects, checked])

  if (!objects) return null

  const grant = (): WizardGrant => ({
    grantee,
    objects: objects.filter((o) => checked.has(key(o))).map(({ kind, oid }) => ({ kind, oid })),
    privileges: [...privileges].filter((p) => offered.includes(p)).map((privilege) => ({ privilege, with_grant: withGrant })),
  })
  const toggle = <T,>(set: Set<T>, value: T, on: boolean) => {
    const next = new Set(set)
    if (on) next.add(value)
    else next.delete(value)

    return next
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    wizardSql(db, scid, grant()).then(
      (sql) => setPreview({ sql, error: null }),
      (err: unknown) => setPreview({ sql: null, error: errorMessage(err) }),
    )
  }

  async function ask() {
    if (grantee === '') return notifyError(t('wizard.no_role'))
    try {
      setConfirm(await wizardSql(db, scid, grant()))
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  async function run() {
    setConfirm(null)
    try {
      await runWizard(db, scid, grant())
      notifySuccess(t('wizard.granted', { grantee, count: grant().objects.length }))
      setChecked(new Set())
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  return (
    <form id="grantWizardForm" onSubmit={(e) => { e.preventDefault(); void ask() }}>
      <fieldset className="pma-fieldset" id="fieldset_grant_wizard">
        <legend>{t('wizard.title')}</legend>
        <p>
          <small>
            <em>{t('wizard.note')}</em>
          </small>
        </p>

        <fieldset className="pma-fieldset">
          <legend>
            <input
              type="checkbox"
              className="sub_checkall_box"
              id="checkall_wizard_objects"
              title={tApp('check_all')}
              checked={visible.length > 0 && visible.every((o) => checked.has(key(o)))}
              onChange={(e) => setChecked(e.target.checked ? new Set([...checked, ...visible.map(key)]) : new Set([...checked].filter((k) => !visible.some((o) => key(o) === k))))}
            />
            <label htmlFor="checkall_wizard_objects">{t('wizard.objects')}</label>
          </legend>
          <input type="text" className="form-control w-auto mb-2" placeholder={tApp('search')} aria-label={tApp('search')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="table-responsive">
            <table className="table table-striped table-hover table-sm w-auto mb-0">
              <thead>
                <tr>
                  <th />
                  <th>{t('wizard.name')}</th>
                  <th>{t('privileges.type')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((o) => (
                  <tr key={key(o)}>
                    <td>
                      <input type="checkbox" id={`wizard_${key(o)}`} checked={checked.has(key(o))} onChange={(e) => setChecked(toggle(checked, key(o), e.target.checked))} />
                    </td>
                    <td>
                      <label htmlFor={`wizard_${key(o)}`}>{o.name}</label>
                    </td>
                    <td>{t(`wizard.type.${o.kind === 'function' ? (o.type === 'p' ? 'procedure' : 'function') : TYPES[o.type]}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>

        <fieldset className="pma-fieldset">
          <legend>{t('privileges.title')}</legend>
          <div className="item mb-2">
            <label htmlFor="select_wizard_grantee">{t('privileges.grantee')}</label>{' '}
            <select id="select_wizard_grantee" value={grantee} onChange={(e) => setGrantee(e.target.value)}>
              <option value="" />
              {['PUBLIC', ...roles].map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
          {offered.length === 0 && <p className="mb-0">{t('wizard.choose_objects')}</p>}
          {offered.map((privilege) => (
            <div className="item" key={privilege}>
              <input type="checkbox" id={`wizard_priv_${privilege}`} checked={privileges.has(privilege)} title={t(`privileges.hint.${privilege}`)} onChange={(e) => setPrivileges(toggle(privileges, privilege, e.target.checked))} />
              <label htmlFor={`wizard_priv_${privilege}`}>
                <code>
                  <dfn title={t(`privileges.hint.${privilege}`)}>{privilege}</dfn>
                </code>
              </label>
            </div>
          ))}
          {offered.length > 0 && (
            <div className="item mt-2">
              <input type="checkbox" id="wizard_with_grant" checked={withGrant} title={t('privileges.with_grant_hint')} onChange={(e) => setWithGrant(e.target.checked)} />
              <label htmlFor="wizard_with_grant">
                <code>WITH GRANT OPTION</code>
              </label>
            </div>
          )}
        </fieldset>
        <div className="clearfloat" />
      </fieldset>
      <fieldset className="pma-fieldset tblFooters">
        <input className="btn btn-secondary preview_sql me-2" type="button" value={tApp('preview_sql')} onClick={showPreview} />
        <input className="btn btn-primary" type="submit" value={tApp('go')} />
      </fieldset>

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
      <ConfirmQuery show={confirm !== null} sql={confirm ?? ''} onClose={() => setConfirm(null)} onConfirm={() => void run()} />
    </form>
  )
}
