import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { formatStampDate } from '../../lib/dates'
import { NOTE_TYPES, NOTE_TYPE_STYLE } from './studentFields'

const inputClass =
  'w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200'

/**
 * Durable typed notes. Pinned ones surface on the session card in the day
 * view; resolving a heads-up closes it out so notes don't fossilise.
 * Operational context only — Radius/DWP stays the instructional record.
 */
export default function StudentNotes({ notes, saving, onAdd, onUpdate, onDelete }) {
  // Instructors read notes; writing them is admin-only.
  const { isAdmin } = useAuth()
  const [body, setBody] = useState('')
  const [type, setType] = useState('heads_up')
  const [pinned, setPinned] = useState(true)
  const [showResolved, setShowResolved] = useState(false)

  const open = notes.filter((n) => !n.resolved)
  const resolved = notes.filter((n) => n.resolved)
  const visible = showResolved ? [...open, ...resolved] : open

  async function submit(e) {
    e.preventDefault()
    if (!body.trim()) return
    const ok = await onAdd({ body: body.trim(), note_type: type, pinned })
    if (ok) setBody('')
  }

  return (
    <div className="space-y-3">
      {isAdmin && (
      <form onSubmit={submit} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="What should the floor know?"
          className={inputClass + ' resize-y bg-white'}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass + ' w-auto'}>
            {NOTE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-brand-500"
            />
            Pin to session card
          </label>
          <button
            type="submit"
            disabled={saving || !body.trim()}
            className="ml-auto rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40"
          >
            Add note
          </button>
        </div>
      </form>
      )}

      {visible.length === 0 ? (
        <p className="px-1 py-3 text-center text-xs text-slate-400">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((note) => (
            <li
              key={note.id}
              className={
                'rounded-lg border px-2.5 py-2 ' +
                (note.resolved ? 'border-slate-200 bg-slate-50 opacity-70' : 'border-slate-200 bg-white')
              }
            >
              <div className="mb-1 flex items-center gap-1.5">
                <span
                  className={
                    'rounded px-1.5 py-0.5 text-[10px] font-medium ' +
                    (NOTE_TYPE_STYLE[note.note_type] ?? NOTE_TYPE_STYLE.general)
                  }
                >
                  {NOTE_TYPES.find((t) => t.value === note.note_type)?.label ?? note.note_type}
                </span>
                {note.pinned && !note.resolved && (
                  <span className="text-[10px] font-medium text-brand-600">pinned</span>
                )}
                {note.resolved && <span className="text-[10px] text-slate-400">resolved</span>}
                {/* The point of timestamped notes: a stale one should LOOK
                    stale. Date always; author when the row has one. */}
                <span className="text-[10px] text-slate-400">
                  {formatStampDate(note.created_at)}
                  {note.author_email ? ` · ${note.author_email.split('@')[0]}` : ''}
                </span>

                {isAdmin && (
                <div className="ml-auto flex items-center gap-1">
                  <IconButton
                    disabled={saving}
                    onClick={() => onUpdate(note.id, { pinned: !note.pinned })}
                    title={note.pinned ? 'Unpin from session card' : 'Pin to session card'}
                  >
                    {note.pinned ? 'Unpin' : 'Pin'}
                  </IconButton>
                  <IconButton
                    disabled={saving}
                    onClick={() => onUpdate(note.id, { resolved: !note.resolved })}
                    title={note.resolved ? 'Reopen this note' : 'Close this note out'}
                  >
                    {note.resolved ? 'Reopen' : 'Resolve'}
                  </IconButton>
                  <IconButton disabled={saving} onClick={() => onDelete(note.id)} title="Delete note" danger>
                    ✕
                  </IconButton>
                </div>
                )}
              </div>
              {/* Readable type, deliberately — v1 rendered notes at 8px. */}
              <p className="text-sm leading-snug whitespace-pre-wrap text-slate-800">{note.body}</p>
            </li>
          ))}
        </ul>
      )}

      {resolved.length > 0 && (
        <button
          type="button"
          onClick={() => setShowResolved((v) => !v)}
          className="w-full text-center text-xs text-slate-500 hover:text-slate-800"
        >
          {showResolved ? 'Hide' : 'Show'} {resolved.length} resolved
        </button>
      )}
    </div>
  )
}

function IconButton({ children, danger, ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={
        'rounded px-1.5 py-0.5 text-[11px] transition disabled:opacity-40 ' +
        (danger
          ? 'text-slate-400 hover:bg-red-50 hover:text-red-600'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800')
      }
    >
      {children}
    </button>
  )
}
