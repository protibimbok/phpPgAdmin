import { insertAfter, registerModule } from '@/modular'
import Search from './Pages/Search'

// The Search tab where phpMyAdmin has it on a database, after SQL. The module sorts after the
// SQL module, whose tab it follows.
registerModule({
  id: 'search',
  order: 21,
  menuFilter: (menu) => insertAfter(menu, { label: 'sql:tab', level: 'database' }, { label: 'search:tab', icon: 'b_search', path: '/db/:db/search', level: 'database' }),
  routes: [{ path: 'db/:db/search', element: <Search /> }],
})
