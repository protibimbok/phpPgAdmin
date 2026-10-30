/**
 * The error body the API's JSON strategy sends: an HTTP exception, or a PostgreSQL error with
 * the fields the server reported.
 */
export interface ApiErrorBody {
  status_code?: number
  reason_phrase?: string
  message?: string
  sqlstate?: string
  detail?: string
  hint?: string
  position?: number
  remedy?: ApiRemedy
}

/**
 * Something the client may offer to do about a failure: a statement to run on the server
 * before trying again, named by its action. The other fields depend on the action.
 */
export interface ApiRemedy {
  action: string
  sql: string
  [field: string]: unknown
}

/** A failed API call, with what the server said about it. */
export class ApiError extends Error {
  readonly status: number
  readonly sqlstate: string | undefined
  readonly detail: string | undefined
  readonly hint: string | undefined
  /** 1-based character offset into the statement the server rejected, when it reported one. */
  readonly position: number | undefined
  /** What the server suggests doing about it, when it suggests anything. */
  readonly remedy: ApiRemedy | undefined

  constructor(status: number, body: ApiErrorBody, fallback: string) {
    super(body.message || body.reason_phrase || fallback)
    this.name = 'ApiError'
    this.status = status
    this.sqlstate = body.sqlstate
    this.detail = body.detail
    this.hint = body.hint
    this.position = body.position
    this.remedy = body.remedy
  }

  /** The session is gone: the caller should show the login page again. */
  get unauthorized(): boolean {
    return this.status === 401
  }
}

/** What to do when a request comes back 401; set by the app while someone is signed in. */
let unauthorizedHandler: (() => void) | null = null

/**
 * Register what happens when the session turns out to be gone (any request answered 401), or
 * clear it with null. Only the signed-in app sets one, so the login page's own 401s (a rejected
 * password, /api/auth/me before signing in) stay with their callers.
 */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

/**
 * Report a 401 met outside request(): a download posted into a frame, a fetch that reads
 * something other than JSON. The signed-in app then shows the login page, as for any call.
 */
export function reportUnauthorized(error: ApiError): void {
  if (error.unauthorized) unauthorizedHandler?.()
}

/**
 * Call the API and return its JSON. A body is sent as JSON; a failure throws an ApiError
 * carrying the server's message and error fields.
 */
export async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody
    const error = new ApiError(response.status, body, response.statusText || `Request failed (${response.status})`)
    reportUnauthorized(error)
    throw error
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

/** Shorthands that encode the body. */
export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) => request<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(url: string, body?: unknown) => request<T>(url, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(url: string, body?: unknown) => request<T>(url, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
}

/**
 * The message to show for a failure of any kind. A PostgreSQL error keeps the server's DETAIL
 * and HINT on lines of their own under the message, labelled as psql labels them, so the
 * whole server error is shown the way phpMyAdmin shows MySQL's.
 */
export function errorMessage(error: unknown, fallback = 'Request failed'): string {
  if (error instanceof ApiError && error.sqlstate) {
    return [error.message || fallback, error.detail && `DETAIL:  ${error.detail}`, error.hint && `HINT:  ${error.hint}`].filter(Boolean).join('\n')
  }
  if (error instanceof Error) return error.message || fallback
  return typeof error === 'string' && error !== '' ? error : fallback
}
