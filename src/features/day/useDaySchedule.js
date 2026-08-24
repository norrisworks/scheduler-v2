import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { INSTRUCTOR_COLUMNS } from '../instructors/rankAccess'

// binder_note is deliberately NOT selected: cards show a done/not-done tick
// only. binder_status now rides on the STUDENT, because binder prep persists
// until the binder is used rather than expiring with one session.
const SESSION_SELECT = `
  id, center_id, student_id, date, start_time, duration, status, source, notes, is_modified, delivery_method, last_seen_in_radius,
  student:students ( id, name, grade, level, gender, first_day,
                     needs_schoolwork, slot_certainty, academic_status,
                     enrollment_start_date, binder_status ),
  assignments ( id, instructor_id, source )
`

const EMPTY = []

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

const scopeKey = (centerId, date) => `${centerId ?? ''}|${date ?? ''}`

/**
 * Everything the day view needs for one center on one date, plus the
 * mutations that view performs. Assignment writes are optimistic so a drop
 * lands instantly; the server result reconciles on the next refetch.
 *
 * Data is stored together with the (center, date) it was loaded for and is
 * withheld during render whenever that no longer matches what the caller is
 * asking for. That makes it impossible for one center's sessions to paint
 * under another's header even for a frame, without needing the whole view to
 * be remounted — which is what used to throw away the selected date.
 */
export function useDaySchedule(centerId, date) {
  const [snapshot, setSnapshot] = useState({
    key: null,
    sessions: EMPTY,
    instructors: EMPTY,
    shifts: EMPTY,
    pinnedNotes: EMPTY,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const key = scopeKey(centerId, date)
  const isCurrent = snapshot.key === key

  // Guards against a slow response for a previous date/center overwriting the
  // current one when the user clicks through days quickly.
  const requestRef = useRef(0)

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!centerId || !date) return
      const token = ++requestRef.current
      const requestKey = scopeKey(centerId, date)
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
          // Explicit columns: tier is column-revoked, and a '*' here would
          // fail for every role. Nothing on the day view needs tier.
          .select(INSTRUCTOR_COLUMNS)
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
      const studentIds = [...new Set(daySessions.map((s) => s.student_id).filter(Boolean))]

      let pinnedNotes = EMPTY
      if (studentIds.length) {
        const { data, error } = await supabase
          .from('student_notes')
          .select('id, student_id, note_type, body')
          .eq('pinned', true)
          .eq('resolved', false)
          .in('student_id', studentIds)
        if (token !== requestRef.current) return
        if (error) setError(error.message)
        pinnedNotes = data ?? EMPTY
      }

      setSnapshot({
        key: requestKey,
        sessions: daySessions,
        instructors: instructorRes.data ?? EMPTY,
        shifts: shiftRes.data ?? EMPTY,
        pinnedNotes,
      })
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
      // Binder state lives on the student now, so the card's prep tick only
      // stays live if student updates reach this channel too.
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'students', filter: `center_id=eq.${centerId}` },
        nudge,
      )
      .subscribe()

    return () => {
      clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [centerId, date, load])

  // Optimistic edits only ever touch the snapshot they were issued against.
  const patchSession = useCallback((requestKey, sessionId, patch) => {
    setSnapshot((prev) => {
      if (prev.key !== requestKey) return prev
      return {
        ...prev,
        sessions: prev.sessions.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)),
      }
    })
  }, [])

  const sessions = isCurrent ? snapshot.sessions : EMPTY

  const assign = useCallback(
    async (sessionId, instructorId) => {
      const session = sessions.find((s) => s.id === sessionId)
      const previous = session?.instructor_id ?? null
      if (previous === instructorId) return
      patchSession(key, sessionId, { instructor_id: instructorId })

      const { error } = await supabase
        .from('assignments')
        .upsert(
          { session_id: sessionId, instructor_id: instructorId, source: 'manual' },
          { onConflict: 'session_id' },
        )

      if (error) {
        patchSession(key, sessionId, { instructor_id: previous })
        setError(error.message)
        return
      }

      // Replacing an auto-assigned instructor by hand is a signal about the
      // ranking. Recorded silently — never a dialog, never a prompt, because
      // this happens mid-session on the floor. It only ever resurfaces as a
      // small count on a rankings matrix cell.
      if (previous && session?.assignment?.source === 'auto' && centerId) {
        await supabase.from('assignment_overrides').insert({
          center_id: centerId,
          student_id: session.student_id,
          instructor_id: instructorId,
          previous_instructor_id: previous,
          session_id: sessionId,
        })
      }
    },
    [sessions, key, patchSession, centerId],
  )

  const unassign = useCallback(
    async (sessionId) => {
      const previous = sessions.find((s) => s.id === sessionId)?.instructor_id ?? null
      patchSession(key, sessionId, { instructor_id: null })

      const { error } = await supabase.from('assignments').delete().eq('session_id', sessionId)
      if (error) {
        patchSession(key, sessionId, { instructor_id: previous })
        setError(error.message)
      }
    },
    [sessions, key, patchSession],
  )

  /**
   * In-center <-> online, from the card menu. Radius normally owns this via
   * the import; the manual toggle exists for sessions with no Radius row —
   * materialized standing slots default to in_center and someone has to be
   * able to say otherwise. is_modified for the same reason as setStatus: a
   * hand-edited row must survive re-materialization.
   */
  const setDelivery = useCallback(
    async (sessionId, deliveryMethod) => {
      const previous = sessions.find((s) => s.id === sessionId)?.delivery_method
      patchSession(key, sessionId, { delivery_method: deliveryMethod, is_modified: true })

      const { error } = await supabase
        .from('sessions')
        .update({
          delivery_method: deliveryMethod,
          is_modified: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId)

      if (error) {
        patchSession(key, sessionId, { delivery_method: previous })
        setError(error.message)
      }
    },
    [sessions, key, patchSession],
  )

  const setStatus = useCallback(
    async (sessionId, status) => {
      const previous = sessions.find((s) => s.id === sessionId)?.status
      patchSession(key, sessionId, { status, is_modified: true })

      // is_modified marks this row as hand-edited so re-materializing the
      // recurring slot leaves it alone (Google Calendar semantics).
      const { error } = await supabase
        .from('sessions')
        .update({ status, is_modified: true, updated_at: new Date().toISOString() })
        .eq('id', sessionId)

      if (error) {
        patchSession(key, sessionId, { status: previous })
        setError(error.message)
      }
    },
    [sessions, key, patchSession],
  )

  const shifts = isCurrent ? snapshot.shifts : EMPTY

  const shiftByInstructor = useMemo(() => {
    const map = new Map()
    for (const shift of shifts) map.set(shift.instructor_id, shift)
    return map
  }, [shifts])

  const notesByStudent = useMemo(() => {
    const map = new Map()
    if (!isCurrent) return map
    for (const note of snapshot.pinnedNotes) {
      const list = map.get(note.student_id)
      if (list) list.push(note)
      else map.set(note.student_id, [note])
    }
    return map
  }, [snapshot.pinnedNotes, isCurrent])

  return {
    sessions,
    instructors: isCurrent ? snapshot.instructors : EMPTY,
    shifts,
    shiftByInstructor,
    notesByStudent,
    // A stale scope reads as loading — the caller never sees another
    // center's data, and never sees an empty day it might mistake for real.
    loading: loading || !isCurrent,
    error,
    refetch: load,
    assign,
    unassign,
    setStatus,
    setDelivery,
    dismissError: () => setError(null),
  }
}
