import { useCenter } from '../features/centers/CenterProvider'
import { formatDateLong, todayISO } from '../lib/dates'

export default function DayViewPage() {
  const { center } = useCenter()

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <p className="text-xs font-semibold tracking-wide text-brand-500 uppercase">Step 2</p>
      <h2 className="mt-2 text-2xl font-semibold text-slate-900">Day view</h2>
      <p className="mt-3 text-sm text-slate-500">
        Time grid by level, session cards, instructor sidebar, drag-drop assignment.
      </p>
      <div className="mt-8 inline-block rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm">
        <p className="font-semibold text-slate-900">{center?.name}</p>
        <p className="mt-1 text-slate-600">{formatDateLong(todayISO())}</p>
        <p className="mt-2 text-xs text-slate-400">Center time — America/New_York</p>
      </div>
    </div>
  )
}
