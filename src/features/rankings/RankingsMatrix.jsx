import { useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import QueryError from '../../components/QueryError'
import InstructorForm from '../instructors/InstructorForm'
import { useCenter } from '../centers/CenterProvider'
import { useAuth } from '../auth/AuthProvider'
import { readableTextOn } from '../../lib/colors'
import Spinner from '../../components/Spinner'
import { LEVEL_OPTIONS } from '../roster/studentFields'
import { isFallbackOnly } from '../assign/rankings'
import { ineligibleForStudentReason } from '../assign/proposeRanking'
import { useRankingsMatrix } from './useRankingsMatrix'
import SeedRankingsDialog from './SeedRankingsDialog'
import Modal from '../../components/Modal'
import InstructorPins from '../roster/InstructorPins'
import { GENDERS, genderLabel, sameGender } from '../../lib/gender'

const NAME_COL = 190
const CELL = 46

export default function RankingsMatrix() {
  const { centerId, center } = useCenter()
  const { isAdmin } = useAuth()
  const {
    students,
    instructors,
    ranks,
    overrides,
    rankedCounts,
    loading,
    saving,
    error,
    refetch,
    setRank,
    saveRankingList,
    dismissError,
  } = useRankingsMatrix(centerId)

  const [query, setQuery] = useState('')
  const [level, setLevel] = useState('')
  const [gender, setGender] = useState('')
  const [sort, setSort] = useState('incomplete')
  const [seeding, setSeeding] = useState(null)
  // The full drag editor for one student, over the matrix. Closing refetches
  // so the row updates in place; the table itself never unmounts, so the
  // scroll position survives.
  const [editingStudent, setEditingStudent] = useState(null)
  // The instructor editor over the matrix, from a column header — the mirror
  // of the student modal. Closing refetches so capability edits reopen or
  // close cells in place.
  const [editingInstructor, setEditingInstructor] = useState(null)
  const [instructorSaving, setInstructorSaving] = useState(false)
  const [instructorError, setInstructorError] = useState(null)
  const cellRefs = useRef(new Map())

  async function patchInstructor(id, patch) {
    setInstructorSaving(true)
    setInstructorError(null)
    const { error } = await supabase.from('instructors').update(patch).eq('id', id)
    setInstructorSaving(false)
    if (error) setInstructorError(error.message)
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = students.filter((s) => {
      if (level && (s.level ?? '') !== level) return false
      if (gender && (s.gender ?? '') !== gender) return false
      if (needle && !s.name.toLowerCase().includes(needle)) return false
      return true
    })

    const counted = filtered.map((s) => ({ student: s, ranked: rankedCounts.get(s.id) ?? 0 }))
    if (sort === 'name') counted.sort((a, b) => a.student.name.localeCompare(b.student.name))
    else if (sort === 'gender') {
      counted.sort(
        (a, b) =>
          (a.student.gender ?? 'zz').localeCompare(b.student.gender ?? 'zz') ||
          a.student.name.localeCompare(b.student.name),
      )
    } else {
      // Unranked and thinnest lists first — the work queue.
      counted.sort((a, b) => a.ranked - b.ranked || a.student.name.localeCompare(b.student.name))
    }
    return counted
  }, [students, query, level, gender, sort, rankedCounts])

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="rounded-lg bg-zinc-100 px-4 py-3 text-sm text-zinc-600">
          The rankings matrix is for admin accounts.
        </p>
      </div>
    )
  }

  const unrankedCount = students.filter((s) => (rankedCounts.get(s.id) ?? 0) === 0).length

  /** Arrow keys move between cells; the grid is usable without a mouse. */
  function onCellKeyDown(e, rowIndex, colIndex) {
    const moves = {
      ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0],
      Enter: [1, 0],
    }
    const move = moves[e.key]
    if (!move) return
    e.preventDefault()
    const target = cellRefs.current.get(`${rowIndex + move[0]}|${colIndex + move[1]}`)
    if (target) {
      target.focus()
      target.select?.()
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2.5">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-zinc-900">Rankings</h1>
          <p className="text-xs text-zinc-500">
            {visible.length} of {students.length} students at {center?.name} ·{' '}
            <span className={unrankedCount > 0 ? 'font-medium text-amber-700' : ''}>
              {unrankedCount} unranked
            </span>
          </p>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search student…"
          aria-label="Search students"
          className="ml-2 w-44 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
        />
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          aria-label="Filter by level"
          className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
        >
          <option value="">All levels</option>
          {LEVEL_OPTIONS.filter((o) => o.value).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          aria-label="Filter by student gender"
          className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
        >
          <option value="">Any gender</option>
          {GENDERS.map((g) => (
            <option key={g.value} value={g.value}>{g.long}</option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Sort students"
          className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
        >
          <option value="incomplete">Unranked first</option>
          <option value="name">Name</option>
          <option value="gender">Gender</option>
        </select>

        <div className="ml-auto flex items-center gap-2">
          {saving && <span className="text-xs text-zinc-400">Saving…</span>}
          <button
            type="button"
            onClick={refetch}
            className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={dismissError} className="font-medium underline">Dismiss</button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {error && students.length === 0 ? (
          <div className="p-6">
            <QueryError error={error} onRetry={refetch} />
          </div>
        ) : loading && students.length === 0 ? (
          <Spinner label="Loading rankings…" />
        ) : instructors.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-zinc-400">
            No active instructors at {center?.name}, so nobody can be ranked yet.
          </p>
        ) : (
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th
                  style={{ width: NAME_COL, minWidth: NAME_COL }}
                  className="sticky top-0 left-0 z-30 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-xs font-semibold text-zinc-600"
                >
                  Student
                </th>
                {instructors.map((i) => (
                  <th
                    key={i.id}
                    style={{ width: CELL, minWidth: CELL }}
                    className="sticky top-0 z-20 border-b border-zinc-200 bg-zinc-50 p-1 align-bottom"
                    title={`${i.name}${i.instructor_rank ? ` · ranked #${i.instructor_rank}` : ''}${isFallbackOnly(i) ? ' · fallback only' : ''} — click to edit`}
                  >
                    {/* Fix-in-place, same as clicking a student name: the
                        header IS the way to the instructor's editor while a
                        capability gap is on screen in their column. */}
                    <button
                      type="button"
                      onClick={() => setEditingInstructor(i)}
                      aria-label={`Edit ${i.name}`}
                      className="mx-auto block rounded hover:ring-2 hover:ring-brand-400"
                    >
                      <span
                        className="mx-auto flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold"
                        style={{ backgroundColor: i.color, color: readableTextOn(i.color) }}
                      >
                        {initials(i.name)}
                      </span>
                    </button>
                    <span className="mt-1 block text-[9px] font-normal text-zinc-400">
                      {genderLabel(i.gender)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ student, ranked }, rowIndex) => (
                <tr key={student.id} className="hover:bg-brand-50/40">
                  <th
                    style={{ width: NAME_COL, minWidth: NAME_COL }}
                    className="sticky left-0 z-10 border-b border-zinc-100 bg-white px-3 py-1 text-left font-normal"
                  >
                    <span className="flex items-center gap-1.5">
                      {/* Numbers in cells are the fast path; the name opens
                          the full drag editor, because reordering a whole
                          list one typed number at a time is not a thing. */}
                      <button
                        type="button"
                        onClick={() => setEditingStudent(student)}
                        title={`Open ${student.name}'s full ranking editor`}
                        className="min-w-0 flex-1 truncate text-left text-zinc-800 hover:text-brand-700 hover:underline"
                      >
                        {student.name}
                      </button>
                      {student.gender && (
                        <span className="shrink-0 text-[10px] text-zinc-400">
                          {genderLabel(student.gender)}
                        </span>
                      )}
                      {ranked === 0 ? (
                        <button
                          type="button"
                          onClick={() => setSeeding(student)}
                          className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-200"
                        >
                          seed
                        </button>
                      ) : (
                        <span className="shrink-0 text-[10px] text-zinc-400">{ranked}</span>
                      )}
                    </span>
                  </th>

                  {instructors.map((instructor, colIndex) => {
                    const key = `${student.id}|${instructor.id}`
                    const rank = ranks.get(key)
                    const moved = overrides.get(key) ?? 0
                    // The ONLY reason a cell is closed is level capability.
                    // Gender never gates a ranking — it only orders proposals.
                    const blocked = ineligibleForStudentReason(student, instructor)
                    const eligible = !blocked
                    const match = sameGender(student, instructor)

                    return (
                      <td
                        key={instructor.id}
                        style={{ width: CELL, minWidth: CELL }}
                        className={
                          'relative border-b border-zinc-100 p-0 text-center ' +
                          (eligible ? '' : 'bg-zinc-100')
                        }
                        title={
                          eligible
                            ? `${student.name} → ${instructor.name}` +
                              (match ? ' · same gender' : '') +
                              (moved ? ` · moved here ${moved}x` : '')
                            : `${instructor.name} is ${blocked} — level capability, not gender. ` +
                              `Tick ${student.level} on their instructor record to open this up.`
                        }
                      >
                        <input
                          ref={(el) => {
                            if (el) cellRefs.current.set(`${rowIndex}|${colIndex}`, el)
                          }}
                          type="text"
                          inputMode="numeric"
                          disabled={!eligible}
                          value={rank ?? ''}
                          onKeyDown={(e) => onCellKeyDown(e, rowIndex, colIndex)}
                          onChange={(e) => {
                            const v = e.target.value.trim()
                            const n = Number(v)
                            setRank(
                              student.id,
                              instructor.id,
                              v === '' ? null : Number.isFinite(n) && n >= 1 ? n : null,
                            )
                          }}
                          aria-label={`Rank of ${instructor.name} for ${student.name}`}
                          className={
                            'h-8 w-full border-0 bg-transparent text-center text-sm tabular-nums outline-none focus:bg-brand-100 focus:ring-2 focus:ring-inset focus:ring-brand-400 disabled:cursor-not-allowed ' +
                            (rank ? 'font-semibold text-zinc-900' : 'text-zinc-300') +
                            (match && !rank ? ' bg-emerald-50/60' : '')
                          }
                        />
                        {moved > 0 && (
                          <span
                            className="pointer-events-none absolute top-0 right-0 rounded-bl bg-violet-200 px-1 text-[8px] font-semibold text-violet-800"
                            title={`Moved here ${moved}x`}
                          >
                            {moved}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="border-t border-zinc-200 bg-white px-4 py-2 text-[11px] text-zinc-400">
        Type a number to rank, clear it to un-rank. Arrow keys move between cells. Grey columns are
        instructors who cannot teach that student's level. A violet corner count is how often you
        moved that student onto that instructor by hand.
      </p>

      {seeding && (
        <SeedRankingsDialog
          student={seeding}
          instructors={instructors}
          onClose={() => setSeeding(null)}
          onSave={async (entries) => {
            const ok = await saveRankingList(seeding.id, entries)
            if (ok) setSeeding(null)
            return ok
          }}
        />
      )}

      {editingStudent && (
        <Modal
          label={`Rankings for ${editingStudent.name}`}
          onClose={async () => {
            setEditingStudent(null)
            await refetch()
          }}
        >
          <div className="border-b border-zinc-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-900">
              Rankings — {editingStudent.name}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              {editingStudent.level ?? 'no level set'}
              {editingStudent.gender ? ` · ${genderLabel(editingStudent.gender)}` : ''} · every
              change saves immediately.
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <InstructorPins studentId={editingStudent.id} student={editingStudent} />
          </div>
          <div className="flex justify-end border-t border-zinc-200 px-4 py-2.5">
            <button
              type="button"
              onClick={async () => {
                setEditingStudent(null)
                await refetch()
              }}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Done
            </button>
          </div>
        </Modal>
      )}

      {editingInstructor && (
        <Modal
          label={`Edit ${editingInstructor.name}`}
          onClose={async () => {
            setEditingInstructor(null)
            setInstructorError(null)
            await refetch()
          }}
        >
          <div className="border-b border-zinc-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-900">{editingInstructor.name}</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              {instructorSaving ? 'Saving…' : 'Every change saves as you make it.'}
            </p>
          </div>
          {instructorError && (
            <p className="mx-4 mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
              {instructorError}
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <InstructorForm
              key={editingInstructor.id}
              instructor={editingInstructor}
              onPatch={(patch) => patchInstructor(editingInstructor.id, patch)}
              onCancel={async () => {
                setEditingInstructor(null)
                setInstructorError(null)
                await refetch()
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  )
}

function initials(name = '') {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}
