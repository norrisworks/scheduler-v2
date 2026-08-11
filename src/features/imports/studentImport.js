import { pick } from './parseTable'
import {
  generateDisplayName,
  nameKey,
  splitName,
  violatesNamingConvention,
} from './namingConvention'

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
  { key: 'gender', headers: ['gender', 'sex'], normalize: (v) => v.trim().toLowerCase() || null },
  { key: 'slot_certainty', headers: ['slot_certainty', 'certainty'], normalize: normalizeCertainty },
  { key: 'performance', headers: ['performance'], normalize: normalizePerformance },
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

function normalizePerformance(value) {
  const v = value.trim().toLowerCase().replace(/[\s_]/g, '-')
  if (v.startsWith('behind')) return 'behind'
  if (v.startsWith('ahead')) return 'ahead'
  if (v.startsWith('at')) return 'at-level'
  return null
}

function normalizeBool(value) {
  const v = value.trim().toLowerCase()
  if (['y', 'yes', 'true', '1', 'x'].includes(v)) return true
  if (['n', 'no', 'false', '0', ''].includes(v)) return false
  return null
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
    fullName: pick(row, 'name', 'student_name', 'student'),
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
  const byRadius = new Map()
  const byName = new Map()
  for (const student of existingStudents) {
    if (student.radius_account) byRadius.set(student.radius_account.trim(), student)
    byName.set(nameKey(student.name), student)
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

  for (const raw of rows) {
    const row = readStudentRow(raw)
    if (!row.fullName && !row.radiusAccount) continue

    const match =
      (row.radiusAccount && byRadius.get(row.radiusAccount.trim())) ||
      byName.get(nameKey(row.fullName))

    if (match) {
      matchedIds.add(match.id)
      const patch = {}
      for (const [key, value] of Object.entries(row.values)) {
        if (changed(match[key], value)) patch[key] = value
      }
      // An existing student is NEVER renamed, whatever the file says.
      if (row.radiusAccount && !match.radius_account) patch.radius_account = row.radiusAccount

      if (Object.keys(patch).length > 0) {
        updated.push({ id: match.id, name: match.name, rowNumber: row.rowNumber, patch })
      } else {
        unchanged.push({ id: match.id, name: match.name })
      }
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
    created.push({
      rowNumber: row.rowNumber,
      fullName: row.fullName,
      name: generated.name,
      needsReview: generated.needsReview,
      reviewReason: generated.reason,
      values: { ...row.values, ...(row.radiusAccount ? { radius_account: row.radiusAccount } : {}) },
    })
  }

  const absent = existingStudents.filter((s) => !matchedIds.has(s.id) && s.active)

  return {
    created,
    updated,
    unchanged,
    problems,
    absent,
    // Names in the file that break the convention are worth surfacing even
    // when they match an existing student, since the file is the source.
    conventionWarnings: created.filter((c) => violatesNamingConvention(c.name)).length,
  }
}
