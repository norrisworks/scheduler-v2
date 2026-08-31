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
11. **Binder prep is per STUDENT, never per session** (2026-08-18, Kieran's
    reasoning): prep is physical work on a physical binder, so it persists
    until that binder is actually used. Per-session state meant a no-show
    wasted the prep — the next day read "not started". Reset is
    ATTENDANCE-driven and never time-driven. **The mechanism was replaced on
    2026-08-23 — see decision 17.** It was a trigger on `sessions` firing when
    a session TRANSITIONED to `completed`; it is now the attendance import, and
    those triggers are dropped. The RULE is unchanged: a passed date, a
    cancellation and a no-show all leave prep alone. Because attendance depends
    on the
    import being run, there is a manual Reset on the student (drawer) and per
    row in the binder view. The instructor RLS carve-out moved to `students`
    (`students_instructor_binder_only`), and it FREEZES EVERYTHING EXCEPT the
    binder columns rather than enumerating frozen ones — a column added later
    is protected by default, which the sessions version was not. `students` was
    added to the realtime publication so the day-view tick stays live.
12. **A failed query is NEVER an empty state.** The rankings modal rendered
    "No rankings, so auto-assign cannot place this student" over a query that
    had failed auth, while the matrix behind it showed a full row for the same
    student. Every list now renders `components/QueryError.jsx` INSTEAD of its
    empty state when the load failed. `lib/queryError.js` classifies the cause;
    "JWT issued at future" means THIS MACHINE'S CLOCK IS AHEAD, and is named as
    such rather than shown raw. Skew and expiry offer a session remint, with
    one automatic attempt per page load (module-scoped flag — auto-retrying a
    genuinely wrong clock would loop).
13. **Ranking editors display STORED ranks, gaps and all** (`visibleRanking`
    in `rankOrder.js`). Inactive instructors are hidden but keep their numbers,
    so Marcus F reads 1,2,3,4,7,8,10,11,13,14,15 in both the popup and the
    matrix. The popup used to renumber survivors 1..11, so the two screens
    disagreed. Reordering still renumbers on save — that is a WRITE, and writes
    stay contiguous.
14. **The DATABASE assigns `instructor_rank`, never the client** (2026-08-21).
    Creating an instructor was outright impossible: the column is NOT NULL with
    no default AND is absent from the client INSERT grant, so naming it fails on
    permissions and omitting it failed the not-null constraint. Trigger
    `instructors_assign_rank` (BEFORE INSERT) fills a null rank with max + 1 for
    that center, so a new hire lands last. It MUST be SECURITY DEFINER — it
    reads `max(instructor_rank)`, and that column is revoked from
    `authenticated`, so an invoker-rights trigger fails exactly where the insert
    already did. It takes a per-center advisory lock because the unique
    constraint is DEFERRABLE INITIALLY DEFERRED: two concurrent inserts picking
    the same max + 1 would not fail until COMMIT, far from the cause.
    `createInstructor` still sends the whole order to
    `set_instructor_rank_order` straight after, which renumbers 1..N — the
    trigger only has to make the insert legal.
15. **`instructors` is admin-write at the DATABASE** (2026-08-21). It was the
    last core table on `staff_all` (ALL / true), so "instructor accounts are
    read-only except binder" held in the UI and nowhere else — any authenticated
    JWT could edit capability and assignability flags that auto-assign depends
    on. Now `read_all` (SELECT / true) + `admin_write` (ALL / `jwt_is_admin()`),
    the same shape as sessions and students. Proven both ways by simulation:
    instructor JWT reads 22 rows, INSERT raises, UPDATE and DELETE touch 0 rows;
    admin does all three.
16. **`npm run check:db` covers what the bundled suite cannot** (2026-08-21).
    `scripts/db-check.mjs` asserts triggers, policies, grants, column locks and
    definer/search_path settings. The database returns FACTS ONLY
    (`db_schema_facts`, admin-gated, `service_role` allowed for CI); every
    EXPECTATION lives in the script, in git, so dropping a trigger changes the
    facts and fails an assertion — a checker that graded itself in the database
    could just be edited to say everything is fine. `DB_CHECK_FACTS_FILE=<json>`
    runs the assertions against a captured payload with no credentials, which is
    how they are mutation-tested. Gate history worth knowing: the first version
    tested `current_user`, which SECURITY DEFINER rebinds to the function OWNER,
    so it failed OPEN; the second added a `session_user` allowance that made it
    untestable. It now reads only the caller's JWT.
