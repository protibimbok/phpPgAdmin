import { NavigationTree } from '@/layout/NavigationTree'
import { registerModule } from '@/modular'
import DatabaseTree from './DatabaseTree'
import Databases from './Pages/Databases'

registerModule({
  id: 'databases',
  menuFilter: (menu) => [...menu, { label: 'databases:tab', icon: 's_db', path: '/server/databases' }],
  routes: [{ path: 'server/databases', element: <Databases /> }],
  // The tree is shown on every page, so it is filled from here rather than from a page.
  fills: (
    <NavigationTree.Fill>
      <DatabaseTree />
    </NavigationTree.Fill>
  ),
})
