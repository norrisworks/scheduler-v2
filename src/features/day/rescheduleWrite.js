import { supabase } from '../../lib/supabase'
import { collisionKind, collisionMessage, rescheduleRows, reusePatch } from './reschedule'

/**
 * The one reschedule write path, shared by the Reschedule dialog and
 * drag-to-reschedule on the day grid. Cancel + create (see reschedule.js):
 * the original becomes a cancelled row, the new time a new manual session.
 *
 * `keepInstructor` copies the original's instructor onto the new session as a
 * manual assignment, so dragging a placed kid half an hour doesn't silently
 * unassign them; the card's coverage warning flags a shift that no longer
 * covers the new time.
 *
 * Returns { error } or { undo } — `undo` puts things back exactly: the new
 * row is removed (or re-cancelled if it was a revived corpse) and the
 * original is restored with its old status and is_modified.
 */
export async function moveSession(session, date, time, { keepInstructor = false } = {}) {
  const { cancel, create } = rescheduleRows(session, date, time)

  const { data: existing } = await supabase
    .from('sessions')
    .select('id, status')
    .eq('student_id', session.student_id)
    .eq('date', create.date)
    .eq('start_time', create.start_time)
    .neq('id', session.id)
    .maybeSingle()

  const kind = collisionKind(existing)
  if (kind === 'live') return { error: collisionMessage('live', session.student?.name) }

  // New-session write first: if it is rejected, the original is untouched.
  let newId
  if (kind === 'cancelled') {
    const { error } = await supabase
      .from('sessions')
      .update({ ...reusePatch(create), updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (error) return { error: error.message }
    newId = existing.id
  } else {
    const { data, error } = await supabase.from('sessions').insert(create).select('id').single()
    if (error) return { error: error.message }
    newId = data.id
  }

  const cancelled = await supabase
    .from('sessions')
    .update({ ...cancel.patch, updated_at: new Date().toISOString() })
    .eq('id', cancel.id)
  if (cancelled.error) {
    return { error: `New session created, but the original did not cancel: ${cancelled.error.message}` }
  }

  if (keepInstructor && session.instructor_id) {
    await supabase
      .from('assignments')
      .upsert(
        { session_id: newId, instructor_id: session.instructor_id, source: 'manual' },
        { onConflict: 'session_id' },
      )
  }

  const undo = async () => {
    if (kind === 'cancelled') {
      await supabase.from('assignments').delete().eq('session_id', newId)
      await supabase
        .from('sessions')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', newId)
    } else {
      // Created moments ago by this move; its assignment cascades with it.
      await supabase.from('sessions').delete().eq('id', newId)
    }
    const { error } = await supabase
      .from('sessions')
      .update({
        status: session.status ?? 'scheduled',
        is_modified: session.is_modified ?? false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.id)
    return { error: error?.message ?? null }
  }

  return { undo, newId }
}
