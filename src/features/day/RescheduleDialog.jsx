import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/Modal'
import TimeSelect from '../../components/TimeSelect'
import { addDays, formatDateLong, formatTimeMeridiem, todayISO } from '../../lib/dates'
import { collisionKind, validateReschedule } from './reschedule'
import { moveSession } from './rescheduleWrite'

/**
 * Move one session to a future date and time. The original is cancelled and
 * a new session is created for the same student — two real rows, so what was
 * planned stays on record. Used from the day-view card menu and from the
 * student drawer's upcoming-sessions list.
 */
export default function RescheduleDialog({ session, onClose, onDone }) {
  const today = todayISO()
  const [date, setDate] = useState(session.date >= today ? session.date : addDays(today, 1))
  const [time, setTime] = useState(session.start_time.slice(0, 5))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // What already sits at the chosen target, looked up as the pickers change,
  // so "that spot holds a cancelled session — it will be restored" is visible
  // BEFORE the button is pressed, not discovered as a failure after.
  const [occupant, setOccupant] = useState(null)

  useEffect(() => {
    let stale = false
    const startTime = time.length === 5 ? `${time}:00` : time
    supabase
      .from('sessions')
      .select('id, status')
      .eq('student_id', session.student_id)
      .eq('date', date)
      .eq('start_time', startTime)
      .neq('id', session.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!stale) setOccupant(data ?? null)
      })
    return () => {
      stale = true
    }
  }, [session.student_id, session.id, date, time])

  const targetKind = collisionKind(occupant)

  async function save() {
    const problem = validateReschedule(date, time, today)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)

    const result = await moveSession(session, date, time)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    await onDone?.()
    onClose()
  }

  return (
    <Modal label={`Reschedule ${session.student?.name ?? 'session'}`} onClose={onClose}>
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-900">
          Reschedule — {session.student?.name ?? 'session'}
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          Now {formatDateLong(session.date)} at {formatTimeMeridiem(session.start_time)}. The
          original is kept as a cancelled session.
        </p>
      </div>

      <div className="space-y-3 p-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-zinc-600">New date</span>
          <input
            type="date"
            value={date}
            min={today}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-zinc-600">New time</span>
          <TimeSelect
            value={time}
            onChange={setTime}
            className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </label>
        <p className="text-[11px] text-zinc-400">
          {session.duration ?? 60} minutes, same as the original.
        </p>
        {targetKind === 'cancelled' && (
          <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-800">
            A cancelled session already sits at that time — it will be restored as this session
            instead of creating a duplicate.
          </p>
        )}
        {targetKind === 'live' && (
          <p className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] leading-snug text-red-700">
            {collisionMessage('live', session.student?.name)}
          </p>
        )}
        {error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-4 py-2.5">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
        >
          {saving ? 'Moving…' : 'Reschedule'}
        </button>
      </div>
    </Modal>
  )
}
