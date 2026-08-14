/** Option lists mirroring the check constraints on `students`. */

export const LEVEL_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'elementary', label: 'Elementary' },
  { value: 'middle', label: 'Middle' },
  { value: 'high', label: 'High' },
]

export const CERTAINTY_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'fixed', label: 'Fixed slot' },
  { value: 'flexible', label: 'Flexible' },
  { value: 'dropin', label: 'Drop-in' },
]

// The single measure of where a student is working. `students.performance`
// was a duplicate of this and has been DROPPED from the database.
export const ACADEMIC_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'behind', label: 'Behind' },
  { value: 'at_level', label: 'At level' },
  { value: 'ahead', label: 'Ahead' },
]

// M/F only — gender is used as a visible ranking-sort input, not decoration.
export { GENDER_OPTIONS } from '../../lib/gender'

/**
 * Radius enrollment status. This is the real signal for whether a student
 * should be on the schedule; `active` used to carry it alone, which meant
 * guessing from whether they had a standing slot.
 *
 * `schedulable: null` means "carries no opinion" — New is a lead, not an
 * enrollment, so it must never flip anyone on.
 */
export const ENROLLMENT_STATUSES = [
  { value: 'enrolled', label: 'Enrolled', schedulable: true, chip: 'bg-emerald-100 text-emerald-800' },
  { value: 'pre_enrolled', label: 'Pre-enrolled', schedulable: true, chip: 'bg-sky-100 text-sky-800' },
  { value: 'on_hold', label: 'On hold', schedulable: false, chip: 'bg-amber-100 text-amber-800' },
  { value: 'new', label: 'New', schedulable: null, chip: 'bg-violet-100 text-violet-800' },
  { value: 'inactive', label: 'Inactive', schedulable: false, chip: 'bg-zinc-200 text-zinc-600' },
]

export const ENROLLMENT_OPTIONS = [
  { value: '', label: 'Not set' },
  ...ENROLLMENT_STATUSES.map((s) => ({ value: s.value, label: s.label })),
]

export const enrollmentMeta = (value) =>
  ENROLLMENT_STATUSES.find((s) => s.value === value) ?? null

/** Radius spellings -> our keys. Unknown values are left unset, not guessed. */
export function normalizeEnrollmentStatus(value) {
  const v = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!v) return null
  if (v === 'enrolled') return 'enrolled'
  if (v === 'pre_enrolled' || v === 'preenrolled') return 'pre_enrolled'
  if (v === 'on_hold' || v === 'onhold' || v === 'hold') return 'on_hold'
  if (v === 'new') return 'new'
  if (v === 'inactive') return 'inactive'
  return null
}

/**
 * What this status implies for `active`. Returns null when the status says
 * nothing, so the caller leaves the flag alone rather than inventing one.
 */
export function activeFromEnrollment(status) {
  return enrollmentMeta(status)?.schedulable ?? null
}

export const NOTE_TYPES = [
  { value: 'heads_up', label: 'Heads up' },
  { value: 'standing', label: 'Standing' },
  { value: 'session_prep', label: 'Session prep' },
  { value: 'general', label: 'General' },
]

export const NOTE_TYPE_STYLE = {
  heads_up: 'bg-amber-100 text-amber-900',
  standing: 'bg-sky-100 text-sky-900',
  session_prep: 'bg-violet-100 text-violet-900',
  general: 'bg-slate-100 text-slate-700',
}

/** day_of_week on recurring_slots: 0 = Sunday … 6 = Saturday. */
export const DAYS = [
  { value: 0, short: 'Sun', label: 'Sunday' },
  { value: 1, short: 'Mon', label: 'Monday' },
  { value: 2, short: 'Tue', label: 'Tuesday' },
  { value: 3, short: 'Wed', label: 'Wednesday' },
  { value: 4, short: 'Thu', label: 'Thursday' },
  { value: 5, short: 'Fri', label: 'Friday' },
  { value: 6, short: 'Sat', label: 'Saturday' },
]

export const DURATION_OPTIONS = [30, 45, 60, 75, 90, 120]

/**
 * Empty strings from <select> and <input> have to become NULL, not ''.
 * `level` and `performance` carry check constraints that reject ''.
 */
export function emptyToNull(value) {
  return value === '' || value === undefined ? null : value
}

/** Attributes the day view and auto-assign depend on. Drives Data health. */
export function missingAttributes(student) {
  const missing = []
  if (!student.level) missing.push('level')
  if (!student.grade) missing.push('grade')
  if (!student.academic_status) missing.push('academic status')
  if (!student.slot_certainty) missing.push('slot certainty')
  if (!student.gender) missing.push('gender')
  return missing
}
