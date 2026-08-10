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
 * This is a UI restriction only for now. RLS still allows any authenticated
 * user to read any center, so treat it as ergonomics until the policies land.
 *
 * Note this role is about which centers a LOGIN may see. It is unrelated to
 * the `instructors` table, which is staff records for assignment.
 */

export const ROLE_ADMIN = 'admin'
export const ROLE_INSTRUCTOR = 'instructor'

export function getRole(user) {
  const role = user?.app_metadata?.role
  // Accounts predate this field, and the ~5 staff logins are created by hand.
  // Absent role means the owner's own account, so it stays unrestricted.
  return role === ROLE_INSTRUCTOR ? ROLE_INSTRUCTOR : ROLE_ADMIN
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
