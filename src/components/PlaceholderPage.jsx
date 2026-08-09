import { useCenter } from '../features/centers/CenterProvider'

/**
 * Stand-in for views 2–9 in BRIEF.md. Each gets replaced by the real feature
 * as it's built; showing the active center here proves the scope is wired.
 */
export default function PlaceholderPage({ title, step, description }) {
  const { center } = useCenter()

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <p className="text-xs font-semibold tracking-wide text-brand-500 uppercase">
        Step {step}
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-slate-900">{title}</h2>
      <p className="mt-3 text-sm text-slate-500">{description}</p>
      <p className="mt-8 inline-block rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
        Scoped to <span className="font-semibold">{center?.name ?? '—'}</span>
      </p>
    </div>
  )
}
