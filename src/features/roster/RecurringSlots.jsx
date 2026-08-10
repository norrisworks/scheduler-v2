import { useState } from 'react'
import { formatTimeMeridiem, todayISO } from '../../lib/dates'
import { DAYS, DURATION_OPTIONS } from './studentFields'

const inputClass =
  'rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200'

/**
 * The standing weekly template. These rows are NOT the schedule — the
 * materializer turns them into real `sessions`. Editing one re-materializes
 * future sessions that haven't been hand-edited (step 4).
 */
export default function RecurringSlots({ slots, saving, onAdd, onUpdate, onDelete }) {
  const [draft, setDraft] = useState({ day_of_week: 1, start_time: '16:00', duration: 60 })

  async function add(e) {
    e.preventDefault()
    await onAdd({
      day_of_week: Number(draft.day_of_week),
      start_time: `${draft.start_time}:00`,
      duration: Number(draft.duration),
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
                <span className="w-10 shrink-0 font-semibold">
                  {DAYS.find((d) => d.value === slot.day_of_week)?.short ?? '—'}
                </span>
                <span className="shrink-0">{formatTimeMeridiem(slot.start_time)}</span>
                <span className="shrink-0 text-xs text-slate-400">{slot.duration}m</span>
                {slot.effective_until && (
                  <span className="truncate text-xs text-slate-400">
                    until {slot.effective_until}
                  </span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-1">
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
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => onDelete(slot.id)}
                    title="Delete the template entirely"
                    className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

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
          <input
            type="time"
            step="900"
            required
            value={draft.start_time}
            onChange={(e) => setDraft({ ...draft, start_time: e.target.value })}
            className={inputClass}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Mins</span>
          <select
            value={draft.duration}
            onChange={(e) => setDraft({ ...draft, duration: e.target.value })}
            className={inputClass}
          >
            {DURATION_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
        >
          Add slot
        </button>
      </form>
    </div>
  )
}
