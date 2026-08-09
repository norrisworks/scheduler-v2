import { timeToMinutes } from '../../lib/dates'
import { hexToRgb } from '../../lib/colors'
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

const GAUGE_AT_CAP = '#DC2626'
const GAUGE_EMPTY = '#E2E8F0'

/**
 * Gauge cell intensity: 0 empty, 1–2 light, 3 solid at the normal working
 * ratio, 4+ red because that is the stretch cap. At-cap slots have to be
 * obvious — this is how the floor decides who can take a walk-in.
 */
export function loadCellColor(load, instructorColor) {
  if (load <= 0) return GAUGE_EMPTY
  if (load >= STRETCH_RATIO) return GAUGE_AT_CAP
  const rgb = hexToRgb(instructorColor)
  if (!rgb) return GAUGE_EMPTY
  const alpha = load >= NORMAL_RATIO ? 1 : load === 2 ? 0.55 : 0.3
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
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
