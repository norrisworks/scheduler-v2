import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { saveTier, splitTierPatch } from '../instructors/tierAccess'
import { buildChecks } from './checks'

const EMPTY = []

/**
 * Everything that would quietly stop the schedule working, gathered in one
 * place. Each check answers "what is broken and who does it affect", not
 * "here is a number".
 */
export function useDataHealth(centerId) {
  const [snapshot, setSnapshot] = useState({
    centerId: null,
    students: EMPTY,
    instructors: EMPTY,
    rankings: EMPTY,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    if (!centerId) return
    const token = ++requestRef.current
    setLoading(true)

    const [studentRes, instructorRes, rankRes] = await Promise.all([
      supabase
        .from('students')
        .select('id, name, grade, level, gender, school, slot_certainty, academic_status, default_duration, active')
        .eq('center_id', centerId)
        .eq('active', true)
        .order('name'),
      supabase
        .from('instructors')
        // The full row, because a flagged instructor opens straight into the
        // editor from here and the form needs every field.
        .select('id, name, color, email, workstream_id, assignability, gender, can_teach_elementary, can_teach_middle, can_teach_high, active')
        .eq('center_id', centerId)
        .eq('active', true)
        .order('name'),
      supabase.from('instructor_rankings').select('student_id, instructor_id'),
    ])

    if (token !== requestRef.current) return
    const failure = studentRes.error || instructorRes.error || rankRes.error
    if (failure) {
      setError(failure.message)
      setLoading(false)
      return
    }

    setSnapshot({
      centerId,
      students: studentRes.data ?? EMPTY,
      instructors: instructorRes.data ?? EMPTY,
      rankings: rankRes.data ?? EMPTY,
    })
    setError(null)
    setLoading(false)
  }, [centerId])

  useEffect(() => {
    load()
  }, [load])

  const isCurrent = snapshot.centerId === centerId
  const students = isCurrent ? snapshot.students : EMPTY
  const instructors = isCurrent ? snapshot.instructors : EMPTY

  const checks = useMemo(
    () => buildChecks(students, instructors, isCurrent ? snapshot.rankings : EMPTY),
    [students, instructors, snapshot.rankings, isCurrent],
  )

  /**
   * Autosave patch for the instructor editor opened from a flagged row.
   * Tier goes through its admin-only RPC; everything else writes directly.
   */
  const patchInstructor = useCallback(
    async (id, patch) => {
      const { tier, rest } = splitTierPatch(patch)
      if (Object.keys(rest).length > 0) {
        const { error } = await supabase.from('instructors').update(rest).eq('id', id)
        if (error) {
          setError(error.message)
          return false
        }
      }
      if (tier) {
        const { error } = await saveTier(id, tier)
        if (error) {
          setError(error.message)
          return false
        }
      }
      await load()
      return true
    },
    [load],
  )

  return {
    checks,
    students,
    instructors,
    loading: loading || !isCurrent,
    error,
    refetch: load,
    patchInstructor,
  }
}
