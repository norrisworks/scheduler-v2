import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { conflictKey, findSourceConflicts } from '../day/sourceConflicts'
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
    sessions: EMPTY,
    dismissals: EMPTY,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    if (!centerId) return
    const token = ++requestRef.current
    setLoading(true)

    const [studentRes, instructorRes, rankRes, sessionRes, dismissRes] = await Promise.all([
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
      // For the duplicate-session resolver: every upcoming scheduled session
      // that could pair a radius row with a standing-slot row.
      supabase
        .from('sessions')
        .select('id, student_id, center_id, date, start_time, duration, status, source, student:students(name)')
        .eq('center_id', centerId)
        .eq('status', 'scheduled')
        .gte('date', new Date().toISOString().slice(0, 10))
        .in('source', ['radius', 'recurring']),
      supabase
        .from('session_conflict_dismissals')
        .select('student_id, date')
        .eq('center_id', centerId),
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
      sessions: sessionRes.data ?? EMPTY,
      dismissals: dismissRes.data ?? EMPTY,
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

  // Radius-vs-standing-slot duplicates across every upcoming day.
  const sourceConflicts = useMemo(() => {
    if (!isCurrent) return []
    const dismissed = new Set(
      snapshot.dismissals.map((d) => conflictKey(d.student_id, d.date)),
    )
    return findSourceConflicts(snapshot.sessions, dismissed)
  }, [snapshot.sessions, snapshot.dismissals, isCurrent])

  /**
   * Autosave patch for the instructor editor opened from a flagged row.
   * Tier goes through its admin-only RPC; everything else writes directly.
   */
  const patchInstructor = useCallback(
    async (id, patch) => {
      const { error } = await supabase.from('instructors').update(patch).eq('id', id)
      if (error) {
        setError(error.message)
        return false
      }
      await load()
      return true
    },
    [load],
  )

  return {
    checks,
    sourceConflicts,
    students,
    instructors,
    loading: loading || !isCurrent,
    error,
    refetch: load,
    patchInstructor,
  }
}
