import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { formatDateShort, formatTimeMeridiem } from '../../lib/dates'
import { DAYS } from '../roster/studentFields'

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
export default function SourceConflictsPanel({
  conflicts,
  crossDay = [],
  showDates = false,
  onChanged,
  onEditStudent,
}) {
  const [busy, setBusy] = useState(null) // conflict key while writing
  const [error, setError] = useState(null)
  // key -> studentId after a cross-day cancel, driving the "permanent
  // change?" follow-up so the same conflict isn't re-resolved every week.
  const [justCancelled, setJustCancelled] = useState({})
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

  /** Cross-day: cancel the standing-slot session, then ask the real question. */
  async function cancelCrossDay(conflict) {
    setBusy(conflict.key)
    setError(null)
    const { error } = await supabase
      .from('sessions')
      .update({ status: 'cancelled', is_modified: true, updated_at: new Date().toISOString() })
      .in('id', conflict.recurring.map((s) => s.id))
    setBusy(null)
    if (error) setError(error.message)
    else {
      setJustCancelled((prev) => ({
        ...prev,
        [conflict.key]: {
          studentId: conflict.studentId,
          name: conflict.name,
          dayOfWeek: conflict.dayOfWeek,
        },
      }))
      await onChanged?.()
    }
  }

  /** "Keep both" for THIS week's pair only. */
  async function keepBothWeek(conflict) {
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

  /** "Never ask about this slot" — permanent for (student, weekday). */
  async function neverAsk(conflict) {
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
    <div className="border-b border-orange-200 bg-orange-50 px-4 py-2">
      {conflicts.length > 0 && (
        <p className="text-sm font-semibold text-orange-900">
          {conflicts.length} student{conflicts.length === 1 ? ' is' : 's are'} scheduled twice — a
          Radius session and the old standing-slot session on the same day.
        </p>
      )}
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

      {crossDay.length > 0 && (
        <>
          <p className={'text-sm font-semibold text-orange-900 ' + (conflicts.length > 0 ? 'mt-2' : '')}>
            {crossDay.length} standing-slot session{crossDay.length === 1 ? '' : 's'} with a
            same-week Radius session on a different day — moved, or an extra session?
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {crossDay.map((c) => (
              <li key={c.key} className="text-xs text-orange-900">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{c.name ?? 'Unknown'}</span>
                  <span>
                    standing slot {dayShort(c.dayOfWeek)} {formatDateShort(c.date)}{' '}
                    <span className="font-medium">{times(c.recurring)}</span> is not in Radius, but
                    Radius has{' '}
                    <span className="font-medium">
                      {c.radius
                        .map((s) => `${formatDateShort(s.date)} ${formatTimeMeridiem(s.start_time)}`)
                        .join(', ')}
                    </span>
                    {' '}that week. This may be a moved session — or a legitimate extra
                    (makeups and swaps are common).
                  </span>
                  {isAdmin && (
                  <span className="ml-auto flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      disabled={busy === c.key}
                      onClick={() => cancelCrossDay(c)}
                      title="Treat it as moved — cancel the standing-slot session"
                      className="rounded bg-orange-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-orange-700 disabled:opacity-40"
                    >
                      Cancel {dayShort(c.dayOfWeek)} session
                    </button>
                    <button
                      type="button"
                      disabled={busy === c.key}
                      onClick={() => keepBothWeek(c)}
                      title="A real extra session this week — keep it and stop asking for this week"
                      className="rounded border border-orange-300 bg-white px-2 py-0.5 text-[11px] font-medium text-orange-800 hover:bg-orange-100 disabled:opacity-40"
                    >
                      Keep both
                    </button>
                    <button
                      type="button"
                      disabled={busy === c.key}
                      onClick={() => neverAsk(c)}
                      title={`Never question this student's ${dayShort(c.dayOfWeek)} slot against same-week Radius sessions again`}
                      className="rounded border border-orange-300 bg-white px-2 py-0.5 text-[11px] font-medium text-orange-800 hover:bg-orange-100 disabled:opacity-40"
                    >
                      Never ask
                    </button>
                  </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Survives the conflict rows disappearing after a cancel: the real fix
          for a permanent day change is the standing slot, or the same
          conflict comes back every week. */}
      {Object.entries(justCancelled).map(([key, info]) => (
        <div
          key={key}
          className="mt-1.5 flex flex-wrap items-center gap-2 rounded bg-orange-100 px-2 py-1 text-xs text-orange-900"
        >
          <span>
            {info.name ?? 'Student'}'s {dayShort(info.dayOfWeek)} session cancelled. If the day
            changed permanently, edit the standing slot too — otherwise this same conflict returns
            every week.
          </span>
          {onEditStudent && (
            <button
              type="button"
              onClick={() => {
                onEditStudent(info.studentId)
                setJustCancelled((prev) => {
                  const next = { ...prev }
                  delete next[key]
                  return next
                })
              }}
              className="rounded bg-orange-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-orange-700"
            >
              Edit standing slots
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              setJustCancelled((prev) => {
                const next = { ...prev }
                delete next[key]
                return next
              })
            }
            className="font-medium underline"
          >
            {onEditStudent ? 'One-off, dismiss' : 'Dismiss'}
          </button>
        </div>
      ))}
    </div>
  )
}
