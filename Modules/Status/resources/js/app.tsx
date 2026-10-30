import { insertAfter, insertBefore, registerModule } from '@/modular'
import Counters from './Pages/Counters'
import Jobs from './Pages/Jobs'
import Locks from './Pages/Locks'
import Logs from './Pages/Logs'
import Monitor from './Pages/Monitor'
import Prepared from './Pages/Prepared'
import Processes from './Pages/Processes'
import Queries from './Pages/Queries'
import ServerStatus from './Pages/ServerStatus'
import Variables from './Pages/Variables'

// The server's "Status" tab where phpMyAdmin has it: after SQL, before the Roles tab (its User
// accounts), so the module sorts after Roles; "Variables" after the tabs that phpMyAdmin puts
// before its own (Export and the rest place themselves after Tablespaces too, ahead of it).
registerModule({
  id: 'status',
  order: 45,
  menuFilter: (menu) => {
    const next = insertBefore(menu, { label: 'roles:tab' }, { label: 'status:tab', icon: 's_status', path: '/server/status' })

    const withVariables = insertAfter(next, { label: 'roles:tablespaces.tab' }, { label: 'status:variables.tab', icon: 's_vars', path: '/server/variables' })

    // A database's sessions and locks, as the classic phpPgAdmin's database Processes tab.
    return insertAfter(withVariables, { label: 'roles:privileges.tab', level: 'database' }, { label: 'status:nav.processes', icon: 's_status', path: '/db/:db/processes', level: 'database' })
  },
  routes: [
    { path: 'server/status', element: <ServerStatus /> },
    { path: 'server/status/processes', element: <Processes /> },
    { path: 'server/status/queries', element: <Queries /> },
    { path: 'server/status/counters', element: <Counters /> },
    { path: 'server/status/locks', element: <Locks /> },
    { path: 'server/status/prepared', element: <Prepared /> },
    { path: 'server/status/monitor', element: <Monitor /> },
    { path: 'server/status/logs', element: <Logs /> },
    { path: 'server/status/jobs', element: <Jobs /> },
    { path: 'server/variables', element: <Variables /> },
    { path: 'db/:db/processes', element: <Processes /> },
    { path: 'db/:db/locks', element: <Locks /> },
  ],
})
