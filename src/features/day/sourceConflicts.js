/**
 * Source conflicts: a family moves their time in Radius, the import creates
 * the radius-source session, and the old recurring-source session stays — the
 * student is on the day twice. Nothing here auto-cancels anything: detection
 * produces a list, and every resolution is a person clicking a button.
 *
 * A conflict is one (student, date) holding BOTH a scheduled radius-source
 * session AND a scheduled recurring-source session, unless that pair was
 * dismissed as a genuine double session ("keep both").
 */

export const conflictKey = (studentId, date) => `${studentId}|${date}`

/**
 * sessions: rows with id, student_id, date, start_time, duration, status,
 * source (student.name optional, carried through when present).
 * dismissedKeys: Set of conflictKey() strings.
 */
export function findSourceConflicts(sessions, dismissedKeys = new Set()) {
  const byPair = new Map()
  for (const s of sessions) {
    if (s.status !== 'scheduled') continue
    if (s.source !== 'radius' && s.source !== 'recurring') continue
    const key = conflictKey(s.student_id, s.date)
    const pair = byPair.get(key) ?? { radius: [], recurring: [] }
    pair[s.source].push(s)
    byPair.set(key, pair)
  }

  const conflicts = []
  for (const [key, pair] of byPair) {
    if (pair.radius.length === 0 || pair.recurring.length === 0) continue
    if (dismissedKeys.has(key)) continue
    const sample = pair.radius[0]
    conflicts.push({
      key,
      studentId: sample.student_id,
      date: sample.date,
      name: sample.student?.name ?? pair.recurring[0].student?.name ?? null,
      centerId: sample.center_id ?? pair.recurring[0].center_id ?? null,
      radius: [...pair.radius].sort((a, b) => a.start_time.localeCompare(b.start_time)),
      recurring: [...pair.recurring].sort((a, b) => a.start_time.localeCompare(b.start_time)),
    })
  }
  return conflicts.sort((a, b) => a.date.localeCompare(b.date) || (a.name ?? '').localeCompare(b.name ?? ''))
}

import { addDays, dayOfWeek } from '../../lib/dates'

/** Sunday-anchored week, matching the materializer's pairing. */
export const weekAnchorOf = (dateISO) => addDays(dateISO, -dayOfWeek(dateISO))

/**
 * The CROSS-DAY pattern: the parent moves Tuesday to Monday in Radius, the
 * import creates Monday, and Tuesday's standing-slot session stays (absence
 * never deletes — rule one is always err toward keeping). The student is on
 * the week twice on different days.
 *
 * This is a QUESTION, never a conclusion: the same shape is also a makeup or
 * a vacation swap, which are common. Detection only — every resolution is a
 * person choosing.
 *
 * A conflict is one scheduled recurring-source session R where, in R's week,
 * the student has ≥1 scheduled radius-source session on a DIFFERENT date and
 * none on R's own date (same-date pairs are the other conflict type).
 *
 * dismissedKeys: `${studentId}|${date}` — "keep both, this week".
 * dismissedSlotDays: `${studentId}|${dayOfWeek}` — "never ask about this slot".
 */
export function findCrossDayConflicts(
  sessions,
  { dismissedKeys = new Set(), dismissedSlotDays = new Set() } = {},
) {
  const radiusByStudentWeek = new Map()
  const radiusDates = new Set()
  const seenIds = new Set()
  for (const s of sessions) {
    if (s.source !== 'radius' || s.status !== 'scheduled') continue
    // Callers may merge overlapping lists (today's sessions + the week's
    // radius rows) — the same row must not count twice.
    if (s.id != null) {
      if (seenIds.has(s.id)) continue
      seenIds.add(s.id)
    }
    radiusDates.add(`${s.student_id}|${s.date}`)
    const wk = `${s.student_id}|${weekAnchorOf(s.date)}`
    radiusByStudentWeek.set(wk, [...(radiusByStudentWeek.get(wk) ?? []), s])
  }

  const conflicts = []
  for (const s of sessions) {
    if (s.source !== 'recurring' || s.status !== 'scheduled') continue
    if (radiusDates.has(`${s.student_id}|${s.date}`)) continue
    const sameWeek = (radiusByStudentWeek.get(`${s.student_id}|${weekAnchorOf(s.date)}`) ?? []).filter(
      (x) => x.date !== s.date,
    )
    if (sameWeek.length === 0) continue
    const key = conflictKey(s.student_id, s.date)
    if (dismissedKeys.has(key)) continue
    if (dismissedSlotDays.has(`${s.student_id}|${dayOfWeek(s.date)}`)) continue
    conflicts.push({
      key,
      studentId: s.student_id,
      date: s.date,
      dayOfWeek: dayOfWeek(s.date),
      name: s.student?.name ?? null,
      centerId: s.center_id ?? null,
      recurring: [s],
      radius: [...sameWeek].sort((a, b) => a.date.localeCompare(b.date)),
    })
  }
  return conflicts.sort(
    (a, b) => a.date.localeCompare(b.date) || (a.name ?? '').localeCompare(b.name ?? ''),
  )
}

