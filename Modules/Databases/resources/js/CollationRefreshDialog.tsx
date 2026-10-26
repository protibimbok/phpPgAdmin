import { useTranslation } from 'react-i18next'
import ConfirmQuery from '@/components/ConfirmQuery'
import type { CollationRemedy } from './api'

/**
 * The question asked when CREATE DATABASE was refused because the template's recorded collation
 * version is stale: refresh it (ALTER DATABASE ... REFRESH COLLATION VERSION, as the server's
 * hint says) and create the database, or leave it. The server's detail explains the versions.
 */
export default function CollationRefreshDialog({ remedy, onConfirm, onClose }: { remedy: CollationRemedy | null; onConfirm: () => void; onClose: () => void }) {
  const { t } = useTranslation('databases')

  return (
    <ConfirmQuery
      show={remedy !== null}
      warning={remedy ? t('create.collation_mismatch', { template: remedy.template, recorded: remedy.recorded, actual: remedy.actual }) : undefined}
      sql={remedy?.sql ?? ''}
      confirmLabel={t('create.refresh_and_create')}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  )
}
