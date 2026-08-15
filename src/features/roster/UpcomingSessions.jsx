import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useCenter } from '../centers/CenterProvider'
import { formatDateShort, formatTimeMeridiem, todayISO } from '../../lib/dates'
import { MATERIALIZE_DAYS, materializeSessions } from '../materializer/materialize'
import RescheduleDialog from '../day/RescheduleDialog'

/** How much further ahead "Generate more" reaches, in days. */
const EXTENDED_DAYS = 60

/**
 * The student's upcoming sessions, cancellable and reschedulable right from
 * the drawer — v1 had this and losing it meant a parent phone call required
 * flipping through day views. Reschedule keeps both rows: the original is
 * cancelled, a new session is created.
 *
 * The list itself has NO cap — it shows every future scheduled row. What it
 * cannot show is a session that does not exist yet: rows are only generated
 * MATERIALIZE_DAYS ahead, which is why a twice-a-week student shows four.
 * "Generate further ahead" materializes THIS student's standing slots out to
 * EXTENDED_DAYS so the later sessions become real, listable rows.
 */
export default function UpcomingSessions({ studentId, slots = [] }) {
  const { centerId } = useCenter()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [extending, setExtending] = useState(false)
  const [error, setError] = useState(null)
  const [rescheduling, setRescheduling] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('sessions')
      .select('id, center_id, student_id, date, start_time, duration, status, notes, student:students(id, name)')
      .eq('student_id', studentId)
      .gte('date', todayISO())
      .eq('status', 'scheduled')
      .order('date')
      .order('start_time')
    if (error) setError(error.message)
    else {
      setSessions(data ?? [])
      setError(null)
    }
    setLoading(false)
  }, [studentId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  /** Materialize this student's slots further out, then reload the list. */
  async function extend() {
    setExtending(true)
    setError(null)
    for (const slot of slots) {
      const { error } = await materializeSessions(centerId, {
        slotId: slot.id,
        daysAhead: EXTENDED_DAYS,
      })
      if (error) {
        setError(error)
        setExtending(false)
        return
      }
    }
    await load()
    setExtending(false)
  }

  async function cancel(session) {
    setSaving(true)
    const { error } = await supabase
      .from('sessions')
      // is_modified so the materializer never resurrects this instance.
      .update({ status: 'cancelled', is_modified: true, updated_at: new Date().toISOString() })
      .eq('id', session.id)
    setSaving(false)
    if (error) setError(error.message)
    else await load()
  }

  if (loading) return <p className="py-2 text-center text-xs text-zinc-400">Loading sessions…</p>

  return (
    <div className="space-y-1.5">
      {error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}

      {sessions.length === 0 ? (
        <p className="text-[11px] text-zinc-400">
          No upcoming sessions. Generate them from the day view if a standing slot should have
          produced some.
        </p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-auto">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-1.5"
            >
              <span className="min-w-0 flex-1 text-sm text-zinc-800">
                {formatDateShort(session.date)} · {formatTimeMeridiem(session.start_time)}
                <span className="text-xs text-zinc-400"> · {session.duration ?? 60}m</span>
              </span>
              <button
                type="button"
                disabled={saving}
                onClick={() => setRescheduling(session)}
                className="shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
              >
                Reschedule
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => cancel(session)}
                className="shrink-0 rounded border border-red-200 px-1.5 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
              >
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Not a cap being lifted — sessions further out don't exist as rows
          yet. This makes them exist, then the list shows them like any other. */}
      {slots.length > 0 && (
        <div className="flex items-center gap-2 pt-0.5">
          <p className="flex-1 text-[11px] leading-snug text-zinc-400">
            Sessions are generated {MATERIALIZE_DAYS} days ahead, so this is every session that
            exists so far.
          </p>
          <button
            type="button"
            disabled={extending || saving}
            onClick={extend}
            className="shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
          >
            {extending ? 'Generating…' : `Generate ${Math.round(EXTENDED_DAYS / 7)} weeks ahead`}
          </button>
        </div>
      )}

      {rescheduling && (
        <RescheduleDialog
          session={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={load}
        />
      )}
    </div>
  )
}
