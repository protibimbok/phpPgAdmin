import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

const openModals: symbol[] = []

export interface ModalProps {
  show: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  /** The footer; by default a single Close button. */
  footer?: ReactNode
  /** Bootstrap's size class suffix: "lg" or "xl". */
  size?: 'sm' | 'lg' | 'xl'
  id?: string
}

/**
 * A Bootstrap 5 modal as phpMyAdmin's modals/*.twig lay it out, driven by React state instead
 * of Bootstrap's script: Escape and the backdrop close it.
 */
export default function Modal({ show, title, onClose, children, footer, size, id }: ModalProps) {
  const { t } = useTranslation()
  const token = useRef<symbol>(Symbol('modal'))
  // The latest onClose, so an inline handler (a new function every render) does not take the
  // modal off the stack and put it back on top of one opened over it.
  const close = useRef(onClose)
  close.current = onClose

  // Modals stack (a preview over a dialog); Escape closes only the one on top. A modal joins
  // the stack once, when it opens, and leaves it when it closes.
  useEffect(() => {
    if (!show) return
    const mine = token.current
    openModals.push(mine)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === mine) close.current()
    }
    document.addEventListener('keydown', onKey)
    document.body.classList.add('modal-open')

    return () => {
      document.removeEventListener('keydown', onKey)
      openModals.splice(openModals.indexOf(mine), 1)
      if (openModals.length === 0) document.body.classList.remove('modal-open')
    }
  }, [show])

  if (!show) return null

  return createPortal(
    <>
      <div className="modal fade show" id={id} tabIndex={-1} role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className={`modal-dialog${size ? ` modal-${size}` : ''}`}>
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{title}</h5>
              <button type="button" className="btn-close" aria-label={t('close')} onClick={onClose} />
            </div>
            <div className="modal-body">{children}</div>
            <div className="modal-footer">
              {footer ?? (
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  {t('close')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" />
    </>,
    document.body,
  )
}
