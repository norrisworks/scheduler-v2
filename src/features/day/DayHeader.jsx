import { addDays, formatDateLong, todayISO } from '../../lib/dates'

export default function DayHeader({
  date,
  onDateChange,
  sessionCount,
  busy,
  onRefresh,
  orientation,
  onOrientationChange,
  onMaterialize,
  materializing,
  onAddSession,
}) {
  const today = todayISO()

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
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
        className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
      >
        Today
      </button>

      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold text-slate-900">{formatDateLong(date)}</h1>
        <p className="text-xs text-slate-500">
          {sessionCount} session{sessionCount === 1 ? '' : 's'}
          {date === today ? ' · today' : ''}
        </p>
      </div>

      {/* View orientation sits with the date controls, not among the action
          buttons — as a pale pill on the right it read as decoration. */}
      <div
        className="ml-4 flex items-center overflow-hidden rounded-lg border border-zinc-300"
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

      <div className="ml-auto flex items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && onDateChange(e.target.value)}
          aria-label="Jump to date"
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-700"
        />
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
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
        >
          {materializing ? 'Generating…' : 'Generate'}
        </button>
        <button
          type="button"
          onClick={() => onRefresh()}
          disabled={busy}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
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
      className="h-8 w-8 rounded-lg border border-slate-300 text-lg leading-none text-slate-600 transition hover:bg-slate-100"
    >
      {children}
    </button>
  )
}
