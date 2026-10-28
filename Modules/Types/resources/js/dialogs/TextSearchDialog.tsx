import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import { FTS_KINDS, ftsOptions, ftsTokens, textSearch, type DictionaryOption, type FtsData, type FtsKind, type FtsObject, type FtsOptions, type TokenMapping } from '../api'

export interface TextSearchDialogProps {
  show: boolean
  db: string
  scid: number
  /** The kind a new object is created as; an existing object fixes it. */
  kind: FtsKind
  object: FtsObject | null
  onClose: () => void
  onSaved: () => void
}

/**
 * The editor for the four full text search objects after pgAdmin's dialogs, in the trigger
 * editor's dialog layout. A configuration is a parser (or a copy of another configuration)
 * and, once it exists, the dictionaries each token type maps to; a dictionary is a template
 * with its options; a parser and a template are their functions. Go saves through the node of
 * the kind; Preview SQL shows the statements.
 */
export default function TextSearchDialog({ show, db, scid, kind: initialKind, object, onClose, onSaved }: TextSearchDialogProps) {
  const { t } = useTranslation('types')
  const { t: tApp } = useTranslation()
  const [kind, setKind] = useState<FtsKind>(initialKind)
  const [options, setOptions] = useState<Partial<Record<FtsKind, FtsOptions>>>({})
  const [name, setName] = useState('')
  const [owner, setOwner] = useState('')
  const [comment, setComment] = useState('')
  // configuration
  const [source, setSource] = useState<'parser' | 'copy'>('parser')
  const [parser, setParser] = useState('')
  const [copyFrom, setCopyFrom] = useState('')
  const [tokens, setTokens] = useState<{ token: string; dictionaries: string }[]>([])
  const [tokenTypes, setTokenTypes] = useState<string[]>([])
  // dictionary
  const [template, setTemplate] = useState('')
  const [dictOptions, setDictOptions] = useState<DictionaryOption[]>([])
  // parser and template functions
  const [functions, setFunctions] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<{
    sql: string | null
    error: string | null
  } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!show) return
    setKind(initialKind)
    setName(object?.name ?? '')
    setOwner(object?.owner ?? '')
    setComment(object?.description ?? '')
    setSource('parser')
    setParser(object?.prsname ?? '')
    setCopyFrom('')
    setTokens(
      (object?.tokens ?? []).map((m: TokenMapping) => ({
        token: m.token,
        dictionaries: m.dictname.join(', '),
      })),
    )
    setTokenTypes([])
    setTemplate(object?.template ?? '')
    setDictOptions(object?.options ?? [])
    setFunctions({
      prsstart: object?.prsstart ?? '',
      prstoken: object?.prstoken ?? '',
      prsend: object?.prsend ?? '',
      prslextype: object?.prslextype ?? '',
      prsheadline: object?.prsheadline === '-' ? '' : (object?.prsheadline ?? ''),
      tmplinit: object?.tmplinit === '-' ? '' : (object?.tmplinit ?? ''),
      tmpllexize: object?.tmpllexize ?? '',
    })
    // The list rows carry no mappings: an existing configuration's come from its properties.
    if (object && initialKind === 'fts_configuration') {
      textSearch(db, scid, initialKind)
        .properties(object.oid)
        .then((props) => setTokens((props.tokens ?? []).map((m: TokenMapping) => ({ token: m.token, dictionaries: m.dictname.join(', ') }))), () => setTokens([]))
      if (object.parser) ftsTokens(db, scid, object.parser).then(setTokenTypes, () => setTokenTypes([]))
    }
  }, [show, initialKind, object, db, scid])

  useEffect(() => {
    if (!show || options[kind]) return
    ftsOptions(db, scid, kind).then(
      (loaded) => setOptions((current) => ({ ...current, [kind]: loaded })),
      () => setOptions((current) => ({ ...current, [kind]: {} })),
    )
  }, [show, kind, db, scid, options])

  const current = options[kind] ?? {}
  const collection = () => textSearch(db, scid, kind)

  function data(): FtsData {
    const common: FtsData = { name, description: comment }
    switch (kind) {
      case 'fts_configuration':
        return object
          ? {
              ...common,
              owner,
              tokens: tokens.map((m) => ({
                token: m.token.trim(),
                dictname: m.dictionaries
                  .split(',')
                  .map((d) => d.trim())
                  .filter(Boolean),
              })),
            }
          : {
              ...common,
              owner,
              ...(source === 'copy' ? { copy_config: copyFrom } : { prsname: parser }),
            }
      case 'fts_dictionary':
        return { ...common, owner, template, options: dictOptions }
      case 'fts_parser':
        return {
          ...common,
          prsstart: functions.prsstart,
          prstoken: functions.prstoken,
          prsend: functions.prsend,
          prslextype: functions.prslextype,
          prsheadline: functions.prsheadline,
        }
      case 'fts_template':
        return {
          ...common,
          tmplinit: functions.tmplinit,
          tmpllexize: functions.tmpllexize,
        }
    }
  }

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      if (object) await collection().update(object.oid, data())
      else await collection().create(data())
      notifySuccess(object ? t('fts.altered', { name }) : t('fts.created', { name }))
      onSaved()
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    collection()
      .modifiedSql(data(), object?.oid)
      .then(
        (sql) => setPreview({ sql, error: null }),
        (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
      )
  }

  /** A select of function names that keeps a value the list does not offer. */
  function functionSelect(field: string, list: string[] | undefined, optional = false) {
    const value = functions[field] ?? ''
    const names = list ?? []

    return (
      <select name={field} value={value} onChange={(e) => setFunctions((f) => ({ ...f, [field]: e.target.value }))} required={!optional}>
        <option value="">{optional ? t('fts.none_function') : ''}</option>
        {value !== '' && !names.includes(value) && <option value={value}>{value}</option>}
        {names.map((fn) => (
          <option key={fn} value={fn}>
            {fn}
          </option>
        ))}
      </select>
    )
  }

  const ownerRow = (kind === 'fts_configuration' || kind === 'fts_dictionary') && (
    <tr>
      <td>{t('fts.owner')}</td>
      <td>
        <select name="fts_owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">{t('editor.current_role')}</option>
          {(current.roles ?? []).map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </td>
    </tr>
  )

  return (
    <>
      <Modal
        show={show}
        onClose={onClose}
        id="textSearchDialogModal"
        size="lg"
        title={object ? t('fts.edit_title', { name: object.name }) : t('fts.create_title')}
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
                <td>{t('fts.kind')}</td>
                <td>
                  {object ? (
                    <input type="text" value={t(`fts.kinds.${kind}`)} readOnly />
                  ) : (
                    <select name="fts_kind" value={kind} onChange={(e) => setKind(e.target.value as FtsKind)}>
                      {FTS_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {t(`fts.kinds.${k}`)}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
              <tr>
                <td>{t('fts.name')}</td>
                <td>
                  <input type="text" name="fts_name" maxLength={63} value={name} onChange={(e) => setName(e.target.value)} required />
                </td>
              </tr>
              {ownerRow}

              {kind === 'fts_configuration' && !object && (
                <>
                  <tr>
                    <td>{t('fts.source')}</td>
                    <td>
                      <label className="me-3">
                        <input type="radio" name="fts_source" checked={source === 'parser'} onChange={() => setSource('parser')} /> {t('fts.parser')}
                      </label>
                      <label>
                        <input type="radio" name="fts_source" checked={source === 'copy'} onChange={() => setSource('copy')} /> {t('fts.copy_config')}
                      </label>
                    </td>
                  </tr>
                  {source === 'parser' ? (
                    <tr>
                      <td>{t('fts.parser')}</td>
                      <td>
                        <select name="prsname" value={parser} onChange={(e) => setParser(e.target.value)} required>
                          <option value="" />
                          {(current.parsers ?? []).map((p) => (
                            <option key={p.oid} value={p.name}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td>{t('fts.copy_config')}</td>
                      <td>
                        <select name="copy_config" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} required>
                          <option value="" />
                          {(current.configurations ?? []).map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )}
                </>
              )}
              {kind === 'fts_configuration' && object && (
                <>
                  <tr>
                    <td>{t('fts.parser')}</td>
                    <td>
                      <input type="text" value={parser} readOnly />
                    </td>
                  </tr>
                  <tr>
                    <td>{t('fts.tokens')}</td>
                    <td>
                      <table id="fts_tokens" className="table table-sm table-borderless w-auto mb-1">
                        <thead>
                          <tr>
                            <th>{t('fts.token')}</th>
                            <th>{t('fts.dictionaries')}</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {tokens.map((mapping, index) => (
                            <tr key={index}>
                              <td>
                                <select value={mapping.token} onChange={(e) => setTokens((rows) => rows.map((r, i) => (i === index ? { ...r, token: e.target.value } : r)))} required>
                                  <option value="" />
                                  {mapping.token !== '' && !tokenTypes.includes(mapping.token) && <option value={mapping.token}>{mapping.token}</option>}
                                  {tokenTypes.map((token) => (
                                    <option key={token} value={token} disabled={tokens.some((r, i) => i !== index && r.token === token)}>
                                      {token}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <input
                                  type="text"
                                  list="fts_dictionaries"
                                  value={mapping.dictionaries}
                                  onChange={(e) =>
                                    setTokens((rows) =>
                                      rows.map((r, i) =>
                                        i === index
                                          ? {
                                              ...r,
                                              dictionaries: e.target.value,
                                            }
                                          : r,
                                      ),
                                    )
                                  }
                                  placeholder="english_stem, simple"
                                  required
                                />
                              </td>
                              <td>
                                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setTokens((rows) => rows.filter((_, i) => i !== index))}>
                                  {t('editor.remove')}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <datalist id="fts_dictionaries">
                        {(current.dictionaries ?? []).map((d) => (
                          <option key={d} value={d} />
                        ))}
                      </datalist>
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => setTokens((rows) => [...rows, { token: '', dictionaries: '' }])}>
                        {t('fts.add_mapping')}
                      </button>
                      <div className="form-text">{t('fts.tokens_hint')}</div>
                    </td>
                  </tr>
                </>
              )}

              {kind === 'fts_dictionary' && (
                <>
                  <tr>
                    <td>{t('fts.template')}</td>
                    <td>
                      {object ? (
                        <input type="text" value={template} readOnly />
                      ) : (
                        <select name="template" value={template} onChange={(e) => setTemplate(e.target.value)} required>
                          <option value="" />
                          {(current.templates ?? []).map((tpl) => (
                            <option key={tpl} value={tpl}>
                              {tpl}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td>{t('fts.options')}</td>
                    <td>
                      <table id="fts_options" className="table table-sm table-borderless w-auto mb-1">
                        <thead>
                          <tr>
                            <th>{t('fts.option')}</th>
                            <th>{t('fts.value')}</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {dictOptions.map((option, index) => (
                            <tr key={index}>
                              <td>
                                <input type="text" value={option.option} onChange={(e) => setDictOptions((rows) => rows.map((r, i) => (i === index ? { ...r, option: e.target.value } : r)))} placeholder="stopwords" required />
                              </td>
                              <td>
                                <input type="text" value={option.value} onChange={(e) => setDictOptions((rows) => rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)))} placeholder="english" />
                              </td>
                              <td>
                                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDictOptions((rows) => rows.filter((_, i) => i !== index))}>
                                  {t('editor.remove')}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDictOptions((rows) => [...rows, { option: '', value: '' }])}>
                        {t('fts.add_option')}
                      </button>
                    </td>
                  </tr>
                </>
              )}

              {kind === 'fts_parser' && (
                <>
                  <tr>
                    <td>START</td>
                    <td>{functionSelect('prsstart', current.start)}</td>
                  </tr>
                  <tr>
                    <td>GETTOKEN</td>
                    <td>{functionSelect('prstoken', current.token)}</td>
                  </tr>
                  <tr>
                    <td>END</td>
                    <td>{functionSelect('prsend', current.end)}</td>
                  </tr>
                  <tr>
                    <td>LEXTYPES</td>
                    <td>{functionSelect('prslextype', current.lextype)}</td>
                  </tr>
                  <tr>
                    <td>HEADLINE</td>
                    <td>{functionSelect('prsheadline', current.headline, true)}</td>
                  </tr>
                  {object && (
                    <tr>
                      <td />
                      <td className="form-text">{t('fts.recreate_hint')}</td>
                    </tr>
                  )}
                </>
              )}

              {kind === 'fts_template' && (
                <>
                  <tr>
                    <td>INIT</td>
                    <td>{functionSelect('tmplinit', current.init, true)}</td>
                  </tr>
                  <tr>
                    <td>LEXIZE</td>
                    <td>{functionSelect('tmpllexize', current.lexize)}</td>
                  </tr>
                  {object && (
                    <tr>
                      <td />
                      <td className="form-text">{t('fts.recreate_hint')}</td>
                    </tr>
                  )}
                </>
              )}

              <tr>
                <td>{t('fts.comment')}</td>
                <td>
                  <input type="text" name="fts_comment" size={50} value={comment} onChange={(e) => setComment(e.target.value)} />
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
