import { useCallback, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { occupiesFloor } from '../day/load'
import { addDays, todayISO } from '../../lib/dates'
import { fetchRankSequence } from '../instructors/rankAccess'
import { buildRankIndex, explainUnplaced, unrankedStudents } from './rankings'
import { NEW_STUDENT_WINDOW_DAYS } from './algorithmFlags'
import { ALGORITHMS } from './algorithms'

/**
 * Runs an auto-assign algorithm over one day. instructor_rankings is the only
 * input: no scoring, no history weighting, no attribute math.
 *
 * Two modes:
 *   run        — fills empty seats only; existing assignments are immovable.
 *   reassign   — clears every AUTO-placed assignment first, then runs fresh.
 *                Manually-placed sessions are preserved and count toward load.
 *
 * Every mutation records what the day looked like beforehand, so the last run
 * can always be undone — v1 had this and losing it made a day permanent.
 */
export function useAutoAssign({ sessions, instructors, shiftByInstructor, onDone }) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  // { touched: [sessionId], before: [{session_id, instructor_id, source}] }
  const [lastRun, setLastRun] = useState(null)

  const dayState = useCallback(() => {
    const dayS = sessions.filter(occupiesFloor)
    return {
      dayS,
      assigned: dayS.filter((s) => s.instructor_id),
      auto: dayS.filter((s) => s.instructor_id && s.assignment?.source === 'auto'),
      manual: dayS.filter((s) => s.instructor_id && s.assignment?.source !== 'auto'),
    }
  }, [sessions])

  const loadRankings = useCallback(async (dayS) => {
    const studentIds = [...new Set(dayS.map((s) => s.student_id).filter(Boolean))]
    if (studentIds.length === 0) return new Map()
    const { data, error } = await supabase
      .from('instructor_rankings')
      .select('student_id, instructor_id, rank')
      .in('student_id', studentIds)
    if (error) throw new Error(error.message)
    const byStudent = new Map()
    for (const row of data ?? []) {
      const forStudent = byStudent.get(row.student_id) ?? new Map()
      forStudent.set(row.instructor_id, row.rank)
      byStudent.set(row.student_id, forStudent)
    }
    return byStudent
  }, [])

  /**
   * The core: assign `unassigned` given `existing` immovable placements,
   * write the result, and remember how to put things back.
   */
  const execute = useCallback(
    async (algorithmKey, { dayS, unassigned, existing, before, cleared }) => {
      const algorithm = ALGORITHMS.find((a) => a.key === algorithmKey)
      if (!algorithm) return null

      const rankingsByStudent = await loadRankings(dayS)
      const rankIndex = buildRankIndex(unassigned, instructors, shiftByInstructor, rankingsByStudent)

      // Order-only: the sequence RPC exposes positions, never column values,
      // so instructor-role runs get the same tie-breaks admins do.
      const centerId = instructors[0]?.center_id
      const rankSeq = centerId
        ? await fetchRankSequence(centerId).catch(() => new Map())
        : new Map()
      const newCutoff = addDays(todayISO(), -NEW_STUDENT_WINDOW_DAYS)
      const newStudentIds = new Set(
        dayS
          .filter((s) => s.student?.enrollment_start_date && s.student.enrollment_start_date >= newCutoff)
          .map((s) => s.student_id),
      )

      const outcome = algorithm.run({
        sessions: dayS,
        unassigned,
        instructors,
        rankIndex,
        existing,
        rankSeq,
        newStudentIds,
      })
      outcome.unranked = unrankedStudents(outcome.unassignable, rankingsByStudent)
      // Why each leftover is a leftover — computed from the same inputs the
      // run used, so the panel never has to guess.
      outcome.explanations = outcome.unassignable.map((s) =>
        explainUnplaced(s, instructors, shiftByInstructor, rankingsByStudent.get(s.student_id)),
      )
      outcome.cleared = cleared

      if (cleared.length > 0) {
        const { error } = await supabase
          .from('assignments')
          .delete()
          .in('session_id', cleared)
        if (error) throw new Error(error.message)
      }
      if (outcome.made.length > 0) {
        const { error } = await supabase.from('assignments').upsert(
          outcome.made.map((m) => ({
            session_id: m.sessionId,
            instructor_id: m.instructorId,
            // Marks these as auto-placed so a later hand move is recognisable
            // as an override rather than an ordinary edit.
            source: 'auto',
          })),
          { onConflict: 'session_id' },
        )
        if (error) throw new Error(error.message)
      }

      setLastRun({
        touched: [...new Set([...cleared, ...outcome.made.map((m) => m.sessionId)])],
        before,
      })
      if (cleared.length > 0 || outcome.made.length > 0) await onDone?.()
      setResult(outcome)
      return outcome
    },
    [instructors, shiftByInstructor, loadRankings, onDone],
  )

  /** Fill empty seats. Existing assignments — auto or manual — are immovable. */
  const run = useCallback(
    async (algorithmKey) => {
      setRunning(true)
      setError(null)
      try {
        const { dayS, assigned } = dayState()
        const unassigned = dayS.filter((s) => !s.instructor_id)
        return await execute(algorithmKey, {
          dayS,
          unassigned,
          existing: new Map(assigned.map((s) => [s.id, s.instructor_id])),
          // Filled seats were empty before, so 'before' is simply nothing.
          before: [],
          cleared: [],
        })
      } catch (err) {
        setError(err.message)
        return null
      } finally {
        setRunning(false)
      }
    },
    [dayState, execute],
  )

  /**
   * Clear the auto-placed seats and run fresh over all of them, so the
   * algorithm can rebalance instead of only topping up. Manual placements are
   * kept and still count toward capacity.
   */
  const reassign = useCallback(
    async (algorithmKey) => {
      setRunning(true)
      setError(null)
      try {
        const { dayS, auto, manual } = dayState()
        const unassigned = dayS.filter((s) => !s.instructor_id || s.assignment?.source === 'auto')
        return await execute(algorithmKey, {
          dayS,
          unassigned,
          existing: new Map(manual.map((s) => [s.id, s.instructor_id])),
          before: auto.map((s) => ({
            session_id: s.id,
            instructor_id: s.instructor_id,
            source: 'auto',
          })),
          cleared: auto.map((s) => s.id),
        })
      } catch (err) {
        setError(err.message)
        return null
      } finally {
        setRunning(false)
      }
    },
    [dayState, execute],
  )

  /** Put every session the last run touched back exactly as it was. */
  const undo = useCallback(async () => {
    if (!lastRun) return
    setRunning(true)
    setError(null)
    try {
      const { error: delErr } = await supabase
        .from('assignments')
        .delete()
        .in('session_id', lastRun.touched)
      if (delErr) throw new Error(delErr.message)
      if (lastRun.before.length > 0) {
        const { error: insErr } = await supabase.from('assignments').insert(lastRun.before)
        if (insErr) throw new Error(insErr.message)
      }
      setLastRun(null)
      setResult(null)
      await onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }, [lastRun, onDone])

  /** Wipe the day's assignments. The caller confirms; this just does it. */
  const clearDay = useCallback(async () => {
    setRunning(true)
    setError(null)
    try {
      const { assigned } = dayState()
      if (assigned.length === 0) return
      const { error } = await supabase
        .from('assignments')
        .delete()
        .in('session_id', assigned.map((s) => s.id))
      if (error) throw new Error(error.message)
      // Clearing is itself undoable: before = everything just removed.
      setLastRun({
        touched: assigned.map((s) => s.id),
        before: assigned.map((s) => ({
          session_id: s.id,
          instructor_id: s.instructor_id,
          source: s.assignment?.source ?? 'manual',
        })),
      })
      setResult(null)
      await onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }, [dayState, onDone])

  /**
   * Recompute the unplaced panel after rankings or shifts were edited from
   * it, without running the algorithms. 'At capacity' is a claim about a run
   * that already happened, so for a student whose new rankings would now get
   * a hearing the honest headline is "run it again", not a fresh guess.
   */
  const refreshExplanations = useCallback(async () => {
    if (!result || result.unassignable.length === 0) return
    try {
      const rankingsByStudent = await loadRankings(result.unassignable)
      const explanations = result.unassignable.map((s) => {
        const ex = explainUnplaced(s, instructors, shiftByInstructor, rankingsByStudent.get(s.student_id))
        return ex.details.some((d) => d.reason === 'at capacity')
          ? { ...ex, headline: 'has an available ranked instructor now — run auto-assign again' }
          : ex
      })
      setResult((prev) => (prev ? { ...prev, explanations } : prev))
    } catch (err) {
      setError(err.message)
    }
  }, [result, instructors, shiftByInstructor, loadRankings])

  return {
    running,
    result,
    error,
    run,
    reassign,
    clearDay,
    undo,
    canUndo: Boolean(lastRun),
    counts: dayState(),
    refreshExplanations,
    dismiss: () => setResult(null),
  }
}
