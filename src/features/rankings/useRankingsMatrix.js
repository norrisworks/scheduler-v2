import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { placeAtRank } from '../assign/rankOrder'

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

    const [studentRes, instructorRes, tierRes, rankRes, overrideRes] = await Promise.all([
      supabase
        .from('students')
        .select('id, name, grade, level, gender, active')
        .eq('center_id', centerId)
        .eq('active', true)
        .order('name'),
      supabase
        .from('instructors')
        .select('id, name, color, assignability, gender, can_teach_elementary, can_teach_middle, can_teach_high')
        .eq('center_id', centerId)
        .eq('active', true)
        .order('name'),
      // Admin-only view: this page is admin-gated, and the seed dialog's
      // tier ordering and reason chips read the merged value.
      supabase.from('instructor_tiers').select('instructor_id, tier'),
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

    const tiers = new Map((tierRes.data ?? []).map((r) => [r.instructor_id, r.tier]))
    setSnapshot({
      centerId,
      students: studentRes.data ?? EMPTY,
      instructors: (instructorRes.data ?? EMPTY).map((i) =>
        tiers.has(i.id) ? { ...i, tier: tiers.get(i.id) } : i,
      ),
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

  /**
   * A cell edit is an INSERTION, not a lone number: rank N slots the
   * instructor in at position N and shifts everyone at or below down one, so
   * the student's list stays contiguous 1..N — exactly what the drawer's drag
   * reorder produces. Clearing closes the gap. Optimistic, whole-row.
   */
  const setRank = useCallback(
    async (studentId, instructorId, rank) => {
      const nameOf = new Map(snapshot.instructors.map((i) => [i.id, i.name]))
      const current = snapshot.instructors
        .map((i) => ({ instructorId: i.id, rank: snapshot.ranks.get(`${studentId}|${i.id}`) }))
        .filter((e) => typeof e.rank === 'number')
        .sort(
          (a, b) =>
            a.rank - b.rank ||
            (nameOf.get(a.instructorId) ?? '').localeCompare(nameOf.get(b.instructorId) ?? ''),
        )

      const hadRow = current.some((e) => e.instructorId === instructorId)
      if (rank === null && !hadRow) return
      const next = placeAtRank(current, instructorId, rank)

      const previousRanks = snapshot.ranks
      setSnapshot((prev) => {
        const ranks = new Map(prev.ranks)
        for (const e of current) ranks.delete(`${studentId}|${e.instructorId}`)
        for (const e of next) ranks.set(`${studentId}|${e.instructorId}`, e.rank)
        return { ...prev, ranks }
      })
      setSaving(true)

      const writes = []
      if (next.length > 0) {
        writes.push(
          supabase.from('instructor_rankings').upsert(
            next.map((e) => ({
              student_id: studentId,
              instructor_id: e.instructorId,
              rank: e.rank,
              updated_at: new Date().toISOString(),
            })),
            { onConflict: 'student_id,instructor_id' },
          ),
        )
      }
      if (rank === null) {
        writes.push(
          supabase
            .from('instructor_rankings')
            .delete()
            .eq('student_id', studentId)
            .eq('instructor_id', instructorId),
        )
      }

      const results = await Promise.all(writes)
      const failure = results.find((r) => r.error)
      setSaving(false)
      if (failure) {
        setError(failure.error.message)
        setSnapshot((prev) => ({ ...prev, ranks: previousRanks }))
      }
    },
    [snapshot.ranks, snapshot.instructors],
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
