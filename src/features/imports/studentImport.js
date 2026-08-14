import { pick } from './parseTable'
import {
  displayNameShape,
  generateDisplayName,
  isPlaceholderName,
  nameKey,
  nearlySameFirstName,
  splitName,
  violatesNamingConvention,
} from './namingConvention'
import { activeFromEnrollment, normalizeEnrollmentStatus } from '../roster/studentFields'
import { accountKey } from './radiusImport'

/**
 * Fields the student roster importer understands. Anything else in the file
 * is ignored rather than rejected — exports carry plenty of columns we do not
 * model, and failing on them would make the importer useless.
 *
 * Deliberately absent: any notion of rankings or instructor priority. Pins
 * replaced hand-ranking permanently and must not come back through an upload.
 */
export const STUDENT_FIELDS = [
  { key: 'grade', headers: ['grade', 'grade_level'] },
  { key: 'level', headers: ['level', 'school_level'], normalize: normalizeLevel },
  { key: 'school', headers: ['school'] },
  { key: 'gender', headers: ['gender', 'sex'], normalize: normalizeGender },
  { key: 'slot_certainty', headers: ['slot_certainty', 'certainty'], normalize: normalizeCertainty },
  // `performance` was a duplicate of academic status; a file column spelled
  // either way lands in academic_status now.
  {
    key: 'academic_status',
    headers: ['academic_status', 'performance', 'academic'],
    normalize: normalizeAcademic,
  },
  {
    key: 'needs_schoolwork',
    headers: ['needs_schoolwork', 'schoolwork', 'supp'],
    normalize: normalizeBool,
  },
  {
    key: 'default_duration',
    headers: ['default_duration', 'duration'],
    normalize: (v) => (v === '' ? null : Number(v) || null),
  },
  // From the Students export. This replaces inferring enrollment from whether
  // a student happened to have a standing slot.
  {
    key: 'enrollment_status',
    headers: ['enrollment_status', 'enrollment'],
    normalize: normalizeEnrollmentStatus,
  },
]

function normalizeLevel(value) {
  const v = value.trim().toLowerCase()
  if (v.startsWith('elem')) return 'elementary'
  if (v.startsWith('mid')) return 'middle'
  if (v.startsWith('high')) return 'high'
  return null
}

function normalizeCertainty(value) {
  const v = value.trim().toLowerCase().replace(/[\s-]/g, '')
  if (v.startsWith('fix')) return 'fixed'
  if (v.startsWith('flex')) return 'flexible'
  if (v.startsWith('drop')) return 'dropin'
  return null
}

function normalizeAcademic(value) {
  const v = value.trim().toLowerCase().replace(/[\s-]/g, '_')
  if (v.startsWith('behind')) return 'behind'
  if (v.startsWith('ahead')) return 'ahead'
  if (v.startsWith('at')) return 'at_level'
  return null
}

/** M/F only — anything else is left unset rather than invented. */
function normalizeGender(value) {
  const v = value.trim().toLowerCase()
  if (v.startsWith('f')) return 'f'
  if (v.startsWith('m')) return 'm'
  return null
}

function normalizeBool(value) {
  const v = value.trim().toLowerCase()
  if (['y', 'yes', 'true', '1', 'x'].includes(v)) return true
  if (['n', 'no', 'false', '0', ''].includes(v)) return false
  return null
}

/**
 * A roster CSV may carry one 'Name' column; the Radius Students export splits
 * First/Last and adds Preferred Name, which is what the student actually goes
 * by and so wins for the display name.
 */
export function readFullName(row) {
  const single = pick(row, 'name', 'student_name', 'student')
  if (single) return single
  const first = pick(row, 'preferred_name') || pick(row, 'first_name')
  const last = pick(row, 'last_name')
  return [first, last].filter(Boolean).join(' ')
}

export function readStudentRow(row) {
  const values = {}
  for (const field of STUDENT_FIELDS) {
    const raw = pick(row, ...field.headers)
    if (raw === '') continue
    const value = field.normalize ? field.normalize(raw) : raw
    if (value !== null) values[field.key] = value
  }
  return {
    rowNumber: row.__row,
    fullName: readFullName(row),
    radiusAccount: pick(row, 'radius_account', 'account_name', 'account'),
    values,
  }
}

const changed = (before, after) => {
  if (typeof after === 'boolean') return Boolean(before) !== after
  return (before ?? null) !== after
}

/**
 * Works out what an import would do without doing it: which rows create a
 * student, which update one, which are already correct, and which existing
 * students the file simply doesn't mention (never touched — a roster export
 * may legitimately be partial).
 */
