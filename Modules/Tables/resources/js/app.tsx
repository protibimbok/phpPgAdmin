import { urls } from '@/level'
import { registerModule } from '@/modular'
import { registerNodeLink } from '@/nodes/links'
import SchemaStructure from './Pages/SchemaStructure'
import TableDdl from './Pages/TableDdl'
import TableStructure from './Pages/TableStructure'

// A table in the tree opens its Browse page, as phpMyAdmin's tree does; the ancestors tell
// which schema it is in.
registerNodeLink('table', (node, { db, ancestors }) => {
  const schema = ancestors.find((a) => a.type === 'schema')

  return db === null || !schema ? '#' : `${urls.relation(db, schema.label, node.label, 'table')}/browse`
})

// The schema's "Structure" tab, first in the schema's bar, where /db/:db/schema/:schema lands;
// the table's "Structure" tab, where a table's own URL lands.
registerModule({
  id: 'tables',
  menuFilter: (menu) => [
    ...menu,
    { label: 'tables:tab', icon: 'b_props', path: '/db/:db/schema/:schema', level: 'schema' },
    { label: 'tables:structure.tab', icon: 'b_props', path: '/db/:db/schema/:schema/table/:table', level: 'table' },
    { label: 'tables:ddl.tab', icon: 'b_sql', path: '/db/:db/schema/:schema/table/:table/ddl', level: 'table' },
  ],
  routes: [
    { path: 'db/:db/schema/:schema', element: <SchemaStructure /> },
    { path: 'db/:db/schema/:schema/table/:table', element: <TableStructure /> },
    { path: 'db/:db/schema/:schema/table/:table/ddl', element: <TableDdl /> },
  ],
})
