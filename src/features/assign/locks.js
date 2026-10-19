import { timeToMinutes } from '../../lib/dates'

const SLOT_MINUTES = 30

/**
 * Locks decide which sessions an auto-assign run may touch.
 *
 * Two kinds:
 *   hand lock  — assignments.locked, set from the card. Lives on the
 *                assignment row, so it belongs to one session and is gone
 *                with it: nothing carries to the next day.
 *   started    — computed, never stored. A session in an earlier slot
 *                (any earlier date, or today starting before the current
 *                half-hour slot) is left exactly as it is, assigned or not, so a run
 *                never moves a kid who is already sitting down.
 *
 * Everything else is fair game: Reassign clears it, hand-placed or not, and
 * places it again.
 */

/** True when the session has started by `nowTime` ('HH:MM') on `today`. */
export function hasStarted(session, today, nowTime) {
  if (!session?.date || !today) return false
  if (session.date < today) return true
  if (session.date > today) return false
  // The current half-hour slot is still open: at 4:31 the 4:30 kids are
  // often still walking in, so only slots before this one count as started.
  const slotStart = Math.floor(timeToMinutes(nowTime) / SLOT_MINUTES) * SLOT_MINUTES
  return timeToMinutes(session.start_time) < slotStart
}

export function isHandLocked(session) {
  return Boolean(session?.instructor_id && session?.assignment?.locked)
}

/** Locked for auto-assign purposes, for either reason. */
export function isFrozen(session, today, nowTime) {
  return isHandLocked(session) || hasStarted(session, today, nowTime)
}

/**
 * Splits a day's floor sessions for a run.
 *
 *   existing — frozen AND assigned: immovable, but still count toward load
 *   pool     — not frozen: what the run is allowed to place
 *   clear    — the assigned part of the pool (Reassign removes these first)
 *   fill     — the unassigned part of the pool (all a Fill run places)
 *   handLocked / started — counts for the sidebar
 */
export function planLockedRun(dayS, today, nowTime) {
  const existing = []
  const pool = []
  let handLocked = 0
  let started = 0
  for (const s of dayS) {
    const hand = isHandLocked(s)
    const begun = hasStarted(s, today, nowTime)
    if (hand) handLocked++
    else if (begun) started++
    if (hand || begun) {
      if (s.instructor_id) existing.push(s)
    } else {
      pool.push(s)
    }
  }
  return {
    existing,
    pool,
    clear: pool.filter((s) => s.instructor_id),
    fill: pool.filter((s) => !s.instructor_id),
    handLocked,
    started,
  }
}
