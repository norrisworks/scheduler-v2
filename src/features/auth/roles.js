/**
 * Roles live in Supabase Auth `app_metadata`, which only the service role can
 * write — a user cannot grant themselves a role from the client, unlike
 * user_metadata. Set it by hand in the dashboard alongside the account:
 *
 *   admin (owner, center directors):
 *     { "role": "admin" }
 *   instructor (the shared per-center logins, instructor-mv@ / instructor-bb@):
 *     { "role": "instructor", "center_code": "MV" }
 *     { "role": "instructor", "center_id": "<centers.id uuid>" }
 *
 * Either center_id or center_code identifies the pinned center; center_id is
 * what an RLS policy will read straight out of the JWT later:
 *   center_id = (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
 *
 * Center pinning is a UI restriction only for now — RLS still allows any
 * authenticated user to read any center's rows. The exception is
 * instructors.tier, which IS database-enforced: the column is revoked from
 * clients, readable only through the instructor_tiers view (empty for
 * instructor JWTs) and writable only through the set_instructor_tier RPC.
 *
 * Note this role is about which centers a LOGIN may see. It is unrelated to
 * the `instructors` table, which is staff records for assignment.
 */

export const ROLE_ADMIN = 'admin'
export const ROLE_INSTRUCTOR = 'instructor'

export function getRole(user) {
  // Least privilege: ONLY an explicit `role: "admin"` claim is admin. An
  // absent or unrecognized claim resolves to instructor, so an account
  // created without metadata is a restricted login, not a silent admin.
  // (Every real account now carries an explicit role.)
  return user?.app_metadata?.role === ROLE_ADMIN ? ROLE_ADMIN : ROLE_INSTRUCTOR
}

/** The center an instructor account is pinned to, or null for admins. */
export function getPinnedCenter(user) {
  if (getRole(user) !== ROLE_INSTRUCTOR) return null
  const meta = user?.app_metadata ?? {}
  const id = typeof meta.center_id === 'string' ? meta.center_id : null
  const code = typeof meta.center_code === 'string' ? meta.center_code.toUpperCase() : null
  if (!id && !code) return null
  return { id, code }
}

/** Does this pin match a center row? */
export function centerMatchesPin(center, pin) {
  if (!pin) return true
  if (pin.id) return center.id === pin.id
  return center.short_code?.toUpperCase() === pin.code
}

/**
 * Which centers a login may see, and whether it may switch between them.
 * Pure so the access decision itself is directly testable — see
 * `npm run check`, which runs the real accounts' metadata through it.
 */
export function resolveCenterAccess(user, allCenters) {
  const pin = getPinnedCenter(user)
  const centers = allCenters.filter((c) => centerMatchesPin(c, pin))
  return {
    centers,
    pinned: Boolean(pin),
    canSwitch: !pin && centers.length > 1,
  }
}
