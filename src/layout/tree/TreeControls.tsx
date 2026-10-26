import { useTranslation } from 'react-i18next'
import Icon from '@/components/Icon'
import { useTreeState } from './treeState'

/**
 * phpMyAdmin's #navigation_controls (navigation/tree/controls.twig): collapse everything, and
 * whether the tree follows the page shown ("Link with main panel").
 */
export default function TreeControls() {
  const { t } = useTranslation()
  const state = useTreeState()
  const linked = state.isLinked()

  return (
    <li id="navigation_controls_outer">
      <div id="navigation_controls">
        <a href="#collapse" id="pma_navigation_collapse" title={t('tree.collapse_all')} onClick={(e) => { e.preventDefault(); state.collapseAll() }}>
          <Icon name="s_collapseall" title={t('tree.collapse_all')} />
        </a>{' '}
        <a href="#link" id="pma_navigation_sync" title={linked ? t('tree.unlink') : t('tree.link')} onClick={(e) => { e.preventDefault(); state.setLinked(!linked) }}>
          <Icon name={linked ? 's_link' : 's_unlink'} title={linked ? t('tree.unlink') : t('tree.link')} />
        </a>
      </div>
    </li>
  )
}
