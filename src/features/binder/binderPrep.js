/**
 * Binder prep state and the rules for reading it.
 *
 * Prep is physical work on a physical binder, so the state belongs to the
 * STUDENT and persists until that binder is actually used. It used to live on
 * the session, which meant a no-show silently wasted the prep: the next day
 * read "not started" even though the binder sat ready on the shelf.
 *
 * Reset is ATTENDANCE-driven and enforced by a database trigger
 * (reset_binder_on_attendance), so it fires whichever path marks a session
 * attended — Radius import, manual edit, raw SQL. Nothing resets because a
 * date went by; that was the bug.
 */

export const DEFAULT_BINDER_STATUS = 'not_started'

export const BINDER_STATUSES = [
  { value: 'not_started', label: 'Not started', chip: 'bg-zinc-200 text-zinc-700', active: 'bg-zinc-600 text-white' },
  { value: 'in_progress', label: 'In progress', chip: 'bg-amber-100 text-amber-800', active: 'bg-amber-500 text-white' },
  { value: 'complete', label: 'Complete', chip: 'bg-emerald-100 text-emerald-800', active: 'bg-emerald-600 text-white' },
]

/** Absent or unknown reads as not started — never as "ready". */
export function binderStatusOf(student) {
  const value = student?.binder_status
  return BINDER_STATUSES.some((s) => s.value === value) ? value : DEFAULT_BINDER_STATUS
}

export function isBinderReady(student) {
  return binderStatusOf(student) === 'complete'
}

export function binderStatusMeta(student) {
  const value = binderStatusOf(student)
  return BINDER_STATUSES.find((s) => s.value === value)
}

/**
 * The manual reset. Imports are what normally drive attendance, so when one
 * has not been run the owner needs to say "this binder is used" by hand — and
 * that must clear the note too, not just the status.
 */
export const BINDER_RESET = { binder_status: DEFAULT_BINDER_STATUS, binder_note: null }

/**
 * One row per STUDENT for a day's sessions.
 *
 * The view still lists a chosen date's sessions, but status and note are the
 * student's, so a student who appears twice must not render two independent
 * controls that disagree. Collapsing to one row per student is what makes the
 * shared status visible rather than merely implied.
 *
 * Rows sort by first session time, then name — prep order is floor order.
 */
export function binderRows(sessions) {
  const byStudent = new Map()
  for (const session of sessions ?? []) {
    const student = session?.student
    if (!student?.id) continue
    const existing = byStudent.get(student.id)
    if (existing) {
      existing.sessionCount += 1
      if (session.start_time < existing.startTime) {
        existing.startTime = session.start_time
        existing.duration = session.duration
      }
    } else {
      byStudent.set(student.id, {
        studentId: student.id,
        student,
        startTime: session.start_time,
        duration: session.duration,
        sessionCount: 1,
      })
    }
  }
  return [...byStudent.values()].sort(
    (a, b) =>
      String(a.startTime ?? '').localeCompare(String(b.startTime ?? '')) ||
      String(a.student?.name ?? '').localeCompare(String(b.student?.name ?? '')),
  )
}

/** Header tallies. Counts STUDENTS, matching the one-row-per-student list. */
export function binderCounts(rows) {
  const counts = { not_started: 0, in_progress: 0, complete: 0 }
  for (const row of rows ?? []) counts[binderStatusOf(row.student)] += 1
  return counts
}
