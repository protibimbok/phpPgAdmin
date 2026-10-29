import { insertAfter, registerModule } from '@/modular'
import SchemaDiff from './Pages/SchemaDiff'

// The database's Schema diff tab, pgAdmin's tool, after Objects. The module sorts after the
// DbObjects module, whose tab it follows.
registerModule({
  id: 'schemadiff',
  order: 53,
  menuFilter: (menu) => insertAfter(menu, { label: 'dbobjects:tab', level: 'database' }, { label: 'schemadiff:tab', icon: 'b_relations', path: '/db/:db/schema-diff', level: 'database' }),
  routes: [{ path: 'db/:db/schema-diff', element: <SchemaDiff /> }],
})
