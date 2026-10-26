import { urls } from '@/level'
import { registerModule } from '@/modular'
import { registerNodeLink } from '@/nodes/links'
import SchemaStructure from './Pages/SchemaStructure'

// A table in the tree opens the table's pages; the ancestors tell which schema it is in.
registerNodeLink('table', (node, { db, ancestors }) => {
  const schema = ancestors.find((a) => a.type === 'schema')

  return db === null || !schema ? '#' : urls.relation(db, schema.label, node.label, 'table')
})

// The schema's "Structure" tab, first in the schema's bar, where /db/:db/schema/:schema lands.
registerModule({
  id: 'tables',
  menuFilter: (menu) => [...menu, { label: 'tables:tab', icon: 'b_props', path: '/db/:db/schema/:schema', level: 'schema' }],
  routes: [{ path: 'db/:db/schema/:schema', element: <SchemaStructure /> }],
})
