import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

const EMPTY = []

const ROSTER_SELECT = `
  id, name, grade, level, school, gender, radius_account, enrollment_status,
  academic_status, slot_certainty, needs_schoolwork,
  default_duration, active,
  recurring_slots ( id, day_of_week, start_time, duration, effective_until ),
  student_notes ( id, pinned, resolved )
`

/**
 * The roster for one center. Scoped the same way as the day view: rows are
 * held together with the center they were loaded for and withheld during
 * render if that no longer matches.
 */
export function useRoster(centerId) {
  const [snapshot, setSnapshot] = useState({ centerId: null, students: EMPTY })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    if (!centerId) return
    const token = ++requestRef.current
    setLoading(true)

    const { data, error } = await supabase
      .from('students')
      .select(ROSTER_SELECT)
      .eq('center_id', centerId)
      .order('name')

    if (token !== requestRef.current) return
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSnapshot({ centerId, students: data ?? EMPTY })
    setError(null)
    setLoading(false)
  }, [centerId])

  useEffect(() => {
    load()
  }, [load])

  const isCurrent = snapshot.centerId === centerId
  const students = isCurrent ? snapshot.students : EMPTY

  const createStudent = useCallback(
    async (name) => {
      const { data, error } = await supabase
        .from('students')
        .insert({ center_id: centerId, name: name.trim() })
        .select('id')
        .single()
      if (error) {
        setError(error.message)
        return null
      }
      await load()
      return data.id
    },
    [centerId, load],
  )

  return {
    students,
    loading: loading || !isCurrent,
    error,
    refetch: load,
    createStudent,
    dismissError: () => setError(null),
  }
}

/** Name search plus the level / enrollment / inactive filters, in memory. */
export function useFilteredRoster(students, { query, level, showInactive, enrollment }) {
  return useMemo(() => {
    const needle = query.trim().toLowerCase()
    return students.filter((s) => {
      if (!showInactive && !s.active) return false
      if (level && (s.level ?? '') !== level) return false
      if (enrollment === 'unset' ? s.enrollment_status : enrollment && s.enrollment_status !== enrollment) {
        return false
      }
      if (needle && !s.name.toLowerCase().includes(needle)) return false
      return true
    })
  }, [students, query, level, showInactive, enrollment])
}
