# Motion capture assets — 15 October 2026

## Current presentation decision

The owner's latest explicit decision restores the previous video preview, with
spring ribbons, the elastic timetable grid and orbital backgrounds. The later
particle/cropped-panel direction is not the current website presentation.
The three original videos and their original posters were restored from the
ignored local capture backup without recapturing or changing their bytes.

Current assets in `marketing/public/demos/`:

| Scene | Video | Poster | Capture |
| --- | --- | --- | --- |
| Attendance | `attendance.mp4` | `attendance-poster.webp` | 430 × 760, 8.29 seconds, 169,525 video bytes |
| Timetable | `timetable.mp4` | `timetable-poster.webp` | 1440 × 900, 8.54 seconds, 255,625 video bytes |
| Family | `family.mp4` | `family-poster.webp` | 430 × 760, 9.00 seconds, 295,953 video bytes |

These are recordings of the real local application with synthetic school data,
not a live connection to a school's records. The timetable scene remains an
Experimental-settings experience. Source recording evidence remains under the
ignored `marketing/screenshots/motion-source/` directory. Videos plus posters
total 836,095 bytes.

`marketing/capture-motion.mjs` is the restored reproduction entry point. With the
synthetic app running on localhost:8000, marketing dependencies, Playwright
Chromium and ffmpeg installed, run `cd marketing && node capture-motion.mjs`.
An optional scene argument (`attendance`, `timetable` or `family`) captures only
that scene. `CAPTURE_ORIGIN` is restricted to localhost/127.0.0.1 and
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select a compatible local Chromium.
After synthetic demo login, the capture blocks all school API writes and fails
on API errors or JavaScript exceptions. The exact repository synthetic portrait
is supplied for the one missing development asset, as documented below.

No recording was rerun for this rollback. The restored script passes syntax
checking. The media transport and existing server/security suites pass 17/17,
including MP4 MIME, full/partial/HEAD delivery and unsatisfiable ranges. Website
integration and deployment remain the owning release's responsibility; restoring
these files is not evidence of a production deployment.

## Historical screenshot exploration — superseded by the rollback above

The following evidence describes the intervening screenshot experiment. Its
references to “current” describe that checkpoint, not the current presentation.

### Screenshot presentation decision at that checkpoint

The owner requested actual application screenshots composed into meaningful
motion graphics. Three connected panels show how a broad overview leads to a
specific class, lesson or recorded-day detail. Page-opening recordings were an
earlier attempt and are no longer the primary website presentation.

Every panel uses pixels captured from the running local synthetic Cambridge
International School demo. The composition does not redraw app text, change a
count or invent a completed action. The page carries the shared synthetic-demo
disclosure; individual image descriptions explain the visible content naturally.
The timetable remains an Experimental-settings experience and must retain that
qualification in the surrounding website copy.

### Screenshot assets and relationships

`marketing/public/stories/regions.json` contains `attendance`, `timetable` and
`family` arrays, each with three objects: `src`, source image `width`/`height`,
native-pixel `crop`, `label` and `description`. It references eight unique WebP
files across nine panels:

| Story | Source images | Relationship shown |
| --- | --- | --- |
| Attendance | `attendance-overview.webp`, `attendance-class.webp`, `attendance-register.webp` | 40 subject registers → Class 7A's Mathematics row → the same Period 1 draft with 27 unmarked students. |
| Timetable | `timetable-week.webp`, `timetable-lesson.webp`, `timetable-detail.webp` | Class 7A's week → Thursday Mathematics at 9:00–9:45am → Kavita Mehta and Room 204. |
| Family | `family-attendance.webp`, `family-day.webp` | Aarav Sharma's aggregate → his selected calendar day → the dated result, 01 Oct 2026, present in the register. |

The older eight-daily-register overview is excluded from the 40-subject-register
story because those scopes differ. The family outcome keeps its date; it is not
presented as a timeless live presence status. The percentage and counts are demo
records, not evidence of a customer's performance.

Mobile source screens are 860 × 1520 pixels and timetable source screens are
2880 × 1800. `timetable-lesson.webp` is a direct 4× browser capture of the actual
weekly lesson card, 540 × 196 pixels, so its focused panel remains readable.
No artificial detail was added to enlarge it.

Two additional source captures, `family-home.webp` and
`attendance-students.webp`, are retained for reproducibility and are not used by
the current panel manifest. `capture-regions.json` records the broader set of
measured pixel and normalized bounds; it is capture evidence, not a rendered
story. All ten WebPs together are 713,948 bytes at this checkpoint.

### Screenshot capture boundaries and provenance

`marketing/capture-story.mjs` uses a new synthetic demo session on localhost. It
then blocks non-GET/HEAD/OPTIONS API requests and fails on API errors, JavaScript
exceptions or attempted school-data mutations. No attendance was marked or
submitted, no lesson was edited, no guardian request was signed, and no message
was sent. The screenshots reflect the local development application; they do not
prove that a particular application release is deployed.

The local server's `/assets/aarav-sharma.png` was unavailable even though its
original synthetic portrait exists in the repository. The capture browser served
that exact repository PNG for this one asset URL. It did not change a student
record, substitute an identity or rewrite screen content. This is the same
documented restoration used by the preceding static screenshot captures.

The considered Parent Home → Timetable scene was excluded because the local
screen combined an Ananya Iyer subtitle with Aarav Sharma's schedule. The family
attendance route consistently identifies Aarav. The inconsistent timetable
subtitle remains an app acceptance gap; this marketing work does not fix it.

### Reproduce and verify the historical screenshot experiment

With the synthetic app running on localhost:8000 and marketing dependencies plus
Playwright Chromium installed:

```sh
cd marketing
node capture-story.mjs
node --test test/story-assets.test.mjs
```

`CAPTURE_ORIGIN` accepts localhost or 127.0.0.1 only.
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` may point to a compatible local Chromium.
No personal browser profile or production institution is used. The still capture
does not require ffmpeg.

All current stills completed without API errors, JavaScript exceptions or blocked
write attempts. Syntax checking passed. Full screens and the nine-crop contact
sheet were visually reviewed. The three asset tests pass, validating manifest
shape and story identity, real image dimensions, crop bounds, readable
descriptions and source-image hashes. An intentional recapture requires visual
review and an explicit hash update; a changed layout can also require new crop
coordinates.

For website integration, preserve crop proportions and enough context to retain
their meaning. Keep every step understandable without animation, honour reduced
motion, and provide the page's pause control. Animate panel transforms and the
relationships between them, not fabricated changes to the displayed records.
The owning website work verifies responsive composition, keyboard/accessibility
behaviour, performance and release separately.

### Prior recording decision before the latest rollback

An earlier attempt produced three read-only H.264 recordings: attendance
(430 × 760, 8.29 seconds, 169,525 bytes), timetable (1440 × 900, 8.54 seconds,
255,625 bytes), and family (430 × 760, 9.00 seconds, 295,953 bytes). Together with
their posters they totalled 836,095 bytes. Their capture had no API errors,
JavaScript exceptions or blocked writes; representative frames were reviewed.

The owner found page-opening clips insufficient and asked for composed screenshot
motion graphics instead. The recording script and any retained working files
are historical source material, not the current presentation contract or a
requirement to ship autoplay videos. Current reproduction and integration follow
the screenshot workflow above.
