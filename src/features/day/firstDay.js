/**
 * First-day state for one session, as the card and the ⋯ menu present it.
 *
 * The default is DERIVED (decision 26): the RPC computes the border from
 * enrollment_start_date, and the manual per-student flag is dead. The
 * three-state session override corrects the derivation when the data lies:
 * null = derive, true = force the border here, false = suppress it here.
 * One session's override changes one session — suppressing a crown never
 * silently promotes the next visit.
 *
 * `is_first_day` arrives from first_day_session_ids, which already applies
 * the override; the source label is what tells the owner WHY a border is
 * there (or missing), so an override is never mistaken for the rule.
 */
export function firstDayBadge(session) {
  if (session?.first_day_override === true) return { firstDay: true, source: 'override' }
  if (session?.first_day_override === false) return { firstDay: false, source: 'override' }
  const derived = Boolean(session?.is_first_day)
  return { firstDay: derived, source: derived ? 'derived' : null }
}

/** The ⋯ menu's one-line description of the state. */
export function firstDayLabel(session) {
  const { firstDay, source } = firstDayBadge(session)
  if (source === 'override') return firstDay ? 'First day — set by hand' : 'First day suppressed by hand'
  return firstDay ? 'First day — derived from enrollment' : null
}
