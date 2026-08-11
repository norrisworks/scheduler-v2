import { CAPABILITY_FLAG } from '../day/levels'
import { shiftCoversSession } from '../day/shiftCoverage'

/**
 * Rankings are the SOLE input to auto-assign. There is no computed score, no
 * rules engine and no hidden math: an instructor is a candidate for a student
 * only if a row exists in instructor_rankings, and the order they are tried
 * in is exactly the rank recorded there.
 *
 * Unranked is not "ranked last" — it is not a candidate at all.
 */

export const isFallbackOnly = (instructor) => instructor?.assignability === 'fallback_only'

/**
 * Hard filters that sit ABOVE the ranking. These are physical facts, not
 * preferences: someone cannot teach a level they are not certified for, and
 * cannot cover a session that runs outside their shift.
 */
export function ineligibleReason(session, instructor, shift) {
  if (!instructor.active) return 'inactive'

  const level = session.student?.level
  const flag = CAPABILITY_FLAG[level]
  // A student with no level set is not gated on capability — that is a Data
  // health problem, not something to silently drop a session over.
  if (flag && !instructor[flag]) return 'cannot teach level'

  if (!shift) return 'not on shift'
  if (!shiftCoversSession(shift, session)) return 'shift does not cover the session'

  return null
}

/**
 * The candidate list for one session: ranked instructors, in rank order.
 * Ties keep their shared rank so the algorithms' load and day-total
 * tie-breaks still have something to resolve.
 */
export function buildCandidates(session, instructors, shiftByInstructor, rankings) {
  if (!rankings || rankings.size === 0) return []

  const candidates = []
  for (const instructor of instructors) {
    const rank = rankings.get(instructor.id)
    // Unranked instructors are not candidates, full stop.
    if (typeof rank !== 'number' || rank < 1) continue
    if (ineligibleReason(session, instructor, shiftByInstructor.get(instructor.id) ?? null)) {
      continue
    }
    candidates.push({ instructorId: instructor.id, rank })
  }

  return candidates.sort((a, b) => a.rank - b.rank || a.instructorId.localeCompare(b.instructorId))
}

/** sessionId -> (instructorId -> rank), the shape the algorithms read. */
export function buildRankIndex(sessions, instructors, shiftByInstructor, rankingsByStudent) {
  const index = new Map()
  for (const session of sessions) {
    const candidates = buildCandidates(
      session,
      instructors,
      shiftByInstructor,
      rankingsByStudent?.get(session.student_id),
    )
    index.set(session.id, new Map(candidates.map((c) => [c.instructorId, c.rank])))
  }
  return index
}

/** Students on this day with no usable ranking, for the unassignable report. */
export function unrankedStudents(sessions, rankingsByStudent) {
  const seen = new Map()
  for (const session of sessions) {
    const ranks = rankingsByStudent?.get(session.student_id)
    if (!ranks || ranks.size === 0) seen.set(session.student_id, session.student?.name ?? 'Unknown')
  }
  return [...seen.entries()].map(([id, name]) => ({ studentId: id, name }))
}
