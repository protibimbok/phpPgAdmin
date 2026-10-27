import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import Modal from '@/components/Modal'
import { urls, useLevel } from '@/level'
import ViewForm from './ViewForm'

export interface CreateViewModalProps {
  show: boolean
  db: string
  /** The query the view is made from. */
  sql: string
  onClose: () => void
}

/**
 * phpMyAdmin's modals/create_view.twig, opened by the "Create view" link under a result: the
 * create-view form in a modal, with Go and Close in the footer. The new view's structure page
 * opens once it is created.
 */
export default function CreateViewModal({ show, db, sql, onClose }: CreateViewModalProps) {
  const { t } = useTranslation('views')
  const { t: tApp } = useTranslation()
  const level = useLevel()
  const navigate = useNavigate()

  return (
    <Modal
      show={show}
      id="createViewModal"
      size="lg"
      title={t('form.create_title')}
      onClose={onClose}
      footer={
        <>
          <button type="submit" form="create_view_modal_form" className="btn btn-secondary" id="createViewModalGoButton">
            {tApp('go')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {tApp('close')}
          </button>
        </>
      }
    >
      <ViewForm
        db={db}
        schema={level.schema ?? 'public'}
        initialSql={sql}
        formId="create_view_modal_form"
        inModal
        onSaved={(node, kind, schema) => {
          onClose()
          navigate(urls.relation(db, schema, node.label, kind))
        }}
      />
    </Modal>
  )
}
