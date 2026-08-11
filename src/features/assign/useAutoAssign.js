import { useCallback, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { occupiesFloor } from '../day/load'
import { buildHistory, buildRankIndex } from './scoring'
import { ALGORITHMS } from './algorithms'

/**
 * Runs an auto-assign algorithm over the unassigned sessions of one day.
 * Everything the algorithms need — pins, history, shift coverage — is
 * gathered here; the algorithms themselves stay pure.
 */
export function useAutoAssign({ date, sessions, instructors, shiftByInstructor, onDone }) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const run = useCallback(
    async (algorithmKey) => {
      const algorithm = ALGORITHMS.find((a) => a.key === algorithmKey)
      if (!algorithm) return null

      setRunning(true)
      setError(null)

      const dayS = sessions.filter(occupiesFloor)
      const unassigned = dayS.filter((s) => !s.instructor_id)
      const studentIds = [...new Set(dayS.map((s) => s.student_id).filter(Boolean))]

      if (unassigned.length === 0 || studentIds.length === 0) {
        setRunning(false)
        const empty = { made: [], unassignable: unassigned, assigned: 0, worstRank: 0, couldNotAssign: unassigned.length }
        setResult(empty)
        return empty
      }

      // Pins are the exception list; history is the continuity signal that
      // only exists because assignments now persist across weeks.
      const [pinRes, historyRes] = await Promise.all([
        supabase
          .from('instructor_rankings')
          .select('student_id, instructor_id, rank')
          .in('student_id', studentIds),
        supabase
          .from('assignments')
          .select('instructor_id, session:sessions!inner ( student_id, date )')
          .in('session.student_id', studentIds)
          .lt('session.date', date)
          .order('date', { referencedTable: 'sessions', ascending: false })
          .limit(600),
      ])

      if (pinRes.error || historyRes.error) {
        setError((pinRes.error ?? historyRes.error).message)
        setRunning(false)
        return null
      }

      const pinsByStudent = new Map()
      for (const pin of pinRes.data ?? []) {
        const forStudent = pinsByStudent.get(pin.student_id) ?? new Map()
        forStudent.set(pin.instructor_id, pin.rank)
        pinsByStudent.set(pin.student_id, forStudent)
      }

      const historyFor = buildHistory(
        (historyRes.data ?? []).map((row) => ({
          student_id: row.session?.student_id,
          instructor_id: row.instructor_id,
        })),
      )

      const rankIndex = buildRankIndex(
        unassigned,
        instructors,
        shiftByInstructor,
        pinsByStudent,
        historyFor,
      )

      const existing = new Map(
        dayS.filter((s) => s.instructor_id).map((s) => [s.id, s.instructor_id]),
      )

      const outcome = algorithm.run({
        sessions: dayS,
        unassigned,
        instructors,
        rankIndex,
        existing,
      })

      if (outcome.made.length > 0) {
        const { error } = await supabase.from('assignments').upsert(
          outcome.made.map((m) => ({ session_id: m.sessionId, instructor_id: m.instructorId })),
          { onConflict: 'session_id' },
        )
        if (error) {
          setError(error.message)
          setRunning(false)
          return null
        }
        await onDone?.()
      }

      setResult(outcome)
      setRunning(false)
      return outcome
    },
    [date, sessions, instructors, shiftByInstructor, onDone],
  )

  return { running, result, error, run, dismiss: () => setResult(null) }
}
