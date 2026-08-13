# Mathnasium Scheduler v2

Internal staff tool for running the floor at Mathnasium of Montgomeryville (MV)
and Blue Bell (BB). See [BRIEF.md](BRIEF.md) for the architecture decisions —
it is the source of truth, except where a section is marked superseded.

## Stack

React 19 + Vite + Tailwind v4 + Supabase (Postgres, Auth, Realtime).
SheetJS for the importers — the only parsing dependency.

## Local setup

```bash
npm install
cp .env.example .env.local   # then paste the anon key
npm run dev
```

`VITE_SUPABASE_ANON_KEY` comes from the Supabase dashboard →
Project Settings → API Keys.

## Checks

```bash
npm run check
```

Zero-dependency assertions over the pure logic that is easy to get quietly
wrong and expensive to get wrong on the floor: center-timezone date handling,
shift coverage, concurrent load, grid geometry, ranking resolution, and every
importer's matching and diff rules. No test runner — it bundles with the
esbuild that Vite already ships and runs on node.

## Auto-assign

`instructor_rankings` is the **sole** input. Ranked instructors are tried in
the recorded rank order; unranked is not "ranked last", it is not a candidate.
Hard filters sit above the ranking because they are physical facts: level
capability, and shift coverage of the entire session window. `fallback_only`
instructors are held to the final phase.

The two algorithms are ported verbatim from v1 (`v1_reference`): Balanced is
scarcity-first, Best Match is tier-by-tier round-robin. Phases are regular
cap 3, regular cap 4, then fallback-only cap 4.

Rankings are maintained by hand — the roster drawer, the rankings matrix, the
per-student seed dialog, and the bulk insert on an instructor's profile.

## Materializer

`recurring_slots` are templates; `sessions` are the real rows. The
`materialize_sessions(center_id, days_ahead, slot_id)` Postgres function turns
one into the other for a rolling two-week window.

It **reconciles rather than rebuilds**: rows the templates still produce are
left in place so their assignments survive, rows that moved or stopped are
removed, missing rows are inserted. It only ever touches sessions that are in
the future *and* have `is_modified = false` — anything hand-edited, and
anything in the past, is left exactly alone (Google Calendar semantics).
"Today" is derived in America/New_York, not UTC.

It runs automatically once per center when the day view loads, and on demand
from the **Generate** button. Editing a standing slot in the roster re-runs it
so the change reaches sessions that were already generated. It is idempotent —
a second run reports `0 created, 0 updated, 0 removed`.

## Imports

All three preview a full diff before writing anything, and log to
`import_runs`.

| | matches on | absence in the file means |
|---|---|---|
| Student roster | `radius_account`, then display name | nothing — never a deletion |
| Radius sessions | account + student name, then display name, then guardian surname | **flag only** — adoption is partial |
| Workstream shifts | `workstream_id`, then name, then first name | **delete** — the file is authoritative |

The opposite deletion rules are deliberate. Radius covers a fraction of a real
week, so absence carries no information. Workstream is the staffing source of
record, so absence means the shift is gone — which is why every deletion is
listed in full and gated behind an explicit confirmation.

Existing students are never renamed by an import. New display names are
generated under the `naming_convention` rules in `v1_reference`.

Matching is name-based only because the Appointments export carries no id
columns. The Students export does carry Student Id and Account Id — importing
one populates `radius_account` and makes future appointment imports id-stable.
MV currently has none populated.

## Accounts

Supabase Auth, email + password. There is no public signup — staff accounts are
created by hand in the Supabase dashboard (Authentication → Users). RLS
restricts every table to authenticated users.

Roles live in each user's `app_metadata`, which only the service role can
write, so a user cannot grant themselves one:

```json
{ "role": "admin" }
{ "role": "instructor", "center_code": "MV" }
{ "role": "instructor", "center_id": "<centers.id uuid>" }
```

Admins get the MV/BB switcher. `instructor` accounts — the shared per-center
logins `instructor-mv@` and `instructor-bb@` — are pinned to one center and see
no switcher, just their center's code. An account with no `role` is treated as
admin so existing logins keep working.

This role governs which centers a *login* may see. It is unrelated to the
`instructors` table, which holds staff records used for assignment. It is a
**UI restriction only** — RLS still lets any authenticated user read any
center. The `center_id` form is what an RLS policy will read from the JWT when
that lands:

```sql
center_id = (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
```

## v1 reference

The `v1_reference` table in Supabase holds verbatim excerpts of the v1 app
(card JSX, layout constants, auto-assign algorithms, the naming convention)
since there is no local v1 source. Reference it for behavior and visual
language only — never for v1's data-layer patterns.

## Layout

```
src/
  lib/         supabase client, date utils (America/New_York — never toISOString)
  features/    auth, centers, day, roster, instructors, shifts,
               assign, rankings, materializer, imports, health
  components/  app shell chrome
  pages/       one file per routed view
```

## Build order

Views ship in the order listed in BRIEF.md, each verified before the next:

1. ✅ Auth + app shell + center switcher
2. ✅ Day view (Grid and Rows orientations)
3. ✅ Roster + student detail
4. ✅ Materializer + recurring slot semantics
5. ✅ Instructor management + shifts week editor
6. ✅ Auto-assign (rankings + phased algorithms)
7. ✅ Radius sessions import
8. ✅ Workstream shifts import
9. ✅ Data health panel

## Deploy

Vercel, framework preset Vite. Set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` in project env vars.
