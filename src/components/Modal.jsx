import { useEffect } from 'react'

/**
 * The one overlay used by every "fix it in place" surface: the unplaced
 * panel's ranking editor, the day-shift editor, and the data-health editors.
 * Two shapes — a centered card, or a right-hand panel for the student drawer,
 * which is itself a full-height column.
 */
export default function Modal({ side = 'center', label, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      {side === 'right' ? (
        <div role="dialog" aria-label={label} className="fixed inset-y-0 right-0 z-50 flex shadow-2xl">
          {children}
        </div>
      ) : (
        <div
          role="dialog"
          aria-label={label}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[26rem] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl"
        >
          {children}
        </div>
      )}
    </>
  )
}
