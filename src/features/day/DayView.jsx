import { useEffect, useMemo, useState } from 'react'
import { useCenter } from '../centers/CenterProvider'
import { centerNowTime, timeToMinutes, todayISO } from '../../lib/dates'
import Spinner from '../../components/Spinner'
import { useDaySchedule } from './useDaySchedule'
import { buildTimeAxis } from './timeGrid'
import { buildSlotStats } from './load'
import DayHeader from './DayHeader'
import ScheduleGrid from './ScheduleGrid'
import InstructorSidebar from './InstructorSidebar'

export default function DayView() {
  const { centerId } = useCenter()
  const [date, setDate] = useState(todayISO)
  const [armedInstructorId, setArmedInstructorId] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [dragActive, setDragActive] = useState(false)
  const [nowTick, setNowTick] = useState(() => centerNowTime())

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

  const instructorsById = useMemo(() => new Map(instructors.map((i) => [i.id, i])), [instructors])
  const armedInstructor = instructorsById.get(armedInstructorId) ?? null

  // The axis lives here so the grid and the sidebar gauges are measured
  // against exactly the same list of 30-minute slots.
  const axis = useMemo(() => buildTimeAxis(date, sessions), [date, sessions])
  const slotStats = useMemo(
    () => buildSlotStats(axis.slots, sessions, shifts),
    [axis.slots, sessions, shifts],
  )

  // Drives the "session running now" ring and the current-time line. Only
  // meaningful on today; other days have no now.
  useEffect(() => {
    const timer = setInterval(() => setNowTick(centerNowTime()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const nowMinutes = date === todayISO() ? timeToMinutes(nowTick) : null

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setArmedInstructorId(null)
      setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full flex-col">
      <DayHeader
        date={date}
        onDateChange={setDate}
        sessionCount={sessions.length}
        busy={loading}
        onRefresh={refetch}
      />

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
        <div className="min-w-0 flex-1 overflow-auto">
          {loading && sessions.length === 0 ? (
            <Spinner label="Loading day…" />
          ) : (
            <ScheduleGrid
              axis={axis}
              slotStats={slotStats}
              sessions={sessions}
              instructorsById={instructorsById}
              shiftByInstructor={shiftByInstructor}
              notesByStudent={notesByStudent}
              nowMinutes={nowMinutes}
              selectedId={selectedId}
              dragActive={dragActive}
              armedInstructor={armedInstructor}
              onSelect={setSelectedId}
              onAssign={assign}
              onUnassign={unassign}
              onStatusChange={setStatus}
            />
          )}
        </div>

        <InstructorSidebar
          instructors={instructors}
          shiftByInstructor={shiftByInstructor}
          sessions={sessions}
          axis={axis}
          nowMinutes={nowMinutes}
          armedInstructorId={armedInstructorId}
          onArm={setArmedInstructorId}
          onDragStateChange={setDragActive}
        />
      </div>
    </div>
  )
}
