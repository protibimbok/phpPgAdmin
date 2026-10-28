import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import SqlEditor from '@sql/js/editor/SqlEditor'
import { rules as rulesOf, type Rule, type RuleData, type TriggerParent } from '../api'

export interface RuleDialogProps {
  show: boolean
  db: string
  scid: number
  parent: TriggerParent
  relOid: number
  rule: Rule | null
  onClose: () => void
  onSaved: () => void
}

const EVENTS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']

/**
 * The rewrite rule editor, in the trigger editor's dialog layout: the name, the event, the
 * condition, DO INSTEAD, the commands (or NOTHING), the comment and whether the rule is
 * enabled. Go saves through the rule node; Preview SQL shows the statements.
 */
export default function RuleDialog({ show, db, scid, parent, relOid, rule, onClose, onSaved }: RuleDialogProps) {
  const { t } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const [name, setName] = useState('')
  const [event, setEvent] = useState('INSERT')
  const [condition, setCondition] = useState('')
  const [instead, setInstead] = useState(parent === 'view')
  const [statements, setStatements] = useState('')
  const [comment, setComment] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!show) return
    setName(rule?.name ?? '')
    setEvent(rule?.event ?? 'INSERT')
    setCondition(rule?.condition ?? '')
    setInstead(rule ? rule.do_instead : parent === 'view')
    setStatements(rule ? (rule.statements === 'NOTHING' ? '' : rule.statements) : '')
    setComment(rule?.comment ?? '')
    setEnabled(rule ? rule.is_enable_rule !== 'D' : true)
  }, [show, rule, parent])

  const collection = () => rulesOf(db, scid, parent, relOid)

  function data(): RuleData {
    return { name, event, condition, do_instead: instead, statements: statements.trim() === '' ? 'NOTHING' : statements, comment, is_enable_rule: enabled ? 'O' : 'D' }
  }

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      if (rule) await collection().update(rule.oid, data())
      else await collection().create(data())
      notifySuccess(rule ? t('triggers.rule_altered', { name }) : t('triggers.rule_created', { name }))
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
      .modifiedSql(data(), rule?.oid)
      .then(
        (sql) => setPreview({ sql, error: null }),
        (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
      )
  }

  return (
    <>
      <Modal
        show={show}
        onClose={onClose}
        id="ruleDialogModal"
        size="lg"
        title={rule ? t('triggers.rule_edit_title', { name: rule.name }) : t('triggers.rule_create_title')}
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
        <form className="rte_form" onSubmit={(e) => { e.preventDefault(); void save() }}>
          <table className="rte_table table table-borderless table-sm">
            <tbody>
              <tr>
                <td>{t('triggers.name')}</td>
                <td>
                  <input type="text" name="rule_name" maxLength={63} value={name} onChange={(e) => setName(e.target.value)} required />
                </td>
              </tr>
              <tr>
                <td>{t('triggers.event')}</td>
                <td>
                  <select name="rule_event" value={event} onChange={(e) => setEvent(e.target.value)}>
                    {EVENTS.map((ev) => (
                      <option key={ev} value={ev}>
                        {ev}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
              <tr>
                <td>{t('triggers.condition')}</td>
                <td>
                  <input type="text" name="rule_condition" size={50} value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="OLD.id > 0" />
                </td>
              </tr>
              <tr>
                <td>{t('triggers.do_instead')}</td>
                <td>
                  <input type="checkbox" name="rule_instead" checked={instead} onChange={(e) => setInstead(e.target.checked)} />
                </td>
              </tr>
              <tr>
                <td>{t('triggers.commands')}</td>
                <td>
                  <SqlEditor value={statements} onChange={setStatements} ariaLabel={t('triggers.commands')} className="rule-commands" lineNumbers={false} placeholder={t('triggers.commands_hint')} />
                </td>
              </tr>
              <tr>
                <td>{t('triggers.comment')}</td>
                <td>
                  <input type="text" name="rule_comment" value={comment} onChange={(e) => setComment(e.target.value)} />
                </td>
              </tr>
              <tr>
                <td>{t('triggers.enabled')}</td>
                <td>
                  <input type="checkbox" name="rule_enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
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
