import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeQueryError } from '../lib/queryError'

/**
 * One automatic remint per page load, module-scoped on purpose. A stale token
 * is worth clearing without being asked; a clock that is genuinely wrong is
 * not, because refresh-and-retry would loop on it forever. After the first
 * attempt the button below is the only path.
 */
let autoRefreshed = false

/**
 * The one way a failed fetch is shown. Every list renders this INSTEAD OF its
 * empty state when a query errors — an auth failure must never be mistaken
 * for missing data.
 *
 * For clock skew and expiry it also offers to remint the token, because those
 * are the two failures a retry alone cannot clear.
 */
export default function QueryError({ error, onRetry, compact = false }) {
  const [busy, setBusy] = useState(false)
  const info = describeQueryError(error)
  const retryRef = useRef(onRetry)
  retryRef.current = onRetry

  // Try once, unprompted, before asking the owner to do anything.
  const shouldAutoRefresh = Boolean(info?.refreshSession) && !autoRefreshed
  useEffect(() => {
    if (!shouldAutoRefresh) return
    autoRefreshed = true
    let cancelled = false
    setBusy(true)
    supabase.auth.refreshSession().then(() => {
      if (cancelled) return
      setBusy(false)
      retryRef.current?.()
    })
    return () => {
      cancelled = true
    }
  }, [shouldAutoRefresh])

  if (!info) return null

  async function refreshAndRetry() {
    setBusy(true)
    // A fresh token is stamped against current server time, which is exactly
    // what a fast clock broke.
    await supabase.auth.refreshSession()
    setBusy(false)
    onRetry?.()
  }

  return (
    <div
      role="alert"
      className={
        'rounded-lg border border-red-200 bg-red-50 text-red-800 ' +
        (compact ? 'px-2.5 py-2' : 'px-4 py-3')
      }
    >
      <p className={compact ? 'text-xs font-semibold' : 'text-sm font-semibold'}>{info.title}</p>
      <p className={'mt-0.5 leading-snug ' + (compact ? 'text-[11px]' : 'text-xs')}>{info.detail}</p>

      {info.raw && info.raw !== info.detail && (
        <p className="mt-1 font-mono text-[10px] break-words text-red-500">{info.raw}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={busy}
            className="rounded border border-red-300 bg-white px-2 py-0.5 text-[11px] font-medium text-red-800 hover:bg-red-100 disabled:opacity-40"
          >
            Retry
          </button>
        )}
        {info.refreshSession && (
          <button
            type="button"
            onClick={refreshAndRetry}
            disabled={busy}
            className="rounded border border-red-300 bg-white px-2 py-0.5 text-[11px] font-medium text-red-800 hover:bg-red-100 disabled:opacity-40"
          >
            {busy ? 'Refreshing…' : 'Refresh session & retry'}
          </button>
        )}
      </div>
    </div>
  )
}
