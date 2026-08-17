import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/Modal'
import TimeSelect from '../../components/TimeSelect'
import { addDays, formatDateLong, formatTimeMeridiem, todayISO } from '../../lib/dates'
import { rescheduleRows, validateReschedule } from './reschedule'

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

  async function save() {
    const problem = validateReschedule(date, time, today)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)

    const { cancel, create } = rescheduleRows(session, date, time)
    // Create first: if the new row is rejected (double-booking, bad data),
    // the original is still on the schedule and nothing was lost.
    const inserted = await supabase.from('sessions').insert(create)
    if (inserted.error) {
      setError(inserted.error.message)
      setSaving(false)
      return
    }
    const cancelled = await supabase
      .from('sessions')
      .update({ ...cancel.patch, updated_at: new Date().toISOString() })
      .eq('id', cancel.id)
    setSaving(false)
    if (cancelled.error) {
      setError(`New session created, but the original did not cancel: ${cancelled.error.message}`)
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
