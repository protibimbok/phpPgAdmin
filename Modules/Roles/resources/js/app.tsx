import { insertAfter, insertBefore, registerModule } from '@/modular'
import AddRole from './Pages/AddRole'
import EditRole from './Pages/EditRole'
import EditTablespace from './Pages/EditTablespace'
import Privileges from './Pages/Privileges'
import Roles from './Pages/Roles'
import Tablespaces from './Pages/Tablespaces'

const KINDS = ['table', 'view', 'mview'] as const

// The server's "Roles" tab where phpMyAdmin has "User accounts" and "Tablespaces" after it, and a
// "Privileges" tab where phpMyAdmin has one: after Operations on a database and a schema, before
// it on a relation.
registerModule({
  id: 'roles',
  order: 40,
  menuFilter: (menu) => {
    const relation = '/db/:db/schema/:schema/:kind/:table'
    let next = insertAfter(menu, { label: 'sql:tab' }, { label: 'roles:tab', icon: 's_rights', path: '/server/roles' })
    next = insertAfter(next, { label: 'roles:tab' }, { label: 'roles:tablespaces.tab', icon: 'b_tblops', path: '/server/tablespaces' })
    next = insertAfter(next, { label: 'databases:operations.tab', level: 'database' }, { label: 'roles:privileges.tab', icon: 's_rights', path: '/db/:db/privileges', level: 'database' })
    next = insertAfter(next, { label: 'schemas:operations.tab', level: 'schema' }, { label: 'roles:privileges.tab', icon: 's_rights', path: '/db/:db/schema/:schema/privileges', level: 'schema' })
    next = insertBefore(next, { label: 'tables:operations.tab', level: 'table' }, { label: 'roles:privileges.tab', icon: 's_rights', path: `${relation}/privileges`, level: 'table' })

    return next
  },
  routes: [
    { path: 'server/roles', element: <Roles /> },
    { path: 'server/roles/create', element: <AddRole /> },
    { path: 'server/roles/:role/edit', element: <EditRole /> },
    { path: 'server/tablespaces', element: <Tablespaces /> },
    { path: 'server/tablespaces/:tablespace/edit', element: <EditTablespace /> },
    { path: 'db/:db/privileges', element: <Privileges /> },
    { path: 'db/:db/schema/:schema/privileges', element: <Privileges /> },
    ...KINDS.map((kind) => ({ path: `db/:db/schema/:schema/${kind}/:table/privileges`, element: <Privileges /> })),
  ],
})
