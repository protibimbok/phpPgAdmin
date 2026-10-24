import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'

export interface RequestState<T> {
  /** Undefined until the first answer arrives; kept while reloading. */
  data: T | undefined
  error: Error | null
  /** True while a call is in flight, including the first. */
  loading: boolean
  /** Run the call again, keeping the current data until the new answer arrives. */
  reload: () => void
}

/**
 * Load something from the API when the component mounts and whenever the dependencies change.
 * An answer that arrives after a newer call started is dropped, so a quick change of page
 * never shows a stale result.
 *
 *     const { data: databases, error, loading } = useRequest(() => listDatabases(), [])
 */
export function useRequest<T>(load: () => Promise<T>, deps: DependencyList): RequestState<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [generation, setGeneration] = useState(0)
  const latest = useRef(0)

  useEffect(() => {
    const call = ++latest.current
    setLoading(true)
    setError(null)

    load().then(
      (result) => {
        if (call !== latest.current) return
        setData(result)
        setLoading(false)
      },
      (e: unknown) => {
        if (call !== latest.current) return
        setError(e instanceof Error ? e : new Error(String(e)))
        setLoading(false)
      },
    )
    // The caller's dependencies decide when to reload; the loader itself changes identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, generation])

  const reload = useCallback(() => setGeneration((g) => g + 1), [])

  return { data, error, loading, reload }
}
