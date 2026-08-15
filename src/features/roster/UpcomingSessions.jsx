import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDateShort, formatTimeMeridiem, todayISO } from '../../lib/dates'
import RescheduleDialog from '../day/RescheduleDialog'

/**
 * The student's upcoming sessions, cancellable and reschedulable right from
 * the drawer — v1 had this and losing it meant a parent phone call required
 * flipping through day views. Reschedule keeps both rows: the original is
 * cancelled, a new session is created.
 */
export default function UpcomingSessions({ studentId }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
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
        <ul className="space-y-1">
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
