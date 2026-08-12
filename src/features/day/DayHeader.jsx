import { useRef } from 'react'
import { addDays, formatDateLong, todayISO } from '../../lib/dates'

export default function DayHeader({
  date,
  onDateChange,
  sessionCount,
  busy,
  onRefresh,
  orientation,
  onOrientationChange,
  grouping,
  onGroupingChange,
  onMaterialize,
  materializing,
  onAddSession,
}) {
  const today = todayISO()
  const pickerRef = useRef(null)

  // The date lives on the heading itself; the input behind it exists only to
  // raise the native picker, so every date control stays in one place.
  function openPicker() {
    const el = pickerRef.current
    if (!el) return
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker()
        return
      } catch {
        // Falls through to focus/click below.
      }
    }
    el.focus()
    el.click()
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2.5">
      <div className="flex items-center gap-1">
        <NavButton onClick={() => onDateChange(addDays(date, -1))} label="Previous day">
          ‹
        </NavButton>
        <NavButton onClick={() => onDateChange(addDays(date, 1))} label="Next day">
          ›
        </NavButton>
      </div>

      <button
        type="button"
        onClick={() => onDateChange(today)}
        disabled={date === today}
        className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-40"
      >
        Today
      </button>

      <div className="relative min-w-0">
        <button
          type="button"
          onClick={openPicker}
          title="Pick a date"
          className="flex max-w-full items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-left transition hover:bg-zinc-100"
        >
          <span className="min-w-0">
            <span className="block truncate text-base font-semibold text-zinc-900">
              {formatDateLong(date)}
            </span>
            <span className="block text-xs text-zinc-500">
              {sessionCount} session{sessionCount === 1 ? '' : 's'}
              {date === today ? ' · today' : ''}
            </span>
          </span>
          <span aria-hidden className="shrink-0 text-xs text-zinc-400">
            ▾
          </span>
        </button>
        <input
          ref={pickerRef}
          type="date"
          value={date}
          onChange={(e) => e.target.value && onDateChange(e.target.value)}
          aria-label="Jump to date"
          className="sr-only"
        />
      </div>

      <div
        className="ml-auto flex items-center overflow-hidden rounded-lg border border-zinc-300"
        role="group"
        aria-label="Day view orientation"
      >
        <OrientationButton
          active={orientation === 'vertical'}
          onClick={() => onOrientationChange('vertical')}
          label="Grid: time down the page, level columns across"
        >
          <span aria-hidden>▦</span> Grid
        </OrientationButton>
        <span className="h-6 w-px bg-zinc-300" aria-hidden />
        <OrientationButton
          active={orientation === 'transposed'}
          onClick={() => onOrientationChange('transposed')}
          label="Rows: time across the page, one row per student"
        >
          <span aria-hidden>▤</span> Rows
        </OrientationButton>
      </div>

      {/* Only meaningful in Rows — the Grid is level columns by definition. */}
      {orientation === 'transposed' && (
        <div
          className="flex items-center overflow-hidden rounded-lg border border-zinc-300"
          role="group"
          aria-label="Row grouping"
        >
          <OrientationButton
            active={grouping === 'level'}
            onClick={() => onGroupingChange('level')}
            label="Group rows by level"
          >
            Level
          </OrientationButton>
          <span className="h-6 w-px bg-zinc-300" aria-hidden />
          <OrientationButton
            active={grouping === 'instructor'}
            onClick={() => onGroupingChange('instructor')}
            label="Group rows by instructor — each instructor's afternoon as one band"
          >
            Instructor
          </OrientationButton>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onAddSession}
          className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-600"
        >
          + Session
        </button>
        <button
          type="button"
          onClick={() => onMaterialize()}
          disabled={materializing}
          title="Generate sessions from standing slots for the next two weeks. Safe to run any time — it never touches past or hand-edited sessions."
          className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-40"
        >
          {materializing ? 'Generating…' : 'Generate'}
        </button>
        <button
          type="button"
          onClick={() => onRefresh()}
          disabled={busy}
          className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-40"
        >
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  )
}

function OrientationButton({ active, onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={
        'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition ' +
        (active ? 'bg-brand-500 text-white' : 'bg-white text-zinc-600 hover:bg-zinc-100')
      }
    >
      {children}
    </button>
  )
}

function NavButton({ onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="h-8 w-8 rounded-lg border border-zinc-300 text-lg leading-none text-zinc-600 transition hover:bg-zinc-100"
    >
      {children}
    </button>
  )
}
