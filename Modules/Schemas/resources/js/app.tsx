import { urls } from '@/level'
import { registerModule } from '@/modular'
import { registerContainerLink, registerNodeLink } from '@/nodes/links'
import DataDictionary from './Pages/DataDictionary'
import Operations from './Pages/Operations'
import Structure from './Pages/Structure'

// A schema in the tree opens the schema's own page.
registerNodeLink('schema', (node, { db }) => (db === null ? '#' : urls.schema(db, node.label)))
registerContainerLink('schema', ({ db }) => (db === null ? urls.server() : urls.database(db)))

// The database's "Structure" tab, first in the database's bar, where /db/:db lands.
registerModule({
  id: 'schemas',
  menuFilter: (menu) => [...menu, { label: 'schemas:tab', icon: 'b_props', path: '/db/:db', level: 'database' }],
  routes: [
    { path: 'db/:db', element: <Structure /> },
    // phpMyAdmin's database/data_dictionary, linked from the bottom of the Structure page.
    { path: 'db/:db/data-dictionary', element: <DataDictionary /> },
  ],
})

// The schema's "Operations" tab comes after the Structure and SQL tabs the other modules give
// the schema level, so it is registered to sort after them.
registerModule({
  id: 'schemas-operations',
  order: 20,
  menuFilter: (menu) => [...menu, { label: 'schemas:operations.tab', icon: 'b_tblops', path: '/db/:db/schema/:schema/operations', level: 'schema' }],
  routes: [{ path: 'db/:db/schema/:schema/operations', element: <Operations /> }],
})
