import { insertAfter, registerModule } from '@/modular'
import Import from './Pages/Import'

// The Import tab where phpMyAdmin has it, after Export on the server, a database, a schema
// and a table (not a view: rows are imported into a table). The module sorts after Export,
// whose tabs it follows.
registerModule({
  id: 'import',
  order: 51,
  menuFilter: (menu) => {
    let next = insertAfter(menu, { label: 'export:tab', level: 'server' }, { label: 'import:tab', icon: 'b_import', path: '/server/import' })
    next = insertAfter(next, { label: 'export:tab', level: 'database' }, { label: 'import:tab', icon: 'b_import', path: '/db/:db/import', level: 'database' })

    next = insertAfter(next, { label: 'export:tab', level: 'schema' }, { label: 'import:tab', icon: 'b_import', path: '/db/:db/schema/:schema/import', level: 'schema' })

    return insertAfter(next, { label: 'export:tab', level: 'table' }, { label: 'import:tab', icon: 'b_tblimport', path: '/db/:db/schema/:schema/:kind/:table/import', level: 'table', kinds: ['table'] })
  },
  routes: [
    { path: 'server/import', element: <Import scope="server" /> },
    { path: 'db/:db/import', element: <Import scope="database" /> },
    { path: 'db/:db/schema/:schema/import', element: <Import scope="schema" /> },
    { path: 'db/:db/schema/:schema/table/:table/import', element: <Import scope="table" /> },
  ],
})
