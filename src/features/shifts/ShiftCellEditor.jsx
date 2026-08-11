import { useEffect, useState } from 'react'
import { formatDateShort } from '../../lib/dates'
import { validateShift } from './weekShifts'

const inputClass =
  'w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200'

/**
 * Add, change or delete one shift. Rendered at the view root so the grid's
 * scroll containers can't clip it.
 */
export default function ShiftCellEditor({ cell, saving, onSave, onDelete, onClose }) {
  const [start, setStart] = useState(cell.start)
  const [end, setEnd] = useState(cell.end)
  const [error, setError] = useState(null)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e) {
    e.preventDefault()
    const problem = validateShift(start, end)
    if (problem) {
      setError(problem)
      return
    }
    const ok = await onSave({
      id: cell.shift?.id ?? null,
      instructor_id: cell.instructor.id,
      date: cell.date,
      start,
      end,
    })
    if (ok) onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="dialog"
        aria-label={`Shift for ${cell.instructor.name} on ${formatDateShort(cell.date)}`}
        className="fixed z-50 w-56 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl"
        style={{
          left: Math.min(cell.x, window.innerWidth - 240),
          top: Math.min(cell.y + 6, window.innerHeight - 210),
        }}
      >
        <p className="mb-2 truncate text-xs font-semibold text-zinc-900">
          {cell.instructor.name}
          <span className="ml-1 font-normal text-zinc-500">{formatDateShort(cell.date)}</span>
        </p>

        <form onSubmit={submit} className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-zinc-600">Start</span>
            <input
              type="time"
              step="900"
              autoFocus
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-zinc-600">End</span>
            <input
              type="time"
              step="900"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className={inputClass}
            />
          </label>

          {error && <p className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{error}</p>}

          <div className="flex items-center gap-1.5 pt-1">
            {cell.shift && (
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  const ok = await onDelete(cell.shift.id)
                  if (ok) onClose()
                }}
                title="Remove this shift — use for a call-out"
                className="rounded-lg border border-red-200 px-2 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-40"
              >
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded-lg border border-zinc-300 px-2 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand-500 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
