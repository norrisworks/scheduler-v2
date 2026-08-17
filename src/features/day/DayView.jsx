import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCenter } from '../centers/CenterProvider'
import { supabase } from '../../lib/supabase'
import { addDays, centerNowTime, formatTimeMeridiem, timeToMinutes, todayISO } from '../../lib/dates'
import Spinner from '../../components/Spinner'
import { useDaySchedule } from './useDaySchedule'
import { buildTimeAxis } from './timeGrid'
import { buildSlotStats, occupiesFloor } from './load'
import { conflictKey, findSourceConflicts, findCrossDayConflicts, weekAnchorOf } from './sourceConflicts'
import SourceConflictsPanel from './SourceConflictsPanel'
import DayHeader from './DayHeader'
import ScheduleGrid from './ScheduleGrid'
import TransposedGrid from './TransposedGrid'
import CancelledList from './CancelledList'
import InstructorSidebar from './InstructorSidebar'
import StatusMenu from './StatusMenu'
import AddSessionDialog from './AddSessionDialog'
import RescheduleDialog from './RescheduleDialog'
import StudentDrawer from '../roster/StudentDrawer'
import { useMaterializer } from '../materializer/useMaterializer'
import { describeMaterialize, MATERIALIZE_DAYS } from '../materializer/materialize'
import { useAutoAssign } from '../assign/useAutoAssign'
import { ALGORITHMS, summaryMessage } from '../assign/algorithms'
import Modal from '../../components/Modal'
import InstructorPins from '../roster/InstructorPins'
import DayShiftEditor from '../shifts/DayShiftEditor'

const ORIENTATION_KEY = 'scheduler.dayOrientation'
const SIDEBAR_KEY = 'scheduler.instructorSidebar'
const GROUPING_KEY = 'scheduler.rowGrouping'

