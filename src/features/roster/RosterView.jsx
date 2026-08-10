import { useState } from 'react'
import { useCenter } from '../centers/CenterProvider'
import { formatTimeMeridiem } from '../../lib/dates'
import Spinner from '../../components/Spinner'
import { useFilteredRoster, useRoster } from './useRoster'
import { DAYS, LEVEL_OPTIONS, missingAttributes } from './studentFields'
import StudentDrawer from './StudentDrawer'

const LEVEL_DOT = {
  elementary: 'bg-sky-500',
  middle: 'bg-violet-500',
  high: 'bg-amber-500',
}

export default function RosterView() {
  const { centerId } = useCenter()
  const { students, loading, error, refetch, createStudent, dismissError } = useRoster(centerId)

  const [query, setQuery] = useState('')
  const [level, setLevel] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [selectedId, setSelectedId] = useState(null)

  const filtered = useFilteredRoster(students, { query, level, showInactive })

  async function addStudent() {
    const name = window.prompt('New student name')
    if (!name?.trim()) return
    const id = await createStudent(name)
    if (id) setSelectedId(id)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-900">Roster</h1>
          <p className="text-xs text-slate-500">
            {filtered.length} of {students.length} student{students.length === 1 ? '' : 's'}
          </p>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name…"
          aria-label="Search students by name"
          className="ml-2 w-48 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />

        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          aria-label="Filter by level"
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="">All levels</option>
          {LEVEL_OPTIONS.filter((o) => o.value).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-brand-500"
          />
          Show inactive
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={refetch}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={addStudent}
            className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600"
          >
            Add student
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={dismissError} className="font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          {loading && students.length === 0 ? (
            <Spinner label="Loading roster…" />
          ) : filtered.length === 0 ? (
            <p className="px-6 py-16 text-center text-sm text-slate-400">
              {students.length === 0
                ? 'No students at this center yet. Add one, or bring them in with the Radius import.'
                : 'No students match these filters.'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {filtered.map((student) => (
                <StudentRow
                  key={student.id}
                  student={student}
                  selected={student.id === selectedId}
                  onSelect={() => setSelectedId(student.id === selectedId ? null : student.id)}
                />
              ))}
            </ul>
          )}
        </div>

        {selectedId && (
          <StudentDrawer
            key={selectedId}
            studentId={selectedId}
            onClose={() => setSelectedId(null)}
            onChanged={refetch}
          />
        )}
      </div>
    </div>
  )
}

function StudentRow({ student, selected, onSelect }) {
  const slots = student.recurring_slots ?? []
  const pinned = (student.student_notes ?? []).filter((n) => n.pinned && !n.resolved).length
  const missing = missingAttributes(student)

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={
          'flex w-full items-center gap-3 px-4 py-2.5 text-left transition ' +
          (selected ? 'bg-brand-50' : 'hover:bg-slate-50') +
          (student.active === false ? ' opacity-50' : '')
        }
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${LEVEL_DOT[student.level] ?? 'bg-slate-300'}`}
          title={student.level ?? 'level not set'}
        />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-slate-900">{student.name}</span>
            {student.grade && (
              <span className="shrink-0 rounded bg-zinc-200 px-1 text-[10px] text-zinc-600">
                {student.grade}
              </span>
            )}
            {student.first_day && (
              <span className="shrink-0 rounded bg-emerald-100 px-1 text-[10px] text-emerald-800">
                First day
              </span>
            )}
            {student.needs_schoolwork && (
              <span className="shrink-0 rounded bg-[#FFEB3B] px-1 text-[10px] font-bold text-black">
                Supp
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {slots.length === 0
              ? 'No standing slots'
              : slots
                  .slice()
                  .sort((a, b) => a.day_of_week - b.day_of_week)
                  .map(
                    (s) =>
                      `${DAYS.find((d) => d.value === s.day_of_week)?.short} ${formatTimeMeridiem(s.start_time)}`,
                  )
                  .join(' · ')}
          </span>
        </span>

        {missing.length > 0 && (
          <span
            className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800"
            title={`Missing: ${missing.join(', ')}`}
          >
            {missing.length} missing
          </span>
        )}
        {pinned > 0 && (
          <span
            className="shrink-0 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] text-brand-700"
            title={`${pinned} pinned note${pinned === 1 ? '' : 's'}`}
          >
            {pinned} pinned
          </span>
        )}
      </button>
    </li>
  )
}
