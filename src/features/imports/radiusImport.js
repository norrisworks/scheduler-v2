import { pick } from './parseTable'
import { cleanPersonName, nameKey, splitName } from './namingConvention'

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
/** Both stored and exported account forms as plain 'First Last'. */
export function accountFullName(value) {
  const withoutId = String(value ?? '').split('|')[0].trim()
  if (!withoutId) return ''
  const parts = withoutId.split(',')
  // 'Keller, Joy' -> 'Joy Keller'; 'Joy Keller' is already right.
  return parts.length > 1 ? `${parts[1].trim()} ${parts[0].trim()}` : withoutId
}

export function accountKey(value) {
  return nameKey(accountFullName(value))
}

/** The display name this full name would collapse to: 'Landon Russell' -> 'landon r'. */
export function displayKeyFromFullName(fullName) {
  const { first, last } = splitName(cleanPersonName(fullName))
  if (!first) return ''
  return nameKey(last ? `${first} ${last[0]}` : first)
}

/**
 * v1 display names sometimes took the GUARDIAN's surname rather than the
 * student's — 'Audie Prykowski' on account 'Joy Keller' was entered as
 * 'Audie K'. So the account holder's surname is a legitimate second candidate
 * for the initial.
 */
export function displayKeyFromGuardian(studentName, accountName) {
  const first = splitName(studentName).first
  // Normalise 'Keller, Joy | 123' to 'Joy Keller' first, or the surname would
  // be read as 'Joy'.
  const guardianLast = splitName(accountFullName(accountName)).last
  if (!first || !guardianLast) return ''
  return nameKey(`${first} ${guardianLast[0]}`)
}

/** Cheap edit distance, capped — only used to SUGGEST, never to match. */
function closeEnough(a, b) {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 2) return false
  const longer = a.length >= b.length ? a : b
  const shorter = a.length >= b.length ? b : a
  if (longer.startsWith(shorter)) return true
  let diffs = 0
  for (let i = 0, j = 0; i < longer.length && j < shorter.length; i++, j++) {
    if (longer[i] !== shorter[j]) {
      diffs++
      if (diffs > 1) return false
      j--
    }
  }
  return diffs <= 1
}

/**
 * Students this row PROBABLY means, offered in the manual linking pass and
 * never applied on their own. Covers the two cases the deterministic rules
 * cannot: a first-name spelling variant ('Charis' vs 'Chariss'), and an
 * initial that matches neither the student's nor the guardian's surname.
 */
export function suggestStudents(row, students) {
  const first = nameKey(splitName(row.studentName).first)
  const studentInitial = nameKey(splitName(row.studentName).last?.[0] ?? '')
  const out = []

  for (const s of students) {
    const sFirst = nameKey(splitName(s.name).first)
    const sInitial = nameKey(splitName(s.name).last?.[0] ?? '')
    if (!sFirst) continue

    if (sFirst === first && sInitial !== studentInitial) {
      out.push({ student: s, why: `same first name, initial ${sInitial.toUpperCase()}` })
    } else if (sInitial && sInitial === studentInitial && closeEnough(sFirst, first)) {
      out.push({ student: s, why: 'first name spelled differently' })
    }
  }
  return out
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

/**
 * 'In-Center' / 'Online' -> the sessions.delivery_method values. The real
 * export carries exactly those two spellings; anything unrecognised (or blank)
 * is in_center, matching the column default — being wrong about a room beats
 * inventing an online session nobody scheduled.
 */
export function mapDelivery(value) {
  return String(value ?? '').trim().toLowerCase() === 'online' ? 'online' : 'in_center'
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
    delivery: mapDelivery(pick(row, 'delivery_method')),
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

  // v1 sometimes used the guardian's surname for the initial.
  const guardianKey = displayKeyFromGuardian(row.studentName, row.accountName)
  if (guardianKey) {
    const byGuardian = students.filter((s) => nameKey(s.name) === guardianKey)
    if (byGuardian.length === 1) return { student: byGuardian[0], via: "guardian's surname" }
    if (byGuardian.length > 1) return { student: null, via: 'ambiguous guardian surname' }
  }

  return { student: null, via: null }
}

const sessionKey = (studentId, date, startTime) => `${studentId}|${date}|${startTime}`

/**
 * The file-side identity of a row, recorded on the session it confirmed.
 * Radius has no stable appointment id, so this is the same natural key the
 * upsert uses, spelled from the file's own fields.
 */
export function radiusKeyOf(row) {
  return `${nameKey(row.studentName)}|${row.date}|${row.startTime}`
}

/**
 * Every session a committed import must mark as Radius-confirmed: one target
 * per MATCHED file row — created, linked, updated, AND unchanged. The
 * unchanged bucket is the one that was historically skipped: a file row that
 * matched an existing session byte-for-byte left no record that Radius had
 * listed it, so "not in Radius" silently meant "source is not radius" and the
 * cross-day detector reported confirmed sessions as absent (five wrong
 * cancellations on 2026-08-17). Unchanged targets must be written WITHOUT
 * touching source; the others ride the upsert.
 */
export function confirmationTargets(centerPlan) {
  const buckets = [
    ['created', centerPlan.created ?? []],
    ['linked', centerPlan.linked ?? []],
    ['updated', centerPlan.updated ?? []],
    ['unchanged', centerPlan.unchanged ?? []],
  ]
  const out = []
  for (const [bucket, entries] of buckets) {
    for (const { row, student } of entries) {
      if (!row || !student) continue
      out.push({
        bucket,
        studentId: student.id,
        date: row.date,
        startTime: row.startTime,
        radiusKey: radiusKeyOf(row),
      })
    }
  }
  return out
}

/**
 * Works out what the import would do, per center, without doing it.
 *
 * Sessions already in the database inside the file's date window but absent
 * from the file are FLAGGED, never deleted: Radius adoption is partial, so
 * absence carries no information.
 */
export function planRadiusImport(
  rows,
  { centersByName, centersById, studentsByCenter, existingSessions },
) {
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
        // A student who matches at ANOTHER center is never imported here and
        // never silently redirected there. It is always a question.
        const elsewhere = []
        for (const [otherId, otherStudents] of studentsByCenter) {
          if (otherId === centerId) continue
          const hit = matchStudent(row, otherStudents)
          if (hit.student) {
            elsewhere.push({
              student: hit.student,
              center: centersById?.get(otherId) ?? null,
              via: hit.via,
            })
          }
        }

        unmatched.push({
          ...row,
          reason: elsewhere.length
            ? `matches ${elsewhere[0].student.name} at ${elsewhere[0].center?.name ?? 'another center'}`
            : (via ?? 'no student with that name or account'),
          centerMismatch: elsewhere.length > 0 ? elsewhere : null,
          suggestions: elsewhere.length ? [] : suggestStudents(row, students),
        })
        continue
      }

      const key = sessionKey(student.id, row.date, row.startTime)
      seenKeys.add(key)
      const current = existing.get(key)
      const target = { status: row.status, duration: row.duration, delivery: row.delivery }

      if (!current) {
        created.push({ row, student, via, target })
      } else if (
        current.status !== target.status ||
        (current.duration ?? 60) !== target.duration ||
        // A session that moves online without changing time is still a change
        // — leaving it in "unchanged" would silently drop the delivery flip.
        (current.delivery_method ?? 'in_center') !== target.delivery
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
