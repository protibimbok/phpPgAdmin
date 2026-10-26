import { NavigationTree } from '@/layout/NavigationTree'
import { registerModule } from '@/modular'
import DatabaseTree from './DatabaseTree'
import DatabaseDdl from './Pages/DatabaseDdl'
import Databases from './Pages/Databases'
import Operations from './Pages/Operations'

registerModule({
  id: 'databases',
  // The server's "Databases" tab; the database's "Operations" and "Show create" tabs come after
  // the Structure tab the Schemas module adds, so this module sorts after it.
  order: 10,
  menuFilter: (menu) => [
    ...menu,
    { label: 'databases:tab', icon: 's_db', path: '/server/databases' },
    { label: 'databases:operations.tab', icon: 'b_tblops', path: '/db/:db/operations', level: 'database' },
    { label: 'databases:ddl.tab', icon: 'b_sql', path: '/db/:db/ddl', level: 'database' },
  ],
  routes: [
    { path: 'server/databases', element: <Databases /> },
    { path: 'db/:db/operations', element: <Operations /> },
    { path: 'db/:db/ddl', element: <DatabaseDdl /> },
  ],
  // The tree is shown on every page, so it is filled from here rather than from a page.
  fills: (
    <NavigationTree.Fill>
      <DatabaseTree />
    </NavigationTree.Fill>
  ),
})
