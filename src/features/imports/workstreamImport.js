import { pick } from './parseTable'
import { nameKey, splitName } from './namingConvention'
import { parseRadiusDate, parseRadiusTime } from './radiusImport'

/**
 * Workstream shifts import.
 *
 * The deletion rule is the OPPOSITE of Radius: the file is authoritative for
 * staffing, so a shift inside the file's date window that the file does not
 * mention has been removed and is deleted here too. That makes the preview
 * the only safeguard, so deletions are always listed in full before commit.
 *
 * The real export is a grouped timesheet: a bare name row introduces each
 * employee and a 'Total:' row closes them out. Neither is data.
 */

export function isDataRow(row) {
  const date = pick(row, 'date')
  const timeIn = pick(row, 'time_in', 'clock_in')
  if (!date || !timeIn) return false
  // 'Total: 648' lands in the duration column on summary rows.
  return !String(pick(row, 'duration_minutes', 'duration')).toLowerCase().startsWith('total')
}

export function readWorkstreamRow(row) {
  return {
    rowNumber: row.__row,
    employeeName: pick(row, 'employee_name', 'name'),
    employeeId: pick(row, 'employee_id'),
    date: parseRadiusDate(pick(row, 'date')),
    startTime: parseRadiusTime(pick(row, 'time_in', 'clock_in')),
    endTime: parseRadiusTime(pick(row, 'time_out', 'clock_out')),
    role: pick(row, 'scheduling_role', 'role'),
    centerName: pick(row, 'center'),
  }
}

/**
 * Matches on workstream_id when the export carries one and v2 has it stored,
 * then on the full name, then on a lone first name — v2 holds several
 * instructors by first name only ('Roy', 'Sophie').
 */
export function matchInstructor(row, instructors) {
  const id = String(row.employeeId ?? '').trim()
  if (id) {
    const byId = instructors.filter((i) => String(i.workstream_id ?? '').trim() === id)
    if (byId.length === 1) return { instructor: byId[0], via: 'workstream id' }
  }

  const full = nameKey(row.employeeName)
  const byFull = instructors.filter((i) => nameKey(i.name) === full)
  if (byFull.length === 1) return { instructor: byFull[0], via: 'name' }
  if (byFull.length > 1) return { instructor: null, via: 'ambiguous name' }

  const first = nameKey(splitName(row.employeeName).first)
  const byFirst = instructors.filter((i) => nameKey(i.name) === first)
  if (byFirst.length === 1) return { instructor: byFirst[0], via: 'first name' }
  if (byFirst.length > 1) return { instructor: null, via: 'ambiguous first name' }

  return { instructor: null, via: null }
}

/** Instructors whose first name matches — offered, never applied silently. */
export function suggestInstructors(row, instructors) {
  const first = nameKey(splitName(row.employeeName).first)
  return instructors
    .filter((i) => nameKey(splitName(i.name).first) === first)
    .map((i) => ({ instructor: i, why: 'same first name' }))
}

const shiftKey = (instructorId, date, startTime) => `${instructorId}|${date}|${startTime}`

export function planWorkstreamImport(
  rows,
  { centersByName, centersById, instructorsByCenter, existingShifts },
) {
  const parsed = rows.filter(isDataRow).map(readWorkstreamRow)
  const unparsable = parsed.filter((r) => !r.date || !r.startTime || !r.endTime)
  const usable = parsed.filter((r) => r.date && r.startTime && r.endTime)

  const byCenter = new Map()
  const unknownCenter = []
  for (const row of usable) {
    const center = centersByName.get(nameKey(row.centerName))
    if (!center) {
      unknownCenter.push(row)
      continue
    }
    const bucket = byCenter.get(center.id) ?? { center, rows: [] }
    bucket.rows.push(row)
    byCenter.set(center.id, bucket)
  }

  const results = []
  for (const [centerId, bucket] of byCenter) {
    const instructors = instructorsByCenter.get(centerId) ?? []
    const existing = new Map(
      (existingShifts ?? [])
        .filter((s) => s.center_id === centerId)
        .map((s) => [shiftKey(s.instructor_id, s.date, s.start_time), s]),
    )

    const created = []
    const updated = []
    const unchanged = []
    const unmatched = []
    const seen = new Set()

    for (const row of bucket.rows) {
      const { instructor, via } = matchInstructor(row, instructors)
      if (!instructor) {
        const elsewhere = []
        for (const [otherId, others] of instructorsByCenter) {
          if (otherId === centerId) continue
          const hit = matchInstructor(row, others)
          if (hit.instructor) {
            elsewhere.push({ instructor: hit.instructor, center: centersById?.get(otherId) ?? null })
          }
        }
        unmatched.push({
          ...row,
          reason: elsewhere.length
            ? `works at ${elsewhere[0].center?.name ?? 'another center'}`
            : (via ?? 'no instructor with that id or name'),
          centerMismatch: elsewhere.length > 0 ? elsewhere : null,
          suggestions: elsewhere.length ? [] : suggestInstructors(row, instructors),
        })
        continue
      }

      const key = shiftKey(instructor.id, row.date, row.startTime)
      seen.add(key)
      const current = existing.get(key)

      if (!current) created.push({ row, instructor, via })
      else if (current.end_time !== row.endTime) updated.push({ row, instructor, current })
      else unchanged.push({ row, instructor })
    }

    // The opposite of Radius: absence IS information here.
    const dates = new Set(bucket.rows.map((r) => r.date))
    const matchedInstructorIds = new Set(
      [...created, ...updated, ...unchanged].map((x) => x.instructor.id),
    )
    const removed = [...existing.entries()]
      .filter(([key, s]) => dates.has(s.date) && !seen.has(key))
      .map(([, s]) => ({
        shift: s,
        // A shift for someone the file never mentions is a different risk from
        // one the file mentions but omits on that day.
        instructorInFile: matchedInstructorIds.has(s.instructor_id),
      }))

    results.push({
      center: bucket.center,
      created,
      updated,
      unchanged,
      unmatched,
      removed,
      dates: [...dates].sort(),
    })
  }

  return {
    centers: results.sort((a, b) => a.center.name.localeCompare(b.center.name)),
    unparsable,
    unknownCenter,
    totalRows: parsed.length,
  }
}
