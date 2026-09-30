# OmniSchool desktop dashboard

The staff console: principal and teacher screens on a desktop layout. It is a separate
Vite app from `frontend/` (the mobile parent/student app) and shares the same API.

```bash
npm install
npm run dev        # http://127.0.0.1:5174, proxies /api to the backend on :8000
npm run typecheck
npm run build
```

The backend's `ALLOWED_ORIGINS` must include `http://127.0.0.1:5174`.

## Who sees what

Navigation is derived from the user's school membership, never from a fixed menu:

| Membership | Persona   | Screens                                                       |
|------------|-----------|---------------------------------------------------------------|
| `admin`    | Principal | Overview, Attendance, Leave requests, Timetable, Notifications |
| `staff`    | Teacher   | Overview (your day), Attendance, Leave requests, Notifications |
| `guardian` | Parent    | Home, Attendance, Leave, Diary, Timetable, Notifications       |
| `student`  | Student   | Home, Attendance, Leave, Diary, Timetable, Notifications       |

Demo accounts (password `OmniDemo@2026`): `meera.principal`, `kavita.staff`, `pooja.parent`, `aarav.student`.

## Design

Implements the Edura OS desktop design (`src/theme.css`): a Material-3 tonal palette
(surface tiers, primary `#0037b0`, primary-container `#1d4ed8`, tertiary for "good",
error for "critical"), Plus Jakarta Sans on a fixed type scale (display / headline /
label / body utility classes `t-*`), borderless cards lifted by a 1px shadow, tiles in
surface-container-low, a fixed 256px white sidebar with the brand tile, context switcher,
"School desk" group and School help, and a 64px translucent header with the academic
session pill, bell and user menu. Icons are lucide (SVG, tree-shaken) standing in for the
design's Material Symbols so no icon font is downloaded. Status is always colour + shape +
word; light/dark come from one token set. Leadership opens on exceptions; teaching opens
on the day; families open on an answer; every decision is attributed to the person who
made it.
