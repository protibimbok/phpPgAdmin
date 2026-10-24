import { useTranslation } from 'react-i18next'
import Modal from './Modal'

export interface PreviewSqlProps {
  /** The statement(s) to show; null while they are being fetched. */
  sql: string | null
  error?: string | null
  show: boolean
  onClose: () => void
  /** When given, an OK button runs it: the confirmation flavour of phpMyAdmin's preview modal. */
  onConfirm?: () => void
  confirmLabel?: string
}

/**
 * phpMyAdmin's "Preview SQL" modal: the statements a form is about to run, in a <pre>, with
 * Close or OK and Close.
 */
export default function PreviewSql({ sql, error, show, onClose, onConfirm, confirmLabel }: PreviewSqlProps) {
  const { t } = useTranslation()

  return (
    <Modal
      show={show}
      onClose={onClose}
      title={sql === null && !error ? t('loading') : t('preview_sql')}
      size="lg"
      footer={
        <>
          {onConfirm && (
            <button type="button" className="btn btn-secondary" onClick={onConfirm} disabled={sql === null}>
              {confirmLabel ?? t('ok')}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('close')}
          </button>
        </>
      }
    >
      {error ? (
        <div className="alert alert-danger mb-0" role="alert">
          {error}
        </div>
      ) : (
        <div className="preview_sql">
          <pre>
            <code className="sql" dir="ltr">
              {sql ?? t('loading')}
            </code>
          </pre>
        </div>
      )}
    </Modal>
  )
}
