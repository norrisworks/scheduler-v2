/** Option lists mirroring the check constraints on `students`. */

export const LEVEL_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'elementary', label: 'Elementary' },
  { value: 'middle', label: 'Middle' },
  { value: 'high', label: 'High' },
]

export const PERFORMANCE_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'behind', label: 'Behind' },
  { value: 'at-level', label: 'At level' },
  { value: 'ahead', label: 'Ahead' },
]

export const CERTAINTY_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'fixed', label: 'Fixed slot' },
  { value: 'flexible', label: 'Flexible' },
  { value: 'dropin', label: 'Drop-in' },
]

// academic_status is free text in the schema; these are v1's values.
export const ACADEMIC_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'behind', label: 'Behind' },
  { value: 'at_level', label: 'At level' },
  { value: 'ahead', label: 'Ahead' },
]

export const GENDER_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'f', label: 'F' },
  { value: 'm', label: 'M' },
  { value: 'other', label: 'Other' },
]

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
  if (!student.performance) missing.push('performance')
  if (!student.slot_certainty) missing.push('slot certainty')
  return missing
}
