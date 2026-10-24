import { request } from '@auth/js/api'

/** What phpMyAdmin's home page reports about the server, the web server and the application. */
export interface ServerInfo {
  server: {
    host: string
    port: number
    /** True when libpq connects over a UNIX socket rather than TCP/IP. */
    socket: boolean
    type: string
    version: string
    user: string
    encoding: string
    /** Null when the server does not report it. */
    ssl: boolean | null
    database: string
  }
  web: {
    software: string | null
    client: string
    extensions: string[]
    php: string
  }
  app: {
    version: string
  }
}

export function getServerInfo(): Promise<ServerInfo> {
  return request<ServerInfo>('/api/server/info')
}
