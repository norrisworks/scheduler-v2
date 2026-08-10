import { useEffect } from 'react'

/**
 * Status changes for one session. Rendered at the top of the day view rather
 * than inside the card, so it is never clipped by the card's overflow.
 */
export default function StatusMenu({ menu, onStatusChange, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!menu) return null

  const { session, x, y } = menu
  const off = session.status === 'cancelled' || session.status === 'no_show'

  const items = off
    ? [{ status: 'scheduled', label: 'Restore to schedule' }]
    : [
        { status: 'cancelled', label: 'Cancel' },
        { status: 'no_show', label: 'No-show' },
        ...(session.status === 'completed'
          ? [{ status: 'scheduled', label: 'Back to scheduled' }]
          : [{ status: 'completed', label: 'Mark completed' }]),
      ]

  function pick(status) {
    onStatusChange(session.id, status)
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="menu"
        className="fixed z-50 min-w-40 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg"
        // Nudged in from the anchor so the menu stays on screen near edges.
        style={{
          left: Math.min(x, window.innerWidth - 176),
          top: Math.min(y + 4, window.innerHeight - 8 - items.length * 32),
        }}
      >
        <p className="truncate px-3 py-1 text-[11px] font-semibold text-zinc-400">
          {session.student?.name ?? 'Session'}
        </p>
        {items.map((item) => (
          <button
            key={item.status}
            type="button"
            role="menuitem"
            onClick={() => pick(item.status)}
            className="block w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100"
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  )
}
