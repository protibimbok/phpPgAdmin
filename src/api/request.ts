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
}

/** A failed API call, with what the server said about it. */
export class ApiError extends Error {
  readonly status: number
  readonly sqlstate: string | undefined
  readonly detail: string | undefined
  readonly hint: string | undefined
  /** 1-based character offset into the statement the server rejected, when it reported one. */
  readonly position: number | undefined

  constructor(status: number, body: ApiErrorBody, fallback: string) {
    super(body.message || body.reason_phrase || fallback)
    this.name = 'ApiError'
    this.status = status
    this.sqlstate = body.sqlstate
    this.detail = body.detail
    this.hint = body.hint
    this.position = body.position
  }

  /** The session is gone: the caller should show the login page again. */
  get unauthorized(): boolean {
    return this.status === 401
  }
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
    throw new ApiError(response.status, body, response.statusText || `Request failed (${response.status})`)
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

/** The message to show for a failure of any kind. */
export function errorMessage(error: unknown, fallback = 'Request failed'): string {
  if (error instanceof Error) return error.message || fallback
  return typeof error === 'string' && error !== '' ? error : fallback
}
