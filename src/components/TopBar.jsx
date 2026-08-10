import { NavLink } from 'react-router-dom'
import CenterSwitcher from '../features/centers/CenterSwitcher'
import { useAuth } from '../features/auth/AuthProvider'

const NAV = [
  { to: '/day', label: 'Day' },
  { to: '/roster', label: 'Roster' },
  { to: '/shifts', label: 'Shifts' },
  { to: '/imports', label: 'Imports' },
  { to: '/health', label: 'Data health' },
]

/** v1 header style: Mathnasium brand red, white text (capacity_colors). */
export default function TopBar() {
  const { user, signOut } = useAuth()

  return (
    <header className="sticky top-0 z-30 bg-brand-500">
      <div className="flex h-14 items-center gap-4 px-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-bold text-brand-600">
            M
          </span>
          <span className="hidden text-sm font-semibold text-white sm:block">Scheduler</span>
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto">
          {NAV.map((item) => (
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
