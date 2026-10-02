/**
 * The session card's top-left marker: one glyph answering "how firm is this
 * booking, and who made it". It replaced two weaker signals — the student
 * certainty dot and the inline Radius R — with a single vocabulary:
 *
 *   green R   — Radius, booked by a parent (or booker unknown)
 *   gray R    — Radius, booked by staff (the booking exists because WE made
 *               it, not because the family asked for it)
 *   green S   — standing slot, certainty fixed or not set (a new
 *               standing-slot student defaults to reliable, so blank reads
 *               as the green S)
 *   orange ●  — standing slot, certainty flexible or drop-in
 *   green ●   — manual, which includes rescheduled sessions
 *
 * Every marker carries a thin black outline so it reads on any card fill.
 */

/** Radius logins that mean a STAFF booking. Parents appear as plain names. */
export const STAFF_BOOKERS = ['william.griffin', 'allison.griffin']

export function isStaffBooker(name) {
  const key = String(name ?? '').trim().toLowerCase()
  return key !== '' && STAFF_BOOKERS.includes(key)
}

const GREEN = '#22C55E'
const GRAY = '#9CA3AF'
const ORANGE = '#F97316'

/** shape 'letter' carries a glyph; shape 'dot' is a filled circle. */
export function sessionMarker(session) {
  if (session.source === 'radius') {
    return isStaffBooker(session.radius_booked_by)
      ? { shape: 'letter', glyph: 'R', color: GRAY, title: 'Radius — booked by staff' }
      : { shape: 'letter', glyph: 'R', color: GREEN, title: 'Radius — booked by parent' }
  }
  if (session.source === 'recurring') {
    const certainty = session.student?.slot_certainty
    return certainty === 'flexible' || certainty === 'dropin'
      ? {
          shape: 'dot',
          color: ORANGE,
          title: `Standing slot — ${certainty === 'dropin' ? 'drop-in' : 'flexible'}`,
        }
      : { shape: 'letter', glyph: 'S', color: GREEN, title: 'Standing slot' }
  }
  // 'manual' — and any source this module does not know reads as hand-placed.
  return { shape: 'dot', color: GREEN, title: 'Manually scheduled' }
}
