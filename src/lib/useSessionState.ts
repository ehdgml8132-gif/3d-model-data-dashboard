import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'

// Keep the active BIM workspace in memory for this page. Saved projects are
// persisted separately by the project manager.
const sessionValues = new Map<string, unknown>()

export function useSessionState<T>(
  key: string,
  initialValue: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (sessionValues.has(key)) return sessionValues.get(key) as T
    const initial = typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue
    sessionValues.set(key, initial)
    return initial
  })
  const current = useRef(value)
  const setSessionValue = useCallback<Dispatch<SetStateAction<T>>>(
    (action) => {
      const next =
        typeof action === 'function' ? (action as (previous: T) => T)(current.current) : action
      current.current = next
      sessionValues.set(key, next)
      setValue(next)
    },
    [key],
  )
  return [value, setSessionValue]
}
