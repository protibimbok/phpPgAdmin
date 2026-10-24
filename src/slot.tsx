import { createContext, useContext, useState, type ComponentProps, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface SlotStore {
  target: HTMLElement | null
  setTarget: (element: HTMLElement | null) => void
}

export interface Slot {
  /** Wraps both the outlet and anything that may fill it. */
  Provider: (props: { children: ReactNode }) => ReactNode
  /** The spot the layout owns; fills are portalled here in mount order. */
  Outlet: (props: ComponentProps<'div'>) => ReactNode
  /** Rendered by a page, or by a module's `fills`, to place content into the outlet. */
  Fill: (props: { children: ReactNode }) => ReactNode
}

/** A spot in the layout that modules fill: the navigation tree, for example. */
export function createSlot(name: string): Slot {
  const SlotContext = createContext<SlotStore | null>(null)

  function useSlot(): SlotStore {
    const store = useContext(SlotContext)
    if (!store) throw new Error(`[slot] "${name}" used outside its provider`)

    return store
  }

  return {
    Provider({ children }) {
      const [target, setTarget] = useState<HTMLElement | null>(null)

      return <SlotContext.Provider value={{ target, setTarget }}>{children}</SlotContext.Provider>
    },

    Outlet(props) {
      const { setTarget } = useSlot()

      return <div ref={setTarget} {...props} />
    },

    Fill({ children }) {
      const { target } = useSlot()

      return target ? createPortal(children, target) : null
    },
  }
}
