import { pick } from './parseTable'
import { nameKey, splitName } from './namingConvention'

/**
 * Radius appointment export -> v2 sessions.
 *
 * Radius has no stable session id, so a session is identified by
 * (student, date, start_time) and that is also the upsert key.
 */

export const STATUS_MAP = {
  scheduled: 'scheduled',
  attended: 'completed',
  cancelled: 'cancelled',
  'late cancelled': 'cancelled',
  canceled: 'cancelled',
  'late canceled': 'cancelled',
  'no show': 'no_show',
  noshow: 'no_show',
}

export function mapStatus(value) {
  return STATUS_MAP[String(value ?? '').trim().toLowerCase()] ?? null
}

/** '8/10/2026' -> '2026-08-10'. Radius writes M/D/YYYY, never ISO. */
export function parseRadiusDate(value) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value ?? '').trim())
  if (!m) return null
  const [, month, day, year] = m
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

/** '3:00 PM' -> '15:00:00'. */
export function parseRadiusTime(value) {
  const m = /^(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?$/.exec(String(value ?? '').trim())
  if (!m) return null
  let hour = Number(m[1]) % 12
  if (m[3].toLowerCase() === 'p') hour += 12
  return `${String(hour).padStart(2, '0')}:${m[2]}:00`
}

/**
 * v2 stores the account as 'Last, First | RadiusId'; the export writes it as
 * 'First Last'. Both collapse to the same comparable key.
 */
export function accountKey(value) {
  const withoutId = String(value ?? '').split('|')[0].trim()
  if (!withoutId) return ''
  const parts = withoutId.split(',')
  const normalized =
    parts.length > 1 ? `${parts[1].trim()} ${parts[0].trim()}` : withoutId
  return nameKey(normalized)
}

/** The display name this full name would collapse to: 'Landon Russell' -> 'landon r'. */
export function displayKeyFromFullName(fullName) {
  const { first, last } = splitName(fullName)
  if (!first) return ''
  return nameKey(last ? `${first} ${last[0]}` : first)
}

/**
 * Metadata that suggests a row was touched by a test or placeholder account.
 * Surfaced in the preview rather than imported silently.
 */
export function isSuspiciousActor(value) {
  const v = String(value ?? '').trim().toLowerCase()
  if (!v) return false
  if (['test', 'tester', 'n/a', 'na', 'unknown'].includes(v)) return true
  const parts = v.split(/\s+/)
  // 'test test' — the same word twice is never a real person.
  return parts.length === 2 && parts[0] === parts[1]
}

export function readRadiusRow(row) {
  const studentName = pick(row, 'student_name', 'student')
  return {
    rowNumber: row.__row,
    studentName,
    accountName: pick(row, 'account_name', 'account'),
    date: parseRadiusDate(pick(row, 'appointment_date', 'date')),
    startTime: parseRadiusTime(pick(row, 'appointment_time', 'time')),
    duration: Number(pick(row, 'session_duration', 'duration')) || 60,
    rawStatus: pick(row, 'session_status', 'status'),
    status: mapStatus(pick(row, 'session_status', 'status')),
    sessionType: pick(row, 'session_type'),
    deliveryMethod: pick(row, 'delivery_method'),
    grade: pick(row, 'grade'),
    bookedOn: parseRadiusDate(pick(row, 'booked_on_date', 'booked_on')),
    lastModified: parseRadiusDate(pick(row, 'last_modified')),
    lastModifiedBy: pick(row, 'last_modified_by'),
    centerName: pick(row, 'center'),
  }
}

/**
 * How much a status proves about the slot. Cancelling in Radius flips an
 * existing row rather than adding one, so the mere existence of a live row
 * proves the slot is live — whatever order the rows appear in, and whatever
 * the timestamps say.
 */
const STATUS_WEIGHT = { scheduled: 2, completed: 2, no_show: 1, cancelled: 0 }
const statusWeight = (status) => STATUS_WEIGHT[status] ?? 0

/**
 * Cancel-and-rebook writes two rows for one slot. Group by
 * (student, date, time): if ANY row is live (Scheduled or Attended) the slot
 * is live and that row wins, newest Booked on date first among several live
 * ones. If every row is cancelled, the slot is cancelled.
 *
 * This is deterministic without needing timestamps to agree — which matters,
 * because `Last modified` ties in real exports (both Fenstermacher rows on
 * 8/12 show 8/10) and could never have broken the tie.
 *
 * A no-show sits between the two: it is not live, but it is a real outcome
 * and outranks a cancellation rather than being discarded by it.
 */
export function resolveRebookings(rows) {
  const bySlot = new Map()
  for (const row of rows) {
    const key = `${nameKey(row.studentName)}|${row.date}|${row.startTime}`
    const list = bySlot.get(key)
    if (list) list.push(row)
    else bySlot.set(key, [row])
  }

  const kept = []
  const superseded = []
  for (const list of bySlot.values()) {
    if (list.length === 1) {
      kept.push(list[0])
      continue
    }
    const ordered = [...list].sort(
      (a, b) =>
        statusWeight(b.status) - statusWeight(a.status) ||
        String(b.bookedOn ?? '').localeCompare(String(a.bookedOn ?? '')) ||
        b.rowNumber - a.rowNumber,
    )
    kept.push(ordered[0])
    superseded.push({ winner: ordered[0], losers: ordered.slice(1) })
  }
  return { kept, superseded }
}

/**
 * Matches a row to a student WITHIN ITS OWN CENTER. Account is checked first
 * where it exists, but an account is shared by siblings, so the student's own
 * first name must agree too.
 */
export function matchStudent(row, students) {
  const rowAccount = accountKey(row.accountName)
  const rowFirst = nameKey(splitName(row.studentName).first)
  const rowDisplay = displayKeyFromFullName(row.studentName)

  if (rowAccount) {
    const byAccount = students.filter(
      (s) => s.radius_account && accountKey(s.radius_account) === rowAccount,
    )
    const withName = byAccount.filter((s) => nameKey(splitName(s.name).first) === rowFirst)
    if (withName.length === 1) return { student: withName[0], via: 'account + name' }
    if (withName.length > 1) return { student: null, via: 'ambiguous account + name' }
  }

  const byDisplay = students.filter((s) => nameKey(s.name) === rowDisplay)
  if (byDisplay.length === 1) return { student: byDisplay[0], via: 'name' }
  if (byDisplay.length > 1) return { student: null, via: 'ambiguous name' }

  return { student: null, via: null }
}

const sessionKey = (studentId, date, startTime) => `${studentId}|${date}|${startTime}`

/**
 * Works out what the import would do, per center, without doing it.
 *
 * Sessions already in the database inside the file's date window but absent
 * from the file are FLAGGED, never deleted: Radius adoption is partial, so
 * absence carries no information.
 */
export function planRadiusImport(rows, { centersByName, studentsByCenter, existingSessions }) {
  const parsed = rows.map(readRadiusRow).filter((r) => r.studentName || r.accountName)

  const unparsable = parsed.filter((r) => !r.date || !r.startTime || !r.status)
  const usable = parsed.filter((r) => r.date && r.startTime && r.status)

  const { kept, superseded } = resolveRebookings(usable)

  const byCenter = new Map()
  const unknownCenter = []

  for (const row of kept) {
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
    const students = studentsByCenter.get(centerId) ?? []
    const existing = new Map(
      (existingSessions ?? [])
        .filter((s) => s.center_id === centerId)
        .map((s) => [sessionKey(s.student_id, s.date, s.start_time), s]),
    )

    const created = []
    const updated = []
    const unchanged = []
    const unmatched = []
    const seenKeys = new Set()

    for (const row of bucket.rows) {
      const { student, via } = matchStudent(row, students)
      if (!student) {
        unmatched.push({ ...row, reason: via ?? 'no student with that name or account' })
        continue
      }

      const key = sessionKey(student.id, row.date, row.startTime)
      seenKeys.add(key)
      const current = existing.get(key)
      const target = { status: row.status, duration: row.duration }

      if (!current) {
        created.push({ row, student, via, target })
      } else if (
        current.status !== target.status ||
        (current.duration ?? 60) !== target.duration
      ) {
        updated.push({ row, student, via, current, target })
      } else {
        unchanged.push({ row, student })
      }
    }

    // Anything the DB has in the window that the file did not mention.
    const dates = new Set(bucket.rows.map((r) => r.date))
    const flagged = [...existing.entries()]
      .filter(([key, s]) => dates.has(s.date) && !seenKeys.has(key))
      .map(([, s]) => s)

    results.push({
      center: bucket.center,
      created,
      updated,
      unchanged,
      unmatched,
      flagged,
      dates: [...dates].sort(),
    })
  }

  return {
    centers: results.sort((a, b) => a.center.name.localeCompare(b.center.name)),
    superseded,
    unparsable,
    unknownCenter,
    suspicious: kept.filter((r) => isSuspiciousActor(r.lastModifiedBy)),
    totalRows: parsed.length,
  }
}
