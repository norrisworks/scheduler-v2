import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useCenter } from '../centers/CenterProvider'
import Spinner from '../../components/Spinner'
import QueryError from '../../components/QueryError'
import { addDays, formatDateLong, formatTimeMeridiem, todayISO } from '../../lib/dates'
import { BINDER_RESET, BINDER_STATUSES, binderCounts, binderRows, binderStatusOf } from './binderPrep'


/**
 * The night-before checklist: every student on a chosen date's schedule, in
 * time order, with a three-way prep status and a note for whoever builds the
 * binders.
 *
 * Status and note live on the STUDENT, because prep is physical work on a
 * physical binder and it survives until that binder is actually used. Reset is
 * attendance-driven, in a database trigger — a no-show no longer throws the
 * prep away, and a date going by never clears anything.
 *
 * One row per student, not per session: a student booked twice shares a single
 * status, so showing two independent controls would be showing a lie.
 *
 * The note is prep context only. Day-view cards never show it; they get a bare
 * done/not-done tick.
 */
export default function BinderPrepView() {
  const { centerId, center } = useCenter()
  // Prep happens the night before, so tomorrow is the default.
  const [date, setDate] = useState(() => addDays(todayISO(), 1))
  const [snapshot, setSnapshot] = useState({ key: null, rows: [] })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [saveError, setSaveError] = useState(null)
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
        'id, start_time, duration, status, student:students ( id, name, grade, level, binder_status, binder_note )',
      )
      .eq('center_id', centerId)
      .eq('date', date)
      .eq('status', 'scheduled')
      .order('start_time')

    if (token !== requestRef.current) return
    if (error) {
      // A failed load must not read as "nobody is booked that day".
      setLoadError(error)
    } else {
      setSnapshot({ key, rows: binderRows(data) })
      setLoadError(null)
    }
    setLoading(false)
  }, [centerId, date, key])

  useEffect(() => {
    load()
  }, [load])

  const rows = snapshot.key === key ? snapshot.rows : []

  /** Patches the student on every row that carries them — one shared state. */
  const patchStudent = useCallback((studentId, patch) => {
    setSnapshot((prev) => ({
      ...prev,
      rows: prev.rows.map((r) =>
        r.studentId === studentId ? { ...r, student: { ...r.student, ...patch } } : r,
      ),
    }))
  }, [])

  /** Every change saves immediately; a failure rolls the row back and says so. */
  const save = useCallback(
    async (studentId, patch, previous) => {
      patchStudent(studentId, patch)
      const { error } = await supabase
        .from('students')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', studentId)
      if (error) {
        patchStudent(studentId, previous)
        setSaveError(error)
      }
    },
    [patchStudent],
  )

  const setStatus = (row, value) =>
    save(
      row.studentId,
      { binder_status: value },
      { binder_status: binderStatusOf(row.student) },
    )

  /**
   * The manual reset. Attendance normally clears a binder, but that depends on
   * the Radius import having been run — so there has to be a way to say "this
   * binder is used" by hand. Clears the note as well as the status.
   */
  const reset = (row) =>
    save(row.studentId, { ...BINDER_RESET }, {
      binder_status: binderStatusOf(row.student),
      binder_note: row.student?.binder_note ?? null,
    })

  // Notes save on a short debounce so typing is not a write per keystroke.
  const setNote = (row, value) => {
    patchStudent(row.studentId, { binder_note: value })
    const timers = noteTimers.current
    clearTimeout(timers.get(row.studentId))
    timers.set(
      row.studentId,
      setTimeout(async () => {
        const { error } = await supabase
          .from('students')
          .update({ binder_note: value || null, updated_at: new Date().toISOString() })
          .eq('id', row.studentId)
        if (error) setSaveError(error)
      }, 500),
    )
  }

  const counts = useMemo(() => binderCounts(rows), [rows])

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

      {saveError && (
        <div className="border-b border-red-200 px-4 py-2">
          <QueryError error={saveError} compact onRetry={() => setSaveError(null)} />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {loadError ? (
          <div className="mx-auto max-w-2xl px-4 py-8">
            <QueryError
              error={loadError}
              onRetry={() => {
                setLoadError(null)
                load()
              }}
            />
          </div>
        ) : loading && rows.length === 0 ? (
          <Spinner label="Loading sessions…" />
        ) : rows.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-zinc-400">
            No scheduled sessions on {formatDateLong(date)}.
          </p>
        ) : (
          <ul className="mx-auto max-w-3xl divide-y divide-zinc-100 px-4 py-2">
            {rows.map((row) => {
              const status = binderStatusOf(row.student)
              const prepped = status !== 'not_started' || row.student?.binder_note
              return (
                <li key={row.studentId} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="w-20 shrink-0 text-xs tabular-nums text-zinc-500">
                    {formatTimeMeridiem(row.startTime)}
                  </span>
                  <span className="w-40 min-w-0 shrink-0">
                    <span className="block truncate text-sm font-medium text-zinc-900">
                      {row.student?.name ?? 'Unknown'}
                    </span>
                    <span className="block text-[10px] text-zinc-400">
                      {row.student?.grade ? `gr ${row.student.grade}` : ''}
                      {row.duration && row.duration !== 60 ? ` · ${row.duration}m` : ''}
                      {/* One binder, two visits — say so rather than repeat the row. */}
                      {row.sessionCount > 1 ? ` · ${row.sessionCount} sessions today` : ''}
                    </span>
                  </span>

                  <span className="flex shrink-0 overflow-hidden rounded-lg border border-zinc-300">
                    {BINDER_STATUSES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => setStatus(row, s.value)}
                        aria-pressed={status === s.value}
                        className={
                          'px-2 py-1 text-[11px] font-medium transition ' +
                          (status === s.value ? s.active : 'bg-white text-zinc-500 hover:bg-zinc-100')
                        }
                      >
                        {s.label}
                      </button>
                    ))}
                  </span>

                  <input
                    type="text"
                    value={row.student?.binder_note ?? ''}
                    onChange={(e) => setNote(row, e.target.value)}
                    placeholder="Binder note — pages, packets, anything prep needs"
                    aria-label={`Binder note for ${row.student?.name ?? 'student'}`}
                    className="min-w-40 flex-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-800 placeholder:text-zinc-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-200"
                  />

                  <button
                    type="button"
                    onClick={() => reset(row)}
                    disabled={!prepped}
                    title="Mark this binder used — clears the status and the note"
                    aria-label={`Reset binder for ${row.student?.name ?? 'student'}`}
                    className="shrink-0 rounded border border-zinc-300 px-1.5 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-30"
                  >
                    Reset
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
