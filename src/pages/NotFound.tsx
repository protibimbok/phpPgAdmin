import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import Icon from '@/components/Icon'

export default function NotFound() {
  const { t } = useTranslation()

  return (
    <div className="alert alert-warning mt-3" role="alert">
      <Icon name="s_attention" /> {t('not_found')} <Link to="/">{t('back_home')}</Link>
    </div>
  )
}
