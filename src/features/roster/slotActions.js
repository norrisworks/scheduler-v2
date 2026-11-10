import { supabase } from '../../lib/supabase'
import { addDays, minutesToTime, todayISO } from '../../lib/dates'

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
  // The slot's upcoming sessions go WITH it. Once the slot row is deleted
  // the FK nulls their link, and the materializer only clears sessions that
  // still point at a slot, so they stayed on the calendar forever beside
  // the replacement slot's sessions (Daun C, Efi K, Noah V, 2026-11-09).
  // Same rows the materializer would clear: recurring, untouched, still
  // scheduled. Today's only if not yet started; hand-edited ones are kept.
  const { error: futureErr } = await deleteUpcoming(id)
  if (futureErr) return { error: futureErr }

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

async function deleteUpcoming(slotId) {
  const today = todayISO()
  const now = new Date()
  const nowTime = minutesToTime(now.getHours() * 60 + now.getMinutes())
  const base = () =>
    supabase
      .from('sessions')
      .delete()
      .eq('recurring_slot_id', slotId)
      .eq('source', 'recurring')
      .eq('is_modified', false)
      .eq('status', 'scheduled')
  const later = await base().gte('date', addDays(today, 1))
  if (later.error) return later
  return base().eq('date', today).gt('start_time', nowTime)
}