17. **Attendance is the SOLE binder reset signal** (2026-08-23). The session
    triggers from decision 11 are dropped; `attendanceImport.js` +
    `AttendanceImportView` replace them. Session status came from the
    appointments export, which says what was BOOKED; the attendance export says
    who actually walked in, and only attendees appear in it — so a no-show is
    simply absent and keeps its prep.
    - `students.binder_status_set_at` (timestamptz, backfilled from
      `updated_at`) is what makes the rule decidable. Reset only when the
      binder is not already clear AND departure is LATER than the stamp; prep
      done after the student left is a re-prep for next time and survives.
      Equal timestamps count as "not later", so they survive too.
    - The stamp is maintained by trigger `students_binder_stamp` and IGNORES
      whatever a client sends, so it cannot be back-dated to force or dodge a
      reset. `students` has table-wide grants, so forcing the value beat
      converting the whole table to column-by-column grants for one field.
      The trigger name matters: BEFORE triggers fire in NAME order, and this
      must precede `students_instructor_binder_only`, whose comparison now
      exempts the stamp (it changes on every binder write by design).
    - Nothing else is written. No session statuses, no roster edits.
    - The manual Reset control stays: attendance depends on the import running.
18. **The attendance bridge is (Lead Id + First Name)** (2026-08-23, corrected
    2026-08-24). The attendance export carries NO per-student id. `Lead Id` and
    `Account Id` are both FAMILY-level and identical across siblings — the
    three Coyne children share lead 3069017 and one Account Id uuid. On the
    real 8/21 export, 25 of 105 leads cover more than one child, and the file
    holds **131 students, not 105**. `Student Id` exists only in the Students
    export, so it cannot bridge the two files.
    - The pair IS unique within a family: 744 distinct pairs from the 744
      Students-export rows carrying a lead, zero duplicates.
    - Stored as a pair (`radius_lead_id` + `radius_first_name`) by the Students
      import, so the mapping is recorded once rather than inferred on each run.
    - `radius_account` is not a route either: it holds the guardian NAME and
      its numeric suffix ('Tang, Jun | 3266135') is account-level, from a
      different space — 0 of 105 matched.
    - **The first cut keyed on the lead alone and was wrong in a way that
      mattered**: it merged siblings into one bucket, so the last child out of
      the door decided all their binders. Checks now cover siblings resolving
      independently, and an unknown sibling falling through rather than
      claiming one of the others.
19. **`sessions.delivery_method`** (2026-08-24): 'in_center' | 'online',
    default in_center. Online sessions get a full green border on day-view
    cards (`ONLINE_GREEN` in `studentOptions.js`); the first-day red border
    WINS when both apply. Written by the Radius import from the file's
    Delivery Method column ('In-Center'/'Online' verbatim; anything else maps
    in_center). A delivery flip on an otherwise-unchanged row counts as an
    UPDATE — before that it landed in "unchanged" and was silently dropped.
    Manual toggle in the card ⋯ menu (sets `is_modified`, so re-materialization
    leaves it alone); materialized standing slots have no Radius row and
    correctly default to in_center. Adding the column also exposed that the
    sessions instructor-trigger enumerated FROZEN columns, so new columns were
    instructor-writable by default — it is now inverted (freeze everything
    except the binder columns), matching the students version.
20. **Bulk ranking removal, with exact undo** (2026-08-24). The inverse of
    `bulk_insert_ranking`, for the rename-instead-of-create mistake (the "new"
    instructor inherited 93 rankings). `bulk_remove_ranking(center, instructor)`
    deletes and renumbers every affected list contiguously in one transaction,
    returning the removed (student, rank) pairs; `bulk_restore_ranking` puts
    each pair back at its original rank, restoring every list bit-for-bit
    (proved on the 96-student worst case). Both are INVOKER rights — RLS is
    the write gate, and db-check asserts they stay that way. The remove
    self-verifies its delete count: an instructor JWT can READ rankings but
    not delete them, so the first cut reported "removed 96" having removed
    nothing. UI: preview-first on the instructor record (`BulkRankingRemove`),
    undo lives until the panel closes.
