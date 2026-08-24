import { pick } from './parseTable'
import { isPlaceholderName, nameKey, splitName } from './namingConvention'
import { parseRadiusDate, parseRadiusTime } from './radiusImport'
import { centerInstant } from '../../lib/dates'

/**
 * Student Attendance Report (Radius) -> binder resets, and NOTHING else.
 *
 * Attendance is the only signal that a binder was used. The appointments
 * export says what was BOOKED; this one says who actually walked in, which is
 * the whole point — a no-show used to throw away the prep.
 *
 * Scheduled session times are irrelevant here. This importer never touches
 * sessions, assignments or the roster; the only column it writes is the
 * student's binder state.
 *
 * MATCHING. The attendance export carries NO per-student id. Lead Id and
 * Account Id are both FAMILY-level and identical across siblings — the three
 * Coyne children share lead 3069017 and one Account Id uuid. In the real 8/21
 * export, 25 of 105 leads cover more than one child, and the file holds 131
 * students, not 105. Student Id exists only in the Students export.
 *
 * The bridge is therefore (Lead Id + First Name), which is unique within a
 * family: 744 distinct pairs from the 744 Students-export rows that carry a
 * lead, zero duplicates. Both halves are stored on the student by the Students
 * import, so the mapping is recorded rather than inferred here.
 *
 * radius_account is NOT a match route: it holds the guardian NAME, and its
 * numeric suffix ('Tang, Jun | 3266135') is an account-level id from a
 * different space — 0 of 105 matched the file's lead ids.
 */

/** One attendance row, normalised. Returns nulls for anything unparseable. */
export function readAttendanceRow(row) {
  const first = pick(row, 'first_name')
  const last = pick(row, 'last_name')
  return {
    rowNumber: row.__row,
    leadId: String(pick(row, 'lead_id') ?? '').trim(),
    accountId: String(pick(row, 'account_id') ?? '').trim(),
    date: parseRadiusDate(pick(row, 'attendance_date', 'date')),
    arrival: parseRadiusTime(pick(row, 'arrival_time')),
    departure: parseRadiusTime(pick(row, 'departure_time')),
    firstName: first,
    lastName: last,
    fullName: `${first} ${last}`.trim(),
    centerName: pick(row, 'center'),
  }
}

/** A row is usable only if we can place it in time and identify the student. */
export function attendanceRowProblem(row) {
  if (!row.date) return 'unreadable attendance date'
  if (!row.departure) return 'unreadable departure time'
  if (!row.leadId && !row.fullName) return 'no lead id and no name'
  return null
}

/**
 * Every display name 'Micah Chun' could legitimately have been stored as.
 *
 * Rule 1 gives 'Micah C', but rule 2 gives 'Micah Ch' whenever two students
 * share a first name — and the roster really does hold 'Micah Ch'/'Micah Ho',
 * 'Charlotte Ju'/'Charlotte Yo'. Trying only the one-letter form misses every
 * student the convention disambiguated, which on the real 8/21 export was
 * three of nine misses.
 */
export function displayCandidates(fullName) {
  const { first, last } = splitName(fullName)
  if (!first || !last) return []
  const one = nameKey(`${first} ${last[0]}`)
  const two = nameKey(`${first} ${last.slice(0, 2)}`)
  return one === two ? [one] : [one, two]
}

/**
 * radius_lead_id first — exact, student-level, and what the Students export
 * carries. Everything after it is a name heuristic for students imported
 * before that column existed, and an ambiguous name matches NOTHING rather
 * than guessing: a wrong match silently clears the wrong child's binder.
 *
 * Deliberately NOT matched:
 *
 *  - Near-miss first names ('Haziq'/'Hazik'). That is a warning, not proof —
 *    a one-letter difference is as likely to be two siblings.
 *  - Placeholder names. Radius carries training records, and they arrive here
 *    looking like anyone else.
 *  - The GUARDIAN surname ('Audie Prykowski' filed as 'Audie K' on Joy
 *    Keller's account). Tried and removed: that key is first name + guardian
 *    initial and ignores the student's own surname, so the template row 'John
 *    Smith' matched the real 'John G' (account Germin). On the real 8/21
 *    export it made 2 matches, 1 of them wrong. A missed reset costs one
 *    manual click; a wrong one clears a child's binder with nobody looking.
 */
