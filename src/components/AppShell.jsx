import { Outlet } from 'react-router-dom'
import TopBar from './TopBar'
import Spinner from './Spinner'
import { useCenter } from '../features/centers/CenterProvider'

export default function AppShell() {
  const { loading, error, center, misconfigured } = useCenter()

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <Spinner label="Loading centers…" />
        ) : error ? (
          <div className="mx-auto max-w-lg px-6 py-16 text-center">
            <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              Could not load centers: {error}
            </p>
          </div>
        ) : misconfigured ? (
          <div className="mx-auto max-w-lg px-6 py-16 text-center">
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              This account is pinned to a center that does not exist. Check its
              <code className="mx-1 rounded bg-amber-100 px-1">app_metadata</code>
              in the Supabase dashboard.
            </p>
          </div>
        ) : !center ? (
          <div className="mx-auto max-w-lg px-6 py-16 text-center text-sm text-slate-500">
            No centers found for this account.
          </div>
        ) : (
          // Deliberately NOT keyed on center.id: remounting threw away view
          // state (the day view's selected date) on every center switch.
          // Each data hook is instead responsible for withholding rows that
          // were loaded for a different center — see useDaySchedule.
          <Outlet />
        )}
      </main>
    </div>
  )
}
