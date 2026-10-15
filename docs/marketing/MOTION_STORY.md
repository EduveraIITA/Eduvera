# Product-led marketing preview — 15 October 2026

## Current owner decision

The owner approved the first product-led preview, then requested sand-like particles
and screenshot-based connected stories. After reviewing that experiment, the owner
explicitly rejected it and requested the previous version back.

The active preview is therefore the **previous walkthrough-based version**:
real app videos for attendance, timetable and family workflows; the original
spring ribbon, elastic grid and orbit backgrounds; the product-led hero, role
benefits, operating rules, preserved screen gallery and enquiry form.

Do not reintroduce the rejected cropped-screen/particle composition as the default
without a new owner decision. Its local sources and captures are recoverable in
`/tmp/thatcampus-rejected-story.DTxgmz/screenshot-revision.tgz`; they are not part
of the active page or production build.

## Product and implementation constraints

The public website learns from [Stripe's product storytelling](https://stripe.com/in)
without copying its brand. ThatCampus retains its full mark, blue identity,
Plus Jakarta Sans and exact tagline. School leaders are the primary buyers;
teachers and families are shown their own relevant workspaces.

Existing original screenshot assets, eight showcase functions and the base
stylesheet remain protected by a byte-preservation regression. The expandable
gallery and its old deep links remain available. Login, legal routes, enquiry
consent, persistent storage and notification outbox contracts are unchanged.
Timetable remains Experimental; online payments remain sandbox-only.
No customer proof, sales statistics or performance savings are invented.

The restored videos are recordings of the local synthetic demo, not a live
connection to visitor records. Playback is deferred until near view, stops
offscreen/in hidden tabs, and respects reduced motion and data saving.
Individual playback, global pause and native expanded-player controls remain.
See [MOTION_CAPTURE.md](MOTION_CAPTURE.md) for provenance.

## Validation and release status

The original video version passed typecheck, lint, production build, nineteen
unit tests, six light/dark responsive layouts and the isolated PostgreSQL enquiry
regression. The restoration was rebuilt and rechecked: all nineteen unit tests,
six visual variants and five-width PostgreSQL enquiry/outbox checks pass. All six
video/poster files byte-match their original backups. Preview readiness is healthy.

The review preview remains `http://localhost:8083`. This rollback does not deploy
to production. Any subsequent release uses the bounded `[website-only]` Stage
workflow and must not alter the school app, its records, domain or DNS.

Motion accessibility follows [pause/stop/hide guidance](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
and [reduced-motion guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html).
