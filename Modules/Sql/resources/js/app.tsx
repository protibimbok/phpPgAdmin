import { insertAfter, insertBefore, registerModule } from '@/modular'
import Console from './console/Console'
import Browse from './Pages/Browse'
import Change from './Pages/Change'
import Search from './Pages/Search'
import SqlPage from './Pages/Sql'

const KINDS = ['table', 'view', 'mview'] as const

// The SQL tab follows the first tab of every level, as it does in phpMyAdmin (Databases, then
// SQL on the server; Structure, then SQL below); Browse opens a table's bar, and Search and
// Insert follow SQL. The module sorts after the ones whose tabs it slots in next to.
registerModule({
  id: 'sql',
  order: 20,
  menuFilter: (menu) => {
    const table = '/db/:db/schema/:schema/:kind/:table'
    let next = insertBefore(menu, { label: 'tables:structure.tab', level: 'table' }, { label: 'sql:browse_tab', icon: 'b_browse', path: `${table}/browse`, level: 'table' })
    next = insertAfter(next, { label: 'databases:tab' }, { label: 'sql:tab', icon: 'b_sql', path: '/server/sql' })
    next = insertAfter(next, { label: 'schemas:tab', level: 'database' }, { label: 'sql:tab', icon: 'b_sql', path: '/db/:db/sql', level: 'database' })
    next = insertAfter(next, { label: 'tables:tab', level: 'schema' }, { label: 'sql:tab', icon: 'b_sql', path: '/db/:db/schema/:schema/sql', level: 'schema' })
    next = insertAfter(next, { label: 'tables:structure.tab', level: 'table' }, { label: 'sql:tab', icon: 'b_sql', path: `${table}/sql`, level: 'table' })
    next = insertAfter(next, { label: 'sql:tab', level: 'table' }, { label: 'sql:search_tab', icon: 'b_search', path: `${table}/search`, level: 'table' })
    next = insertAfter(next, { label: 'sql:search_tab', level: 'table' }, { label: 'sql:insert_tab', icon: 'b_insrow', path: `${table}/insert`, level: 'table' })

    return next
  },
  routes: [
    { path: 'server/sql', element: <SqlPage /> },
    { path: 'db/:db/sql', element: <SqlPage /> },
    { path: 'db/:db/schema/:schema/sql', element: <SqlPage /> },
    ...KINDS.flatMap((kind) => [
      { path: `db/:db/schema/:schema/${kind}/:table/browse`, element: <Browse /> },
      { path: `db/:db/schema/:schema/${kind}/:table/sql`, element: <SqlPage /> },
      { path: `db/:db/schema/:schema/${kind}/:table/search`, element: <Search /> },
      { path: `db/:db/schema/:schema/${kind}/:table/insert`, element: <Change /> },
      { path: `db/:db/schema/:schema/${kind}/:table/change`, element: <Change /> },
    ]),
  ],
  // The console sits at the bottom of every page.
  fills: <Console />,
})
