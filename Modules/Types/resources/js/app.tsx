import { urls } from '@/level'
import { registerModule } from '@/modular'
import { registerNodeLink } from '@/nodes/links'
import TypeEditor from './Pages/TypeEditor'
import Types from './Pages/Types'

// A type or domain in the tree opens its editor.
for (const node of ['type', 'domain'] as const) {
  registerNodeLink(node, (treeNode, { db, ancestors }) => {
    const schema = ancestors.find((a) => a.type === 'schema')

    return db === null || !schema ? '#' : `${urls.schema(db, schema.label)}/types/${node}/${encodeURIComponent(treeNode.label)}/edit`
  })
}

// A collation or text search object in the tree opens its dialog on the Types page.
for (const node of ['collation', 'fts_configuration', 'fts_dictionary', 'fts_parser', 'fts_template'] as const) {
  registerNodeLink(node, (treeNode, { db, ancestors }) => {
    const schema = ancestors.find((a) => a.type === 'schema')

    return db === null || !schema ? '#' : `${urls.schema(db, schema.label)}/types?${new URLSearchParams({ open: `${node}:${treeNode.label}` })}`
  })
}

// The schema's "Types" tab, after Sequences.
registerModule({
  id: 'types',
  order: 32,
  menuFilter: (menu) => [...menu, { label: 'types:tab', icon: 'b_plugin', path: '/db/:db/schema/:schema/types', level: 'schema' }],
  routes: [
    { path: 'db/:db/schema/:schema/types', element: <Types /> },
    { path: 'db/:db/schema/:schema/types/create', element: <TypeEditor mode="create" /> },
    { path: 'db/:db/schema/:schema/types/:node/:name/edit', element: <TypeEditor mode="edit" /> },
  ],
})
