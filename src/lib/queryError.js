/**
 * Why a query failed, in terms the floor can act on.
 *
 * The rule this exists to enforce: A FAILED QUERY IS NEVER AN EMPTY RESULT.
 * The rankings modal rendered "No rankings, so auto-assign cannot place this
 * student" while the matrix behind it showed a full list — the fetch had
 * failed auth and the empty array was drawn as though it were data. An error
 * must look like an error, always, or it sends someone hunting for missing
 * data that was never missing.
 */

export const CLOCK_SKEW = 'clock_skew'
export const SESSION_EXPIRED = 'session_expired'
export const OFFLINE = 'offline'
export const UNKNOWN = 'unknown'

const textOf = (error) =>
  typeof error === 'string'
    ? error
    : [error?.message, error?.details, error?.hint, error?.error_description]
        .filter(Boolean)
        .join(' ')

/**
 * "JWT issued at future" is PostgREST refusing a token whose iat is ahead of
 * server time — i.e. THIS MACHINE'S CLOCK IS FAST. It presents as a total
 * auth failure, so it is worth naming precisely rather than showing the raw
 * string; nobody reads "JWT issued at future" and thinks to check the clock.
 */
export function classifyQueryError(error) {
  if (!error) return null
  const text = textOf(error).toLowerCase()
  if (!text) return UNKNOWN
  if (/issued\s+at\s+future/.test(text) || /clock\s*skew/.test(text) || /iat.*future/.test(text)) {
    return CLOCK_SKEW
  }
  if (/jwt\s*expired/.test(text) || /token.*expired/.test(text) || /invalid\s+jwt/.test(text)) {
    return SESSION_EXPIRED
  }
  if (/failed to fetch|network\s*error|networkerror|load failed/.test(text)) return OFFLINE
  return UNKNOWN
}

/**
 * A message, a fix, and what the UI is allowed to offer. `refreshSession` is
 * the difference between an error that clears itself and one the owner has to
 * reason about: for skew and expiry, a fresh token is minted against current
 * server time and the retry usually just works.
 */
export function describeQueryError(error) {
  if (!error) return null
  const kind = classifyQueryError(error)
  const raw = textOf(error) || 'Unknown error'

  if (kind === CLOCK_SKEW) {
    return {
      kind,
      title: 'Your system clock is ahead of the server',
      detail:
        'The login token is stamped in the future, so the database rejects every query. ' +
        'Sync this machine’s clock (Windows: Settings → Time & language → Date & time → Sync now), then retry.',
      raw,
      canRetry: true,
      refreshSession: true,
    }
  }
  if (kind === SESSION_EXPIRED) {
    return {
      kind,
      title: 'Your session expired',
      detail: 'Refreshing the session should restore access without signing in again.',
      raw,
      canRetry: true,
      refreshSession: true,
    }
  }
  if (kind === OFFLINE) {
    return {
      kind,
      title: 'Could not reach the database',
      detail: 'The network request did not complete. Check the connection and retry.',
      raw,
      canRetry: true,
      refreshSession: false,
    }
  }
  return {
    kind: UNKNOWN,
    title: 'That did not load',
    detail: raw,
    raw,
    canRetry: true,
    refreshSession: false,
  }
}

/**
 * Guard for every list in the app: if this returns true the caller must show
 * the error, NOT its empty state, however empty the data looks.
 */
export function isFailure(error) {
  return Boolean(error)
}
