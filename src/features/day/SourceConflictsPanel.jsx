import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDateShort, formatTimeMeridiem } from '../../lib/dates'

/**
 * The duplicate-session resolver, shared by the day view and data health.
 * Each conflict is one (student, date) carrying both a radius-source and a
 * recurring-source session. Two buttons, both explicit, nothing automatic:
 *
 *   Keep Radius — the recurring session(s) are cancelled (is_modified, so the
 *                 materializer never resurrects them). Radius said the family
 *                 moved; the old slot instance goes.
 *   Keep both   — recorded as a genuine double session; this pair stops being
 *                 flagged everywhere, including future import previews.
 */
export default function SourceConflictsPanel({ conflicts, showDates = false, onChanged }) {
  const [busy, setBusy] = useState(null) // conflict key while writing
  const [error, setError] = useState(null)

  if (conflicts.length === 0) return null

  async function keepRadius(conflict) {
    setBusy(conflict.key)
    setError(null)
    const { error } = await supabase
      .from('sessions')
      .update({ status: 'cancelled', is_modified: true, updated_at: new Date().toISOString() })
      .in('id', conflict.recurring.map((s) => s.id))
    setBusy(null)
    if (error) setError(error.message)
    else await onChanged?.()
  }

  async function keepBoth(conflict) {
    setBusy(conflict.key)
    setError(null)
    const { error } = await supabase.from('session_conflict_dismissals').insert({
      student_id: conflict.studentId,
      center_id: conflict.centerId,
      date: conflict.date,
    })
    setBusy(null)
    if (error) setError(error.message)
    else await onChanged?.()
  }

  const times = (list) => list.map((s) => `${formatTimeMeridiem(s.start_time)} (${s.duration ?? 60}m)`).join(', ')

  return (
    <div className="border-b border-orange-200 bg-orange-50 px-4 py-2">
      <p className="text-sm font-semibold text-orange-900">
        {conflicts.length} student{conflicts.length === 1 ? ' is' : 's are'} scheduled twice — a
        Radius session and the old standing-slot session on the same day.
      </p>
      {error && <p className="mt-1 rounded bg-red-100 px-2 py-1 text-xs text-red-800">{error}</p>}
      <ul className="mt-1.5 space-y-1">
        {conflicts.map((c) => (
          <li key={c.key} className="flex flex-wrap items-center gap-2 text-xs text-orange-900">
            <span className="font-semibold">{c.name ?? 'Unknown'}</span>
            {showDates && <span className="text-orange-700">{formatDateShort(c.date)}</span>}
            <span>
              Radius: <span className="font-medium">{times(c.radius)}</span>
              {' · '}standing slot: <span className="font-medium">{times(c.recurring)}</span>
            </span>
            <span className="ml-auto flex shrink-0 gap-1.5">
              <button
                type="button"
                disabled={busy === c.key}
                onClick={() => keepRadius(c)}
                title="Radius is right — cancel the standing-slot session"
                className="rounded bg-orange-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-orange-700 disabled:opacity-40"
              >
                Keep Radius, cancel the other
              </button>
              <button
                type="button"
                disabled={busy === c.key}
                onClick={() => keepBoth(c)}
                title="A genuine double session — stop flagging this pair"
                className="rounded border border-orange-300 bg-white px-2 py-0.5 text-[11px] font-medium text-orange-800 hover:bg-orange-100 disabled:opacity-40"
              >
                Keep both
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
