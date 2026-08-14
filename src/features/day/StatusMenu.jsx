import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { BINDER_STATUSES } from '../binder/BinderPrepView'

/**
 * Status changes for one session. Rendered at the top of the day view rather
 * than inside the card, so it is never clipped by the card's overflow.
 *
 * Also the day view's one look at the binder note: the day query never loads
 * it (cards must not show it), so this fetches the single session's note on
 * open instead.
 */
export default function StatusMenu({ menu, onStatusChange, onClose }) {
  const [binder, setBinder] = useState(null)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    setBinder(null)
    if (!menu) return
    supabase
      .from('sessions')
      .select('binder_status, binder_note')
      .eq('id', menu.session.id)
      .single()
      .then(({ data }) => data && setBinder(data))
  }, [menu])

  if (!menu) return null

  const { session, x, y } = menu
  const off = session.status === 'cancelled' || session.status === 'no_show'
  const binderMeta = BINDER_STATUSES.find((s) => s.value === (binder?.binder_status ?? 'not_started'))

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
        {binder && (
          <div className="max-w-56 border-t border-zinc-100 px-3 py-1.5">
            <p className="text-[10px] text-zinc-400">
              Binder:{' '}
              <span className={`rounded px-1 py-0.5 font-medium ${binderMeta.chip}`}>
                {binderMeta.label}
              </span>
            </p>
            {binder.binder_note && (
              <p className="mt-1 text-[11px] leading-snug break-words text-zinc-600">
                {binder.binder_note}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  )
}