21. **Naming: only rows that JOIN the roster are collisions, and first names
    are title-cased** (2026-08-24). The rule-2 count used to run over every
    file row before the creation gate — and a Students export is a center's
    full history, so 'Lily Rocco' (Inactive, skipped) forced two letters onto
    the only Lily actually joining ('LILY Ge'). Naming now happens in a second
    pass over the rows that actually create. First names are title-cased for
    DISPLAY only ('LILY' -> 'Lily'; short all-caps 'JJ' and mixed-case
    'McKenna' are left alone; `titleCaseName`); `radius_first_name` keeps the
    file's verbatim spelling because it is a matching fact, not a display
    name, and the attendance matcher compares case-insensitively. Existing
    rows corrected by hand: 'Chino Br' -> 'Chino B' (owner's call — 'Chino D'
    is a hand-entered duplicate of the same child, pending merge), 'LILY Ge'
    -> 'Lily G'. NOTE: while both Chino rows exist, a fresh import of 'Chino
    Bridges' would still produce 'Chino Br' — a roster student sharing the
    first name IS a rule-2 collision; the convention cannot know two rows are
    one child. Merging the duplicate ends that.
22. **The poisoned-slot bug, and how sessions die** (2026-08-24, found via
    Chino B's 18 unfillable slots). Cancelling sets `is_modified`, which
    shields the row from the materializer's delete pass, and the unique
    (student, date, start_time) index makes the insert's ON CONFLICT DO
    NOTHING skip that spot forever — so cancel + delete slot + re-create slot
    at the same times = permanently blocked, with `recurring_slot_id` nulled
    by the FK (ON DELETE SET NULL). Three-part fix:
    - The materializer RECLAIMS a cancelled row squatting on an active slot's
      exact (student, date, time) IF it is not that slot's own session
      (`recurring_slot_id is distinct from` the slot): it becomes a fresh
      scheduled instance, linked, is_modified false, stale assignment cleared.
      The slot's OWN cancelled session is a deliberate one-off ("out this
      Tuesday") and is NEVER resurrected — this function runs on every
      day-view load, so a blanket rule would undo every cancel. A reclaimed
      row the owner re-cancels carries the slot's id and stays cancelled:
      reclaim converges, it cannot loop. Proven by simulation end to end.
    - Deleting a standing slot offers to remove its future cancelled sessions
      (count shown, three-way choice; the count query runs BEFORE the delete
      because the FK nulls the link).
    - The card ⋯ menu gains "Delete permanently…" (admin, two-click arm),
      a HARD delete: row gone, assignment cascades, and if a slot covers that
      time the next materializer run regenerates it — deleting is not
      cancelling.
23. **Enrollment drives `active` on manual edits too** (2026-08-24).
    "Deactivating a student doesn't save" was a missing coupling, not a broken
    write: the drawer's Enrollment select saved `enrollment_status='inactive'`
    and left `active=true` — decision 8's importer rule never ran on manual
    edits. The drawer now derives `active` via `activeFromEnrollment` in the
    same patch (New/blank imply nothing; the Active checkbox remains a manual
    override). Chino D corrected in place. Diagnosed by testing the exact
    UPDATE under an admin JWT (it worked) and then reading the row: fresh
    updated_at, status inactive, boolean untouched.
24. **Cancelled rows are REUSED at collision, never a wall** (2026-08-24).
    The unique (student, date, start_time) index counts cancelled rows, so a
    reschedule back to where it came from always failed against its own
    corpse, and every retry minted another one (real trails: Grace Co,
    Lauren D, Maggie G). `collisionKind` in `reschedule.js` classifies a
    target as free / cancelled / live before any write:
    - CANCELLED occupant -> revived in place via `reusePatch` (scheduled,
      source manual, is_modified, incoming duration/notes). No duplicate row
      is ever created; the Reschedule dialog shows "will be restored instead
      of creating a duplicate" live as the pickers change, and Add session
      does the same reuse silently.
    - LIVE occupant -> refused with a message that says "already has a
      SCHEDULED session" — distinct from the cancelled case by design.
    - The materializer's side was decision 22's reclaim (foreign corpses
      reclaimed; a slot's own cancelled one-off is deliberate and kept).
    Hard delete is also reachable from the cancelled strip below the grid
    (✕ per chip, admin, arm-then-fire) — a cancelled session has no card, so
    the strip is its only surface.

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
- **Student Attendance Report** (`attendanceImport.js`): binder resets, and
  nothing else. Splits by the Center column, groups by student, and keeps each
  student's LATEST departure — attended Monday and Friday against a Wednesday
  prep still counts as used. Matching is `radius_lead_id`, then the display
  name, and an ambiguous name matches NOTHING: a missed reset costs one manual
  click, a wrong one clears another child's binder unnoticed. Two match routes
  were deliberately refused — near-miss first names ('Haziq'/'Hazik', as likely
  siblings as a typo) and the GUARDIAN surname. The guardian route was built,
  measured and removed: its key is first name + guardian initial, ignoring the
  student's own surname, so the template row 'John Smith' matched the real
  'John G' (account Germin). On the real export it made 2 matches, 1 wrong.
  Placeholder names never match, for the same reason they never create.
  Real 8/21 export with the pair populated: 249 rows, 0 skipped, **131
  students, 129 matched, all via the pair**; Blue Bell 40 of 40. The two misses
  are the cases where guessing is worst: 'Haziq Hassan' vs the stored 'Hazik H'
  (a spelling divergence INSIDE a sibling pair — the family also holds Hayat H,
  so a guess picks between two real children), and 'John Smith', refused as a
  placeholder. Both surface in the preview.
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
- Binder prep (`/binder`): binder_status/binder_note on the STUDENT (see
  decision 11). Defaults to tomorrow, one row per student. Cards show a tiny
  ✓/✗ only; the note never renders on cards (the day query doesn't even
  select it) — only in the binder view, the student drawer, and the ⋯ menu.
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
- **Binder cleanup migration is DELIBERATELY UNAPPLIED.** `sessions.binder_status`
  / `binder_note`, the `sessions_instructor_binder_only` trigger and the
  `instructor_binder_update` policy on `sessions` are all still in place, dead
  but harmless, because the deployed bundle still writes them. Ship the client
  first, then drop them — migrating first is exactly how the owner got locked
  out during the instructor_rank work. SQL is in decision 11's commit message.
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
- **Six tables are still on a permissive `staff_all` (ALL / true)**, so any
  authenticated JWT can write them: `centers`, `import_runs`,
  `instructor_shifts`, `session_conflict_dismissals`,
  `session_cross_day_dismissals`, `v1_reference`. `assignment_overrides` is a
  variant (SELECT true + INSERT true). **`instructor_shifts` is the one worth
  deciding about** — shift coverage is a hard filter in auto-assign, so an
  instructor account editing shifts changes who is assignable. The others are
  low-stakes. They are listed in `PERMISSIVE_ALLOWED` in `db-check.mjs`, so
  they stay visible and a NEW permissive table fails the checks.
- **`radius_first_name` is empty on every student until a Students import
  runs.** `radius_lead_id` is populated (247 of 252) from an earlier run, but
  the lead alone is a FAMILY, so until the second half is stored the attendance
  import falls back to name matching. Re-run the Students export through the
  roster import once and matching becomes exact. The 129-of-131 figure above
  was measured by reconstructing what that import will write, from the real
  `Students Export 8_23_2026.xlsx` — the definitive number comes from the run
  itself. A one-time SQL backfill would do the same and can be proposed on
  request; not done unilaterally, as it is a bulk roster write.
- **Imports are not admin-gated in the nav** (`TopBar.jsx` marks only
  Instructors and Rankings `adminOnly`), but every write an import makes lands
  on an admin-write table, so an instructor account reaches the screens and
  then fails mid-import. Gate the nav, or leave it — but it is not a
  permissions hole, only a bad error path.

## Working style the owner expects

Verify each numbered item before the next; report evidence with numbers.
Preview-first for anything destructive; bulk data changes are proposed, never
committed unilaterally. Report failures plainly. When the owner reverses an
earlier decision, the newest instruction wins and gets encoded in checks so
it can't silently regress.
