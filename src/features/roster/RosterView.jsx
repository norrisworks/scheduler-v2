import { useEffect, useState } from 'react'
import QueryError from '../../components/QueryError'
import { supabase } from '../../lib/supabase'
import { useCenter } from '../centers/CenterProvider'
import { useAuth } from '../auth/AuthProvider'
import CreateStudentDialog from './CreateStudentDialog'
import { formatTimeMeridiem, todayISO } from '../../lib/dates'
import Spinner from '../../components/Spinner'
import TimeSelect from '../../components/TimeSelect'
import { materializeSessions } from '../materializer/materialize'
import { futureCancelledCount, insertSlot, newSlotRow, patchSlot, removeSlot } from './slotActions'
import { useFilteredRoster, useRoster } from './useRoster'
import {
  ACADEMIC_OPTIONS,
  DAYS,
  ENROLLMENT_STATUSES,
  LEVEL_OPTIONS,
  activeFromEnrollment,
  emptyToNull,
  enrollmentMeta,
  missingAttributes,
} from './studentFields'
import StudentDrawer from './StudentDrawer'

const LEVEL_DOT = {
  elementary: 'bg-sky-500',
  middle: 'bg-violet-500',
  high: 'bg-amber-500',
}

export default function RosterView() {
  const { centerId } = useCenter()
  const { isAdmin } = useAuth()
  const { students, loading, error, refetch, createStudent, updateStudentFields, dismissError } =
    useRoster(centerId)

  const [query, setQuery] = useState('')
  const [level, setLevel] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [enrollment, setEnrollment] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [instructors, setInstructors] = useState([])
  const [adding, setAdding] = useState(false)
  const [slotBusy, setSlotBusy] = useState(false)
  const [slotError, setSlotError] = useState(null)

  /**
   * Every roster slot write follows the DRAWER's exact path: the shared
   * slotActions write, then materializeSessions — future unmodified
   * sessions MOVE (same rows, instructor assignments intact) — then a
   * refetch so the cells show the new truth.
   */
  async function runSlotWrite(fn) {
    setSlotBusy(true)
    setSlotError(null)
    const { error } = await fn()
    if (error) {
      setSlotError(error.message)
      setSlotBusy(false)
      return false
    }
    const { error: matError } = await materializeSessions(centerId)
    if (matError) setSlotError(`Slot saved, but updating sessions failed: ${matError}`)
    await refetch()
    setSlotBusy(false)
    return true
  }

  const slotHandlers = {
    busy: slotBusy,
    add: (studentId, day, time, defaultDuration) =>
      runSlotWrite(() => insertSlot(studentId, newSlotRow(day, time, defaultDuration))),
    update: (slotId, patch) => runSlotWrite(() => patchSlot(slotId, patch)),
    remove: (slotId, opts) => runSlotWrite(() => removeSlot(slotId, opts)),
    countCancelled: futureCancelledCount,
  }

  const filtered = useFilteredRoster(students, { query, level, showInactive, enrollment })

  // The mismatch worth catching: schedulable in Radius, switched off here.
  const contradictions = students.filter(
    (s) => !s.active && activeFromEnrollment(s.enrollment_status) === true,
  ).length

  // Loaded for the create dialog's ranking step; a student is never created
  // without one.
  useEffect(() => {
    if (!centerId) return
    supabase
      .from('instructors')
      .select('id, name, color, assignability, gender, can_teach_elementary, can_teach_middle, can_teach_high, active')
      .eq('center_id', centerId)
      .eq('active', true)
      .order('name')
      .then(({ data }) => setInstructors(data ?? []))
  }, [centerId])

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

        <select
          value={enrollment}
          onChange={(e) => setEnrollment(e.target.value)}
          aria-label="Filter by enrollment status"
          className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
        >
          <option value="">Any enrollment</option>
          {ENROLLMENT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
          <option value="unset">Not set</option>
        </select>

        <label className="flex items-center gap-1.5 text-xs text-zinc-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 accent-brand-500"
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
          {isAdmin && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600"
          >
            Add student
          </button>
          )}
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

      {slotError && (
        <div className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span className="flex-1">{slotError}</span>
          <button type="button" onClick={() => setSlotError(null)} className="font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {contradictions > 0 && (
        <div className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          <span className="flex-1">
            {contradictions} student{contradictions === 1 ? ' is' : 's are'} enrolled in Radius but
            switched off here — they will not appear on the schedule.
          </span>
          <button
            type="button"
            onClick={() => {
              setShowInactive(true)
              setEnrollment('')
            }}
            className="font-medium underline"
          >
            Show them
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          {error && students.length === 0 ? (
            <div className="p-6">
              <QueryError error={error} onRetry={refetch} />
            </div>
          ) : loading && students.length === 0 ? (
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
                  isAdmin={isAdmin}
                  slotHandlers={slotHandlers}
                  onUpdateStudent={updateStudentFields}
                />
              ))}
            </ul>
          )}
        </div>

        {adding && (
          <CreateStudentDialog
            centerId={centerId}
            instructors={instructors}
            onClose={() => setAdding(false)}
            onCreated={async (id) => {
              await refetch()
              setSelectedId(id)
            }}
          />
        )}

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


