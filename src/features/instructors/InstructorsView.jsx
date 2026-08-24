import { useState } from 'react'
import QueryError from '../../components/QueryError'
import { useCenter } from '../centers/CenterProvider'
import { useAuth } from '../auth/AuthProvider'
import { readableTextOn } from '../../lib/colors'
import Spinner from '../../components/Spinner'
import { useInstructors } from './useInstructors'
import { capabilityString, instructorWarnings, nextColor } from './instructorFields'
import { isFallbackOnly } from '../assign/rankings'
import InstructorForm from './InstructorForm'
import BulkRankingInsert from './BulkRankingInsert'
import BulkRankingRemove from './BulkRankingRemove'
import { genderLabel } from '../../lib/gender'

export default function InstructorsView() {
  const { centerId, center } = useCenter()
  const { isAdmin } = useAuth()
  const {
    instructors,
    loading,
    saving,
    error,
    refetch,
    createInstructor,
    updateInstructor,
    reorderInstructors,
    dismissError,
  } = useInstructors(centerId)

  const [selectedId, setSelectedId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [dragIndex, setDragIndex] = useState(null)

  const selected = instructors.find((i) => i.id === selectedId) ?? null
  // This list IS the ranking editor, so it always shows everyone: the rank
  // order spans the whole center, inactive instructors included (muted).
  const visible = [...instructors].sort(
    (a, b) => (a.instructor_rank ?? 999) - (b.instructor_rank ?? 999) || a.name.localeCompare(b.name),
  )
  const activeCount = instructors.filter((i) => i.active).length

  function drop(index) {
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null)
      return
    }
    const next = [...visible]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(index, 0, moved)
    setDragIndex(null)
    reorderInstructors(next.map((i) => i.id))
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="rounded-lg bg-zinc-100 px-4 py-3 text-sm text-zinc-600">
          Instructor management is for admin accounts.
        </p>
      </div>
    )
  }

  async function submitNew(values) {
    const ok = await createInstructor(values)
    if (ok) setAdding(false)
    return ok
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2.5">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-zinc-900">Instructors</h1>
          <p className="text-xs text-zinc-500">
            {activeCount} active at {center?.name}
            {instructors.length - activeCount > 0 &&
              ` · ${instructors.length - activeCount} inactive`}
          </p>
        </div>

        <p className="ml-4 text-[11px] text-zinc-400">
          Drag to rank — 1 is your best. The order saves as you drop.
        </p>

        <button
          type="button"
          onClick={() => {
            setAdding(true)
            setSelectedId(null)
          }}
          className="ml-auto rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600"
        >
          Add instructor
        </button>
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
          {error && instructors.length === 0 ? (
            <div className="p-6">
              <QueryError error={error} onRetry={refetch} />
            </div>
          ) : loading && instructors.length === 0 ? (
            <Spinner label="Loading instructors…" />
          ) : visible.length === 0 ? (
            <p className="px-6 py-16 text-center text-sm text-zinc-400">
              No instructors at this center yet.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-200">
              {visible.map((instructor, index) => (
                <InstructorRow
                  key={instructor.id}
                  instructor={instructor}
                  rank={index + 1}
                  selected={instructor.id === selectedId}
                  dragging={dragIndex === index}
                  onDragStart={() => setDragIndex(index)}
                  onDrop={() => drop(index)}
                  onDragEnd={() => setDragIndex(null)}
                  onSelect={() => {
                    setAdding(false)
                    setSelectedId(instructor.id === selectedId ? null : instructor.id)
                  }}
                />
              ))}
            </ul>
          )}
        </div>

        {(adding || selected) && (
          <aside className="flex w-[24rem] shrink-0 flex-col border-l border-zinc-200 bg-white">
            <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900">
                {adding ? 'New instructor' : selected?.name}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setAdding(false)
                  setSelectedId(null)
                }}
                aria-label="Close instructor panel"
                className="rounded px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              >
                ✕
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
              <InstructorForm
                key={adding ? 'new' : selected.id}
                instructor={adding ? null : selected}
                defaultColor={adding ? nextColor(instructors) : undefined}
                saving={saving}
                onCreate={submitNew}
                onPatch={(patch) => updateInstructor(selected.id, patch)}
                onCancel={
                  adding
                    ? () => setAdding(false)
                    : () => setSelectedId(null)
                }
              />

              {!adding && selected && (
                <>
                  <BulkRankingInsert instructor={selected} centerId={centerId} />
                  <BulkRankingRemove instructor={selected} centerId={centerId} />
                </>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

function InstructorRow({
  instructor,
  rank,
  selected,
  dragging,
  onDragStart,
  onDrop,
  onDragEnd,
  onSelect,
}) {
  const warnings = instructorWarnings(instructor)
  const capabilities = capabilityString(instructor)

  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={dragging ? 'bg-brand-100' : ''}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={
          'flex w-full cursor-grab items-center gap-3 px-4 py-2.5 text-left transition active:cursor-grabbing ' +
          (selected ? 'bg-brand-50' : 'hover:bg-zinc-50') +
          (instructor.active ? '' : ' opacity-50')
        }
      >
        <span aria-hidden className="shrink-0 text-xs text-zinc-300">⋮⋮</span>
        <span className="w-7 shrink-0 text-center text-sm font-bold tabular-nums text-zinc-400">
          {rank}
        </span>
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[11px] font-bold"
          style={{ backgroundColor: instructor.color, color: readableTextOn(instructor.color) }}
        >
          {initials(instructor.name)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-zinc-900">{instructor.name}</span>
            {isFallbackOnly(instructor) && (
              <span className="shrink-0 rounded bg-zinc-200 px-1 text-[10px] text-zinc-700">
                Fallback only
              </span>
            )}
            {!instructor.active && (
              <span className="shrink-0 rounded bg-zinc-200 px-1 text-[10px] text-zinc-600">
                Inactive
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-zinc-500">
            {capabilities || 'no levels'}
            {instructor.gender ? ` · ${genderLabel(instructor.gender)}` : ''}
            {instructor.email ? ` · ${instructor.email}` : ''}
          </span>
        </span>

        {warnings.length > 0 && (
          <span
            className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800"
            title={warnings.join('; ')}
          >
            ⚠ {warnings.length}
          </span>
        )}
      </button>
    </li>
  )
}

function initials(name = '') {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}
