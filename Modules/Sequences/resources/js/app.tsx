import { urls } from '@/level'
import { registerModule } from '@/modular'
import { registerNodeLink } from '@/nodes/links'
import SequenceEditor from './Pages/SequenceEditor'
import Sequences from './Pages/Sequences'

// A sequence in the tree opens its editor.
registerNodeLink('sequence', (node, { db, ancestors }) => {
  const schema = ancestors.find((a) => a.type === 'schema')

  return db === null || !schema ? '#' : `${urls.schema(db, schema.label)}/sequences/${encodeURIComponent(node.label)}/edit`
})

// The schema's "Sequences" tab, after Routines.
registerModule({
  id: 'sequences',
  order: 31,
  menuFilter: (menu) => [...menu, { label: 'sequences:tab', icon: 'b_events', path: '/db/:db/schema/:schema/sequences', level: 'schema' }],
  routes: [
    { path: 'db/:db/schema/:schema/sequences', element: <Sequences /> },
    { path: 'db/:db/schema/:schema/sequences/create', element: <SequenceEditor mode="create" /> },
    { path: 'db/:db/schema/:schema/sequences/:sequence/edit', element: <SequenceEditor mode="edit" /> },
  ],
})
