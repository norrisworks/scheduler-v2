import { NavLink } from 'react-router-dom'
import CenterSwitcher from '../features/centers/CenterSwitcher'
import { useAuth } from '../features/auth/AuthProvider'

/**
 * The tabs in visual groups, left to right: running today, planning the
 * week, people, and — pushed to the far right — maintenance. Thin dividers,
 * no labels. Admin-only flags are per tab, so an instructor account sees
 * its permitted tabs in the same grouped order.
 */
const NAV_GROUPS = [
  {
    key: 'today',
    items: [
      { to: '/day', label: 'Day' },
      { to: '/binder', label: 'Binder' },
    ],
  },
  {
    key: 'planning',
    items: [
      { to: '/week', label: 'Week', adminOnly: true },
      { to: '/shifts', label: 'Shifts' },
    ],
  },
  {
    key: 'people',
    items: [
      { to: '/roster', label: 'Roster' },
      { to: '/instructors', label: 'Instructors', adminOnly: true },
      { to: '/rankings', label: 'Rankings', adminOnly: true },
    ],
  },
  {
    key: 'maintenance',
    pushRight: true,
    items: [
      { to: '/imports', label: 'Imports' },
      { to: '/health', label: 'Data health' },
    ],
  },
]

/** v1 header style: Mathnasium brand red, white text (capacity_colors). */
export default function TopBar() {
  const { user, signOut, isAdmin } = useAuth()
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((item) => isAdmin || !item.adminOnly),
  })).filter((g) => g.items.length > 0)

  return (
    <header className="sticky top-0 z-30 bg-brand-500">
      <div className="flex h-14 items-center gap-4 px-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-bold text-brand-600">
            M
          </span>
          <span className="hidden text-sm font-semibold text-white sm:block">Scheduler</span>
        </div>

        <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
          {groups.map((group, i) => (
            <div
              key={group.key}
              className={'flex items-center gap-1 ' + (group.pushRight ? 'ml-auto' : '')}
            >
              {/* A thin divider between groups; the pushed group's gap is
                  its own separator. */}
              {i > 0 && !group.pushRight && (
                <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-white/30" />
              )}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    'rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition ' +
                    (isActive
                      ? 'bg-white text-brand-600 shadow-sm'
                      : 'text-red-50 hover:bg-brand-600 hover:text-white')
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <CenterSwitcher />
          <div className="hidden text-right md:block">
            <p className="text-xs leading-tight text-red-100">Signed in as</p>
            <p className="text-xs leading-tight font-medium text-white">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="rounded-lg border border-red-200/60 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-600"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}
