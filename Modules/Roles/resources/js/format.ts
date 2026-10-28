import type { Grant } from './api'

/** The privileges as one line: ALL PRIVILEGES when the grantee holds everything the object accepts. */
export function privilegeList(grants: Grant[], allowed: string[]): string {
  const held = grants.map((g) => g.privilege)

  return allowed.length > 1 && allowed.every((p) => held.includes(p)) ? 'ALL PRIVILEGES' : allowed.filter((p) => held.includes(p)).join(', ')
}

/** "Yes" when every privilege held may be granted on, "No" when none may, else the ones that may. */
export function grantSummary(grants: Grant[], yes: string, no: string): string {
  const grantable = grants.filter((g) => g.with_grant)
  if (grantable.length === 0) return no

  return grantable.length === grants.length ? yes : grantable.map((g) => g.privilege).join(', ')
}
