import { addDays, timeToMinutes } from '../../lib/dates'

export const DEFAULT_START = '15:00'
export const DEFAULT_END = '19:00'

/** The seven ISO dates of a week, Sunday first (matches day_of_week 0..6). */
export function weekDays(weekStart) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

/** Why this shift is invalid, or null. */
export function validateShift(start, end) {
  if (!start || !end) return 'Both a start and an end time are needed.'
  if (timeToMinutes(end) <= timeToMinutes(start)) return 'The end time must be after the start.'
  return null
}

/** Length of one shift in hours. */
export function shiftHours(shift) {
  if (!shift?.start_time || !shift?.end_time) return 0
  return (timeToMinutes(shift.end_time) - timeToMinutes(shift.start_time)) / 60
}

export function totalHours(shifts) {
  return shifts.reduce((sum, s) => sum + shiftHours(s), 0)
}

const key = (instructorId, date, startTime) => `${instructorId}|${date}|${startTime}`

/**
 * Shifts to insert when copying a week forward. Anything that would collide
 * with a shift already on the target week is skipped rather than overwritten
 * — copy-last-week is a convenience, not a reset, and must never silently
 * discard something already entered by hand.
 */
export function planCopyWeek(sourceShifts, existingShifts, offsetDays = 7) {
  const taken = new Set(existingShifts.map((s) => key(s.instructor_id, s.date, s.start_time)))
  const rows = []
  let skipped = 0

  for (const shift of sourceShifts) {
    const date = addDays(shift.date, offsetDays)
    const k = key(shift.instructor_id, date, shift.start_time)
    if (taken.has(k)) {
      skipped++
      continue
    }
    taken.add(k)
    rows.push({
      center_id: shift.center_id,
      instructor_id: shift.instructor_id,
      date,
      start_time: shift.start_time,
      end_time: shift.end_time,
      role: shift.role ?? null,
      source: 'manual',
    })
  }

  return { rows, skipped }
}

/** Shifts keyed by `${instructor_id}|${date}` for the grid cells. */
export function indexShifts(shifts) {
  const map = new Map()
  for (const shift of shifts) {
    const k = `${shift.instructor_id}|${shift.date}`
    const list = map.get(k)
    if (list) list.push(shift)
    else map.set(k, [shift])
  }
  for (const list of map.values()) list.sort((a, b) => a.start_time.localeCompare(b.start_time))
  return map
}

/**
 * Sensible times for a new shift: reuse what this instructor is already
 * working that week, so filling a row is a few clicks rather than retyping.
 */
export function suggestTimes(shiftsForInstructor) {
  const latest = shiftsForInstructor[shiftsForInstructor.length - 1]
  return {
    start: latest?.start_time?.slice(0, 5) ?? DEFAULT_START,
    end: latest?.end_time?.slice(0, 5) ?? DEFAULT_END,
  }
}
