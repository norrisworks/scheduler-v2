import { supabase } from '../../lib/supabase'
import { MATERIALIZE_DAYS } from './materializeResult'

export { MATERIALIZE_DAYS, describeMaterialize, materializeChanged } from './materializeResult'

/**
 * Runs the `materialize_sessions` Postgres function. It reconciles rather
 * than rebuilds, and only ever touches FUTURE sessions with
 * is_modified = false, so running it is always safe.
 *
 * `slotId` scopes the run to one recurring slot.
 */
export async function materializeSessions(centerId, { slotId = null, daysAhead } = {}) {
  const { data, error } = await supabase.rpc('materialize_sessions', {
    p_center_id: centerId,
    p_days_ahead: daysAhead ?? MATERIALIZE_DAYS,
    p_slot_id: slotId,
  })

  if (error) return { error: error.message, result: null }

  const row = Array.isArray(data) ? data[0] : data
  return {
    error: null,
    result: {
      created: row?.created ?? 0,
      updated: row?.updated ?? 0,
      removed: row?.removed ?? 0,
    },
  }
}
