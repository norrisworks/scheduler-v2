# HANDOFF — Mathnasium Scheduler v2

State of the project as of 2026-08-16, written for a fresh Claude Code session
on any machine. Read this alongside `BRIEF.md` (the original spec) — where
they disagree, this file wins, because several of the brief's designs were
deliberately reversed mid-build (each noted below).

## What this is

A two-center tutoring-center scheduler (Montgomeryville "MV", Blue Bell "BB")
for Buxmont Math. React 19 + Vite + Tailwind v4 + Supabase (Postgres, Auth,
Realtime). SheetJS (`xlsx`) is the only parsing dependency. Deployed target is
Vercel (`vercel.json` present; the owner deploys — no CLI/token in-session).

- Repo: `norrisworks/scheduler-v2`, branch `main`, push builds nothing — the
  owner runs Vercel manually.
- Supabase project: `solflnjhncpanwlomvjp`.
- Owner: Will (will@buxmontmath.com). Second admin: kieran@buxmontmath.com.
  Shared floor logins: instructor-mv@ / instructor-bb@buxmontmath.com, pinned
  to one center via `app_metadata` (`role: "instructor"`, `center_code`).
- `npm run check` — zero-dependency check suite (esbuild bundle, run under
  node). **500 checks.** Keep it green; every behavioral rule in this file is
  encoded there. `npm run build` must also stay clean.

## Data model (three layers, never collapsed)

`recurring_slots` (weekly templates) → materialized into `sessions` (real
rows, one per student per day, `materialize_sessions(center, days, slot)` RPC,
14 days ahead by default) → `assignments` (FK to sessions.id, unique per
session, `source` = 'auto' | 'manual'). Sessions carry `source` =
'recurring' | 'manual' | 'radius' and `is_modified` (hand-edited rows are
never touched by re-materialization — Google Calendar semantics).

Realtime: day view subscribes to sessions/assignments/instructor_shifts.
`REPLICA IDENTITY FULL` is set on those tables — without it, DELETE events
never pass a center_id filter (a real bug we hit).

Dates are America/New_York everywhere via `src/lib/dates.js` (UTC-noon
anchor). **Never call `toISOString()` for dates.**

## The load-bearing decisions

1. **Rankings are the SOLE input to auto-assign.** No computed scoring, no
   rules engine, no hidden math — this reversed the brief's central design.
   A student's `instructor_rankings` list (1..N, contiguous) is the entire
   candidate set; unranked = not a candidate. Hard filters above the ranking
   are physical only: active, level capability (`can_teach_*`), full shift
   coverage. 577 real rankings were migrated from v1 project
   `dtmkeizusyxeaxltpxmg` after the owner reversed an earlier "they're stale"
   instruction.
2. **`instructor_rank` replaced `tier`** (2026-08-16). Ordinal, unique per
   center, 1 = best. Edited by dragging the Instructors list. Backfill was
   strong → solid → developing, alphabetical within each. `tier` is fully
   dropped. Tag **`pre-instructor-rank-20260816`** returns to the tier era.
3. **Confidentiality of `instructor_rank`** (tier inherited this first): the
   column has NO client grant (the `instructors` table is granted column by
   column — a `select('*')` on instructors fails for every role, so every
   select names its columns via `INSTRUCTOR_COLUMNS` in
   `src/features/instructors/rankAccess.js`). Reads: `instructor_ranks` view
   (admin JWTs get rows, instructor JWTs get zero). Writes:
   `set_instructor_rank_order(center, uuid[])` — whole-center order only.
   Order-only exposure for non-admins: `proposed_instructor_order` (proposals)
   and `instructor_rank_sequence` (algorithms). **Lesson learned the hard
   way:** a plain column-level `REVOKE` is a silent no-op against Supabase's
   table-wide grant — revoke the table, re-grant every column except the
   private one. And ship client code BEFORE destructive migrations; we locked
   the owner out once by migrating first (stale bundle ran `select('*')`).
