import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { listDatabases } from '@databases/js/api'
import Modal from '@/components/Modal'
import { urls, useLevel } from '@/level'
import ViewForm from './ViewForm'

export interface CreateViewModalProps {
  show: boolean
  /** The database the query ran in; without one (the server's SQL page) the form asks for it. */
  db?: string
  /** The query the view is made from. */
  sql: string
  onClose: () => void
}

/**
 * phpMyAdmin's modals/create_view.twig, opened by the "Create view" link under a result: the
 * create-view form in a modal, with Go and Close in the footer. The new view's structure page
 * opens once it is created. A query run on the server's SQL page has no database, so the form
 * then starts with a Database row, set to the database the query ran in.
 */
export default function CreateViewModal({ show, db, sql, onClose }: CreateViewModalProps) {
  const { t } = useTranslation('views')
  const { t: tApp } = useTranslation()
  const level = useLevel()
  const navigate = useNavigate()
  const [databases, setDatabases] = useState<string[] | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)

  useEffect(() => {
    if (!show || db !== undefined || databases !== null) return
    listDatabases().then(
      (list) => {
        const usable = list.filter((d) => d.datallowconn && !d.is_template)
        setDatabases(usable.map((d) => d.name))
        // The one the session is connected to is the one the query ran in.
        setChosen((current) => current ?? (usable.find((d) => !d.can_drop) ?? usable[0])?.name ?? null)
      },
      () => setDatabases([]),
    )
  }, [show, db, databases])

  const target = db ?? chosen

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
      {target !== null && (
        <ViewForm
          db={target}
          schema={level.schema ?? 'public'}
          initialSql={sql}
          formId="create_view_modal_form"
          inModal
          databaseChoice={db === undefined ? { options: databases ?? [], onChange: setChosen } : undefined}
          onSaved={(node, kind, schema) => {
            onClose()
            navigate(urls.relation(target, schema, node.label, kind))
          }}
        />
      )}
    </Modal>
  )
}
