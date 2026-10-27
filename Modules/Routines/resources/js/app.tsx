import { urls } from '@/level'
import { registerModule } from '@/modular'
import { registerNodeLink } from '@/nodes/links'
import { KINDS } from './api'
import RoutineEditor from './Pages/RoutineEditor'
import Routines from './Pages/Routines'

// A routine in the tree opens its editor, as phpMyAdmin's tree does.
for (const kind of KINDS) {
  registerNodeLink(kind, (node, { db, ancestors }) => {
    const schema = ancestors.find((a) => a.type === 'schema')

    return db === null || !schema ? '#' : `${urls.schema(db, schema.label)}/routines/${kind}/${node.oid}/edit`
  })
}

// The schema's "Routines" tab, after the Operations tab the Schemas module adds.
registerModule({
  id: 'routines',
  order: 30,
  menuFilter: (menu) => [...menu, { label: 'routines:tab', icon: 'b_routines', path: '/db/:db/schema/:schema/routines', level: 'schema' }],
  routes: [
    { path: 'db/:db/schema/:schema/routines', element: <Routines /> },
    { path: 'db/:db/schema/:schema/routines/create', element: <RoutineEditor mode="create" /> },
    { path: 'db/:db/schema/:schema/routines/:kind/:oid/edit', element: <RoutineEditor mode="edit" /> },
  ],
})
