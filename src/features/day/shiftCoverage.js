import { timeToMinutes } from '../../lib/dates'

export function sessionEndMinutes(session) {
  return timeToMinutes(session.start_time) + (session.duration ?? 60)
}

/** True when the shift spans the session's ENTIRE duration. */
export function shiftCoversSession(shift, session) {
  if (!shift) return false
  return (
    timeToMinutes(shift.start_time) <= timeToMinutes(session.start_time) &&
    timeToMinutes(shift.end_time) >= sessionEndMinutes(session)
  )
}

/**
 * Why an instructor is a questionable fit for a session, or null if they're
 * fine. v1 happily assigned 6:30 students to instructors leaving at 6; manual
 * drops are still allowed here, but they never happen silently.
 */
export function coverageWarning(instructor, shift, session) {
  if (!instructor || !session) return null
  if (!shift) return `${instructor.name} has no shift on this day`
  if (!shiftCoversSession(shift, session)) {
    return `${instructor.name}'s shift does not cover the full session`
  }
  return null
}

/** Do two sessions overlap in time? Used for peak concurrent load. */
export function sessionsOverlap(a, b) {
  return (
    timeToMinutes(a.start_time) < sessionEndMinutes(b) &&
    timeToMinutes(b.start_time) < sessionEndMinutes(a)
  )
}

/** Largest number of this instructor's sessions running at the same moment. */
export function peakConcurrent(sessions) {
  const events = []
  for (const s of sessions) {
    events.push([timeToMinutes(s.start_time), 1])
    events.push([sessionEndMinutes(s), -1])
  }
  // Ends sort before starts at the same minute — a session ending at 5:00
  // does not overlap one starting at 5:00.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let current = 0
  let peak = 0
  for (const [, delta] of events) {
    current += delta
    if (current > peak) peak = current
  }
  return peak
}
