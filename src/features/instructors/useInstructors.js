import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { INSTRUCTOR_COLUMNS, loadRanks, mergeRanks, saveRankOrder } from './rankAccess'

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

    // instructor_rank carries no client grant, so the select names its
    // columns and rank values come from the admin-only view (empty for
    // instructor sessions).
    const [instRes, ranks] = await Promise.all([
      supabase
        .from('instructors')
        .select(INSTRUCTOR_COLUMNS)
        .eq('center_id', centerId)
        .order('name'),
      loadRanks().catch(() => new Map()),
    ])

    if (token !== requestRef.current) return
    if (instRes.error) {
      setError(instRes.error.message)
      setLoading(false)
      return
    }

    setSnapshot({ centerId, instructors: mergeRanks(instRes.data ?? EMPTY, ranks) })
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
    (values) =>
      run(async () => {
        const { data, error } = await supabase
          .from('instructors')
          .insert({ ...values, center_id: centerId })
          .select('id')
          .single()
        if (error) return { error }
        // A new instructor defaults to LAST in the center's rank order. The
        // RPC needs the complete order, so send everyone in their current
        // order with the new id appended.
        const ordered = [...snapshot.instructors]
          .sort((a, b) => (a.instructor_rank ?? 999) - (b.instructor_rank ?? 999))
          .map((i) => i.id)
        return saveRankOrder(centerId, [...ordered, data.id])
      }),
    [run, centerId, snapshot.instructors],
  )

  const updateInstructor = useCallback(
    (id, patch) => run(() => supabase.from('instructors').update(patch).eq('id', id)),
    [run],
  )

  /** The ranking editor's write: the whole center order, 1..N, immediately. */
  const reorderInstructors = useCallback(
    (orderedIds) =>
      run(async () => {
        // Optimistic: repaint the list in the new order before the round trip.
        setSnapshot((prev) => ({
          ...prev,
          instructors: prev.instructors.map((i) => {
            const at = orderedIds.indexOf(i.id)
            return at === -1 ? i : { ...i, instructor_rank: at + 1 }
          }),
        }))
        return saveRankOrder(centerId, orderedIds)
      }),
    [run, centerId],
  )

  return {
    instructors: isCurrent ? snapshot.instructors : EMPTY,
    loading: loading || !isCurrent,
    saving,
    error,
    refetch: load,
    createInstructor,
    updateInstructor,
    reorderInstructors,
    dismissError: () => setError(null),
  }
}