export function planStudentImport(rows, existingStudents) {
  // Accounts are stored as 'Last, First | RadiusId' but exported as
  // 'Last, First', so both sides go through the same normaliser. An account is
  // shared by siblings, so it is only decisive together with the first name.
  const byAccount = new Map()
  const byName = new Map()
  // first name + last initial -> students, for the third matching tier below.
  const byShape = new Map()
  for (const student of existingStudents) {
    if (student.radius_account) {
      const key = accountKey(student.radius_account)
      const list = byAccount.get(key) ?? []
      list.push(student)
      byAccount.set(key, list)
    }
    byName.set(nameKey(student.name), student)
    const shape = displayNameShape(student.name)
    if (shape) byShape.set(shape, [...(byShape.get(shape) ?? []), student])
  }

  // How many FILE rows sit on each account and each name shape. Both counts
  // are needed to tell a lone student from a set of siblings: three rows on
  // one account are three children, not three views of the same child.
  const rowsPerAccount = new Map()
  const rowsPerShape = new Map()
  for (const raw of rows) {
    const row = readStudentRow(raw)
    if (row.radiusAccount) {
      const key = accountKey(row.radiusAccount)
      rowsPerAccount.set(key, (rowsPerAccount.get(key) ?? 0) + 1)
    }
    const shape = displayNameShape(row.fullName)
    if (shape) rowsPerShape.set(shape, (rowsPerShape.get(shape) ?? 0) + 1)
  }

  // Names already in use, grown as the plan invents new ones, so two new
  // students in the same file cannot be given the same display name.
  const taken = existingStudents.map((s) => s.name)
  const matchedIds = new Set()

  // Two NEW students sharing a first name both need two letters, so the
  // first one processed can't be given a bare initial. Existing students are
  // never renamed, so only incoming rows are counted here.
  const incomingFirstNames = new Map()
  for (const raw of rows) {
    const first = splitName(readStudentRow(raw).fullName).first.toLowerCase()
    if (first) incomingFirstNames.set(first, (incomingFirstNames.get(first) ?? 0) + 1)
  }
  const rosterFirstNames = new Set(
    existingStudents.map((s) => splitName(s.name).first.toLowerCase()),
  )

  const created = []
  const updated = []
  const unchanged = []
  const problems = []
  // Rows that would have created a long-departed student. Counted rather than
  // dropped silently, so the preview still accounts for every row in the file.
  const skipped = []

  for (const raw of rows) {
    const row = readStudentRow(raw)
    if (!row.fullName && !row.radiusAccount) continue

    // Tier 1: the Radius account. Siblings SHARE an account, so it only
    // identifies a student together with the first name. The lone-holder
    // shortcut (which lets 'Alexander Patel' find a stored 'Alex P') is only
    // safe when one student and one row sit on the account — otherwise three
    // sibling rows all collapse onto whichever child we happen to have, and
    // the last row silently overwrites the others' grade, school and status.
    const key = row.radiusAccount ? accountKey(row.radiusAccount) : null
    const onAccount = key ? (byAccount.get(key) ?? []) : []
    const rowFirst = nameKey(splitName(row.fullName).first)
    const byFirstName = onAccount.filter((s) => nameKey(splitName(s.name).first) === rowFirst)
    const accountMatch =
      byFirstName.length === 1
        ? byFirstName[0]
        : onAccount.length === 1 && rowsPerAccount.get(key) === 1
          ? onAccount[0]
          : undefined

    // Tier 3: the display-name convention. A stored name never carries a full
    // last name, so 'Danielle Shaw' in the file is 'Danielle S' here and no
    // exact comparison can see it. Accepted only when the shape is unambiguous
    // on both sides — one student, one row — since it is a guess, not an id.
    const shape = displayNameShape(row.fullName)
    const sameShape = shape ? (byShape.get(shape) ?? []) : []
    const shapeMatch =
      sameShape.length === 1 && rowsPerShape.get(shape) === 1 ? sameShape[0] : undefined

    const match = accountMatch || byName.get(nameKey(row.fullName)) || shapeMatch

    if (match) {
      // Two rows landing on one student means the export lists them twice or
      // the match is wrong. Either way the second row must not quietly patch
      // over the first — surface it and let a person decide.
      if (matchedIds.has(match.id)) {
        problems.push({
          rowNumber: row.rowNumber,
          fullName: row.fullName,
          reason: `also matches ${match.name}, already taken by an earlier row — not applied`,
        })
        continue
      }
      matchedIds.add(match.id)
      const patch = {}
      for (const [key, value] of Object.entries(row.values)) {
        if (changed(match[key], value)) patch[key] = value
      }

      // Enrollment drives `active`, but only when it actually says something:
      // 'New' is a lead, not an enrollment, so it never switches anyone on.
      const implied = activeFromEnrollment(row.values.enrollment_status)
      if (implied !== null && Boolean(match.active) !== implied) patch.active = implied
      // An existing student is NEVER renamed, whatever the file says.
      if (row.radiusAccount && !match.radius_account) patch.radius_account = row.radiusAccount

      if (Object.keys(patch).length > 0) {
        updated.push({ id: match.id, name: match.name, rowNumber: row.rowNumber, patch })
      } else {
        unchanged.push({ id: match.id, name: match.name })
      }
      continue
    }

    // Nobody matched, so this row would create a student. A Radius export
    // carries the FULL history of a center, and the Blue Bell file is mostly
    // students who left years ago — 441 of 543 rows. Creating them just to
    // switch them off would bury the live roster, so an Inactive row is never
    // a new student. Only creation is gated: a student already here can still
    // be marked inactive by the same file.
    if (row.values.enrollment_status === 'inactive') {
      skipped.push({ rowNumber: row.rowNumber, fullName: row.fullName })
      continue
    }

    const first = splitName(row.fullName).first.toLowerCase()
    const generated = generateDisplayName(row.fullName, row.values.grade, taken, {
      sharesFirstName: rosterFirstNames.has(first) || (incomingFirstNames.get(first) ?? 0) > 1,
    })
    if (!generated.name) {
      problems.push({ rowNumber: row.rowNumber, fullName: row.fullName, reason: generated.reason })
      continue
    }
    taken.push(generated.name)
    const impliedActive = activeFromEnrollment(row.values.enrollment_status)

    // Before inventing a student, look for one we already have under a
    // near-miss spelling: the roster's 'Chariss E' is this file's 'Charis
    // Effraim'. Too weak to match on, strong enough to stop and ask.
    const lastInitial = splitName(row.fullName).last[0]?.toLowerCase()
    const lookalike = existingStudents.find(
      (s) =>
        !matchedIds.has(s.id) &&
        splitName(s.name).last[0]?.toLowerCase() === lastInitial &&
        nearlySameFirstName(splitName(s.name).first, splitName(row.fullName).first),
    )

    created.push({
      rowNumber: row.rowNumber,
      fullName: row.fullName,
      name: generated.name,
      needsReview: generated.needsReview || Boolean(lookalike) || isPlaceholderName(row.fullName),
      reviewReason: lookalike
        ? `looks like ${lookalike.name}, already on the roster — same student spelled differently?`
        : isPlaceholderName(row.fullName)
          ? 'a placeholder name, not a real student'
          : generated.reason,
      values: {
        ...row.values,
        ...(row.radiusAccount ? { radius_account: row.radiusAccount } : {}),
        // A new student with no usable enrollment signal starts inactive
        // rather than being assumed onto the schedule.
        active: impliedActive === true,
      },
    })
  }

  const absent = existingStudents.filter((s) => !matchedIds.has(s.id) && s.active)

  return {
    created,
    updated,
    unchanged,
    problems,
    skipped,
    absent,
    // Names in the file that break the convention are worth surfacing even
    // when they match an existing student, since the file is the source.
    conventionWarnings: created.filter((c) => violatesNamingConvention(c.name)).length,
  }
}

/**
 * Splits the file by its Center column before planning, so a Blue Bell export
 * can never create Blue Bell students inside Montgomeryville. The Radius
 * Students export carries a Center column; a hand-made roster CSV may not, and
 * those rows fall back to the center you are looking at.
 */
export function planStudentImportByCenter(
  rows,
  { centersByName, studentsByCenter, fallbackCenter },
) {
  const buckets = new Map()
  const unknownCenter = []

  for (const row of rows) {
    const named = pick(row, 'center')
    const center = named ? centersByName.get(nameKey(named)) : fallbackCenter
    if (!center) {
      unknownCenter.push({ row, centerName: named })
      continue
    }
    const bucket = buckets.get(center.id) ?? { center, rows: [], fromColumn: Boolean(named) }
    bucket.rows.push(row)
    buckets.set(center.id, bucket)
  }

  const centers = [...buckets.values()].map((bucket) => ({
    ...bucket,
    plan: planStudentImport(bucket.rows, studentsByCenter.get(bucket.center.id) ?? []),
  }))

  return {
    centers: centers.sort((a, b) => a.center.name.localeCompare(b.center.name)),
    unknownCenter,
    totalRows: rows.length,
  }
}
