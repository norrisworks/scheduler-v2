import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

const EMPTY = []

/**
 * Instructors for one center, including inactive ones — deactivating is how
 * staff leave, and their assignment history has to stay reachable.
 * Scoped like every other list: rows are held with the center they were
 * loaded for and withheld during render if that no longer matches.
 */
export function useInstructors(centerId) {
  const [snapshot, setSnapshot] = useState({ centerId: null, instructors: EMPTY })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    if (!centerId) return
    const token = ++requestRef.current
    setLoading(true)

    const { data, error } = await supabase
      .from('instructors')
      .select('*')
      .eq('center_id', centerId)
      .order('name')

    if (token !== requestRef.current) return
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSnapshot({ centerId, instructors: data ?? EMPTY })
    setError(null)
    setLoading(false)
  }, [centerId])

  useEffect(() => {
    load()
  }, [load])

  const isCurrent = snapshot.centerId === centerId

  const run = useCallback(
    async (fn) => {
      setSaving(true)
      const { error } = await fn()
      if (error) setError(error.message)
      else await load()
      setSaving(false)
      return !error
    },
    [load],
  )

  const createInstructor = useCallback(
    (values) => run(() => supabase.from('instructors').insert({ ...values, center_id: centerId })),
    [run, centerId],
  )

  const updateInstructor = useCallback(
    (id, patch) => run(() => supabase.from('instructors').update(patch).eq('id', id)),
    [run],
  )

  return {
    instructors: isCurrent ? snapshot.instructors : EMPTY,
    loading: loading || !isCurrent,
    saving,
    error,
    refetch: load,
    createInstructor,
    updateInstructor,
    dismissError: () => setError(null),
  }
}
