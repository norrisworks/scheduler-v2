import { supabase } from '../../lib/supabase'
import { todayISO } from '../../lib/dates'

/**
 * The ONE set of standing-slot write paths. The drawer (useStudent) and the
 * roster's day cells both call these, so the two editing locations behave
 * identically by construction: same insert shape, same update, same
 * delete-with-cleanup. The caller follows every write with
 * materializeSessions, which MOVES future unmodified sessions (same rows,
 * instructor assignments intact) rather than cancel-and-recreate.
 */

/** A new slot row: duration inherits the student default (decision 20). */
export function newSlotRow(dayOfWeek, startTime, defaultDuration) {
  return {
    day_of_week: Number(dayOfWeek),
    start_time: startTime.length === 5 ? `${startTime}:00` : startTime,
    duration: defaultDuration || 60,
    effective_from: todayISO(),
  }
}

export function insertSlot(studentId, slot) {
  return supabase.from('recurring_slots').insert({ ...slot, student_id: studentId })
}

export function patchSlot(id, patch) {
  return supabase.from('recurring_slots').update(patch).eq('id', id)
}

/**
 * Deleting a slot leaves its future CANCELLED sessions behind as orphans
 * (the FK is ON DELETE SET NULL), and a cancelled row blocks its exact
 * (date, time) from ever being materialized again — the poisoned-slot bug.
 * The materializer now reclaims such orphans when a new slot lands on them,
 * but offering the cleanup at delete time keeps them out of the cancelled
 * strip entirely. The count query MUST run before the delete: afterwards
 * the link is already null.
 */
export async function futureCancelledCount(id) {
  const { count, error } = await supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('recurring_slot_id', id)
    .eq('status', 'cancelled')
    .gte('date', todayISO())
  return error ? 0 : (count ?? 0)
}

export async function removeSlot(id, { alsoCancelled = false } = {}) {
  if (alsoCancelled) {
    const { error } = await supabase
      .from('sessions')
      .delete()
      .eq('recurring_slot_id', id)
      .eq('status', 'cancelled')
      .gte('date', todayISO())
    if (error) return { error }
  }
  return supabase.from('recurring_slots').delete().eq('id', id)
}
