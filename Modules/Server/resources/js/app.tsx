import { registerModule } from '@/modular'
import Home from './Pages/Home'

// The server's home page is where "/" lands; the breadcrumb names the server on every page.
registerModule({
  id: 'server',
  routes: [{ index: true, element: <Home /> }],
})