export default function DayView() {
  const { centerId } = useCenter()
  const [date, setDate] = useState(todayISO)
  const [armedInstructorId, setArmedInstructorId] = useState(null)
  const [openStudent, setOpenStudent] = useState(null) // { studentId, sessionId }
  const [statusMenu, setStatusMenu] = useState(null)
  const [rescheduling, setRescheduling] = useState(null)
  const [addingSession, setAddingSession] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [nowTick, setNowTick] = useState(() => centerNowTime())
  const [orientation, setOrientation] = useState(
    () => localStorage.getItem(ORIENTATION_KEY) ?? 'vertical',
  )
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) !== 'closed',
  )
  const [grouping, setGrouping] = useState(() => localStorage.getItem(GROUPING_KEY) ?? 'level')

  const {
    sessions,
    instructors,
    shifts,
    shiftByInstructor,
    notesByStudent,
    loading,
    error,
    refetch,
    assign,
    unassign,
    setStatus,
    dismissError,
  } = useDaySchedule(centerId, date)

  useEffect(() => {
    localStorage.setItem(ORIENTATION_KEY, orientation)
  }, [orientation])

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, sidebarOpen ? 'open' : 'closed')
  }, [sidebarOpen])

  useEffect(() => {
    localStorage.setItem(GROUPING_KEY, grouping)
  }, [grouping])

  const {
    running: materializing,
    result: materializeResult,
    error: materializeError,
    run: materialize,
    dismiss: dismissMaterialize,
  } = useMaterializer(centerId, refetch)

  const instructorsById = useMemo(() => new Map(instructors.map((i) => [i.id, i])), [instructors])
  const armedInstructor = instructorsById.get(armedInstructorId) ?? null

  const {
    running: assigning,
    result: assignResult,
    error: assignError,
    run: runAutoAssign,
    reassign: runReassign,
    clearDay: clearAssignments,
    undo: undoAssignRun,
    canUndo: canUndoAssign,
    refreshExplanations,
    dismiss: dismissAssign,
  } = useAutoAssign({ date, sessions, instructors, shiftByInstructor, onDone: refetch })
  // Fix-in-place modals opened from the unplaced panel. The date never
  // changes underneath them; closing refreshes the panel, not the page.
  const [editingRankings, setEditingRankings] = useState(null) // an explanation row
  const [editingShifts, setEditingShifts] = useState(false)

  // Radius-vs-standing-slot duplicates for this date, same-day and
  // cross-day. Dismissals are recorded answers; conflicts never resolve
  // themselves. Cross-day needs the whole week's radius sessions, since the
  // pattern is "moved to a different day".
  const [conflictContext, setConflictContext] = useState({
    dismissed: new Set(),
    slotDayDismissed: new Set(),
    weekRadius: [],
  })
  const loadConflictContext = useCallback(async () => {
    if (!centerId || !date) return
    const weekStart = weekAnchorOf(date)
    const weekEnd = addDays(weekStart, 6)
    const [dismissRes, slotDayRes, radiusRes] = await Promise.all([
      supabase
        .from('session_conflict_dismissals')
        .select('student_id, date')
        .eq('center_id', centerId)
        .gte('date', weekStart)
        .lte('date', weekEnd),
      supabase
        .from('session_cross_day_dismissals')
        .select('student_id, day_of_week')
        .eq('center_id', centerId),
      supabase
        .from('sessions')
        .select('id, student_id, center_id, date, start_time, duration, status, source')
        .eq('center_id', centerId)
        .eq('source', 'radius')
        .eq('status', 'scheduled')
        .gte('date', weekStart)
        .lte('date', weekEnd),
    ])
    setConflictContext({
      dismissed: new Set((dismissRes.data ?? []).map((d) => conflictKey(d.student_id, d.date))),
      slotDayDismissed: new Set(
        (slotDayRes.data ?? []).map((d) => `${d.student_id}|${d.day_of_week}`),
      ),
      weekRadius: radiusRes.data ?? [],
    })
  }, [centerId, date])
  useEffect(() => {
    loadConflictContext()
  }, [loadConflictContext])
  const sourceConflicts = useMemo(
    () => findSourceConflicts(sessions, conflictContext.dismissed),
    [sessions, conflictContext.dismissed],
  )
  const crossDayConflicts = useMemo(
    () =>
      findCrossDayConflicts([...sessions, ...conflictContext.weekRadius], {
        dismissedKeys: conflictContext.dismissed,
        dismissedSlotDays: conflictContext.slotDayDismissed,
        // Only surface pairs whose questionable session is on the date being
        // viewed — the other days' rows show up on their own days.
      }).filter((c) => c.date === date),
    [sessions, conflictContext, date],
  )

  // Cancelled and no-show sessions come off the grid entirely and out of every
  // count. They're still reachable in the strip under the grid.
  const gridSessions = useMemo(() => sessions.filter(occupiesFloor), [sessions])
  const offGrid = useMemo(() => sessions.filter((s) => !occupiesFloor(s)), [sessions])

  // The axis lives here so the grid and the sidebar gauges are measured
  // against exactly the same list of 30-minute slots.
  const axis = useMemo(() => buildTimeAxis(date, gridSessions), [date, gridSessions])
  const slotStats = useMemo(
    () => buildSlotStats(axis.slots, gridSessions, shifts),
    [axis.slots, gridSessions, shifts],
  )

  useEffect(() => {
    const timer = setInterval(() => setNowTick(centerNowTime()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const nowMinutes = date === todayISO() ? timeToMinutes(nowTick) : null

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setArmedInstructorId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleOpenStudent = useCallback(
    (studentId, sessionId) => setOpenStudent({ studentId, sessionId }),
    [],
  )

  // A manual add can land on a different day than the one on screen.
  const handleCreated = useCallback(
    async (createdDate) => {
      if (createdDate !== date) setDate(createdDate)
      else await refetch()
    },
    [date, refetch],
  )

  const gridProps = {
    axis,
    slotStats,
    sessions: gridSessions,
    instructorsById,
    shiftByInstructor,
    notesByStudent,
    nowMinutes,
    selectedId: openStudent?.sessionId ?? null,
    dragActive,
    armedInstructor,
    onOpenStudent: handleOpenStudent,
    onAssign: assign,
    onUnassign: unassign,
    onStatusMenu: setStatusMenu,
  }

  return (
    <div className="flex h-full flex-col">
      <DayHeader
        date={date}
        onDateChange={setDate}
        sessionCount={gridSessions.length}
        busy={loading}
        onRefresh={refetch}
        orientation={orientation}
        onOrientationChange={setOrientation}
        grouping={grouping}
        onGroupingChange={setGrouping}
        onMaterialize={materialize}
        materializing={materializing}
        onAddSession={() => setAddingSession(true)}
      />

      <SourceConflictsPanel
        conflicts={sourceConflicts}
        crossDay={crossDayConflicts}
        onEditStudent={(studentId) => setOpenStudent({ studentId })}
        onChanged={async () => {
          await refetch()
          await loadConflictContext()
        }}
      />

      {assignError && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          Auto-assign failed: {assignError}
        </div>
      )}

      {assignResult && (
        <div
          className={
            'border-b px-4 py-2 text-sm ' +
            (assignResult.couldNotAssign > 0
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800')
          }
        >
          <div className="flex items-center gap-3">
            <span className="flex-1 font-medium">{summaryMessage(assignResult)}</span>
            {canUndoAssign && (
              <button
                type="button"
                onClick={undoAssignRun}
                disabled={assigning}
                className="font-medium underline"
              >
                Undo
              </button>
            )}
            <button type="button" onClick={dismissAssign} className="font-medium underline">
              Dismiss
            </button>
          </div>

          {/* Who was left out, and exactly why — and the fix opens right here:
              the name opens that student's ranking editor, and a shift-shaped
              reason offers the day's shift editor. No navigating away. */}
          {(assignResult.explanations?.length ?? 0) > 0 && (
            <ul className="mt-1.5 space-y-1 border-t border-amber-200/60 pt-1.5">
              {assignResult.explanations.map((ex) => (
                <li key={ex.sessionId} className="text-xs">
                  <button
                    type="button"
                    onClick={() => setEditingRankings(ex)}
                    title={`Edit ${ex.name}'s rankings`}
                    className="font-semibold underline decoration-amber-400 underline-offset-2 hover:text-amber-950"
                  >
                    {ex.name}
                  </button>
                  <span className="text-amber-800/70"> {formatTimeMeridiem(ex.startTime)} — </span>
                  <span>{ex.headline}</span>
                  {ex.details.length > 0 && (
                    <span className="text-amber-800/70">
                      {' · '}
                      {ex.details
                        .map((d) => `${d.name} (#${d.rank} ${d.reason})`)
                        .join(', ')}
                    </span>
                  )}
                  {ex.details.some(
                    (d) => d.reason === 'not on shift' || d.reason === 'shift does not cover the session',
                  ) && (
                    <button
                      type="button"
                      onClick={() => setEditingShifts(true)}
                      className="ml-1.5 rounded border border-amber-300 px-1 py-px text-[10px] font-medium hover:bg-amber-100"
                    >
                      Shifts…
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}


      {materializeError && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          Could not generate sessions: {materializeError}
        </div>
      )}

      {describeMaterialize(materializeResult) && (
        <div className="flex items-center gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <span className="flex-1">
            Sessions generated from standing slots for the next {MATERIALIZE_DAYS} days —{' '}
            {describeMaterialize(materializeResult)}.
          </span>
          <button type="button" onClick={dismissMaterialize} className="font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={dismissError} className="font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {armedInstructor && (
        <div className="flex items-center gap-3 border-b border-brand-200 bg-brand-50 px-4 py-2 text-sm text-brand-800">
          <span className="flex-1">
            Assigning <strong>{armedInstructor.name}</strong> — click sessions to assign, Esc to
            stop.
          </span>
          <button
            type="button"
            onClick={() => setArmedInstructorId(null)}
            className="font-medium underline"
          >
            Done
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <InstructorSidebar
          instructors={instructors}
          shiftByInstructor={shiftByInstructor}
          sessions={gridSessions}
          axis={axis}
          nowMinutes={nowMinutes}
          armedInstructorId={armedInstructorId}
          onArm={setArmedInstructorId}
          onDragStateChange={setDragActive}
          open={sidebarOpen}
          onToggleOpen={() => setSidebarOpen((v) => !v)}
          algorithms={ALGORITHMS}
          onAutoAssign={runAutoAssign}
          onReassign={runReassign}
          onClearDay={clearAssignments}
          onUndo={undoAssignRun}
          canUndo={canUndoAssign}
          assigning={assigning}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto">
            {loading && gridSessions.length === 0 ? (
              <Spinner label="Loading day…" />
            ) : orientation === 'transposed' ? (
              <TransposedGrid {...gridProps} grouping={grouping} />
            ) : (
              <ScheduleGrid {...gridProps} />
            )}
          </div>
          <CancelledList sessions={offGrid} onStatusChange={setStatus} />
        </div>

        {openStudent && (
          <StudentDrawer
            key={openStudent.studentId}
            studentId={openStudent.studentId}
            onClose={() => setOpenStudent(null)}
            onChanged={refetch}
          />
        )}
      </div>

      {editingRankings && (
        <Modal
          label={`Rankings for ${editingRankings.name}`}
          onClose={async () => {
            setEditingRankings(null)
            await refreshExplanations()
          }}
        >
          <div className="border-b border-zinc-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-900">
              Rankings — {editingRankings.name}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Changes save immediately. Close, then run auto-assign again to place them.
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <InstructorPins
              studentId={editingRankings.studentId}
              student={
                sessions.find((s) => s.id === editingRankings.sessionId)?.student ?? {
                  name: editingRankings.name,
                }
              }
            />
          </div>
          <div className="flex justify-end border-t border-zinc-200 px-4 py-2.5">
            <button
              type="button"
              onClick={async () => {
                setEditingRankings(null)
                await refreshExplanations()
              }}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Done
            </button>
          </div>
        </Modal>
      )}

      {editingShifts && (
        <Modal
          label={`Shifts for ${date}`}
          onClose={async () => {
            setEditingShifts(false)
            await refreshExplanations()
          }}
        >
          <DayShiftEditor
            date={date}
            instructors={instructors}
            shiftByInstructor={shiftByInstructor}
            onChanged={refetch}
            onClose={async () => {
              setEditingShifts(false)
              await refreshExplanations()
            }}
          />
        </Modal>
      )}

      <StatusMenu
        menu={statusMenu}
        onStatusChange={setStatus}
        onUnassign={unassign}
        onReschedule={(session) => setRescheduling(session)}
        onClose={() => setStatusMenu(null)}
      />

      {rescheduling && (
        <RescheduleDialog
          session={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={refetch}
        />
      )}


      {addingSession && (
        <AddSessionDialog
          centerId={centerId}
          date={date}
          onClose={() => setAddingSession(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
