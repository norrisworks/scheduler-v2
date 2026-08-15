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
