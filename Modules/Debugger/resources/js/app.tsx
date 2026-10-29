import { registerModule } from '@/modular'
import Debugger from './Pages/Debugger'

// A routine's debugger, reached from the routine editor's Debug button.
registerModule({
  id: 'debugger',
  order: 55,
  routes: [{ path: 'db/:db/schema/:schema/routines/:kind/:oid/debug', element: <Debugger /> }],
})
