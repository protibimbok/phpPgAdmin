import { urls } from '@/level'
import { registerModule } from '@/modular'
import { registerNodeLink } from '@/nodes/links'
import CreateView from './Pages/CreateView'
import ViewDdl from './Pages/ViewDdl'
import ViewOperations from './Pages/ViewOperations'
import ViewStructure from './Pages/ViewStructure'

const KINDS = ['view', 'mview'] as const

// Views and materialized views in the tree open their Browse page, as tables do.
for (const kind of KINDS) {
  registerNodeLink(kind, (node, { db, ancestors }) => {
    const schema = ancestors.find((a) => a.type === 'schema')

    return db === null || !schema ? '#' : `${urls.relation(db, schema.label, node.label, kind)}/browse`
  })
}

// The pages behind the relation tabs the Tables module declares (Structure, Operations, Show
// create) for the view kinds, the edit-view form and the schema's create-view page.
registerModule({
  id: 'views',
  routes: [
    { path: 'db/:db/schema/:schema/create-view', element: <CreateView mode="create" /> },
    ...KINDS.flatMap((kind) => [
      { path: `db/:db/schema/:schema/${kind}/:view`, element: <ViewStructure /> },
      { path: `db/:db/schema/:schema/${kind}/:view/operations`, element: <ViewOperations /> },
      { path: `db/:db/schema/:schema/${kind}/:view/ddl`, element: <ViewDdl /> },
      { path: `db/:db/schema/:schema/${kind}/:view/edit`, element: <CreateView mode="edit" /> },
    ]),
  ],
})
