import { CAPABILITY_FLAG } from '../day/levels'
import { shiftCoversSession } from '../day/shiftCoverage'

/**
 * v1 required hand-ranking every instructor for every student, so new
 * students and new instructors started unassignable. v2 computes a default
 * score for any (student, instructor) pair and turns it into the same 1..N
 * rank the ported algorithms consume. instructor_rankings survives, but only
 * for exceptions: pin a great match, block a bad one.
 */

export const WEIGHTS = {
  preferred: 30,
  primary: 15,
  prefersBehindMatch: 20,
  genderMatch: 10,
  historyPerSession: 8,
  historyCap: 40,
}

/** A pin of 0 or less blocks the pairing outright. */
export const BLOCK_RANK = 0
export const isBlockingPin = (rank) => typeof rank === 'number' && rank <= BLOCK_RANK

/** How many of a student's most recent sessions feed the history boost. */
export const HISTORY_WINDOW = 10

export function computeScore(student, instructor, historyCount = 0) {
  let score = 0
  if (instructor.preferred) score += WEIGHTS.preferred
  if ((instructor.priority ?? 'primary') === 'primary') score += WEIGHTS.primary
  if (instructor.prefers_behind && student?.performance === 'behind') {
    score += WEIGHTS.prefersBehindMatch
  }
  const a = student?.gender?.toLowerCase()
  const b = instructor.gender?.toLowerCase()
  if (a && b && a === b) score += WEIGHTS.genderMatch
  // Continuity: an instructor who has taught this student recently scores
  // higher. Only possible now that assignments persist across weeks.
  score += Math.min(historyCount * WEIGHTS.historyPerSession, WEIGHTS.historyCap)
  return score
}

/**
 * Hard filters. Returns null when the pairing is allowed, otherwise why not —
 * useful for explaining an unassignable session rather than just dropping it.
 */
export function ineligibleReason(session, instructor, shift, pinRank) {
  if (isBlockingPin(pinRank)) return 'blocked'
  if (!instructor.active) return 'inactive'

  const level = session.student?.level
  const flag = CAPABILITY_FLAG[level]
  // A student with no level set is not gated on capability — the Data health
  // panel is where that gets fixed, not here.
  if (flag && !instructor[flag]) return 'cannot teach level'

  if (!shift) return 'not on shift'
  if (!shiftCoversSession(shift, session)) return 'shift does not cover the session'

  // Last-resort instructors are only ever used through an explicit pin.
  if (instructor.last_resort && typeof pinRank !== 'number') return 'last resort, not pinned'

  return null
}

/**
 * The ranked candidate list for one session: pins first in their own order,
 * then everyone else by computed score. Rank is 1-based position, which is
 * exactly what v1's getExplicitRank returned.
 */
export function buildCandidates(session, instructors, shiftByInstructor, pins, historyFor) {
  const pinned = []
  const scored = []

  for (const instructor of instructors) {
    const pinRank = pins?.get(instructor.id)
    const reason = ineligibleReason(
      session,
      instructor,
      shiftByInstructor.get(instructor.id) ?? null,
      pinRank,
    )
    if (reason) continue

    const history = historyFor?.(session.student_id, instructor.id) ?? 0
    const score = computeScore(session.student, instructor, history)
    const entry = { instructorId: instructor.id, score, history, pinRank: pinRank ?? null }
    if (typeof pinRank === 'number') pinned.push(entry)
    else scored.push(entry)
  }

  pinned.sort((a, b) => a.pinRank - b.pinRank || a.instructorId.localeCompare(b.instructorId))
  scored.sort((a, b) => b.score - a.score || a.instructorId.localeCompare(b.instructorId))

  return [...pinned, ...scored].map((entry, i) => ({ ...entry, rank: i + 1 }))
}

/** sessionId -> (instructorId -> rank), the shape the algorithms read. */
export function buildRankIndex(sessions, instructors, shiftByInstructor, pinsByStudent, historyFor) {
  const index = new Map()
  for (const session of sessions) {
    const candidates = buildCandidates(
      session,
      instructors,
      shiftByInstructor,
      pinsByStudent?.get(session.student_id),
      historyFor,
    )
    index.set(session.id, new Map(candidates.map((c) => [c.instructorId, c.rank])))
  }
  return index
}

/**
 * Counts of how often each instructor recently taught each student, from
 * assignment rows ordered most-recent-first.
 */
export function buildHistory(rows, window = HISTORY_WINDOW) {
  const perStudent = new Map()
  for (const row of rows) {
    const seen = perStudent.get(row.student_id) ?? { taken: 0, counts: new Map() }
    if (seen.taken >= window) continue
    seen.taken++
    seen.counts.set(row.instructor_id, (seen.counts.get(row.instructor_id) ?? 0) + 1)
    perStudent.set(row.student_id, seen)
  }
  return (studentId, instructorId) => perStudent.get(studentId)?.counts.get(instructorId) ?? 0
}
