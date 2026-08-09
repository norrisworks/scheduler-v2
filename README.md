# Mathnasium Scheduler v2

Internal staff tool for running the floor at Mathnasium of Montgomeryville (MV)
and Blue Bell (BB). See [BRIEF.md](BRIEF.md) for the architecture decisions —
it is the source of truth.

## Stack

React 19 + Vite + Tailwind v4 + Supabase (Postgres, Auth, Realtime).

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
shift coverage, concurrent load, and the day-view grid geometry. No test
runner — it bundles with the esbuild that Vite already ships and runs on node.

## v1 reference

The `v1_reference` table in Supabase holds verbatim excerpts of the v1 app
(card JSX, layout constants, auto-assign algorithms) since there is no local
v1 source. Reference it for behavior and visual language only — never for v1's
data-layer patterns. BRIEF.md wins on conflict.

## Accounts

Supabase Auth, email + password. There is no public signup — staff accounts are
created by hand in the Supabase dashboard (Authentication → Users). RLS
restricts every table to authenticated users.

## Layout

```
src/
  lib/         supabase client, date utils (America/New_York — never toISOString)
  features/    auth/, centers/  — providers + their UI
  components/  app shell chrome
  pages/       one file per routed view
```

## Build order

Views ship in the order listed in BRIEF.md, each verified before the next:

1. ✅ Auth + app shell + center switcher
2. ✅ Day view
3. Roster + student detail
4. Materializer + recurring slot semantics
5. Shifts week editor
6. Auto-assign
7. Radius import
8. Workstream import
9. Data health panel

## Deploy

Vercel, framework preset Vite. Set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` in project env vars.
