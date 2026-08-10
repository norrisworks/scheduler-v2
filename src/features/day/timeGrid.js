import { dayOfWeek, timeToMinutes } from '../../lib/dates'
import { sessionEndMinutes, sessionsOverlap } from './shiftCoverage'

// v1 geometry, kept verbatim — the day view's proportions are the thing that
// made it readable on the floor.
export const SLOT_MINUTES = 30
export const SLOT_HEIGHT = 60 // px per 30-min slot
export const SUBCOL_WIDTH = 95 // px per overlap sub-column
export const SUBCOL_GAP = 4

// Transposed orientation: time runs left-to-right, one row per student.
export const SLOT_WIDTH = 76 // px per 30-min slot
export const ROW_HEIGHT = 52 // px per student row
export const ROW_GAP = 4

/** v1 getTimeSlots: weekdays 14:30–19:30, weekends 09:30–13:00. */
export function centerHours(dateISO) {
  const dow = dayOfWeek(dateISO)
  const weekend = dow === 0 || dow === 6
  return weekend
    ? { start: 9 * 60 + 30, end: 13 * 60 }
    : { start: 14 * 60 + 30, end: 19 * 60 + 30 }
}

const floorSlot = (m) => Math.floor(m / SLOT_MINUTES) * SLOT_MINUTES
const ceilSlot = (m) => Math.ceil(m / SLOT_MINUTES) * SLOT_MINUTES

/**
 * The vertical axis for a day. Starts from center hours but stretches to
 * contain anything scheduled outside them — a session must never be clipped
 * out of view just because someone booked past closing.
 */
export function buildTimeAxis(dateISO, sessions) {
  const hours = centerHours(dateISO)
  let start = hours.start
  let end = hours.end

  for (const session of sessions) {
    start = Math.min(start, floorSlot(timeToMinutes(session.start_time)))
    end = Math.max(end, ceilSlot(sessionEndMinutes(session)))
  }

  const slots = []
  for (let m = start; m <= end; m += SLOT_MINUTES) slots.push(m)

  return { start, end, slots, height: ((end - start) / SLOT_MINUTES) * SLOT_HEIGHT }
}

/** Pixel offset and height for a session on the axis. */
export function sessionGeometry(session, axis) {
  const top = ((timeToMinutes(session.start_time) - axis.start) / SLOT_MINUTES) * SLOT_HEIGHT
  const height = ((session.duration ?? 60) / SLOT_MINUTES) * SLOT_HEIGHT
  return { top, height }
}

/**
 * v1 overlap handling: sort by start time, then greedily place each session in
 * the first sub-column it doesn't collide with. A new sub-column is opened
 * only when the session overlaps something in every existing one.
 */
export function packSubColumns(sessions) {
  const sorted = [...sessions].sort(
    (a, b) =>
      a.start_time.localeCompare(b.start_time) ||
      (a.student?.name ?? '').localeCompare(b.student?.name ?? ''),
  )

  const columns = []
  const indexById = new Map()

  for (const session of sorted) {
    let placed = false
    for (let i = 0; i < columns.length; i++) {
      if (columns[i].every((other) => !sessionsOverlap(other, session))) {
        columns[i].push(session)
        indexById.set(session.id, i)
        placed = true
        break
      }
    }
    if (!placed) {
      columns.push([session])
      indexById.set(session.id, columns.length - 1)
    }
  }

  return { sorted, indexById, count: Math.max(columns.length, 1) }
}

/** Horizontal placement of a session on the transposed axis. */
export function sessionSpan(session, axis) {
  const left = ((timeToMinutes(session.start_time) - axis.start) / SLOT_MINUTES) * SLOT_WIDTH
  const width = ((session.duration ?? 60) / SLOT_MINUTES) * SLOT_WIDTH
  return { left, width }
}

export function axisWidth(axis) {
  return ((axis.end - axis.start) / SLOT_MINUTES) * SLOT_WIDTH
}

/**
 * One row per student, grouped by level. A student with two sessions in an
 * afternoon gets one row with two bars, which is the whole point of the
 * transposed view — the gap between them is the thing you're looking for.
 */
export function groupByStudent(sessions) {
  const rows = new Map()
  for (const session of sessions) {
    const id = session.student_id
    const row = rows.get(id)
    if (row) row.sessions.push(session)
    else rows.set(id, { studentId: id, student: session.student, sessions: [session] })
  }
  return [...rows.values()]
    .map((row) => ({
      ...row,
      sessions: row.sessions.sort((a, b) => a.start_time.localeCompare(b.start_time)),
    }))
    .sort((a, b) => {
      const first = a.sessions[0].start_time.localeCompare(b.sessions[0].start_time)
      return first || (a.student?.name ?? '').localeCompare(b.student?.name ?? '')
    })
}

export function subColumnLeft(index) {
  return index * (SUBCOL_WIDTH + SUBCOL_GAP)
}

export function columnWidth(subColumnCount) {
  return subColumnCount * SUBCOL_WIDTH + (subColumnCount - 1) * SUBCOL_GAP
}
