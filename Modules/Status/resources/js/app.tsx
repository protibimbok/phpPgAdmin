import { insertBefore, registerModule } from '@/modular'
import Monitor from './Pages/Monitor'
import Processes from './Pages/Processes'
import ServerStatus from './Pages/ServerStatus'

// The server's "Status" tab where phpMyAdmin has it: after SQL, before the Roles tab (its User
// accounts), so the module sorts after Roles.
registerModule({
  id: 'status',
  order: 45,
  menuFilter: (menu) => insertBefore(menu, { label: 'roles:tab' }, { label: 'status:tab', icon: 's_status', path: '/server/status' }),
  routes: [
    { path: 'server/status', element: <ServerStatus /> },
    { path: 'server/status/processes', element: <Processes /> },
    { path: 'server/status/monitor', element: <Monitor /> },
  ],
})
