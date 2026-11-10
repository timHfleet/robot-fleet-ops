import { useCallback, useEffect, useRef, useState } from 'react'

/** Calls a Python endpoint: POST /api/<group>/<name> with JSON params. */
export async function callApi<T>(path: string, params: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params ?? {}),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error((body && body.error) || `Request failed (${res.status})`)
  return body as T
}

type HookOptions = { cachePolicy?: 'stale-while-revalidate' | 'network-only' }
type TriggerOptions = { skipCache?: boolean }

export type BackendHook<P, T> = {
  data: T | undefined
  loading: boolean
  error: string | null
  trigger: (params: P, opts?: TriggerOptions) => { result: Promise<T> }
  reset: () => void
}

const cache = new Map<string, unknown>()

/**
 * Same shape as the Retool backend hooks the pages were written against:
 * `{ data, loading, error, trigger }`, where `trigger(params).result` is a promise.
 */
export function makeHook<P, T>(path: string) {
  return function useBackend(options: HookOptions = {}): BackendHook<P, T> {
    const [data, setData] = useState<T | undefined>(undefined)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const latest = useRef(0)
    const swr = options.cachePolicy === 'stale-while-revalidate'

    const trigger = useCallback(
      (params: P, opts: TriggerOptions = {}) => {
        const id = ++latest.current
        const key = `${path}:${JSON.stringify(params ?? {})}`
        if (swr && !opts.skipCache && cache.has(key)) setData(cache.get(key) as T)
        setLoading(true)
        setError(null)
        const result = callApi<T>(path, params).then(
          (value) => {
            cache.set(key, value)
            if (id === latest.current) {
              setData(value)
              setLoading(false)
            }
            return value
          },
          (err: unknown) => {
            if (id === latest.current) {
              setError(err instanceof Error ? err.message : String(err))
              setLoading(false)
            }
            throw err
          },
        )
        // Callers that don't await shouldn't trigger unhandled-rejection noise.
        result.catch(() => {})
        return { result }
      },
      [swr],
    )

    const reset = useCallback(() => {
      setData(undefined)
      setError(null)
      setLoading(false)
    }, [])

    useEffect(() => () => void (latest.current += 1), [])

    return { data, loading, error, trigger, reset }
  }
}
