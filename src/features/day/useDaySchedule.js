import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

const SESSION_SELECT = `
  id, student_id, date, start_time, duration, status, source, notes, is_modified,
  student:students ( id, name, grade, level, performance, gender, first_day,
                     needs_schoolwork, slot_certainty, academic_status ),
  assignments ( id, instructor_id )
`

// PostgREST returns an embedded row as an object or an array depending on how
// it reads the constraint; assignments.session_id is unique, so either way
// there is at most one.
function firstOf(embedded) {
  if (!embedded) return null
  return Array.isArray(embedded) ? (embedded[0] ?? null) : embedded
}

function normalizeSession(row) {
  const assignment = firstOf(row.assignments)
  return {
    ...row,
    assignments: undefined,
    assignment,
    instructor_id: assignment?.instructor_id ?? null,
  }
}

/**
 * Everything the day view needs for one center on one date, plus the
 * mutations that view performs. Assignment writes are optimistic so a drop
 * lands instantly; the server result reconciles on the next refetch.
 */
export function useDaySchedule(centerId, date) {
  const [sessions, setSessions] = useState([])
  const [instructors, setInstructors] = useState([])
  const [shifts, setShifts] = useState([])
  const [pinnedNotes, setPinnedNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Guards against a slow response for a previous date/center overwriting the
  // current one when the user clicks through days quickly.
  const requestRef = useRef(0)

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!centerId || !date) return
      const token = ++requestRef.current
      if (!quiet) setLoading(true)

      const [sessionRes, instructorRes, shiftRes] = await Promise.all([
        supabase
          .from('sessions')
          .select(SESSION_SELECT)
          .eq('center_id', centerId)
          .eq('date', date)
          .order('start_time'),
        supabase
          .from('instructors')
          .select('*')
          .eq('center_id', centerId)
          .eq('active', true)
          .order('name'),
        supabase.from('instructor_shifts').select('*').eq('center_id', centerId).eq('date', date),
      ])

      if (token !== requestRef.current) return

      const failure = sessionRes.error || instructorRes.error || shiftRes.error
      if (failure) {
        setError(failure.message)
        setLoading(false)
        return
      }

      const daySessions = (sessionRes.data ?? []).map(normalizeSession)
      setSessions(daySessions)
      setInstructors(instructorRes.data ?? [])
      setShifts(shiftRes.data ?? [])

      const studentIds = [...new Set(daySessions.map((s) => s.student_id).filter(Boolean))]
      if (studentIds.length) {
        const { data, error } = await supabase
          .from('student_notes')
          .select('id, student_id, note_type, body')
          .eq('pinned', true)
          .eq('resolved', false)
          .in('student_id', studentIds)
        if (token !== requestRef.current) return
        if (error) setError(error.message)
        setPinnedNotes(data ?? [])
      } else {
        setPinnedNotes([])
      }

      setError(null)
      setLoading(false)
    },
    [centerId, date],
  )

  useEffect(() => {
    load()
  }, [load])

  // Realtime: refetch just this day rather than reloading the app (v1 did the
  // latter). Coalesce bursts so a multi-row write is one refetch.
  useEffect(() => {
    if (!centerId || !date) return
    let timer = null
    const nudge = () => {
      clearTimeout(timer)
      timer = setTimeout(() => load({ quiet: true }), 250)
    }

    const channel = supabase
      .channel(`day:${centerId}:${date}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sessions', filter: `center_id=eq.${centerId}` },
        nudge,
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, nudge)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'instructor_shifts',
          filter: `center_id=eq.${centerId}`,
        },
        nudge,
      )
      .subscribe()

    return () => {
      clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [centerId, date, load])

  const patchSession = useCallback((sessionId, patch) => {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)))
  }, [])

  const assign = useCallback(
    async (sessionId, instructorId) => {
      const previous = sessions.find((s) => s.id === sessionId)?.instructor_id ?? null
      if (previous === instructorId) return
      patchSession(sessionId, { instructor_id: instructorId })

      const { error } = await supabase
        .from('assignments')
        .upsert({ session_id: sessionId, instructor_id: instructorId }, { onConflict: 'session_id' })

      if (error) {
        patchSession(sessionId, { instructor_id: previous })
        setError(error.message)
      }
    },
    [sessions, patchSession],
  )

  const unassign = useCallback(
    async (sessionId) => {
      const previous = sessions.find((s) => s.id === sessionId)?.instructor_id ?? null
      patchSession(sessionId, { instructor_id: null })

      const { error } = await supabase.from('assignments').delete().eq('session_id', sessionId)
      if (error) {
        patchSession(sessionId, { instructor_id: previous })
        setError(error.message)
      }
    },
    [sessions, patchSession],
  )

  const setStatus = useCallback(
    async (sessionId, status) => {
      const previous = sessions.find((s) => s.id === sessionId)?.status
      patchSession(sessionId, { status, is_modified: true })

      // is_modified marks this row as hand-edited so re-materializing the
      // recurring slot leaves it alone (Google Calendar semantics).
      const { error } = await supabase
        .from('sessions')
        .update({ status, is_modified: true, updated_at: new Date().toISOString() })
        .eq('id', sessionId)

      if (error) {
        patchSession(sessionId, { status: previous })
        setError(error.message)
      }
    },
    [sessions, patchSession],
  )

  const shiftByInstructor = useMemo(() => {
    const map = new Map()
    for (const shift of shifts) map.set(shift.instructor_id, shift)
    return map
  }, [shifts])

  const notesByStudent = useMemo(() => {
    const map = new Map()
    for (const note of pinnedNotes) {
      const list = map.get(note.student_id)
      if (list) list.push(note)
      else map.set(note.student_id, [note])
    }
    return map
  }, [pinnedNotes])

  return {
    sessions,
    instructors,
    shifts,
    shiftByInstructor,
    notesByStudent,
    loading,
    error,
    refetch: load,
    assign,
    unassign,
    setStatus,
    dismissError: () => setError(null),
  }
}
