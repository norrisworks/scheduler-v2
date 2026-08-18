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
 * A session Radius has vouched for: created from a file (source 'radius') or
 * matched by a committed file against an existing row (last_seen_in_radius,
 * written by the import for created/linked/updated/unchanged alike). Source
 * alone is NOT the signal — a matched-unchanged session keeps
 * source 'recurring', and reading source as "in Radius" is the broken signal
 * behind the 2026-08-17 wrong cancellations.
 */
export const isRadiusConfirmed = (s) =>
  s.source === 'radius' || s.last_seen_in_radius != null

/**
 * The CROSS-DAY notice: a standing-slot session NOT confirmed by any Radius
 * file whose date range covers its date, while the same student HAS
 * confirmed sessions elsewhere that week.
 *
 * THIS IS INFORMATION, NOT A SUGGESTION. Five sessions were wrongly
 * cancelled in one day (2026-08-17: Isaac M, Daijhen F, Matthias F,
 * Victoria F among them) when this detector presented the pattern as a
 * probable move and Radius merely carried an ADDITIONAL session. The file
 * cannot distinguish a move from an addition, so callers must present these
 * as a plain statement of fact with no suggested action and no move
 * language.
 *
 * Three silencers keep the notice rare and honest:
 *  - CONFIRMATION: a session any committed file listed is never mentioned.
 *  - COVERAGE: a date no committed file's range covers is never mentioned —
 *    "not confirmed" is only meaningful where Radius data exists at all.
 *  - THE COUNT GATE: the week's confirmed sessions must EQUAL the student's
 *    standing-slot count. MORE is an addition; FEWER means Radius doesn't
 *    carry the student's full week (most families are not scheduling through
 *    Radius). Neither is mentioned. This limits noise — it is not evidence.
 *
 * coverage: [{date_from, date_to}] of committed radius imports.
 * slotCounts: studentId -> count of active standing slots. A student absent
 * from the map is never mentioned: no counts, no arithmetic, no notice.
 * dismissedKeys: `${studentId}|${date}` — hide the notice for this week.
 * dismissedSlotDays: `${studentId}|${dayOfWeek}` — never show it again.
 */
export function findCrossDayConflicts(
  sessions,
  {
    dismissedKeys = new Set(),
    dismissedSlotDays = new Set(),
    slotCounts = new Map(),
    coverage = [],
  } = {},
) {
  const covered = (date) =>
    coverage.some((r) => r.date_from && r.date_to && r.date_from <= date && date <= r.date_to)

  const confirmedByStudentWeek = new Map()
  const confirmedDates = new Set()
  const seenIds = new Set()
  for (const s of sessions) {
    if (s.status !== 'scheduled' || !isRadiusConfirmed(s)) continue
    // Callers may merge overlapping lists (today's sessions + the week's
    // confirmed rows) — the same row must not count twice.
    if (s.id != null) {
      if (seenIds.has(s.id)) continue
      seenIds.add(s.id)
    }
    confirmedDates.add(`${s.student_id}|${s.date}`)
    const wk = `${s.student_id}|${weekAnchorOf(s.date)}`
    confirmedByStudentWeek.set(wk, [...(confirmedByStudentWeek.get(wk) ?? []), s])
  }

  const conflicts = []
  const noticed = new Set()
  for (const s of sessions) {
    if (s.source !== 'recurring' || s.status !== 'scheduled') continue
    if (isRadiusConfirmed(s)) continue
    if (!covered(s.date)) continue
    // A confirmed session on the SAME date is the same-day panel's job.
    if (confirmedDates.has(`${s.student_id}|${s.date}`)) continue
    const weekConfirmed =
      confirmedByStudentWeek.get(`${s.student_id}|${weekAnchorOf(s.date)}`) ?? []
    const sameWeek = weekConfirmed.filter((x) => x.date !== s.date)
    if (sameWeek.length === 0) continue
    const slotCount = slotCounts.get(s.student_id)
    if (slotCount === undefined || weekConfirmed.length !== slotCount) continue
    const key = conflictKey(s.student_id, s.date)
    if (noticed.has(key)) continue
    if (dismissedKeys.has(key)) continue
    if (dismissedSlotDays.has(`${s.student_id}|${dayOfWeek(s.date)}`)) continue
    noticed.add(key)
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
 * Import-preview variant of the cross-day notice: a recurring session the
 * plan FLAGGED (in-window but absent from the file) whose student has a file
 * row elsewhere in the same week. Same shape and same information-only rule
 * as findCrossDayConflicts, with the radius side as {date, start_time} stubs
 * from the file. Confirmation and coverage need no parameters here: the file
 * rows (all buckets, matched-unchanged included) ARE the confirmations, and
 * flagged sessions are in-window by construction.
 */
export function planCrossDayConflicts(
  centerPlan,
  { dismissedKeys = new Set(), dismissedSlotDays = new Set(), slotCounts = new Map() } = {},
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
    const weekRows = fileByStudentWeek.get(`${s.student_id}|${weekAnchorOf(s.date)}`) ?? []
    const sameWeek = weekRows.filter((x) => x.date !== s.date)
    if (sameWeek.length === 0) continue
    // The same count gate as the live detector: file rows that week must
    // EQUAL the standing-slot count, or this is an addition / an
    // incompletely-tracked week, and nothing is mentioned.
    const slotCount = slotCounts.get(s.student_id)
    if (slotCount === undefined || weekRows.length !== slotCount) continue
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
