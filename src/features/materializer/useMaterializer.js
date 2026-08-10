import { useCallback, useEffect, useRef, useState } from 'react'
import { materializeSessions } from './materialize'

/**
 * Keeps the two-week window filled. Runs once automatically per center so it
 * never depends on someone remembering, and exposes `run` for the button.
 */
export function useMaterializer(centerId, onDone) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const autoRanFor = useRef(null)

  // onDone is a refetch; keeping it in a ref stops an unstable callback from
  // re-triggering the automatic run.
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  }, [onDone])

  const run = useCallback(
    async (options) => {
      if (!centerId) return null
      setRunning(true)
      const { error, result } = await materializeSessions(centerId, options)
      setRunning(false)

      if (error) {
        setError(error)
        return null
      }
      setError(null)
      setResult(result)
      if (result.created || result.updated || result.removed) await doneRef.current?.()
      return result
    },
    [centerId],
  )

  useEffect(() => {
    if (!centerId || autoRanFor.current === centerId) return
    autoRanFor.current = centerId
    run()
  }, [centerId, run])

  return { running, result, error, run, dismiss: () => setResult(null) }
}
