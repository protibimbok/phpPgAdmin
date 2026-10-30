import { insertAfter, insertBefore, registerModule } from '@/modular'
import Export from './Pages/Export'
import './preferences'

const KINDS = ['table', 'view', 'mview'] as const

// The Export tab where phpMyAdmin has it on every level: after User accounts on the server
// (here after Tablespaces, which follows Roles), before Operations on a database and a schema,
// and after Insert on a table. The module sorts after the ones whose tabs it slots in next to.
registerModule({
  id: 'export',
  order: 50,
  menuFilter: (menu) => {
    let next = insertAfter(menu, { label: 'roles:tablespaces.tab' }, { label: 'export:tab', icon: 'b_export', path: '/server/export' })
    next = insertBefore(next, { label: 'databases:operations.tab', level: 'database' }, { label: 'export:tab', icon: 'b_export', path: '/db/:db/export', level: 'database' })
    next = insertBefore(next, { label: 'schemas:operations.tab', level: 'schema' }, { label: 'export:tab', icon: 'b_export', path: '/db/:db/schema/:schema/export', level: 'schema' })

    return insertAfter(next, { label: 'sql:insert_tab', level: 'table' }, { label: 'export:tab', icon: 'b_tblexport', path: '/db/:db/schema/:schema/:kind/:table/export', level: 'table' })
  },
  routes: [
    { path: 'server/export', element: <Export scope="server" /> },
    // A query's rows, from the SQL page's "Export" link or a grid's "With selected: Export".
    { path: 'server/export/query', element: <Export scope="query" /> },
    { path: 'db/:db/export/query', element: <Export scope="query" /> },
    { path: 'db/:db/export', element: <Export scope="database" /> },
    { path: 'db/:db/schema/:schema/export', element: <Export scope="schema" /> },
    ...KINDS.map((kind) => ({ path: `db/:db/schema/:schema/${kind}/:table/export`, element: <Export scope="table" /> })),
  ],
})
