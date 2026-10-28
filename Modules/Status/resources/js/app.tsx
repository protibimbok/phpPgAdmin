import { insertAfter, insertBefore, registerModule } from '@/modular'
import Locks from './Pages/Locks'
import Monitor from './Pages/Monitor'
import Prepared from './Pages/Prepared'
import Processes from './Pages/Processes'
import ServerStatus from './Pages/ServerStatus'
import Variables from './Pages/Variables'

// The server's "Status" tab where phpMyAdmin has it: after SQL, before the Roles tab (its User
// accounts), so the module sorts after Roles; "Variables" after the tabs that phpMyAdmin puts
// before its own (Tablespaces stands in for Export, Import and Settings until they are built).
registerModule({
  id: 'status',
  order: 45,
  menuFilter: (menu) => {
    const next = insertBefore(menu, { label: 'roles:tab' }, { label: 'status:tab', icon: 's_status', path: '/server/status' })

    return insertAfter(next, { label: 'roles:tablespaces.tab' }, { label: 'status:variables.tab', icon: 's_vars', path: '/server/variables' })
  },
  routes: [
    { path: 'server/status', element: <ServerStatus /> },
    { path: 'server/status/processes', element: <Processes /> },
    { path: 'server/status/locks', element: <Locks /> },
    { path: 'server/status/prepared', element: <Prepared /> },
    { path: 'server/status/monitor', element: <Monitor /> },
    { path: 'server/variables', element: <Variables /> },
  ],
})
