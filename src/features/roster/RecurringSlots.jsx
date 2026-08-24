import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { todayISO } from '../../lib/dates'
import TimeSelect from '../../components/TimeSelect'
import { DAYS } from './studentFields'

const inputClass =
  'rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200'

/**
 * The standing weekly template. These rows are NOT the schedule — the
 * materializer turns them into real `sessions`. Editing one re-materializes
 * future sessions that haven't been hand-edited (step 4).
 */
export default function RecurringSlots({ slots, saving, defaultDuration, onAdd, onUpdate, onDelete, onCountCancelled }) {
  const { isAdmin } = useAuth()
  const [draft, setDraft] = useState({ day_of_week: 1, start_time: '16:00' })
  // Two-step delete: {slotId, cancelled} while the confirm is showing. The
  // cancelled count matters because a cancelled session left behind squats on
  // its exact (date, time) — re-creating the slot then finds every occurrence
  // blocked (the poisoned-slot bug, Chino B's 18 rows).
  const [confirming, setConfirming] = useState(null)

  async function askDelete(slotId) {
    const cancelled = (await onCountCancelled?.(slotId)) ?? 0
    setConfirming({ slotId, cancelled })
  }

  async function add(e) {
    e.preventDefault()
    await onAdd({
      day_of_week: Number(draft.day_of_week),
      start_time: `${draft.start_time}:00`,
      // Duration is a student-level property; the slot simply inherits it.
      duration: defaultDuration || 60,
      effective_from: todayISO(),
    })
  }

  return (
    <div className="space-y-3">
      {slots.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-400">
          No standing slots. This student only appears on days with a session
          created manually or by the Radius import.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {slots.map((slot) => {
            const ended = slot.effective_until && slot.effective_until < todayISO()
            return (
              <li
                key={slot.id}
                className={
                  'flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-sm ' +
                  (ended ? 'bg-slate-50 text-slate-400' : 'bg-white text-slate-700')
                }
              >
                {/* Day and time are editable IN PLACE and autosave; each
                    change re-materializes this student's future unmodified
                    sessions — which MOVE (same rows, assignments intact),
                    never cancel-and-recreate. */}
                <select
                  value={slot.day_of_week}
                  disabled={saving || !isAdmin}
                  onChange={(e) => onUpdate(slot.id, { day_of_week: Number(e.target.value) })}
                  aria-label="Slot day"
                  className="shrink-0 rounded border border-slate-200 bg-transparent px-1 py-0.5 text-sm font-semibold"
                >
                  {DAYS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.short}
                    </option>
                  ))}
                </select>
                <TimeSelect
                  value={slot.start_time.slice(0, 5)}
                  disabled={saving || !isAdmin}
                  onChange={(t) => onUpdate(slot.id, { start_time: `${t}:00` })}
                  aria-label="Slot start time"
                  className="shrink-0 rounded border border-slate-200 bg-transparent px-1 py-0.5 text-sm"
                />
                <span className="shrink-0 text-xs text-slate-400">{slot.duration}m</span>
                {slot.effective_until && (
                  <span className="truncate text-xs text-slate-400">
                    until {slot.effective_until}
                  </span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  {isAdmin && (<>
                  {!slot.effective_until && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => onUpdate(slot.id, { effective_until: todayISO() })}
                      title="Stop this standing slot from today — keeps past sessions intact"
                      className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    >
                      End
                    </button>
                  )}
                  {confirming?.slotId === slot.id ? (
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          setConfirming(null)
                          onDelete(slot.id, { alsoCancelled: confirming.cancelled > 0 })
                        }}
                        className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-medium text-white hover:bg-red-700"
                      >
                        {confirming.cancelled > 0
                          ? `Delete + ${confirming.cancelled} cancelled`
                          : 'Delete slot'}
                      </button>
                      {confirming.cancelled > 0 && (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => {
                            setConfirming(null)
                            onDelete(slot.id, { alsoCancelled: false })
                          }}
                          title="Keep the cancelled sessions as history. Note: they keep blocking these times until a slot reclaims them."
                          className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
                        >
                          Slot only
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-100"
                      >
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => askDelete(slot.id)}
                      title="Delete the template entirely"
                      className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      ✕
                    </button>
                  )}
                  </>)}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {isAdmin && (
      <form onSubmit={add} className="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Day</span>
          <select
            value={draft.day_of_week}
            onChange={(e) => setDraft({ ...draft, day_of_week: e.target.value })}
            className={inputClass + ' w-full'}
          >
            {DAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Start</span>
          <TimeSelect
            value={draft.start_time}
            onChange={(t) => setDraft({ ...draft, start_time: t })}
            className={inputClass}
          />
        </label>
        {/* No duration input: duration is a student-level property, and the
            slot takes the student's default automatically. */}
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
        >
          Add slot
        </button>
      </form>
      )}
    </div>
  )
}


