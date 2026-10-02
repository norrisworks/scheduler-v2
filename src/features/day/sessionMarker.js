/**
 * The session card's top-left marker: one glyph answering "how firm is this
 * booking, and who made it". It replaced two weaker signals — the student
 * certainty dot and the inline Radius R — with a single vocabulary:
 *
 *   green ○ white R — Radius, booked by a parent (or booker unknown)
 *   gray ○ white R  — Radius, booked by staff (the booking exists because
 *                     WE made it, not because the family asked for it)
 *   green ○ white S — standing slot, certainty fixed or not set (a new
 *                     standing-slot student defaults to reliable, so blank
 *                     reads as the green S)
 *   orange ○        — standing slot, certainty flexible or drop-in
 *   green ○         — manual, which includes rescheduled sessions
 *
 * Every marker is the SAME small filled circle with a thin black border;
 * the letter sits inside in bold white. (The first cut drew bare letters
 * with a 0.5px text-stroke — the stroke blurred them into circles anyway,
 * illegibly. The circle-with-letter is the legible version of that.)
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

/** Every marker is a circle; `glyph` is the white letter inside, or null. */
export function sessionMarker(session) {
  if (session.source === 'radius') {
    return isStaffBooker(session.radius_booked_by)
      ? { glyph: 'R', color: GRAY, title: 'Radius — booked by staff' }
      : { glyph: 'R', color: GREEN, title: 'Radius — booked by parent' }
  }
  if (session.source === 'recurring') {
    const certainty = session.student?.slot_certainty
    return certainty === 'flexible' || certainty === 'dropin'
      ? {
          glyph: null,
          color: ORANGE,
          title: `Standing slot — ${certainty === 'dropin' ? 'drop-in' : 'flexible'}`,
        }
      : { glyph: 'S', color: GREEN, title: 'Standing slot' }
  }
  // 'manual' — and any source this module does not know reads as hand-placed.
  return { glyph: null, color: GREEN, title: 'Manually scheduled' }
}
