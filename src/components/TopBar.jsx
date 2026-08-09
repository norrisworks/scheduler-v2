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

export default function TopBar() {
  const { user, signOut } = useAuth()

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
      <div className="flex h-14 items-center gap-4 px-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
            M
          </span>
          <span className="hidden text-sm font-semibold text-slate-900 sm:block">Scheduler</span>
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                'rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition ' +
                (isActive
                  ? 'bg-brand-50 text-brand-600'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <CenterSwitcher />
          <div className="hidden text-right md:block">
            <p className="text-xs leading-tight text-slate-500">Signed in as</p>
            <p className="text-xs leading-tight font-medium text-slate-800">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}