function StudentRow({ student, selected, onSelect, isAdmin, slotHandlers, onUpdateStudent }) {
  const slots = student.recurring_slots ?? []
  const pinned = (student.student_notes ?? []).filter((n) => n.pinned && !n.resolved).length
  const missing = missingAttributes(student)

  return (
    <li className="flex items-center gap-3 pr-3">
      {/* A FIXED-width name block, so the slot grid sits right beside the
          name on every row and the day columns line up down the page. */}
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={
          'w-72 shrink-0 self-stretch px-4 py-2 text-left transition ' +
          (selected ? 'bg-brand-50' : 'hover:bg-slate-50') +
          (student.active === false ? ' opacity-50' : '')
        }
      >
        <span className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${LEVEL_DOT[student.level] ?? 'bg-slate-300'}`}
            title={student.level ?? 'level not set'}
          />
          <span className="truncate text-sm font-medium text-slate-900">{student.name}</span>
          {student.grade && (
            <span className="shrink-0 rounded bg-zinc-200 px-1 text-[10px] text-zinc-600">
              {student.grade}
            </span>
          )}
          {student.needs_schoolwork && (
            <span className="shrink-0 rounded bg-[#FFEB3B] px-1 text-[10px] font-bold text-black">
              Supp
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          {enrollmentMeta(student.enrollment_status) && (
            <span
              className={`shrink-0 rounded px-1 text-[10px] ${enrollmentMeta(student.enrollment_status).chip}`}
            >
              {enrollmentMeta(student.enrollment_status).label}
            </span>
          )}
          {!student.active && activeFromEnrollment(student.enrollment_status) === true && (
            <span
              className="shrink-0 rounded bg-red-100 px-1 text-[10px] font-medium text-red-800"
              title="Radius has this student as schedulable, but they are switched off here"
            >
              should be active
            </span>
          )}
          {missing.length > 0 && (
            <span
              className="truncate rounded bg-amber-100 px-1 text-[10px] text-amber-800"
              title={`Missing: ${missing.join(', ')}`}
            >
              no {missing.join(', no ')}
            </span>
          )}
          {pinned > 0 && (
            <span
              className="shrink-0 rounded bg-brand-100 px-1 text-[10px] text-brand-700"
              title={`${pinned} pinned note${pinned === 1 ? '' : 's'}`}
            >
              {pinned} pinned
            </span>
          )}
        </span>
      </button>

      {/* Inline drawer fields, academic status first. Autosaves. */}
      <select
        value={student.academic_status ?? ''}
        disabled={!isAdmin}
        onChange={(e) => onUpdateStudent(student.id, { academic_status: emptyToNull(e.target.value) })}
        aria-label={`Academic status for ${student.name}`}
        className="w-24 shrink-0 rounded border border-slate-200 bg-transparent px-1 py-0.5 text-xs text-slate-700"
      >
        {ACADEMIC_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <SlotCells student={student} slots={slots} isAdmin={isAdmin} handlers={slotHandlers} />
    </li>
  )
}

/** The five roster day columns: Mon-Thu and Saturday. */
const ROSTER_DAYS = [1, 2, 3, 4, 6]

/**
 * Standing slots as read-only day cells; clicking one opens a Shifts-style
 * popover (SlotPopover) that edits through the drawer's exact write paths.
 * A day holds a LIST - Katie V's two Saturday slots both show. A student
 * with no slots gets the whole section grayed with the label in it.
 */
function SlotCells({ student, slots, isAdmin, handlers }) {
  const [popover, setPopover] = useState(null) // { day, x, y }
  const today = todayISO()
  const active = slots.filter((s) => !s.effective_until || s.effective_until >= today)
  const none = active.length === 0

  function open(day, event) {
    if (!isAdmin) return
    const rect = event.currentTarget.getBoundingClientRect()
    setPopover({ day, x: rect.left, y: rect.bottom })
  }

  return (
    <div
      className={
        'flex min-w-0 flex-1 items-stretch gap-1 rounded py-1.5 ' +
        (none ? 'bg-slate-50 opacity-70' : '')
      }
    >
      {none && (
        <span className="self-center px-2 text-[10px] whitespace-nowrap text-slate-400">
          No standing slots
        </span>
      )}
      {ROSTER_DAYS.map((day) => {
        const mine = active
          .filter((s) => s.day_of_week === day)
          .sort((a, b) => a.start_time.localeCompare(b.start_time))
        return (
          <button
            key={day}
            type="button"
            onClick={(e) => open(day, e)}
            disabled={!isAdmin}
            title={isAdmin ? 'Edit standing slots' : undefined}
            className={
              'min-w-0 flex-1 rounded border px-1.5 py-0.5 text-left ' +
              (mine.length > 0
                ? 'border-slate-200 bg-white hover:border-brand-300'
                : 'border-slate-100 hover:border-slate-300') +
              (isAdmin ? '' : ' cursor-default')
            }
          >
            <p className="text-[9px] font-semibold tracking-wide text-slate-400 uppercase">
              {DAYS.find((d) => d.value === day)?.short}
            </p>
            {mine.length === 0 ? (
              <p className="text-[11px] text-slate-300">—</p>
            ) : (
              mine.map((slot) => (
                <p key={slot.id} className="text-[11px] text-slate-700 tabular-nums">
                  {formatTimeMeridiem(slot.start_time)}
                </p>
              ))
            )}
          </button>
        )
      })}
      {popover && (
        <SlotPopover
          student={student}
          day={popover.day}
          slots={active
            .filter((s) => s.day_of_week === popover.day)
            .sort((a, b) => a.start_time.localeCompare(b.start_time))}
          handlers={handlers}
          x={popover.x}
          y={popover.y}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  )
}

/**
 * One day's slots, edited in a Shifts-style popover: times save on change
 * (no Save button), every slot carries a VISIBLE Delete, and the add row
 * takes its press like a new shift. All writes are the drawer's shared
 * paths; deletes keep the cancelled-session cleanup confirm.
 */
function SlotPopover({ student, day, slots, handlers, x, y, onClose }) {
  const [draft, setDraft] = useState('16:00')
  const [confirming, setConfirming] = useState(null) // { slotId, cancelled }

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function askDelete(slotId) {
    const cancelled = (await handlers.countCancelled(slotId)) ?? 0
    setConfirming({ slotId, cancelled })
  }

  const dayMeta = DAYS.find((d) => d.value === day)

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="dialog"
        aria-label={`Standing slots for ${student.name} on ${dayMeta?.label}`}
        className="fixed z-50 w-64 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl"
        style={{
          left: Math.min(x, window.innerWidth - 272),
          top: Math.min(y + 6, window.innerHeight - 240),
        }}
      >
        <p className="mb-2 truncate text-xs font-semibold text-zinc-900">
          {student.name}
          <span className="ml-1 font-normal text-zinc-500">{dayMeta?.label}</span>
        </p>

        {slots.length === 0 ? (
          <p className="mb-2 rounded-lg border border-dashed border-slate-200 px-2 py-2 text-center text-[11px] text-slate-400">
            No standing slot on {dayMeta?.label} yet.
          </p>
        ) : (
          <ul className="mb-2 space-y-1.5">
            {slots.map((slot) =>
              confirming?.slotId === slot.id ? (
                <li key={slot.id} className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-1.5">
                  <button
                    type="button"
                    disabled={handlers.busy}
                    onClick={() => {
                      setConfirming(null)
                      handlers.remove(slot.id, { alsoCancelled: confirming.cancelled > 0 })
                    }}
                    className="w-full rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                  >
                    {confirming.cancelled > 0
                      ? `Delete + ${confirming.cancelled} future cancelled`
                      : 'Delete slot'}
                  </button>
                  {confirming.cancelled > 0 && (
                    <button
                      type="button"
                      disabled={handlers.busy}
                      onClick={() => {
                        setConfirming(null)
                        handlers.remove(slot.id, { alsoCancelled: false })
                      }}
                      title="Keep the cancelled sessions as history. Note: they keep blocking these times until a slot reclaims them."
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                    >
                      Delete slot only
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="w-full rounded px-2 py-1 text-xs text-slate-500 hover:bg-white"
                  >
                    Keep the slot
                  </button>
                </li>
              ) : (
                <li key={slot.id} className="flex items-center gap-2">
                  <TimeSelect
                    value={slot.start_time.slice(0, 5)}
                    disabled={handlers.busy}
                    onChange={(t) => handlers.update(slot.id, { start_time: `${t}:00` })}
                    aria-label="Slot start time"
                    className="flex-1 rounded-lg border border-zinc-300 px-2 py-1 text-sm"
                  />
                  <span className="shrink-0 text-[10px] text-slate-400">{slot.duration}m</span>
                  <button
                    type="button"
                    disabled={handlers.busy}
                    onClick={() => askDelete(slot.id)}
                    className="shrink-0 rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </li>
              ),
            )}
          </ul>
        )}

        <div className="flex items-center gap-2 border-t border-zinc-100 pt-2">
          <TimeSelect
            value={draft}
            disabled={handlers.busy}
            onChange={setDraft}
            aria-label="New slot start time"
            className="flex-1 rounded-lg border border-zinc-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            disabled={handlers.busy}
            onClick={() => handlers.add(student.id, day, draft, student.default_duration)}
            className="shrink-0 rounded-lg bg-brand-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
          >
            {slots.length > 0 ? 'Add another' : 'Add slot'}
          </button>
        </div>
      </div>
    </>
  )
}
