import { insertAfter, registerModule } from '@/modular'
import Designer from './Pages/Designer'

// The database's Designer tab, phpMyAdmin's, after Schema diff. The module sorts after the
// SchemaDiff module, whose tab it follows.
registerModule({
  id: 'designer',
  order: 54,
  menuFilter: (menu) => insertAfter(menu, { label: 'schemadiff:tab', level: 'database' }, { label: 'designer:tab', icon: 'b_relations', path: '/db/:db/designer', level: 'database' }),
  routes: [{ path: 'db/:db/designer', element: <Designer /> }],
})