4. **Algorithm changes are flagged, all OFF.**
   `src/features/assign/algorithmFlags.js`: `RANK_TIEBREAK`,
   `RANK_GATED_CAP` (+ `CAP_RELAX_TOP_N = 6`), `NEW_STUDENT_PREFERENCE`
   (+ 45-day window, top-5, margin 1). Checks prove flags-off is bit-identical
   to pre-rank behavior. 8/13 replay results: A changed nothing that day; B
   reassigned 3 and left Tanmayee S unplaced (capacity loss at the 5pm peak —
   Elizabeth seq 8 and Sydney seq 10 fall outside top 6); C changed nothing.
   The owner toggles one at a time; do not turn any on unasked.
5. **Radius owns attendance.** The UI shows and sets only `cancelled`;
   completed/no_show exist in data (import writes them) but never render.
   The card ⋯ menu is Cancel/Restore, Reschedule, Unassign. Reschedule =
   cancel original + create new row (never edit in place), new row written
   first so a rejected insert loses nothing.
6. **Duration is a student-level property, full stop** (this reversed a
   same-day "prompt to apply" design — the owner's call). Changing
   `default_duration` silently updates active standing slots and ALL future
   scheduled sessions. No per-session or per-slot duration input exists
   anywhere; slots and manual sessions inherit the student's default.
7. **No Save buttons on edits, anywhere.** Every existing-row editor
   autosaves: selects/checkboxes on change, text debounced 500ms, pending
   writes FLUSH (not discard) on close/switch. Buttons exist only where a row
   doesn't exist yet (create flows, imports, seed dialog, reschedule).
8. **Enrollment comes from Radius, not inference.** `enrollment_status`
   (enrolled / pre_enrolled / on_hold / new / inactive): Enrolled+Pre-enrolled
   are schedulable, On hold/Inactive are not, **New is a lead and never
   activates or creates anyone**. Importer creation gate: only
   enrolled/pre_enrolled/on_hold rows may create a student; Inactive rows are
   "left in Radius" (a Radius export is a center's full history — 438 of Blue
   Bell's 543 rows are former students). Stock fake names (First Last, John
   Smith…) never create. `enrollment_start_date` is imported and feeds the
   new-student window.
9. **Gender** is `male`/`female` (DB CHECK on both tables), one definition in
   `src/lib/gender.js`, displayed as F/M. It is a proposal SORT input only —
   never an eligibility gate. If a rankings column looks gender-blocked, the
   real cause is level capability flags (this was a real confusion once).
10. **Roles**: only an explicit `role: "admin"` claim is admin; absent or
    unknown resolves to instructor (least privilege). Center pinning is
    UI-only; `instructor_rank` is the one DB-enforced secret.

## Importers (all preview-first; never commit on the owner's behalf)

- **Students export** (`studentImport.js`): splits by the file's Center
  column — a row can never land in the selected-but-wrong center. Matching
  tiers: radius account + first name (siblings share accounts; a one-letter
  first-name miss resolves WITHIN an account — 'Hazik'/'Haziq' are real), then
  exact display name, then display-name shape ('Danielle Shaw' ↔ 'Danielle
  S'), each only when unambiguous both sides. Existing students are NEVER
  renamed. Near-miss lookalikes without an account are created-but-flagged.
- **Radius appointments** (`radiusImport.js`): duplicate slots resolve by
  status (any Scheduled/Attended row = live; all cancelled = cancelled —
  the owner's corrected rule; ignore Booked-on tiebreaks). Center mismatches
  always ask. Sessions in-window but absent from the file are FLAGGED, never
  deleted. Suspicious `Last Modified By` (e.g. 'test test') surfaced.
- **Workstream timesheet** (`workstreamImport.js`): the OPPOSITE deletion
  rule — in-window shifts absent from the file are deleted (previewed first).
  The matching file shape is the `Employee Timesheet Export` xlsx, not the
  time_clock csv.
- **Source conflicts**: a (student, date) with both a scheduled radius and
  recurring session = duplicate (family moved their time in Radius). Surfaced
  in the day view, data health, and the import preview with explicit
  keep-Radius / keep-both choices; "keep both" persists in
  `session_conflict_dismissals`. Nothing auto-cancels, ever.

## UI conventions

- Fix-in-place: diagnostic surfaces open their editor as a modal over the
  same screen (shared `src/components/Modal.jsx`) — unplaced panel → ranking
  editor + day-shift editor; data health → student drawer / instructor form
  (instructor form is admin-gated); rankings matrix → click a student name
  for the full drag editor. Closing refreshes in place.
- Rankings editors share one placement rule (`rankOrder.js/placeAtRank`):
  rank N = insert at N, everyone shifts, list renumbers 1..N, clearing closes
  the gap. Matrix cells and drawer drag provably agree. Every eligible
  instructor is always visible in the drawer (unranked = dashed row).
- Auto-assign day tooling: Undo last run, Clear all (confirm sits inline next
  to the button, in the sidebar), Reassign all (clears auto-placed only;
  manual placements immovable and count toward load), unplaced panel with
  per-student reasons.
- Binder prep (`/binder`): binder_status/binder_note on the SESSION (resets
  naturally, history preserved). Defaults to tomorrow. Cards show a tiny
  ✓/✗ only; the note never renders on cards (the day query doesn't even
  select it) — only in the binder view and the session's ⋯ menu.
- Session cards are flat (no shadows); instructor stripe + first-day red
  border + selection outline are identity/state, not depth.
- Cancelled strip below the grid is cancelled-only.

## Environment gotchas (this repo, this machine)

- **PowerShell mangles non-ASCII** (em dashes, `·`) when writing files — use
  the Write/Edit tools, never shell redirection, for file content.
- The repo is CRLF-on-checkout; `node -e` string replacements with `\n`
  patterns silently miss — prefer the Edit tool for surgical changes.
- The check suite bundles with esbuild; pure logic modules must not import
  the Supabase client (`import.meta.env` breaks under node). That's why
  `rankings.js`, `algorithms.js`, `sourceConflicts.js`, `reschedule.js`,
  `rankOrder.js`, `materializeResult.js`, `health/checks.js` are pure.
- Dev server: `preview_start` name `scheduler-v2` (port 5173). The session is
  usually signed out; Claude cannot enter credentials, so verification beyond
  the sign-in wall = build + checks + SQL simulation (`set local role
  authenticated` + `request.jwt.claims`) — that JWT-simulation pattern is the
  standard proof for anything RLS/grant-related.
- The owner keeps dated backup tables (`*_20260816`) in the DB — never touch.
- Real export files live in `C:\Users\login\Downloads\Mathnasium\dwp_reports\`
  — always test importers against the real files, not the spec; nearly every
  importer bug was found that way.

## Open items

- **Vercel deploy** is the owner's; repo is ready (`vercel.json` SPA rewrite).
- **A Radius appointments import was previewed but intentionally left
  uncommitted** earlier (MV 27 new / 16 updated / 4 unmatched; BB rows held on
  a center mismatch that Radius support is fixing — all three disputed
  students are MV students). Re-run with a fresh export rather than trusting
  those numbers.
- **Algorithm flags**: all off; the owner will trial them one at a time. If
  `RANK_GATED_CAP` goes on with today's ranks, expect a capacity squeeze at
  5pm (see the 8/13 replay in the git log — commit `8e899fe`).
- Known data quirks: MV students mostly lack `radius_account` (BB is 100%);
  three `Assessment ES/HS/MS` placeholder students exist at MV on purpose;
  'Chariss E' and 'Hazik H' are the owner's spellings (Radius says
  Charis/Haziq — matching handles it).
- Kieran's admin login can see the full instructor ranking (role-based
  confidentiality has no per-person carve-out) — flagged to the owner; a
  third role would be needed to change that.

## Working style the owner expects

Verify each numbered item before the next; report evidence with numbers.
Preview-first for anything destructive; bulk data changes are proposed, never
committed unilaterally. Report failures plainly. When the owner reverses an
earlier decision, the newest instruction wins and gets encoded in checks so
it can't silently regress.
