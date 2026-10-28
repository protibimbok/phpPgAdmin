import { insertBefore, registerModule } from '@/modular'
import { registerContainerLink, registerNodeLink } from '@/nodes/links'
import Replication from './Pages/Replication'

const page = (db: string | null, open?: string) => (db === null ? '/server/replication' : `/server/replication?${new URLSearchParams({ db, ...(open ? { open } : {}) })}`)

// A publication or subscription in the tree opens its dialog on the Replication page, their
// containers that page with the database chosen.
for (const node of ['publication', 'subscription'] as const) {
  registerNodeLink(node, (treeNode, { db }) => page(db, `${node}:${treeNode.label}`))
  registerContainerLink(node, ({ db }) => page(db))
}

// The server's "Replication" tab where phpMyAdmin has it, before Variables.
registerModule({
  id: 'replication',
  order: 46,
  menuFilter: (menu) => insertBefore(menu, { label: 'status:variables.tab' }, { label: 'replication:tab', icon: 's_replication', path: '/server/replication' }),
  routes: [{ path: 'server/replication', element: <Replication /> }],
})
