import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDateShort } from '../../lib/dates'
import TimeSelect from '../../components/TimeSelect'

const inputClass =
  'w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200'

/**
 * Manual add-to-schedule: a drop-in, a make-up, or anyone who turns up
 * without a standing slot. Writes source='manual', which the materializer
 * never touches.
 */
export default function AddSessionDialog({ centerId, date, onClose, onCreated }) {
  const [students, setStudents] = useState([])
  const [query, setQuery] = useState('')
  const [studentId, setStudentId] = useState(null)
  const [form, setForm] = useState({ date, start_time: '16:00', duration: 60 })
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase
      .from('students')
      .select('id, name, grade, level, default_duration')
      .eq('center_id', centerId)
      .eq('active', true)
      .order('name')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setStudents(data ?? [])
      })
  }, [centerId])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return []
    return students.filter((s) => s.name.toLowerCase().includes(needle)).slice(0, 8)
  }, [students, query])

  const selected = students.find((s) => s.id === studentId) ?? null

  function pick(student) {
    setStudentId(student.id)
    setQuery(student.name)
    if (student.default_duration) setForm((f) => ({ ...f, duration: student.default_duration }))
  }

  async function submit(e) {
    e.preventDefault()
    if (!studentId) {
      setError('Pick a student first.')
      return
    }
    setSaving(true)
    setError(null)

    const { error } = await supabase.from('sessions').insert({
      center_id: centerId,
      student_id: studentId,
      date: form.date,
      start_time: `${form.start_time}:00`,
      duration: Number(form.duration),
      status: 'scheduled',
      source: 'manual',
    })

    setSaving(false)
    if (error) {
      // The unique index on (student_id, date, start_time) is what catches a
      // double-booking here.
      setError(
        error.code === '23505'
          ? `${selected?.name ?? 'That student'} already has a session at that time.`
          : error.message,
      )
      return
    }
    await onCreated(form.date)
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Add session"
        className="fixed top-1/2 left-1/2 z-50 w-[22rem] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-200 bg-white p-4 shadow-xl"
      >
        <h2 className="mb-3 text-sm font-semibold text-zinc-900">Add session</h2>

        <form onSubmit={submit} className="space-y-3">
          <div className="relative">
            <label className="mb-1 block text-xs font-medium text-zinc-600">Student</label>
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setStudentId(null)
              }}
              placeholder="Search name…"
              className={inputClass}
            />
            {matches.length > 0 && !studentId && (
              <ul className="absolute z-10 mt-1 max-h-52 w-full overflow-auto rounded-lg border border-zinc-200 bg-white shadow-lg">
                {matches.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => pick(s)}
                      className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-zinc-100"
                    >
                      <span className="truncate">{s.name}</span>
                      {s.grade && (
                        <span className="shrink-0 rounded bg-zinc-200 px-1 text-[10px] text-zinc-600">
                          {s.grade}
                        </span>
                      )}
                      <span className="ml-auto shrink-0 text-[10px] text-zinc-400">
                        {s.level ?? 'level not set'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.trim() && matches.length === 0 && !studentId && (
              <p className="mt-1 text-[11px] text-zinc-400">
                No active student matches. Add them on the Roster first.
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-2">
              <span className="mb-1 block text-xs font-medium text-zinc-600">Date</span>
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className={inputClass}
              />
            </label>
            {/* No duration input: duration is a student-level property, and
                the session takes the picked student's default automatically. */}
            <p className="self-end pb-1.5 text-xs text-zinc-400">{form.duration}m</p>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-600">Start time</span>
            <TimeSelect
              value={form.start_time}
              onChange={(t) => setForm({ ...form, start_time: t })}
              className={inputClass}
            />
          </label>

          {error && (
            <p className="rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <span className="flex-1 text-[11px] text-zinc-400">
              Adds to {formatDateShort(form.date)}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !studentId}
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
            >
              {saving ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
