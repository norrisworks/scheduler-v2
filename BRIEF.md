# Mathnasium Scheduler v2 — Build Brief

This document is the source of truth for this rebuild. It captures architecture
decisions already made. Do not relitigate them; ask before deviating.

## Context

Rebuild of an existing single-center scheduling app (React/Vite/Supabase) used
daily at Mathnasium of Montgomeryville, now expanding to a second center (Blue
Bell). The v1 app works but has foundational flaws this rebuild fixes. This is
a clean-slate build: new repo, new Supabase project, new Vercel deployment.
v1 stays running untouched until v2 earns the cutover.

## What the app is

An internal staff tool for running the floor at a math tutoring center:
- Day view of all student sessions, laid out by time, grouped by level
  (elementary / middle / high)
- Instructor assignment: drag-drop manual + auto-assign algorithms
- Staffing: who is working, and their shift times
- Student roster management and lightweight operational notes
- Imports: Radius (student sessions) and Workstream (staff shifts)

Users: owner + center directors + lead instructors. ~5 logins. Two centers.

## Infrastructure (already exists)

- Supabase project: `scheduler-v2`, project id `solflnjhncpanwlomvjp`
  (org: Math). Schema is ALREADY APPLIED — 10 tables, RLS enabled,
  authenticated-only policies, centers seeded (MV, BB). Read the live schema;
  do not re-create it. 7 MV instructors and one week of shifts already loaded.
- GitHub repo: created, empty.
- Vercel: not yet connected. Env vars needed at deploy:
  VITE_SUPABASE_URL=https://solflnjhncpanwlomvjp.supabase.co
  VITE_SUPABASE_ANON_KEY=(from Supabase dashboard → Settings → API)

## Core architecture (the point of the rebuild)

v1's fatal flaw: recurring sessions were virtual (computed at render from
columns on students), so day instances didn't exist as rows. Cancellations
were fake rows matched by time-string. Assignments keyed on synthesized
strings and were overwritten weekly, destroying teaching history.

v2 inverts this. Three layers:

1. `recurring_slots` — templates. One row per student per standing weekly
   slot (day_of_week, start_time, duration, effective_from/until).
2. `sessions` — materialized instances. One real row per student per
   date+time. status: scheduled/cancelled/no_show/completed.
   source: recurring/manual/radius. THE center of gravity.
3. `assignments` — FK to sessions.id, one instructor per session.
   History persists forever; never overwritten across weeks.

Materializer: a job/function that generates sessions from recurring_slots
2 weeks ahead (source='recurring', linked via recurring_slot_id). Run it
on load if the window isn't filled, or via a visible button — but it must
not depend on someone remembering. Editing a recurring slot re-materializes
FUTURE sessions where is_modified=false; hand-edited sessions are left
alone (Google Calendar semantics).

Multi-center: every core table carries center_id. UI has a center switcher
(MV / BB). All queries scope to the active center.

## Auth

Supabase Auth, email+password, ~5 staff accounts created manually in the
dashboard. No public signup. No client-side passwords (v1 had a hardcoded
admin password — never again). RLS policies already restrict everything to
authenticated users.

## Imports

Both imports are file-upload pages with a diff preview before commit, and
log to `import_runs`.

### Radius sessions import
- xlsx export from Radius scheduling. Columns include Student Name, Account
  Name, Appointment date, Appointment time, Session duration, Session status,
  Delivery Method. NO stable IDs.
- Match students on `students.radius_account` (+ name); first import needs a
  manual linking pass UI for unmatched names.
- Upsert on (student_id, date, start_time).
- Quirk: cancel-and-rebook produces two rows for the same slot — take the
  latest row per slot.
- Sessions in the DB within the import's date window but absent from the
  file: FLAG for review, do NOT delete (Radius adoption is partial; absence
  does not mean cancelled).
- Imported rows that match a materialized session: confirm it (no dupe).
  New rows: insert with source='radius'.

### Workstream shifts import
- csv, one row per shift. Current real format (time clock report, same
  shape expected for schedule export): Name, Scheduling Role, Clock In
  (M/D/YYYY HH:MM), Clock Out, ... Will is requesting a scheduled-shifts
  export with an employee id/email column; until then, match on name
  (case-insensitive, trimmed — data contains 'caroline connelly').
- Match instructors on workstream_id if present, else normalized name.
- Upsert on (instructor_id, date, start_time).
- Shifts in the DB within the file's date window but absent from the file:
  DELETE (the file is authoritative for staffing; opposite of Radius rule).
- Manual shift editor also exists (below); imports and manual edits share
  the table, distinguished by source.

## Staffing

