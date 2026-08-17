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
