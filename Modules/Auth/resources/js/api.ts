export interface User {
  username: string
}

/** The error body the API's JSON strategy sends for an HTTP exception. */
interface ApiError {
  status_code?: number
  reason_phrase?: string
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiError
    throw new Error(body.reason_phrase || response.statusText || `Request failed (${response.status})`)
  }

  return (await response.json()) as T
}

export function login(username: string, password: string): Promise<User> {
  return request<{ user: User }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }).then(({ user }) => user)
}

/** The signed-in user, or null when the session has none. */
export function me(): Promise<User | null> {
  return request<{ user: User }>('/api/auth/me')
    .then(({ user }) => user)
    .catch(() => null)
}

export function logout(): Promise<void> {
  return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }).then(() => undefined)
}
