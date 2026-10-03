/**
 * Supplemental (Supp), the first_day_override pattern: the STUDENT's
 * needs_schoolwork is the default every session inherits; one session can
 * override it on or off (sessions.needs_schoolwork_override) without
 * touching the student or any other session. Null means follow the student.
 */
export function effectiveSupp(session) {
  return (
    session.needs_schoolwork_override ??
    session.student?.needs_schoolwork ??
    false
  )
}

/** The menu's note under an overridden session, or null when following. */
export function suppLabel(session) {
  if (session.needs_schoolwork_override === true) return 'Supp forced for this session'
  if (session.needs_schoolwork_override === false) return 'Supp off for this session'
  return null
}
