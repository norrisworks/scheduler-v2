import { useEffect, useState } from 'react'
import Spinner from '../../components/Spinner'
import { useStudent } from './useStudent'
import StudentAttributes from './StudentAttributes'
import RecurringSlots from './RecurringSlots'
import StudentNotes from './StudentNotes'

const TABS = [
  { key: 'attributes', label: 'Attributes' },
  { key: 'slots', label: 'Standing slots' },
  { key: 'notes', label: 'Notes' },
]

export default function StudentDrawer({ studentId, onClose, onChanged }) {
  const [tab, setTab] = useState('attributes')
  const {
    student,
    slots,
    notes,
    loading,
    saving,
    error,
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
          <StudentAttributes
            student={student}
            saving={saving}
            onSave={(patch) => save(updateStudent, patch)}
          />
        ) : tab === 'slots' ? (
          <RecurringSlots
            slots={slots}
            saving={saving}
            onAdd={(slot) => save(addSlot, slot)}
            onUpdate={(id, patch) => save(updateSlot, id, patch)}
            onDelete={(id) => save(deleteSlot, id)}
          />
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
