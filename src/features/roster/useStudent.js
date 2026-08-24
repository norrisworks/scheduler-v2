import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { todayISO } from '../../lib/dates'

const EMPTY = []

/**
 * One student's full record: attributes, recurring slot templates, and notes.
 * Every mutation refetches only what it touched.
 */
export function useStudent(studentId) {
  const { user } = useAuth()
  const [snapshot, setSnapshot] = useState({ id: null, student: null, slots: EMPTY, notes: EMPTY })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    if (!studentId) {
      setSnapshot({ id: null, student: null, slots: EMPTY, notes: EMPTY })
      setLoading(false)
      return
    }
    const token = ++requestRef.current
    setLoading(true)

    const [studentRes, slotRes, noteRes, authorRes] = await Promise.all([
      supabase.from('students').select('*').eq('id', studentId).single(),
      supabase
        .from('recurring_slots')
        .select('*')
        .eq('student_id', studentId)
        .order('day_of_week')
        .order('start_time'),
      supabase
        .from('student_notes')
        .select('*')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false }),
      // id -> email for the handful of staff accounts, so a note can say who
      // wrote it. Non-fatal: a failure just leaves notes authorless.
      supabase.from('note_authors').select('id, email'),
    ])

    if (token !== requestRef.current) return

    const failure = studentRes.error || slotRes.error || noteRes.error
    if (failure) {
      setError(failure.message)
      setLoading(false)
      return
    }

    const authorById = new Map((authorRes.data ?? []).map((a) => [a.id, a.email]))
    setSnapshot({
      id: studentId,
      student: studentRes.data,
      slots: slotRes.data ?? EMPTY,
      notes: (noteRes.data ?? EMPTY).map((n) => ({
        ...n,
        author_email: authorById.get(n.author_id) ?? null,
      })),
    })
    setError(null)
    setLoading(false)
  }, [studentId])

  useEffect(() => {
    load()
  }, [load])

  const isCurrent = snapshot.id === studentId

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

  const updateStudent = useCallback(
    (patch) =>
      run(() =>
        supabase
          .from('students')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('id', studentId),
      ),
    [run, studentId],
  )

  const addSlot = useCallback(
    (slot) => run(() => supabase.from('recurring_slots').insert({ ...slot, student_id: studentId })),
    [run, studentId],
  )

  const updateSlot = useCallback(
    (id, patch) => run(() => supabase.from('recurring_slots').update(patch).eq('id', id)),
    [run],
  )

  /**
   * Deleting a slot leaves its future CANCELLED sessions behind as orphans
   * (the FK is ON DELETE SET NULL), and a cancelled row blocks its exact
   * (date, time) from ever being materialized again — the poisoned-slot bug.
   * The materializer now reclaims such orphans when a new slot lands on them,
   * but offering the cleanup at delete time keeps them out of the cancelled
   * strip entirely. The count query MUST run before the delete: afterwards
   * the link is already null.
   */
  const futureCancelledCount = useCallback(async (id) => {
    const { count, error } = await supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('recurring_slot_id', id)
      .eq('status', 'cancelled')
      .gte('date', todayISO())
    return error ? 0 : (count ?? 0)
  }, [])

  const deleteSlot = useCallback(
    (id, { alsoCancelled = false } = {}) =>
      run(async () => {
        if (alsoCancelled) {
          const { error } = await supabase
            .from('sessions')
            .delete()
            .eq('recurring_slot_id', id)
            .eq('status', 'cancelled')
            .gte('date', todayISO())
          if (error) return { error }
        }
        return supabase.from('recurring_slots').delete().eq('id', id)
      }),
    [run],
  )

  const addNote = useCallback(
    (note) =>
      run(() =>
        supabase
          .from('student_notes')
          .insert({ ...note, student_id: studentId, author_id: user?.id ?? null }),
      ),
    [run, studentId, user],
  )

  const updateNote = useCallback(
    (id, patch) =>
      run(() =>
        supabase
          .from('student_notes')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('id', id),
      ),
    [run],
  )

  const deleteNote = useCallback(
    (id) => run(() => supabase.from('student_notes').delete().eq('id', id)),
    [run],
  )

  return {
    student: isCurrent ? snapshot.student : null,
    slots: isCurrent ? snapshot.slots : EMPTY,
    notes: isCurrent ? snapshot.notes : EMPTY,
    loading: loading || !isCurrent,
    saving,
    error,
    refetch: load,
    updateStudent,
    addSlot,
    updateSlot,
    deleteSlot,
    futureCancelledCount,
    addNote,
    updateNote,
    deleteNote,
    dismissError: () => setError(null),
  }
}
