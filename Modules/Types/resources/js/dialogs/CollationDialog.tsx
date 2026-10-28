import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import { collationOptions, collations as collationsOf, type Collation, type CollationData, type CollationOptions } from '../api'

export interface CollationDialogProps {
  show: boolean
  db: string
  scid: number
  collation: Collation | null
  onClose: () => void
  onSaved: () => void
}

type Definition = 'copy' | 'locale' | 'lc'

/**
 * The collation editor after pgAdmin's collation dialog, in the trigger editor's dialog
 * layout: the name, owner and comment, and a definition that is one of a copied collation, a
 * locale, or an LC_COLLATE / LC_CTYPE pair, with the provider, DETERMINISTIC, RULES
 * (PostgreSQL 16+) and version. PostgreSQL cannot alter a definition, so an existing
 * collation shows its definition read-only and only the name, owner and comment are saved.
 */
export default function CollationDialog({ show, db, scid, collation, onClose, onSaved }: CollationDialogProps) {
  const { t } = useTranslation('types')
  const { t: tApp } = useTranslation()
  const [options, setOptions] = useState<CollationOptions | null>(null)
  const [name, setName] = useState('')
  const [owner, setOwner] = useState('')
  const [comment, setComment] = useState('')
  const [definition, setDefinition] = useState<Definition>('locale')
  const [copyFrom, setCopyFrom] = useState('')
  const [locale, setLocale] = useState('')
  const [lcCollate, setLcCollate] = useState('')
  const [lcType, setLcType] = useState('')
  const [provider, setProvider] = useState('')
  const [deterministic, setDeterministic] = useState(true)
  const [rules, setRules] = useState('')
  const [version, setVersion] = useState('')
  const [preview, setPreview] = useState<{
    sql: string | null
    error: string | null
  } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!show) return
    setName(collation?.name ?? '')
    setOwner(collation?.owner ?? '')
    setComment(collation?.description ?? '')
    const same = (collation?.lc_collate ?? '') === (collation?.lc_type ?? '')
    setDefinition(collation ? (same ? 'locale' : 'lc') : 'locale')
    setCopyFrom('')
    setLocale(same ? (collation?.lc_collate ?? '') : '')
    setLcCollate(collation?.lc_collate ?? '')
    setLcType(collation?.lc_type ?? '')
    setProvider(collation?.provider ?? '')
    setDeterministic(collation?.is_deterministic ?? true)
    setRules(collation?.rules ?? '')
    setVersion(collation?.version ?? '')
    if (!options) collationOptions(db, scid).then(setOptions, () => setOptions({ collations: [], roles: [], version: 0 }))
  }, [show, collation, db, scid, options])

  const serverVersion = options?.version ?? 0
  const providers = ['libc', 'icu', ...(serverVersion >= 170000 ? ['builtin'] : [])]

  function data(): CollationData {
    const common: CollationData = { name, owner, description: comment }
    if (collation) return common
    if (definition === 'copy') return { ...common, copy_collation: copyFrom }
    const settings: CollationData = {
      provider,
      is_deterministic: deterministic,
      rules,
      version,
    }

    return definition === 'locale' ? { ...common, ...settings, locale } : { ...common, ...settings, lc_collate: lcCollate, lc_type: lcType }
  }

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      if (collation) await collationsOf(db, scid).update(collation.oid, data())
      else await collationsOf(db, scid).create(data())
      notifySuccess(collation ? t('collations.altered', { name }) : t('collations.created', { name }))
      onSaved()
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    collationsOf(db, scid)
      .modifiedSql(data(), collation?.oid)
      .then(
        (sql) => setPreview({ sql, error: null }),
        (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
      )
  }

  const readOnly = collation !== null

  return (
    <>
      <Modal
        show={show}
        onClose={onClose}
        id="collationDialogModal"
        size="lg"
        title={collation ? t('collations.edit_title', { name: collation.name }) : t('collations.create_title')}
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
              <tr>
                <td>{t('collations.name')}</td>
                <td>
                  <input type="text" name="collation_name" maxLength={63} value={name} onChange={(e) => setName(e.target.value)} required />
                </td>
              </tr>
              <tr>
                <td>{t('collations.owner')}</td>
                <td>
                  <select name="collation_owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
                    <option value="">{t('editor.current_role')}</option>
                    {(options?.roles ?? []).map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
              {!readOnly && (
                <tr>
                  <td>{t('collations.definition')}</td>
                  <td>
                    {(['locale', 'lc', 'copy'] as Definition[]).map((kind) => (
                      <label key={kind} className="me-3">
                        <input type="radio" name="collation_definition" checked={definition === kind} onChange={() => setDefinition(kind)} /> {t(`collations.definitions.${kind}`)}
                      </label>
                    ))}
                  </td>
                </tr>
              )}
              {definition === 'copy' && (
                <tr>
                  <td>{t('collations.copy_from')}</td>
                  <td>
                    <select name="copy_collation" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} required>
                      <option value="" />
                      {(options?.collations ?? []).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              )}
              {definition === 'locale' && (
                <tr>
                  <td>{t('collations.locale')}</td>
                  <td>
                    <input type="text" name="locale" value={locale} onChange={(e) => setLocale(e.target.value)} placeholder="en-US" required readOnly={readOnly} />
                  </td>
                </tr>
              )}
              {definition === 'lc' && (
                <>
                  <tr>
                    <td>LC_COLLATE</td>
                    <td>
                      <input type="text" name="lc_collate" value={lcCollate} onChange={(e) => setLcCollate(e.target.value)} placeholder="en_US.utf8" required readOnly={readOnly} />
                    </td>
                  </tr>
                  <tr>
                    <td>LC_CTYPE</td>
                    <td>
                      <input type="text" name="lc_type" value={lcType} onChange={(e) => setLcType(e.target.value)} placeholder="en_US.utf8" required readOnly={readOnly} />
                    </td>
                  </tr>
                </>
              )}
              {definition !== 'copy' && (
                <>
                  <tr>
                    <td>{t('collations.provider')}</td>
                    <td>
                      {readOnly ? (
                        <input type="text" value={provider} readOnly />
                      ) : (
                        <select name="provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
                          <option value="">{t('collations.provider_default')}</option>
                          {providers.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td>{t('collations.deterministic')}</td>
                    <td>
                      <input type="checkbox" name="is_deterministic" checked={deterministic} onChange={(e) => setDeterministic(e.target.checked)} disabled={readOnly} />
                    </td>
                  </tr>
                  {(serverVersion >= 160000 || rules !== '') && (
                    <tr>
                      <td>{t('collations.rules')}</td>
                      <td>
                        <input type="text" name="rules" value={rules} onChange={(e) => setRules(e.target.value)} placeholder="&V << w <<< W" readOnly={readOnly} />
                        {!readOnly && <div className="form-text">{t('collations.rules_hint')}</div>}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td>{t('collations.version')}</td>
                    <td>
                      <input type="text" name="version" value={version} onChange={(e) => setVersion(e.target.value)} readOnly={readOnly} />
                    </td>
                  </tr>
                </>
              )}
              <tr>
                <td>{t('collations.comment')}</td>
                <td>
                  <input type="text" name="collation_comment" size={50} value={comment} onChange={(e) => setComment(e.target.value)} />
                </td>
              </tr>
            </tbody>
          </table>
        </form>
      </Modal>
      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </>
  )
}
