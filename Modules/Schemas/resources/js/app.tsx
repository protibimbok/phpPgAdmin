import { urls } from '@/level'
import { registerModule } from '@/modular'
import { registerNodeLink } from '@/nodes/links'
import Structure from './Pages/Structure'

// A schema in the tree opens the schema's own page.
registerNodeLink('schema', (node, { db }) => (db === null ? '#' : urls.schema(db, node.label)))

// The database's "Structure" tab, first in the database's bar, where /db/:db lands.
registerModule({
  id: 'schemas',
  menuFilter: (menu) => [...menu, { label: 'schemas:tab', icon: 'b_props', path: '/db/:db', level: 'database' }],
  routes: [{ path: 'db/:db', element: <Structure /> }],
})
