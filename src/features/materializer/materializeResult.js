/**
 * Pure reporting helpers for a materializer run. Kept free of the Supabase
 * client so they stay directly testable under node.
 */

/** The brief's window: keep two weeks of sessions materialized ahead. */
export const MATERIALIZE_DAYS = 14

export function materializeChanged(result) {
  return Boolean(result && (result.created || result.updated || result.removed))
}

/** e.g. "12 created, 1 removed" — or null when nothing changed. */
export function describeMaterialize(result) {
  if (!materializeChanged(result)) return null
  const parts = []
  if (result.created) parts.push(`${result.created} created`)
  if (result.updated) parts.push(`${result.updated} updated`)
  if (result.removed) parts.push(`${result.removed} removed`)
  return parts.join(', ')
}
