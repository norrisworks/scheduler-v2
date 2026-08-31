import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { formatTimeMeridiem } from '../../lib/dates'

/**
 * Cancelled sessions are off the grid and out of the counts — not on the
 * floor, not consuming capacity — but stay visible and reversible here.
 * Cancelled is the ONLY status this app surfaces: attendance (attended,
 * no-show) belongs to Radius, so rows carrying those values simply leave the
 * day view rather than being displayed.
 *
 * Each chip restores (↩) or hard-deletes (✕, admin, arm-then-fire). Delete
 * lives here and not only on the ⋯ menu because a cancelled session has no
 * card — this strip IS its only surface, and a cancelled row still occupies
 * its (date, time) against the unique index until it is reused or removed.
 */
export default function CancelledList({ sessions, onStatusChange, onDelete }) {
  const cancelled = sessions.filter((s) => s.status === 'cancelled')

  if (cancelled.length === 0) return null

  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2 border-t border-slate-200 bg-white px-4 py-2">
      <Group
        label="Cancelled today"
        sessions={cancelled}
        dot="bg-red-500"
        onStatusChange={onStatusChange}
        onDelete={onDelete}
      />
    </div>
  )
}

function Group({ label, sessions, dot, onStatusChange, onDelete }) {
  const { isAdmin } = useAuth()
  // Arm-then-fire per chip: the first ✕ turns the chip red, the second
  // deletes. Any other chip's ✕ re-arms there instead.
  const [armedId, setArmedId] = useState(null)

  if (sessions.length === 0) return null

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-slate-500">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label} ({sessions.length})
      </span>
      <div className="flex flex-wrap gap-1">
        {sessions.map((session) => {
          const armed = armedId === session.id
          return (
            <span
              key={session.id}
              className={
                'group flex items-center gap-1 rounded border py-0.5 pr-0.5 pl-1.5 text-[11px] ' +
                (armed
                  ? 'border-red-300 bg-red-50 text-red-700'
                  : 'border-slate-200 bg-slate-50 text-slate-600')
              }
            >
              <span className="truncate line-through">{session.student?.name ?? 'Unknown'}</span>
              <span className={armed ? 'text-red-400' : 'text-slate-400'}>
                {formatTimeMeridiem(session.start_time)}
              </span>
              <button
                type="button"
                onClick={() => {
                  setArmedId(null)
                  onStatusChange(session.id, 'scheduled')
                }}
                title={`Restore ${session.student?.name ?? 'session'} to the grid`}
                className="rounded px-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-800"
              >
                ↩
              </button>
              {isAdmin && onDelete && (
                <button
                  type="button"
                  onClick={() => {
                    if (!armed) {
                      setArmedId(session.id)
                      return
                    }
                    setArmedId(null)
                    onDelete(session.id)
                  }}
                  title={
                    armed
                      ? 'Click again to delete permanently — cannot be undone'
                      : `Delete ${session.student?.name ?? 'session'} permanently`
                  }
                  className={
                    'rounded px-1 transition ' +
                    (armed
                      ? 'bg-red-600 font-semibold text-white hover:bg-red-700'
                      : 'text-slate-400 hover:bg-red-100 hover:text-red-700')
                  }
                >
                  ✕
                </button>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}
