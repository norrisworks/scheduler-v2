import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { addDays } from '../../lib/dates'
import { planCopyWeek, weekDays } from './weekShifts'

const EMPTY = []

/**
 * One week of shifts for a center, plus the instructors to render rows for.
 * Scoped like every other list: rows are held with the (center, week) they
 * were loaded for and withheld during render if that no longer matches.
 */
export function useWeekShifts(centerId, weekStart) {
  const [snapshot, setSnapshot] = useState({ key: null, shifts: EMPTY, instructors: EMPTY })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const requestRef = useRef(0)

  const scopeKey = `${centerId ?? ''}|${weekStart ?? ''}`
  const days = useMemo(() => weekDays(weekStart), [weekStart])

  const load = useCallback(async () => {
    if (!centerId || !weekStart) return
    const token = ++requestRef.current
    const requestKey = `${centerId}|${weekStart}`
    setLoading(true)

    const [shiftRes, instructorRes] = await Promise.all([
      supabase
        .from('instructor_shifts')
        .select('*')
        .eq('center_id', centerId)
        .gte('date', weekStart)
        .lte('date', addDays(weekStart, 6))
        .order('date')
        .order('start_time'),
      supabase
        .from('instructors')
        .select('*')
        .eq('center_id', centerId)
        .eq('active', true)
        .order('name'),
    ])

    if (token !== requestRef.current) return
    const failure = shiftRes.error || instructorRes.error
    if (failure) {
      setError(failure.message)
      setLoading(false)
      return
    }

    setSnapshot({
      key: requestKey,
      shifts: shiftRes.data ?? EMPTY,
      instructors: instructorRes.data ?? EMPTY,
    })
    setError(null)
    setLoading(false)
  }, [centerId, weekStart])

  useEffect(() => {
    load()
  }, [load])

  const isCurrent = snapshot.key === scopeKey

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

  const saveShift = useCallback(
    (shift) => {
      const row = {
        center_id: centerId,
        instructor_id: shift.instructor_id,
        date: shift.date,
        start_time: `${shift.start}:00`,
        end_time: `${shift.end}:00`,
        source: 'manual',
      }
      // An existing row may have had its start_time changed, which is part of
      // the unique key, so that case is an update by id rather than an upsert.
      return run(() =>
        shift.id
          ? supabase.from('instructor_shifts').update(row).eq('id', shift.id)
          : supabase.from('instructor_shifts').insert(row),
      )
    },
    [run, centerId],
  )

  /** Same-day call-out: the shift simply goes away. */
  const deleteShift = useCallback(
    (id) => run(() => supabase.from('instructor_shifts').delete().eq('id', id)),
    [run],
  )

  const clearDay = useCallback(
    (instructorId, date) =>
      run(() =>
        supabase
          .from('instructor_shifts')
          .delete()
          .eq('instructor_id', instructorId)
          .eq('date', date),
      ),
    [run],
  )

  const copyLastWeek = useCallback(async () => {
    if (!centerId || !weekStart) return null
    const previousStart = addDays(weekStart, -7)

    setSaving(true)
    const { data, error } = await supabase
      .from('instructor_shifts')
      .select('*')
      .eq('center_id', centerId)
      .gte('date', previousStart)
      .lte('date', addDays(previousStart, 6))

    if (error) {
      setError(error.message)
      setSaving(false)
      return null
    }

    const { rows, skipped } = planCopyWeek(data ?? [], isCurrent ? snapshot.shifts : [])
    if (rows.length === 0) {
      setSaving(false)
      return { inserted: 0, skipped, source: data?.length ?? 0 }
    }

    const { error: insertError } = await supabase.from('instructor_shifts').insert(rows)
    if (insertError) {
      setError(insertError.message)
      setSaving(false)
      return null
    }

    await load()
    setSaving(false)
    return { inserted: rows.length, skipped, source: data?.length ?? 0 }
  }, [centerId, weekStart, isCurrent, snapshot.shifts, load])

  return {
    days,
    shifts: isCurrent ? snapshot.shifts : EMPTY,
    instructors: isCurrent ? snapshot.instructors : EMPTY,
    loading: loading || !isCurrent,
    saving,
    error,
    refetch: load,
    saveShift,
    deleteShift,
    clearDay,
    copyLastWeek,
    dismissError: () => setError(null),
  }
}