`instructor_shifts` replaces v1's working_today booleans. Week-grid editor:
rows = instructors, columns = days, cells = shift start/end. Copy-last-week
button. Same-day call-outs = delete/edit today's shift.

Auto-assign MUST respect shift windows: an instructor is only assignable to
a session if their shift covers the ENTIRE session duration. (v1 assigned
6:30 students to instructors leaving at 6.)

## Assignment scoring — SUPERSEDED (owner decision, see below)

> This section is no longer how v2 works. Computed scoring was built, used,
> and then removed at the owner's direction: `instructor_rankings` is now the
> SOLE input to auto-assign. Ranked instructors are tried in rank order;
> unranked is not "ranked last", it is not a candidate. Hard filters (level
> capability, shift coverage) still sit above the ranking, and fallback-only
> instructors are still held to the final phase. Rankings are maintained by
> hand in the roster, the rankings matrix, and the seeding actions.
> The original text is kept below for context only.

## Assignment scoring (original plan, no longer implemented)

v1 required hand-ranking every instructor for every student; new students
and new instructors started unassignable. v2 computes a default score for
any (student, instructor) pair:

1. Hard filters (exclude): level capability flags (can_teach_*), shift
   coverage, last_resort held to final phase.
2. Base score from attributes: preferred flag, priority (primary/backup),
   prefers_behind vs student.performance, gender match if set.
3. History boost: recent actual assignments (now persistent!) add
   continuity weight — an instructor who taught this student in the last
   N sessions scores higher.
4. Explicit pins override everything: instructor_rankings survives but is
   now for EXCEPTIONS ONLY (pin a great match, block a bad one), not
   exhaustive lists.

Auto-assign algorithms: port v1's phased logic (ranked matches at cap 3 →
relax cap to 4 → last-resort instructors only if explicitly pinned;
tie-break on lowest peak concurrent load). The algorithms consume a scored
candidate list per student; only the source of scores changes.

## Notes (the "home base" feature)

Two kinds, deliberately separate:
- `sessions.notes` — one-liner about THAT day ("leaving 15 early").
- `student_notes` — durable typed entries: note_type
  (standing/heads_up/session_prep/general), body, pinned, resolved,
  author (auth user), timestamps.

UI: pinned notes render compactly on the session card. Full notes live in
a student drawer/panel — readable type, not 8px. Heads-ups can be resolved
(closed out) so notes don't fossilize. Notes are operational context only;
Radius/DWP remains the instructional source of truth. No syncing.

## Views (build in this order)

1. Auth + app shell + center switcher
2. Day view (the workhorse): time-grid by level columns, session cards
   (name, grade, time, status dots, pinned note, assigned instructor color),
   instructor sidebar with shift times + live load counts, drag-drop assign
3. Roster + student detail (attributes, recurring slots editor, notes panel)
4. Materializer + recurring slot edit semantics
5. Shifts week editor
6. Auto-assign (scoring + phased algorithm)
7. Radius import page
8. Workstream import page
9. Data health panel (missing attributes, unlinked import names, flagged
   sessions from imports)

## Explicitly NOT in v2.0

- Layout/seating view (v1 had hardcoded seat maps; if it returns later,
  it's data-driven: tables(center_id, name, capacity) + seat assignments)
- Parent-facing anything
- Radius write-back (imports are one-way, into the app)
- Automated Radius fetching (manual export upload only)

## Stack & conventions

- React + Vite + Tailwind, Supabase JS client. Keep dependencies minimal.
- COMPONENTS IN SEPARATE FILES. v1 was one 2,506-line App.jsx with 41
  useState hooks; never again. Feature folders, small components, shared
  hooks for data access.
- Timezone: America/New_York everywhere. Never use toISOString() to derive
  "today" (v1 bug: app showed tomorrow after 8pm ET). Use a date util.
- Times in DB are naive time columns; treat as local center time.
- Mathnasium brand red #EC3A33 for chrome; keep the v1 day-view visual
  language (it worked) on the new data layer.
- Supabase Realtime subscriptions for live multi-user updates (v1 had
  this; keep it, but scope refetches instead of reloading everything).

## Data migration (separate task, after core views work)

A script will migrate v1 data (Supabase project dtmkeizusyxeaxltpxmg) into
v2: students + session1/2/3 columns → students + recurring_slots; schedules
incl. 1,292 duration-0 cancellation hack rows → sessions with proper
status; assignments re-keyed where recoverable; instructors matched by name
against the 7 already seeded. Blue Bell starts empty and gets entered fresh.

## Sequencing note

Build and verify each numbered view before starting the next. The app is
in daily use at MV on v1; v2 cutover happens only when day view, shifts,
and assignment all work against migrated data.
