import { useEffect, useState } from 'react'
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
      { to: '/binder', label: 'Binders' },
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
      { to: '/roster', label: 'Students' },
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
/**
 * The signed-in identity, collapsed into one small account button at the
 * far right: clicking it opens a menu with the email and Sign out.
 */
function AccountMenu({ email, onSignOut }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        title={email ?? 'Account'}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/30"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="12" cy="8.5" r="3.4" />
          <path d="M5 19.5c1.4-3 4-4.5 7-4.5s5.6 1.5 7 4.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute top-10 right-0 z-50 w-60 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg"
          >
            <p className="border-b border-zinc-100 px-3 py-2 text-xs text-zinc-500">
              Signed in as
              <span className="mt-0.5 block truncate font-medium text-zinc-800">{email}</span>
            </p>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onSignOut()
              }}
              className="block w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  )
}

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
                <span aria-hidden className="mx-3 h-6 w-px shrink-0 bg-white/60" />
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
          <AccountMenu email={user?.email} onSignOut={signOut} />
        </div>
      </div>
    </header>
  )
}
