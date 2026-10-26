import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from './Modal'

export interface ConfirmQueryProps {
  show: boolean
  /** The statement(s) about to run, shown in the question. */
  sql: string | string[]
  onConfirm: () => void
  onClose: () => void
  /** A line before the question: phpMyAdmin's "You are about to DESTROY a complete database!". */
  warning?: string
  /** Extra controls under the question: a CASCADE box, for instance. */
  children?: ReactNode
  confirmLabel?: string
  /** The confirm button's Bootstrap class; "btn-danger" for a drop. */
  confirmClass?: string
}

/**
 * phpMyAdmin's confirmation dialog (Functions.confirm): "Do you really want to execute "…"?"
 * with the statement in code, an OK and a Cancel button.
 */
export default function ConfirmQuery({ show, sql, onConfirm, onClose, warning, children, confirmLabel, confirmClass = 'btn-primary' }: ConfirmQueryProps) {
  const { t } = useTranslation()
  const statements = Array.isArray(sql) ? sql : [sql]
  // The question is translated with a placeholder where the statements go, so they can be marked up.
  const [before, after] = t('do_you_really', { sql: '\u0000' }).split('\u0000')

  return (
    <Modal
      show={show}
      onClose={onClose}
      title={t('confirm')}
      id="confirm_dialog"
      footer={
        <>
          <button type="button" className={`btn ${confirmClass} submitOK`} onClick={onConfirm}>
            {confirmLabel ?? t('ok')}
          </button>
          <button type="button" className="btn btn-secondary submitCancel" onClick={onClose}>
            {t('cancel')}
          </button>
        </>
      }
    >
      {warning && <strong>{warning}</strong>}{warning && ' '}
      {before}
      <code dir="ltr">
        {statements.map((statement, i) => (
          <span key={i}>
            {i > 0 && <br />}
            {statement}
          </span>
        ))}
      </code>
      {after}
      {children}
    </Modal>
  )
}
