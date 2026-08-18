import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { formatDateShort, formatTimeMeridiem } from '../../lib/dates'
import { DAYS } from '../roster/studentFields'

/**
 * Two panels sharing one component.
 *
 * SAME-DAY duplicates (orange, actionable): a radius-source and a
 * recurring-source session on the same date — the student is visibly on the
 * day twice, a fact the data proves on its own. Two explicit buttons,
 * nothing automatic:
 *
 *   Keep Radius — the recurring session(s) are cancelled (is_modified, so the
 *                 materializer never resurrects them).
 *   Keep both   — recorded as a genuine double session; this pair stops being
 *                 flagged everywhere, including future import previews.
 *
 * CROSS-DAY notices (slate, INFORMATION ONLY): a standing session absent from
 * a week's Radius file. Five sessions were wrongly cancelled in one day
 * (2026-08-17: Isaac M, Daijhen F, Matthias F, Victoria F among them) on this
 * detector's suggestion — including cases that passed the count gate, because
 * a partial week plus an added session can match the slot count by
 * coincidence. The file cannot distinguish a move from an addition, so this
 * panel suggests NOTHING: no move language, no recommended action. It states
 * the fact. A plain "Cancel this session" button exists on each row — the
 * owner's tool for a decision they made themselves, restored at their
 * request — but it carries no emphasis and the notice never argues for it.
 */
export default function SourceConflictsPanel({ conflicts, crossDay = [], showDates = false, onChanged }) {
  const [busy, setBusy] = useState(null) // conflict key while writing
  const [error, setError] = useState(null)
  // Resolving conflicts is a scheduling decision — admin-only. Instructors
  // still SEE the panel: a double-booked student matters on the floor.
  const { isAdmin } = useAuth()

  if (conflicts.length === 0 && crossDay.length === 0) return null

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

  /** Hides the notice for this week's date. Touches nothing else. */
  async function hideWeek(conflict) {
    setBusy(conflict.key)
    setError(null)
    const { error } = await supabase.from('session_conflict_dismissals').upsert(
      { student_id: conflict.studentId, center_id: conflict.centerId, date: conflict.date },
      { onConflict: 'student_id,date' },
    )
    setBusy(null)
    if (error) setError(error.message)
    else await onChanged?.()
  }

  /**
   * Cancels the standing-slot session. Present because the owner asked for
   * the ability back — NOT because anything here recommends it. is_modified
   * keeps the materializer from resurrecting the row.
   */
  async function cancelSession(conflict) {
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

  /** Never show the notice for this (student, weekday) again. */
  async function neverShow(conflict) {
    setBusy(conflict.key)
    setError(null)
    const { error } = await supabase.from('session_cross_day_dismissals').upsert(
      {
        student_id: conflict.studentId,
        center_id: conflict.centerId,
        day_of_week: conflict.dayOfWeek,
      },
      { onConflict: 'student_id,day_of_week' },
    )
    setBusy(null)
    if (error) setError(error.message)
    else await onChanged?.()
  }

  const times = (list) => list.map((s) => `${formatTimeMeridiem(s.start_time)} (${s.duration ?? 60}m)`).join(', ')
  const dayShort = (dow) => DAYS.find((d) => d.value === dow)?.short ?? '?'

  return (
    <>
      {conflicts.length > 0 && (
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
                {isAdmin && (
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
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {crossDay.length > 0 && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
          <p className="text-sm font-semibold text-slate-700">
            {crossDay.length} standing session{crossDay.length === 1 ? '' : 's'} not listed in this
            week's Radius file.
          </p>
          <p className="mt-0.5 text-[11px] text-slate-600">
            Most families are not on Radius, so this usually means nothing — a session absent from a
            Radius file is <span className="font-semibold">not</span> cancelled, and nothing here
            needs action.
          </p>
          {error && <p className="mt-1 rounded bg-red-100 px-2 py-1 text-xs text-red-800">{error}</p>}
          <ul className="mt-1.5 space-y-1.5">
            {crossDay.map((c) => (
              <li key={c.key} className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
                <span className="font-semibold">{c.name ?? 'Unknown'}</span>
                <span>
                  {dayShort(c.dayOfWeek)} {formatDateShort(c.date)}{' '}
                  <span className="font-medium">{times(c.recurring)}</span> is not in the file; the
                  file lists{' '}
                  <span className="font-medium">
                    {c.radius
                      .map((s) => `${formatDateShort(s.date)} ${formatTimeMeridiem(s.start_time)}`)
                      .join(', ')}
                  </span>
                  {' '}that week.
                </span>
                {isAdmin && (
                <span className="ml-auto flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    disabled={busy === c.key}
                    onClick={() => hideWeek(c)}
                    title="Hide this notice for this date — changes nothing on the schedule"
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    Hide this week
                  </button>
                  <button
                    type="button"
                    disabled={busy === c.key}
                    onClick={() => neverShow(c)}
                    title={`Never show this notice for this student's ${dayShort(c.dayOfWeek)} slot — changes nothing on the schedule`}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    Don't show again for this slot
                  </button>
                  {/* The owner's tool, not a recommendation: the notice
                      states facts; this button acts only on their say-so. */}
                  <button
                    type="button"
                    disabled={busy === c.key}
                    onClick={() => cancelSession(c)}
                    title="Cancels this standing-slot session — your decision; the notice implies nothing"
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                  >
                    Cancel this session
                  </button>
                </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
