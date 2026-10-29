import { insertAfter, registerModule } from '@/modular'
import Settings from './Pages/Settings'

// The server's Settings tab where phpMyAdmin has it, after Import. The module sorts after the
// Import module, whose tab it follows.
registerModule({
  id: 'settings',
  order: 52,
  menuFilter: (menu) => insertAfter(menu, { label: 'import:tab', level: 'server' }, { label: 'settings:tab', icon: 'b_tblops', path: '/server/settings' }),
  routes: [
    { path: 'server/settings', element: <Settings /> },
    { path: 'server/settings/:page', element: <Settings /> },
  ],
})
