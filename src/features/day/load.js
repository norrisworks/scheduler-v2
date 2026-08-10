import { timeToMinutes } from '../../lib/dates'
import { sessionEndMinutes } from './shiftCoverage'

/** Working ratios from the auto-assign phases: 3 normal, 4 stretch cap. */
export const NORMAL_RATIO = 3
export const STRETCH_RATIO = 4

/**
 * Only sessions that actually put a student on the floor count toward load.
 * A cancellation or a no-show frees the capacity it was holding.
 */
export function occupiesFloor(session) {
  return session.status !== 'cancelled' && session.status !== 'no_show'
}

/** v1 getSessionsAtTime: slot >= start AND slot < start + duration. */
export function sessionCoversSlot(session, slotMinutes) {
  return (
    slotMinutes >= timeToMinutes(session.start_time) && slotMinutes < sessionEndMinutes(session)
  )
}

export function shiftCoversSlot(shift, slotMinutes) {
  return (
    slotMinutes >= timeToMinutes(shift.start_time) && slotMinutes < timeToMinutes(shift.end_time)
  )
}

/** Students in session during a slot — the floor's density readout. */
export function studentsAtSlot(sessions, slotMinutes) {
  let count = 0
  for (const s of sessions) if (occupiesFloor(s) && sessionCoversSlot(s, slotMinutes)) count++
  return count
}

export function instructorsOnShiftAtSlot(shifts, slotMinutes) {
  let count = 0
  for (const shift of shifts) if (shiftCoversSlot(shift, slotMinutes)) count++
  return count
}

/** v1 getInstructorLoadByTime — this instructor's student count per slot. */
export function instructorLoadBySlot(sessions, instructorId, slots) {
  const mine = sessions.filter((s) => s.instructor_id === instructorId && occupiesFloor(s))
  return slots.map((slot) => mine.reduce((n, s) => n + (sessionCoversSlot(s, slot) ? 1 : 0), 0))
}

/** v1 getInstructorCurrentCount — who they have right now. Null off today. */
export function instructorCurrentCount(sessions, instructorId, nowMinutes) {
  if (nowMinutes === null || nowMinutes === undefined) return null
  return sessions.reduce(
    (n, s) =>
      n +
      (s.instructor_id === instructorId && occupiesFloor(s) && sessionCoversSlot(s, nowMinutes)
        ? 1
        : 0),
    0,
  )
}

/** v1 getInstructorTotalCount — their day total. */
export function instructorTotalCount(sessions, instructorId) {
  return sessions.reduce(
    (n, s) => n + (s.instructor_id === instructorId && occupiesFloor(s) ? 1 : 0),
    0,
  )
}

/**
 * How a slot's student count sits against the capacity of who is on shift.
 * This is the overbooked warning the owner scans for.
 */
export function slotPressure(students, instructorsOnShift) {
  if (students === 0) return 'empty'
  if (instructorsOnShift === 0) return 'uncovered'
  if (students > instructorsOnShift * STRETCH_RATIO) return 'over_stretch'
  if (students > instructorsOnShift * NORMAL_RATIO) return 'over'
  return 'ok'
}

/**
 * v1's fixed thresholds (capacity_colors, verbatim) for the instructor gauge
 * cells. Cells show the NUMBER, tinted by these bands — not alpha fills.
 */
export function gaugeCellClass(load) {
  if (load <= 0) return 'bg-zinc-200 text-zinc-400'
  if (load <= 2) return 'bg-green-100 text-green-700'
  if (load === 3) return 'bg-yellow-100 text-yellow-700'
  if (load === 4) return 'bg-orange-100 text-orange-700'
  return 'bg-red-100 text-red-700'
}

/**
 * v1's fixed thresholds for the per-slot student count chip on the time
 * axis. One addition v1 could not detect: students present with ZERO
 * instructors on shift is a real error state and stays solid red.
 */
export function slotChipClass(students, onShift) {
  if (students > 0 && onShift === 0) return 'bg-red-500 text-white'
  if (students === 0) return 'text-zinc-300'
  if (students <= 5) return 'bg-green-100 text-green-700'
  if (students <= 8) return 'bg-yellow-100 text-yellow-700'
  if (students <= 10) return 'bg-orange-100 text-orange-700'
  return 'bg-red-100 text-red-700'
}

/** Everything the time axis needs, one entry per 30-min slot. */
export function buildSlotStats(slots, sessions, shifts) {
  return slots.map((minutes) => {
    const students = studentsAtSlot(sessions, minutes)
    const onShift = instructorsOnShiftAtSlot(shifts, minutes)
    return {
      minutes,
      students,
      onShift,
      capacity: onShift * NORMAL_RATIO,
      stretchCapacity: onShift * STRETCH_RATIO,
      pressure: slotPressure(students, onShift),
    }
  })
}