/**
 * Import-preview variant of the cross-day pattern: a recurring session the
 * plan FLAGGED (in-window but absent from the file) whose student has a file
 * row elsewhere in the same week. Same shape as findCrossDayConflicts, with
 * the radius side as {date, start_time} stubs from the file.
 */
export function planCrossDayConflicts(
  centerPlan,
  { dismissedKeys = new Set(), dismissedSlotDays = new Set() } = {},
) {
  const fileByStudentWeek = new Map()
  for (const entry of [
    ...(centerPlan.created ?? []),
    ...(centerPlan.linked ?? []),
    ...(centerPlan.updated ?? []),
    ...(centerPlan.unchanged ?? []),
  ]) {
    if (!entry.row || entry.row.status !== 'scheduled') continue
    const wk = `${entry.student.id}|${weekAnchorOf(entry.row.date)}`
    fileByStudentWeek.set(wk, [
      ...(fileByStudentWeek.get(wk) ?? []),
      { date: entry.row.date, start_time: entry.row.startTime, duration: entry.row.duration ?? 60 },
    ])
  }

  const conflicts = []
  for (const s of centerPlan.flagged ?? []) {
    if (s.source !== 'recurring' || s.status !== 'scheduled') continue
    const sameWeek = (fileByStudentWeek.get(`${s.student_id}|${weekAnchorOf(s.date)}`) ?? []).filter(
      (x) => x.date !== s.date,
    )
    if (sameWeek.length === 0) continue
    const key = conflictKey(s.student_id, s.date)
    if (dismissedKeys.has(key)) continue
    if (dismissedSlotDays.has(`${s.student_id}|${dayOfWeek(s.date)}`)) continue
    conflicts.push({
      key,
      studentId: s.student_id,
      date: s.date,
      dayOfWeek: dayOfWeek(s.date),
      name: s.student?.name ?? null,
      centerId: s.center_id ?? null,
      recurring: [s],
      radius: [...sameWeek].sort((a, b) => a.date.localeCompare(b.date)),
    })
  }
  return conflicts.sort(
    (a, b) => a.date.localeCompare(b.date) || (a.name ?? '').localeCompare(b.name ?? ''),
  )
}

/**
 * The import-preview variant: conflicts the FILE is about to cause (or keep).
 * Any row the plan will create/update/keep as a radius session whose
 * (student, date) also has a scheduled recurring session in the database.
 * Returns the same shape findSourceConflicts does, with the file rows in
 * `radius` as {start_time, duration} stubs when the session doesn't exist yet.
 */
export function planSourceConflicts(centerPlan, existingSessions, dismissedKeys = new Set()) {
  const fileRows = [
    ...centerPlan.created.map((c) => ({ student: c.student, row: c.row })),
    ...centerPlan.updated.map((u) => ({ student: u.student, row: u.row })),
    ...centerPlan.unchanged.map((u) => ({ student: u.student, row: u.row ?? null })),
  ].filter((e) => e.row && e.row.status === 'scheduled')

  const recurringByPair = new Map()
  for (const s of existingSessions) {
    if (s.source !== 'recurring' || s.status !== 'scheduled') continue
    const key = conflictKey(s.student_id, s.date)
    recurringByPair.set(key, [...(recurringByPair.get(key) ?? []), s])
  }

  const byPair = new Map()
  for (const { student, row } of fileRows) {
    const key = conflictKey(student.id, row.date)
    if (dismissedKeys.has(key)) continue
    const recurring = recurringByPair.get(key)
    if (!recurring) continue
    const entry = byPair.get(key) ?? {
      key,
      studentId: student.id,
      date: row.date,
      name: student.name,
      radius: [],
      recurring: [...recurring].sort((a, b) => a.start_time.localeCompare(b.start_time)),
    }
    entry.radius.push({ start_time: row.startTime, duration: row.duration ?? 60 })
    byPair.set(key, entry)
  }

  return [...byPair.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.name ?? '').localeCompare(b.name ?? ''),
  )
}
