import { useCallback, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { occupiesFloor } from '../day/load'
import { buildRankIndex, unrankedStudents } from './rankings'
import { ALGORITHMS } from './algorithms'

/**
 * Runs an auto-assign algorithm over the unassigned sessions of one day.
 * instructor_rankings is the only input: no scoring, no history weighting,
 * no attribute math. A student with no rankings gets no candidates.
 */
export function useAutoAssign({ sessions, instructors, shiftByInstructor, onDone }) {
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
        const empty = {
          made: [],
          unassignable: unassigned,
          assigned: 0,
          worstRank: 0,
          couldNotAssign: unassigned.length,
          unranked: [],
        }
        setResult(empty)
        setRunning(false)
        return empty
      }

      const { data, error } = await supabase
        .from('instructor_rankings')
        .select('student_id, instructor_id, rank')
        .in('student_id', studentIds)

      if (error) {
        setError(error.message)
        setRunning(false)
        return null
      }

      const rankingsByStudent = new Map()
      for (const row of data ?? []) {
        const forStudent = rankingsByStudent.get(row.student_id) ?? new Map()
        forStudent.set(row.instructor_id, row.rank)
        rankingsByStudent.set(row.student_id, forStudent)
      }

      const rankIndex = buildRankIndex(unassigned, instructors, shiftByInstructor, rankingsByStudent)
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
      outcome.unranked = unrankedStudents(outcome.unassignable, rankingsByStudent)

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
    [sessions, instructors, shiftByInstructor, onDone],
  )

  return { running, result, error, run, dismiss: () => setResult(null) }
}
