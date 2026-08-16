import { INSTRUCTOR_PALETTE } from '../day/studentOptions'

export { INSTRUCTOR_PALETTE }

/**
 * Three clean axes replace the overlapping flags v1 accumulated:
 *   can_teach_*     — hard capability filter (unchanged)
 *   assignability   — replaces priority + last_resort
 *   instructor_rank — the owner's ordinal ranking (replaces tier), edited by
 *                     dragging the Instructors list, confidential like tier was
 * `priority`, `last_resort`, `prefers_behind`, `preferred` and `tier` have
 * been DROPPED from the database — any code that reaches for them is a bug.
 */
export const ASSIGNABILITY_OPTIONS = [
  { value: 'normal', label: 'Normal', hint: 'Considered in the usual phases' },
  {
    value: 'fallback_only',
    label: 'Fallback only',
    hint: 'Held to the final phase, and only if ranked for that student',
  },
]

export { GENDER_OPTIONS } from '../../lib/gender'

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
 * Configuration that would quietly stop this instructor from ever being
 * auto-assigned. Surfaced in the list and the form, and in Data health.
 */
export function instructorWarnings(instructor) {
  const warnings = []
  if (!LEVEL_FLAGS.some((f) => instructor[f.key])) {
    warnings.push('cannot teach any level, so will never be auto-assigned')
  }
  return warnings
}

/** The next unused palette colour, so new instructors don't collide. */
export function nextColor(instructors) {
  const taken = new Set(instructors.map((i) => (i.color ?? '').toUpperCase()))
  return INSTRUCTOR_PALETTE.find((c) => !taken.has(c.toUpperCase())) ?? INSTRUCTOR_PALETTE[0]
}
