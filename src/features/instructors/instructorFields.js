import { INSTRUCTOR_PALETTE } from '../day/studentOptions'

export { INSTRUCTOR_PALETTE }

export const PRIORITY_OPTIONS = [
  { value: 'primary', label: 'Primary' },
  { value: 'backup', label: 'Backup' },
]

export const GENDER_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'f', label: 'F' },
  { value: 'm', label: 'M' },
  { value: 'other', label: 'Other' },
]

export const LEVEL_FLAGS = [
  { key: 'can_teach_elementary', short: 'E', label: 'Elementary' },
  { key: 'can_teach_middle', short: 'M', label: 'Middle' },
  { key: 'can_teach_high', short: 'H', label: 'High' },
]

/** Which levels this instructor can take, as the sidebar's 'EMH' string. */
export function capabilityString(instructor) {
  return LEVEL_FLAGS.filter((f) => instructor[f.key])
    .map((f) => f.short)
    .join('')
}

/**
 * Configuration that would quietly break auto-assign (step 6) if left as-is.
 * An instructor who can teach nothing is never assignable, and last_resort
 * only ever applies through an explicit pin.
 */
export function instructorWarnings(instructor) {
  const warnings = []
  if (!LEVEL_FLAGS.some((f) => instructor[f.key])) {
    warnings.push('cannot teach any level, so will never be auto-assigned')
  }
  if (instructor.last_resort && instructor.priority === 'primary') {
    warnings.push('is last-resort but marked primary')
  }
  return warnings
}

/** The next unused palette colour, so new instructors don't collide. */
export function nextColor(instructors) {
  const taken = new Set(instructors.map((i) => (i.color ?? '').toUpperCase()))
  return INSTRUCTOR_PALETTE.find((c) => !taken.has(c.toUpperCase())) ?? INSTRUCTOR_PALETTE[0]
}
