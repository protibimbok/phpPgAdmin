import { createSlot } from '@/slot'

/**
 * The tree in the navigation panel. No page of a module is shown while it is, so it is filled
 * from the `fills` of a registration, which the layout keeps rendered: a <ul> of tree items.
 */
export const NavigationTree = createSlot('NavigationTree')
