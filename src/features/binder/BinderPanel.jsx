import { BINDER_RESET, binderStatusMeta, binderStatusOf } from './binderPrep'

/**
 * Binder state on the student record, and the manual way to clear it.
 *
 * Attendance normally clears a binder, via the attendance import — but that
 * only reaches us when someone runs it. Until they do, the owner needs a way
 * to say "that binder got used" without inventing a session status. This is
 * that control.
 *
 * The full three-way editor lives in Binder prep; this is state plus reset.
 */
export default function BinderPanel({ student, saving, onSave }) {
  const status = binderStatusOf(student)
  const meta = binderStatusMeta(student)
  const note = student?.binder_note
  const prepped = status !== 'not_started' || Boolean(note)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${meta.chip}`}>
          {meta.label}
        </span>
        <button
          type="button"
          disabled={saving || !prepped}
          onClick={() => onSave({ ...BINDER_RESET })}
          title="Mark this binder used — clears the status and the note"
          className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-30"
        >
          Reset
        </button>
      </div>

      {note && <p className="text-xs leading-snug break-words text-zinc-600">{note}</p>}

      <p className="text-[11px] leading-snug text-zinc-400">
        Prep stays put until the student attends — a no-show or a passed date never clears it.
        Reset by hand when attendance has not been imported yet.
      </p>
    </div>
  )
}
