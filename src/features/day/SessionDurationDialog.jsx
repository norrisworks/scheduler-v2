import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/Modal'
import { formatDateLong, formatTimeMeridiem } from '../../lib/dates'
import { DURATION_OPTIONS } from '../roster/studentFields'

/**
 * Change ONE session's duration and nothing else. is_modified pins the row so
 * the materializer never snaps it back to its template.
 */
export default function SessionDurationDialog({ session, onClose, onDone }) {
  const [minutes, setMinutes] = useState(session.duration ?? 60)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function save() {
    setSaving(true)
    setError(null)
    const { error } = await supabase
      .from('sessions')
      .update({ duration: minutes, is_modified: true, updated_at: new Date().toISOString() })
      .eq('id', session.id)
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    await onDone?.()
    onClose()
  }

  return (
    <Modal label={`Duration for ${session.student?.name ?? 'session'}`} onClose={onClose}>
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-900">
          Duration — {session.student?.name ?? 'session'}
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          {formatDateLong(session.date)} at {formatTimeMeridiem(session.start_time)}. Only this
          session changes.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5 p-4">
        {DURATION_OPTIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setMinutes(d)}
            aria-pressed={minutes === d}
            className={
              'rounded-lg border px-3 py-1.5 text-sm font-medium transition ' +
              (minutes === d
                ? 'border-brand-500 bg-brand-500 text-white'
                : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100')
            }
          >
            {d}m
          </button>
        ))}
        {error && (
          <p className="w-full rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>
        )}
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
          disabled={saving || minutes === (session.duration ?? 60)}
          className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
        >
          {saving ? 'Saving…' : `Set ${minutes}m`}
        </button>
      </div>
    </Modal>
  )
}
