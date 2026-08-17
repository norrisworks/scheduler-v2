import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useCenter } from '../centers/CenterProvider'
import { formatDateLong } from '../../lib/dates'
import TimeSelect from '../../components/TimeSelect'
import { DEFAULT_END, DEFAULT_START, validateShift } from './weekShifts'

/**
 * One day's shifts, editable in place. Opened from the unplaced panel when
 * the diagnosis is "nobody on shift" — the fix belongs next to the finding,
 * not three screens away on the week grid.
 */
export default function DayShiftEditor({ date, instructors, shiftByInstructor, onChanged, onClose }) {
  const { centerId } = useCenter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // instructorId -> { start, end } while a row is being edited. Selects
  // commit whole values, so existing shifts save immediately on change.
  const [drafts, setDrafts] = useState(new Map())

  const draftFor = (instructor) => {
    const existing = drafts.get(instructor.id)
    if (existing) return existing
    const shift = shiftByInstructor.get(instructor.id)
    return shift
      ? { start: shift.start_time.slice(0, 5), end: shift.end_time.slice(0, 5) }
      : { start: DEFAULT_START, end: DEFAULT_END }
  }

  const setDraft = (instructor, patch) => {
    const next = { ...draftFor(instructor), ...patch }
    setDrafts((prev) => {
      const map = new Map(prev)
      map.set(instructor.id, next)
      return map
    })
    // An EXISTING shift saves as the times change — no Save button, same rule
    // as every other editor. A new shift still needs its Add press.
    if (shiftByInstructor.has(instructor.id)) saveShift(instructor, next)
  }

  async function write(fn) {
    setSaving(true)
    setError(null)
    const { error } = await fn()
    setSaving(false)
    if (error) {
      setError(error.message)
      return false
    }
    await onChanged?.()
    return true
  }

  async function saveShift(instructor, draftOverride = null) {
    const draft = draftOverride ?? draftFor(instructor)
    const problem = validateShift(draft.start, draft.end)
    if (problem) {
      setError(problem)
      return
    }
    const shift = shiftByInstructor.get(instructor.id)
    const row = {
      center_id: centerId,
      instructor_id: instructor.id,
      date,
      start_time: `${draft.start}:00`,
      end_time: `${draft.end}:00`,
      source: 'manual',
    }
    const ok = await write(() =>
      shift
        ? supabase.from('instructor_shifts').update(row).eq('id', shift.id)
        : supabase.from('instructor_shifts').insert(row),
    )
    if (ok) {
      setDrafts((prev) => {
        const next = new Map(prev)
        next.delete(instructor.id)
        return next
      })
    }
  }

  const onShift = instructors.filter((i) => shiftByInstructor.has(i.id))
  const offShift = instructors.filter((i) => !shiftByInstructor.has(i.id))

  return (
    <>
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-900">Shifts — {formatDateLong(date)}</h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          Changes apply immediately and feed straight into auto-assign eligibility.
        </p>
      </div>

      {error && (
        <p className="border-b border-red-200 bg-red-50 px-4 py-1.5 text-xs text-red-700">{error}</p>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {[
          { label: 'On shift', list: onShift },
          { label: 'Not on shift', list: offShift },
        ].map(
          ({ label, list }) =>
            list.length > 0 && (
              <div key={label} className="mb-3">
                <p className="mb-1 px-1 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
                  {label}
                </p>
                <ul className="space-y-1">
                  {list.map((instructor) => {
                    const shift = shiftByInstructor.get(instructor.id)
                    const draft = draftFor(instructor)
                    return (
                      <li
                        key={instructor.id}
                        className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-1.5"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm text-zinc-800">
                          {instructor.name}
                        </span>
                        {/* Existing shifts save as the times change; only a
                            NEW shift needs its Add press. */}
                        <TimeSelect
                          value={draft.start}
                          onChange={(t) => setDraft(instructor, { start: t })}
                          aria-label={`Shift start for ${instructor.name}`}
                          className="rounded border border-zinc-300 px-1 py-0.5 text-xs"
                        />
                        <span className="text-xs text-zinc-400">–</span>
                        <TimeSelect
                          value={draft.end}
                          onChange={(t) => setDraft(instructor, { end: t })}
                          aria-label={`Shift end for ${instructor.name}`}
                          className="rounded border border-zinc-300 px-1 py-0.5 text-xs"
                        />
                        {shift ? (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              write(() =>
                                supabase.from('instructor_shifts').delete().eq('id', shift.id),
                              )
                            }
                            title="Remove this shift — use for a call-out"
                            className="rounded px-1 text-xs text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                          >
                            ✕
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => saveShift(instructor)}
                            className="rounded border border-brand-300 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-40"
                          >
                            Add
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ),
        )}
      </div>

      <div className="flex justify-end border-t border-zinc-200 px-4 py-2.5">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          Done
        </button>
      </div>
    </>
  )
}
