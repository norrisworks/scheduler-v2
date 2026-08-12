import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

const EMPTY = []

/**
 * The whole ranking grid for one center: students down, instructors across.
 * Writes go straight to instructor_rankings a cell at a time.
 */
export function useRankingsMatrix(centerId) {
  const [snapshot, setSnapshot] = useState({
    centerId: null,
    students: EMPTY,
    instructors: EMPTY,
    ranks: new Map(),
    overrides: new Map(),
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    if (!centerId) return
    const token = ++requestRef.current
    setLoading(true)

    const [studentRes, instructorRes, rankRes, overrideRes] = await Promise.all([
      supabase
        .from('students')
        .select('id, name, grade, level, gender, active')
        .eq('center_id', centerId)
        .eq('active', true)
        .order('name'),
      supabase
        .from('instructors')
        .select('id, name, color, tier, assignability, gender, can_teach_elementary, can_teach_middle, can_teach_high')
        .eq('center_id', centerId)
        .eq('active', true)
        .order('name'),
      supabase.from('instructor_rankings').select('student_id, instructor_id, rank'),
      supabase
        .from('assignment_overrides')
        .select('student_id, instructor_id')
        .eq('center_id', centerId),
    ])

    if (token !== requestRef.current) return
    const failure = studentRes.error || instructorRes.error || rankRes.error || overrideRes.error
    if (failure) {
      setError(failure.message)
      setLoading(false)
      return
    }

    const ranks = new Map()
    for (const row of rankRes.data ?? []) {
      ranks.set(`${row.student_id}|${row.instructor_id}`, row.rank)
    }
    const overrides = new Map()
    for (const row of overrideRes.data ?? []) {
      const key = `${row.student_id}|${row.instructor_id}`
      overrides.set(key, (overrides.get(key) ?? 0) + 1)
    }

    setSnapshot({
      centerId,
      students: studentRes.data ?? EMPTY,
      instructors: instructorRes.data ?? EMPTY,
      ranks,
      overrides,
    })
    setError(null)
    setLoading(false)
  }, [centerId])

  useEffect(() => {
    load()
  }, [load])

  const isCurrent = snapshot.centerId === centerId

  /** Optimistic so typing across a row feels immediate. */
  const setRank = useCallback(
    async (studentId, instructorId, rank) => {
      const key = `${studentId}|${instructorId}`
      const previous = snapshot.ranks.get(key)

      setSnapshot((prev) => {
        const ranks = new Map(prev.ranks)
        if (rank === null) ranks.delete(key)
        else ranks.set(key, rank)
        return { ...prev, ranks }
      })
      setSaving(true)

      const { error } =
        rank === null
          ? await supabase
              .from('instructor_rankings')
              .delete()
              .eq('student_id', studentId)
              .eq('instructor_id', instructorId)
          : await supabase.from('instructor_rankings').upsert(
              {
                student_id: studentId,
                instructor_id: instructorId,
                rank,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'student_id,instructor_id' },
            )

      setSaving(false)
      if (error) {
        setError(error.message)
        setSnapshot((prev) => {
          const ranks = new Map(prev.ranks)
          if (previous === undefined) ranks.delete(key)
          else ranks.set(key, previous)
          return { ...prev, ranks }
        })
      }
    },
    [snapshot.ranks],
  )

  /** Writes a whole proposed list for one student in a single round trip. */
  const saveRankingList = useCallback(
    async (studentId, entries) => {
      setSaving(true)
      const { error } = await supabase.from('instructor_rankings').upsert(
        entries.map((e) => ({
          student_id: studentId,
          instructor_id: e.instructorId,
          rank: e.rank,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'student_id,instructor_id' },
      )
      setSaving(false)
      if (error) {
        setError(error.message)
        return false
      }
      await load()
      return true
    },
    [load],
  )

  const rankedCounts = useMemo(() => {
    const counts = new Map()
    if (!isCurrent) return counts
    for (const key of snapshot.ranks.keys()) {
      const studentId = key.split('|')[0]
      counts.set(studentId, (counts.get(studentId) ?? 0) + 1)
    }
    return counts
  }, [snapshot.ranks, isCurrent])

  return {
    students: isCurrent ? snapshot.students : EMPTY,
    instructors: isCurrent ? snapshot.instructors : EMPTY,
    ranks: isCurrent ? snapshot.ranks : new Map(),
    overrides: isCurrent ? snapshot.overrides : new Map(),
    rankedCounts,
    loading: loading || !isCurrent,
    saving,
    error,
    refetch: load,
    setRank,
    saveRankingList,
    dismissError: () => setError(null),
  }
}
