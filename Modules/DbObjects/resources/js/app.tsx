import { urls } from '@/level'
import { insertAfter, registerModule } from '@/modular'
import { registerContainerLink, registerNodeLink } from '@/nodes/links'
import Objects from './Pages/Objects'

const KINDS = ['extension', 'language', 'cast', 'event_trigger', 'foreign_data_wrapper', 'foreign_server', 'user_mapping'] as const

// An extension, language, cast, event trigger, foreign data wrapper, foreign server or user
// mapping in the tree opens its dialog on the database's Objects page; their folders open the
// page at their list.
for (const kind of KINDS) {
  registerNodeLink(kind, (node, { db }) => (db === null ? '#' : `${urls.database(db)}/objects?${new URLSearchParams({ open: `${kind}:${node.oid}` })}`))
  registerContainerLink(kind, ({ db }) => (db === null ? urls.server() : `${urls.database(db)}/objects#${kind}s_section`))
}

// The database's Objects tab, pgAdmin's database-level nodes, after Privileges. The module
// sorts after the Roles module, whose tab it follows.
registerModule({
  id: 'dbobjects',
  order: 41,
  menuFilter: (menu) => insertAfter(menu, { label: 'roles:privileges.tab', level: 'database' }, { label: 'dbobjects:tab', icon: 'b_plugin', path: '/db/:db/objects', level: 'database' }),
  routes: [{ path: 'db/:db/objects', element: <Objects /> }],
})
