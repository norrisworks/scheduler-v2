import { formatTimeMeridiem } from '../../lib/dates'

/**
 * Cancelled sessions are off the grid and out of the counts — not on the
 * floor, not consuming capacity — but stay visible and reversible here.
 * Cancelled is the ONLY status this app surfaces: attendance (attended,
 * no-show) belongs to Radius, so rows carrying those values simply leave the
 * day view rather than being displayed.
 */
export default function CancelledList({ sessions, onStatusChange }) {
  const cancelled = sessions.filter((s) => s.status === 'cancelled')

  if (cancelled.length === 0) return null

  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2 border-t border-slate-200 bg-white px-4 py-2">
      <Group
        label="Cancelled today"
        sessions={cancelled}
        dot="bg-red-500"
        onStatusChange={onStatusChange}
      />
    </div>
  )
}

function Group({ label, sessions, dot, onStatusChange }) {
  if (sessions.length === 0) return null

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-slate-500">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label} ({sessions.length})
      </span>
      <div className="flex flex-wrap gap-1">
        {sessions.map((session) => (
          <span
            key={session.id}
            className="group flex items-center gap-1 rounded border border-slate-200 bg-slate-50 py-0.5 pr-0.5 pl-1.5 text-[11px] text-slate-600"
          >
            <span className="truncate line-through">{session.student?.name ?? 'Unknown'}</span>
            <span className="text-slate-400">{formatTimeMeridiem(session.start_time)}</span>
            <button
              type="button"
              onClick={() => onStatusChange(session.id, 'scheduled')}
              title={`Restore ${session.student?.name ?? 'session'} to the grid`}
              className="rounded px-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-800"
            >
              ↩
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}