export function matchAttendanceStudent(row, students) {
  if (isPlaceholderName(row.fullName)) return { student: null, via: 'placeholder name' }

  if (row.leadId && row.firstName) {
    const byPair = students.filter(
      (s) =>
        String(s.radius_lead_id ?? '').trim() === row.leadId &&
        nameKey(s.radius_first_name) === nameKey(row.firstName),
    )
    if (byPair.length === 1) return { student: byPair[0], via: 'lead id + first name' }
    if (byPair.length > 1) return { student: null, via: 'ambiguous lead id + first name' }
    // A lead we know with a first name we do not is a sibling who is not on
    // our roster — fall through to the name routes rather than claiming one of
    // their siblings.
  }

  const candidates = displayCandidates(row.fullName)
  if (candidates.length > 0) {
    const byShape = students.filter((s) => candidates.includes(nameKey(s.name)))
    if (byShape.length === 1) return { student: byShape[0], via: 'name' }
    if (byShape.length > 1) return { student: null, via: 'ambiguous name' }
  }

  const full = nameKey(row.fullName)
  const byFull = students.filter((s) => nameKey(s.name) === full)
  if (byFull.length === 1) return { student: byFull[0], via: 'full name' }
  if (byFull.length > 1) return { student: null, via: 'ambiguous name' }

  return { student: null, via: null }
}

/**
 * The rule, in one place.
 *
 * Reset when the binder is not already clear AND the student left AFTER the
 * binder was last set. A binder marked complete after they walked out is a
 * re-prep for the next session and is left alone — that case is the reason
 * binder_status_set_at exists.
 */
export function decideReset(student, departedAt) {
  const status = student?.binder_status ?? 'not_started'
  if (status === 'not_started' && !student?.binder_note) {
    return { reset: false, reason: 'already not started' }
  }
  if (!departedAt) return { reset: false, reason: 'no readable departure' }

  const setAt = student?.binder_status_set_at ? new Date(student.binder_status_set_at) : null
  if (setAt && setAt.getTime() >= departedAt.getTime()) {
    return { reset: false, reason: 'prepped after they left — kept for next session' }
  }
  return { reset: true, reason: 'attended after the binder was prepped' }
}

/**
 * Groups the file by center, then by student, keeping each student's LATEST
 * departure. Latest is the one that matters: a student who attended Monday and
 * Friday against a binder prepped on Wednesday has still used it.
 */
export function planAttendanceImport(rows, { centersByName, studentsByCenter }) {
  const parsed = rows.map(readAttendanceRow)
  const skipped = []
  const unknownCenters = new Set()
  const perCenter = new Map()

  let dateFrom = null
  let dateTo = null

  for (const row of parsed) {
    const problem = attendanceRowProblem(row)
    if (problem) {
      skipped.push({ row, reason: problem })
      continue
    }

    const center = centersByName.get(nameKey(row.centerName))
    if (!center) {
      unknownCenters.add(row.centerName || '(blank)')
      skipped.push({ row, reason: `unknown center "${row.centerName}"` })
      continue
    }

    if (!dateFrom || row.date < dateFrom) dateFrom = row.date
    if (!dateTo || row.date > dateTo) dateTo = row.date

    if (!perCenter.has(center.id)) perCenter.set(center.id, { center, visits: new Map(), rows: 0 })
    const bucket = perCenter.get(center.id)
    bucket.rows += 1

    // Key on the PAIR. The lead alone is a family: keying on it merged the
    // three Coyne children into one bucket and let the last sibling out of the
    // door decide all three binders.
    const key =
      row.leadId && row.firstName
        ? `pair:${row.leadId}|${nameKey(row.firstName)}`
        : `name:${nameKey(row.fullName)}`
    const departedAt = centerInstant(row.date, row.departure)
    const existing = bucket.visits.get(key)
    if (!existing) {
      bucket.visits.set(key, { row, departedAt, visits: 1 })
    } else {
      existing.visits += 1
      if (departedAt && (!existing.departedAt || departedAt > existing.departedAt)) {
        existing.departedAt = departedAt
        existing.row = row
      }
    }
  }

  const centers = [...perCenter.values()].map((bucket) => {
    const students = studentsByCenter.get(bucket.center.id) ?? []
    const matched = []
    const unmatched = []

    for (const visit of bucket.visits.values()) {
      const { student, via } = matchAttendanceStudent(visit.row, students)
      if (!student) {
        unmatched.push({ ...visit, via })
        continue
      }
      matched.push({ ...visit, student, via, decision: decideReset(student, visit.departedAt) })
    }

    const sortByName = (a, b) => a.row.fullName.localeCompare(b.row.fullName)
    matched.sort(sortByName)
    unmatched.sort(sortByName)

    return {
      center: bucket.center,
      rows: bucket.rows,
      matched,
      unmatched,
      resets: matched.filter((m) => m.decision.reset),
      kept: matched.filter((m) => !m.decision.reset),
    }
  })

  centers.sort((a, b) => a.center.name.localeCompare(b.center.name))

  return {
    totalRows: rows.length,
    dateFrom,
    dateTo,
    skipped,
    unknownCenters: [...unknownCenters],
    centers,
  }
}

