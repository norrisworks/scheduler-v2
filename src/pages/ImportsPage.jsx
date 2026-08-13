import { useState } from 'react'
import StudentImportView from '../features/imports/StudentImportView'
import RadiusImportView from '../features/imports/RadiusImportView'
import WorkstreamImportView from '../features/imports/WorkstreamImportView'

const TABS = [
  { key: 'students', label: 'Student roster' },
  { key: 'radius', label: 'Radius sessions' },
  { key: 'workstream', label: 'Workstream shifts' },
]

export default function ImportsPage() {
  const [tab, setTab] = useState('students')
  const active = TABS.find((t) => t.key === tab)

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-zinc-200 bg-white px-4 py-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={
              'rounded-lg px-3 py-1.5 text-sm font-medium transition ' +
              (tab === t.key
                ? 'bg-brand-50 text-brand-600'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'students' ? (
          <StudentImportView />
        ) : tab === 'radius' ? (
          <RadiusImportView />
        ) : (
          <WorkstreamImportView />
        )}
      </div>
    </div>
  )
}
