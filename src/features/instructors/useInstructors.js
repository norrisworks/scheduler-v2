import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  INSTRUCTOR_COLUMNS,
  loadTiers,
  mergeTiers,
  saveTier,
  splitTierPatch,
} from './tierAccess'

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

    // tier is column-revoked, so the select names its columns and the tier
    // values come from the admin-only view (empty for instructor sessions).
    const [instRes, tiers] = await Promise.all([
      supabase
        .from('instructors')
        .select(INSTRUCTOR_COLUMNS)
        .eq('center_id', centerId)
        .order('name'),
      loadTiers().catch(() => new Map()),
    ])

    if (token !== requestRef.current) return
    if (instRes.error) {
      setError(instRes.error.message)
      setLoading(false)
      return
    }

    setSnapshot({ centerId, instructors: mergeTiers(instRes.data ?? EMPTY, tiers) })
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
        // tier cannot ride along on the insert — the column grant excludes
        // it — so the row is created first and tier set through the RPC.
        const { tier, rest } = splitTierPatch(values)
        const { data, error } = await supabase
          .from('instructors')
          .insert({ ...rest, center_id: centerId })
          .select('id')
          .single()
        if (error || !tier) return { error }
        return saveTier(data.id, tier)
      }),
    [run, centerId],
  )

  const updateInstructor = useCallback(
    (id, patch) =>
      run(async () => {
        const { tier, rest } = splitTierPatch(patch)
        if (Object.keys(rest).length > 0) {
          const { error } = await supabase.from('instructors').update(rest).eq('id', id)
          if (error) return { error }
        }
        return tier ? saveTier(id, tier) : { error: null }
      }),
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
