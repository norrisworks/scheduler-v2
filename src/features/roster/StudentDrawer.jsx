import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { todayISO } from '../../lib/dates'
import Spinner from '../../components/Spinner'
import { useCenter } from '../centers/CenterProvider'
import { describeMaterialize, materializeSessions } from '../materializer/materialize'
import { useStudent } from './useStudent'
import StudentAttributes from './StudentAttributes'
import RecurringSlots from './RecurringSlots'
import StudentNotes from './StudentNotes'
import InstructorPins from './InstructorPins'
import UpcomingSessions from './UpcomingSessions'

const TABS = [
  { key: 'attributes', label: 'Details' },
  { key: 'pins', label: 'Pins' },
  { key: 'notes', label: 'Notes' },
]

export default function StudentDrawer({ studentId, onClose, onChanged }) {
  const [tab, setTab] = useState('attributes')
  const { centerId } = useCenter()
  const [slotEffect, setSlotEffect] = useState(null)
  // Offered after default_duration changes: apply to what already exists, or
  // only go forward. Never silent either way.
  const [durationOffer, setDurationOffer] = useState(null)
  const [applyingDuration, setApplyingDuration] = useState(false)
  const [sessionsRefresh, setSessionsRefresh] = useState(0)
  const {
    student,
    slots,
    notes,
    loading,
    saving,
    error,
    refetch,
    updateStudent,
    addSlot,
    updateSlot,
    deleteSlot,
    addNote,
    updateNote,
    deleteNote,
    dismissError,
  } = useStudent(studentId)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Any write can change what the roster list shows (name, level, slot count).
  async function save(fn, ...args) {
    const ok = await fn(...args)
    if (ok) onChanged()
    return ok
  }

  /**
   * A changed default_duration silently affects nothing that already exists —
   * sessions and slots keep their own durations. So after the save, count
   * what COULD follow the new default and ask.
   */
  async function saveAttributes(patch) {
    const before = student?.default_duration ?? null
    const ok = await save(updateStudent, patch)
    if (!ok) return ok

    const minutes = patch.default_duration
    if (minutes && minutes !== before) {
      const slotCount = slots.filter(
        (s) =>
          s.duration !== minutes &&
          (!s.effective_until || s.effective_until >= new Date().toISOString().slice(0, 10)),
      ).length
      const { count } = await supabase
        .from('sessions')
        .select('id', { count: 'exact', head: true })
        .eq('student_id', studentId)
        .gte('date', todayISO())
        .eq('status', 'scheduled')
        .eq('is_modified', false)
        .neq('duration', minutes)
      const sessionCount = count ?? 0
      if (slotCount > 0 || sessionCount > 0) {
        setDurationOffer({ minutes, slotCount, sessionCount })
      }
    }
    return ok
  }

  /** Apply the new default to the standing slots and future untouched sessions. */
  async function applyDuration() {
    if (!durationOffer) return
    setApplyingDuration(true)
    const { minutes } = durationOffer
    const today = todayISO()

    const slotIds = slots
      .filter((s) => s.duration !== minutes && (!s.effective_until || s.effective_until >= today))
      .map((s) => s.id)
    const writes = []
    if (slotIds.length > 0) {
      writes.push(supabase.from('recurring_slots').update({ duration: minutes }).in('id', slotIds))
    }
    writes.push(
      supabase
        .from('sessions')
        // is_modified stays false: these still follow their template, which
        // now says the same thing.
        .update({ duration: minutes, updated_at: new Date().toISOString() })
        .eq('student_id', studentId)
        .gte('date', today)
        .eq('status', 'scheduled')
        .eq('is_modified', false),
    )
    const results = await Promise.all(writes)
    const failure = results.find((r) => r.error)
    setApplyingDuration(false)
    if (failure) {
      setSlotEffect({ error: failure.error.message })
      return
    }
    setDurationOffer(null)
    setSessionsRefresh((n) => n + 1)
    await refetch()
    onChanged()
  }

  /**
   * Editing a template has to reach the sessions it already produced, or the
   * change silently doesn't apply until someone opens the day view. Future
   * unmodified sessions are reconciled; hand-edited ones are left alone.
   */
  async function saveSlot(fn, ...args) {
    const ok = await save(fn, ...args)
    if (!ok) return false
    const { result, error } = await materializeSessions(centerId)
    setSlotEffect(error ? { error } : { text: describeMaterialize(result) })
    return true
  }

  const openNotes = notes.filter((n) => !n.resolved).length

  return (
    <aside className="flex w-[26rem] shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-start gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-slate-900">
            {student?.name ?? 'Student'}
          </h2>
          <p className="text-xs text-slate-500">
            {student?.active === false ? 'Inactive · ' : ''}
            {slots.length} standing slot{slots.length === 1 ? '' : 's'} · {openNotes} open note
            {openNotes === 1 ? '' : 's'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close student panel"
          className="rounded px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          ✕
        </button>
      </div>

      <div className="flex gap-1 border-b border-slate-200 px-2 py-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={
              'rounded-lg px-2.5 py-1 text-xs font-medium transition ' +
              (tab === t.key
                ? 'bg-brand-50 text-brand-600'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800')
            }
          >
            {t.label}
            {t.key === 'notes' && openNotes > 0 && (
              <span className="ml-1 rounded bg-brand-100 px-1 text-[10px] text-brand-700">
                {openNotes}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={dismissError} className="font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading || !student ? (
          <Spinner label="Loading student…" />
        ) : tab === 'attributes' ? (
          <div className="space-y-5">
            <StudentAttributes
              student={student}
              saving={saving}
              onSave={saveAttributes}
            />

            {durationOffer && (
              <div className="rounded-lg border border-brand-200 bg-brand-50 p-2.5">
                <p className="text-xs leading-snug text-brand-900">
                  Default is now {durationOffer.minutes}m. Apply it to{' '}
                  {durationOffer.sessionCount} upcoming session
                  {durationOffer.sessionCount === 1 ? '' : 's'} and {durationOffer.slotCount}{' '}
                  standing slot{durationOffer.slotCount === 1 ? '' : 's'}? Hand-edited sessions are
                  never touched either way.
                </p>
                <div className="mt-1.5 flex gap-1.5">
                  <button
                    type="button"
                    disabled={applyingDuration}
                    onClick={applyDuration}
                    className="rounded bg-brand-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
                  >
                    {applyingDuration ? 'Applying…' : 'Apply to existing'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDurationOffer(null)}
                    className="rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100"
                  >
                    Only going forward
                  </button>
                </div>
              </div>
            )}

            <section className="border-t border-zinc-200 pt-4">
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                Standing slots
              </h3>
              <RecurringSlots
                slots={slots}
                saving={saving}
                defaultDuration={student.default_duration}
                onAdd={(slot) => saveSlot(addSlot, slot)}
                onUpdate={(id, patch) => saveSlot(updateSlot, id, patch)}
                onDelete={(id) => saveSlot(deleteSlot, id)}
              />
              {slotEffect && (
                <p
                  className={
                    'mt-3 rounded-lg px-2.5 py-2 text-xs ' +
                    (slotEffect.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800')
                  }
                >
                  {slotEffect.error
                    ? `Could not update sessions: ${slotEffect.error}`
                    : slotEffect.text
                      ? `Upcoming sessions updated — ${slotEffect.text}. Hand-edited sessions were left alone.`
                      : 'No upcoming sessions needed changing.'}
                </p>
              )}
            </section>

            <section className="border-t border-zinc-200 pt-4">
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                Upcoming sessions
              </h3>
              <UpcomingSessions studentId={studentId} slots={slots} refreshKey={sessionsRefresh} />
            </section>
          </div>
        ) : tab === 'pins' ? (
          <InstructorPins studentId={studentId} student={student} />
        ) : (
          <StudentNotes
            notes={notes}
            saving={saving}
            onAdd={(note) => save(addNote, note)}
            onUpdate={(id, patch) => save(updateNote, id, patch)}
            onDelete={(id) => save(deleteNote, id)}
          />
        )}
      </div>
    </aside>
  )
}
