/**
 * Rescheduling is a cancel plus a create, never an edit: the original session
 * stays as a cancelled row and a new one is born at the new date and time.
 * Both persist, so the history of what was planned is never rewritten.
 */

/** Why this reschedule target is unusable, or null if it is fine. */
export function validateReschedule(date, time, todayISO) {
  if (!date) return 'pick a date'
  if (!time) return 'pick a time'
  if (date < todayISO) return 'the new date is in the past'
  return null
}

/**
 * What sits at a target (student, date, time), and what that means for
 * creating a session there. The unique index counts CANCELLED rows too, so a
 * plain insert fails against a corpse exactly as it fails against a live
 * session — and rescheduling back to where you came from always collided with
 * the cancelled original. The fix is to classify before writing:
 *
 *   'free'      — nothing there, insert normally
 *   'cancelled' — a cancelled row occupies the spot: REUSE it (revive in
 *                 place) instead of failing. No duplicate is ever created.
 *   'live'      — a scheduled (or attended/no-show) session is genuinely
 *                 there: refuse, and say THAT, not "already has a session".
 */
export function collisionKind(existing) {
  if (!existing) return 'free'
  return existing.status === 'cancelled' ? 'cancelled' : 'live'
}

/** The message for a refused target — distinct from the cancelled case. */
export function collisionMessage(kind, studentName) {
  const name = studentName ?? 'That student'
  if (kind === 'live') return `${name} already has a scheduled session at that time.`
  if (kind === 'cancelled') {
    // Shown only where reuse is NOT applied automatically; both dialogs reuse.
    return `${name} has a cancelled session at that time — it can be restored instead.`
  }
  return null
}

/**
 * Revives a cancelled row in place as the new session. source 'manual' and
 * is_modified because a human placed it here; the materializer treats it like
 * any other hand edit. The binder-irrelevant columns (delivery, notes) take
 * the incoming values so the revived row IS the session that was asked for,
 * not a ghost of the old one.
 */
export function reusePatch(fields) {
  return {
    status: 'scheduled',
    source: 'manual',
    is_modified: true,
    duration: fields.duration ?? 60,
    notes: fields.notes ?? null,
  }
}

/**
 * The two writes as data. The cancel patch marks is_modified so the
 * materializer never resurrects the old slot instance; the new row is
 * source 'manual' so the materializer never touches it either.
 */
export function rescheduleRows(session, date, time) {
  return {
    cancel: {
      id: session.id,
      patch: { status: 'cancelled', is_modified: true },
    },
    create: {
      center_id: session.center_id,
      student_id: session.student_id,
      date,
      start_time: time.length === 5 ? `${time}:00` : time,
      duration: session.duration ?? 60,
      status: 'scheduled',
      source: 'manual',
      notes: session.notes ?? null,
    },
  }
}
