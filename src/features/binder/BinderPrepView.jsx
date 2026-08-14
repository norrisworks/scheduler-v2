import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useCenter } from '../centers/CenterProvider'
import Spinner from '../../components/Spinner'
import { addDays, formatDateLong, formatTimeMeridiem, todayISO } from '../../lib/dates'

/**
 * The night-before checklist: every student on tomorrow's schedule, in time
 * order, with a three-way prep status and a note for whoever builds the
 * binders. Status and note live on the SESSION, so each visit starts fresh
 * and past days keep their state as history — no reset job.
 *
 * The note is prep context only. Day-view cards never show it; they get a
 * bare done/not-done tick.
 */
export const BINDER_STATUSES = [
  { value: 'not_started', label: 'Not started', chip: 'bg-zinc-200 text-zinc-700', active: 'bg-zinc-600 text-white' },
  { value: 'in_progress', label: 'In progress', chip: 'bg-amber-100 text-amber-800', active: 'bg-amber-500 text-white' },
  { value: 'complete', label: 'Complete', chip: 'bg-emerald-100 text-emerald-800', active: 'bg-emerald-600 text-white' },
]

export default function BinderPrepView() {
  const { centerId, center } = useCenter()
  // Prep happens the night before, so tomorrow is the default.
  const [date, setDate] = useState(() => addDays(todayISO(), 1))
  const [snapshot, setSnapshot] = useState({ key: null, rows: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const requestRef = useRef(0)
  const noteTimers = useRef(new Map())

  const key = `${centerId}|${date}`

  const load = useCallback(async () => {
    if (!centerId) return
    const token = ++requestRef.current
    setLoading(true)

    const { data, error } = await supabase
      .from('sessions')
      .select(
        'id, start_time, duration, status, binder_status, binder_note, student:students ( id, name, grade, level )',
      )
      .eq('center_id', centerId)
      .eq('date', date)
      .eq('status', 'scheduled')
      .order('start_time')

    if (token !== requestRef.current) return
    if (error) {
      setError(error.message)
    } else {
      const rows = (data ?? []).sort(
        (a, b) =>
          a.start_time.localeCompare(b.start_time) ||
          (a.student?.name ?? '').localeCompare(b.student?.name ?? ''),
      )
      setSnapshot({ key, rows })
      setError(null)
    }
    setLoading(false)
  }, [centerId, date, key])

  useEffect(() => {
    load()
  }, [load])

  const rows = snapshot.key === key ? snapshot.rows : []

  const patchRow = useCallback((sessionId, patch) => {
    setSnapshot((prev) => ({
      ...prev,
      rows: prev.rows.map((r) => (r.id === sessionId ? { ...r, ...patch } : r)),
    }))
  }, [])

  /** Every change saves immediately; a failure rolls the row back and says so. */
  const save = useCallback(
    async (sessionId, patch, previous) => {
      patchRow(sessionId, patch)
      const { error } = await supabase
        .from('sessions')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', sessionId)
      if (error) {
        patchRow(sessionId, previous)
        setError(error.message)
      }
    },
    [patchRow],
  )

  const setStatus = (row, value) =>
    save(row.id, { binder_status: value }, { binder_status: row.binder_status })

  // Notes save on a short debounce so typing is not a write per keystroke.
  const setNote = (row, value) => {
    patchRow(row.id, { binder_note: value })
    const timers = noteTimers.current
    clearTimeout(timers.get(row.id))
    timers.set(
      row.id,
      setTimeout(async () => {
        const { error } = await supabase
          .from('sessions')
          .update({ binder_note: value || null, updated_at: new Date().toISOString() })
          .eq('id', row.id)
        if (error) setError(error.message)
      }, 500),
    )
  }

  const counts = useMemo(() => {
    const c = { complete: 0, in_progress: 0, not_started: 0 }
    for (const r of rows) c[r.binder_status ?? 'not_started'] += 1
    return c
  }, [rows])

  const tomorrow = addDays(todayISO(), 1)

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2.5">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-zinc-900">Binder prep</h1>
          <p className="text-xs text-zinc-500">
            {center?.name} · {formatDateLong(date)}
            {date === tomorrow ? ' · tomorrow' : date === todayISO() ? ' · today' : ''}
          </p>
        </div>

        <div className="ml-2 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDate(addDays(date, -1))}
            aria-label="Previous day"
            className="rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-100"
          >
            ‹
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="Prep date"
            className="rounded-lg border border-zinc-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={() => setDate(addDays(date, 1))}
            aria-label="Next day"
            className="rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-100"
          >
            ›
          </button>
          {date !== tomorrow && (
            <button
              type="button"
              onClick={() => setDate(tomorrow)}
              className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Tomorrow
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5 text-xs">
          <span className="rounded-lg bg-emerald-100 px-2 py-1 font-medium text-emerald-800">
            {counts.complete} complete
          </span>
          <span className="rounded-lg bg-amber-100 px-2 py-1 font-medium text-amber-800">
            {counts.in_progress} in progress
          </span>
          <span className="rounded-lg bg-zinc-200 px-2 py-1 font-medium text-zinc-700">
            {counts.not_started} not started
          </span>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && rows.length === 0 ? (
          <Spinner label="Loading sessions…" />
        ) : rows.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-zinc-400">
            No scheduled sessions on {formatDateLong(date)}.
          </p>
        ) : (
          <ul className="mx-auto max-w-3xl divide-y divide-zinc-100 px-4 py-2">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="w-20 shrink-0 text-xs tabular-nums text-zinc-500">
                  {formatTimeMeridiem(row.start_time)}
                </span>
                <span className="w-40 min-w-0 shrink-0">
                  <span className="block truncate text-sm font-medium text-zinc-900">
                    {row.student?.name ?? 'Unknown'}
                  </span>
                  <span className="block text-[10px] text-zinc-400">
                    {row.student?.grade ? `gr ${row.student.grade}` : ''}
                    {row.duration && row.duration !== 60 ? ` · ${row.duration}m` : ''}
                  </span>
                </span>

                <span className="flex shrink-0 overflow-hidden rounded-lg border border-zinc-300">
                  {BINDER_STATUSES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setStatus(row, s.value)}
                      aria-pressed={(row.binder_status ?? 'not_started') === s.value}
                      className={
                        'px-2 py-1 text-[11px] font-medium transition ' +
                        ((row.binder_status ?? 'not_started') === s.value
                          ? s.active
                          : 'bg-white text-zinc-500 hover:bg-zinc-100')
                      }
                    >
                      {s.label}
                    </button>
                  ))}
                </span>

                <input
                  type="text"
                  value={row.binder_note ?? ''}
                  onChange={(e) => setNote(row, e.target.value)}
                  placeholder="Binder note — pages, packets, anything prep needs"
                  aria-label={`Binder note for ${row.student?.name ?? 'student'}`}
                  className="min-w-40 flex-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-800 placeholder:text-zinc-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-200"
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
