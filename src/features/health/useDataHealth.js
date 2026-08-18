import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { conflictKey, findSourceConflicts, findCrossDayConflicts } from '../day/sourceConflicts'
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
    slotDayDismissals: EMPTY,
    slots: EMPTY,
    coverage: EMPTY,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    if (!centerId) return
    const token = ++requestRef.current
    setLoading(true)

    const [studentRes, instructorRes, rankRes, sessionRes, dismissRes, slotDayRes, slotRes, coverRes] = await Promise.all([
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
        .select('id, student_id, center_id, date, start_time, duration, status, source, last_seen_in_radius, student:students(name)')
        .eq('center_id', centerId)
        .eq('status', 'scheduled')
        .gte('date', new Date().toISOString().slice(0, 10))
        .in('source', ['radius', 'recurring']),
      supabase
        .from('session_conflict_dismissals')
        .select('student_id, date')
        .eq('center_id', centerId),
      supabase
        .from('session_cross_day_dismissals')
        .select('student_id, day_of_week')
        .eq('center_id', centerId),
      supabase
        .from('recurring_slots')
        .select('student_id, effective_until, students!inner(center_id)')
        .eq('students.center_id', centerId),
      // Coverage: which dates any committed Radius file actually spans.
      supabase
        .from('import_runs')
        .select('date_from, date_to')
        .eq('kind', 'radius_sessions')
        .not('date_from', 'is', null),
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
      slotDayDismissals: slotDayRes.data ?? EMPTY,
      slots: slotRes.data ?? EMPTY,
      coverage: coverRes.data ?? EMPTY,
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

  // Radius-vs-standing-slot duplicates across every upcoming day, same-day
  // and cross-day.
  const conflictSets = useMemo(() => {
    if (!isCurrent) return { sameDate: [], crossDay: [] }
    const dismissed = new Set(
      snapshot.dismissals.map((d) => conflictKey(d.student_id, d.date)),
    )
    const slotDays = new Set(
      snapshot.slotDayDismissals.map((d) => `${d.student_id}|${d.day_of_week}`),
    )
    const today = new Date().toISOString().slice(0, 10)
    const slotCounts = new Map()
    for (const slot of snapshot.slots) {
      if (slot.effective_until && slot.effective_until < today) continue
      slotCounts.set(slot.student_id, (slotCounts.get(slot.student_id) ?? 0) + 1)
    }
    return {
      sameDate: findSourceConflicts(snapshot.sessions, dismissed),
      crossDay: findCrossDayConflicts(snapshot.sessions, {
        dismissedKeys: dismissed,
        dismissedSlotDays: slotDays,
        slotCounts,
        coverage: snapshot.coverage,
      }),
    }
  }, [snapshot.sessions, snapshot.dismissals, snapshot.slotDayDismissals, snapshot.slots, snapshot.coverage, isCurrent])

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
    sourceConflicts: conflictSets.sameDate,
    crossDayConflicts: conflictSets.crossDay,
    students,
    instructors,
    loading: loading || !isCurrent,
    error,
    refetch: load,
    patchInstructor,
  }
}
