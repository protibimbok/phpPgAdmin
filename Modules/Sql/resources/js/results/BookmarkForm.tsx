import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Icon from '@/components/Icon'
import { notifyError, notifySuccess } from '@/notify'
import { createBookmark } from '../api'

export interface BookmarkFormProps {
  database: string
  sql: string
}

/**
 * phpMyAdmin's "Bookmark this SQL query" card under a result (sql/bookmark.twig): a label, the
 * "let every user access" box and the button; the saved query then appears in the SQL page's
 * bookmark list and in the console.
 */
export default function BookmarkForm({ database, sql }: BookmarkFormProps) {
  const { t } = useTranslation('sql')
  const [label, setLabel] = useState('')
  const [shared, setShared] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (label.trim() === '') return
    try {
      await createBookmark({ database, label: label.trim(), sql, shared })
      notifySuccess(t('bookmark.created'))
      setLabel('')
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  return (
    <form className="bookmarkQueryForm d-print-none card mb-3" onSubmit={(e) => void submit(e)}>
      <div className="card-header">
        <Icon name="b_bookmark" /> {t('bookmark.title')}
      </div>
      <div className="card-body">
        <div className="formelement">
          <label>
            {t('bookmark.label')} <input type="text" name="bkm_fields[bkm_label]" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
        </div>
        <div className="formelement">
          <label>
            <input type="checkbox" name="bkm_all_users" value="true" checked={shared} onChange={(e) => setShared(e.target.checked)} /> {t('bookmark.all_users')}
          </label>
        </div>
        <div className="clearfloat" />
      </div>
      <div className="card-footer tblFooters">
        <input className="btn btn-secondary" type="submit" value={t('bookmark.title')} />
      </div>
    </form>
  )
}
