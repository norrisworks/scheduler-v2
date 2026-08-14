/**
 * v1's option tables, kept so the cards read the same way to staff who have
 * been using v1 daily.
 */

// Small dot before the student's name.
export const SLOT_CERTAINTY = {
  fixed: { label: 'Fixed slot', color: '#22C55E' },
  flexible: { label: 'Flexible slot', color: '#EAB308' },
  dropin: { label: 'Drop-in', color: '#EF4444' },
}

// Pill badge under the time row. Old rows wrote these with a hyphen, current
// ones use an underscore, so both spellings resolve.
export const ACADEMIC_STATUS = {
  behind: { label: 'Behind', bg: '#FEE2E2', color: '#991B1B' },
  at_level: { label: 'At level', bg: '#E2E8F0', color: '#334155' },
  'at-level': { label: 'At level', bg: '#E2E8F0', color: '#334155' },
  ahead: { label: 'Ahead', bg: '#DCFCE7', color: '#166534' },
}

export const BRAND_RED = '#EC3A33'

/** v1 instructorColors palette — used when seeding or editing instructors. */
export const INSTRUCTOR_PALETTE = [
  '#E53935', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#00ACC1',
  '#FFD600', '#6D4C41', '#D81B60', '#3949AB', '#00897B', '#7CB342',
  '#000000', '#757575', '#FF6F00', '#5E35B1',
]
