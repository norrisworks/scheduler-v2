import { Outlet } from 'react-router-dom'
import TopBar from './TopBar'
import Spinner from './Spinner'
import { useCenter } from '../features/centers/CenterProvider'

export default function AppShell() {
  const { loading, error, center } = useCenter()

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
        ) : !center ? (
          <div className="mx-auto max-w-lg px-6 py-16 text-center text-sm text-slate-500">
            No centers found for this account.
          </div>
        ) : (
          // Remount the active view when the center changes so no view can
          // render one center's data under another's header.
          <Outlet key={center.id} />
        )}
      </main>
    </div>
  )
}
