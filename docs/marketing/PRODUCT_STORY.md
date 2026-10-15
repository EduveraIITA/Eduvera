# Public website product story — 15 October 2026

## User decision

Replace the generic illustrative landing page with Apple-inspired, product-led
storytelling: real application screenshots, concise explanations, restrained
depth/tilt and scroll motion. This supersedes the previous Stitch variant for the
public website only. The authenticated application is not redesigned here.

The primary journey is: understand the product → explore a relevant workflow →
see scheduling and stakeholder context → request a personal demo. Existing
Features, Solutions, About, Contact, Login and legal destinations are retained.
Login remains `https://app.thatcampus.com/login`.

## Screenshot provenance

Six real screens were captured from the local synthetic Cambridge International
School demo on 15 October 2026: principal overview, period attendance, principal
insights, teacher home, parent home and the experimental weekly timetable. No
production accounts or real institutional records were captured. The timetable
is explicitly labelled as an Experimental-settings experience.

The local parent profile referenced a missing development upload. For the capture
only, the browser restored the original repository synthetic Aarav portrait. No
student data or database record was changed. No other screen content was redrawn,
invented, composited or rewritten. Raw exploratory captures containing development
errors are not shipped.

To refresh with the synthetic local demo running on port 8000:

```sh
cd marketing
npm ci
npx playwright install chromium
node capture-product.mjs
node encode-screens.mjs
```

Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` only if a system Chromium is needed.
The capture script signs into the local demo, reads the pages, and stores raw
PNGs under ignored `screenshots/source/`. The encoder creates responsive WebP
sizes and an optimized copy of the exact existing brand image. Enlargement uses
the full-resolution version. Public screenshots carry accessible descriptions
and a visible demo-data note.

## Interaction and delivery

- Hero screenshot fan and timetable use restrained transform-only scroll motion.
  Desktop visitors can pause parallax. System reduced-motion preferences disable
  animated movement; mobile screenshots retain a static tilt.
- Four keyboard-operable workflow tabs; image enlargement uses a native modal
  with Escape dismissal, focus handling and background scroll lock.
- Mobile navigation, single-column phone enquiry form, system dark mode, clear
  focus styling, and no page-level horizontal overflow at tested widths.
- Prerendered content, self-hosted Latin fonts, responsive/lazy WebP images and
  gzip text transfer. No autoplay video or third-party trackers were added.
- Existing validated, CSRF-protected PostgreSQL enquiry/outbox behavior is
  retained. No fabricated sales metrics, testimonials or payment readiness claims.
- Canonical Cloudflare-forwarded public host can be indexed; noncanonical hosts
  retain `noindex`. This SEO header selection grants no authorization.

## Verification

Typecheck, lint, production build and ten server/security/deployment tests pass.
The existing browser suite was updated for the real-product UI and verifies the
enquiry plus notification outbox against an isolated local PostgreSQL database.
Visual checks cover 320, 390, 768 and 1440px, dark desktop/mobile, gallery selection,
image loading, modal/Escape, mobile navigation and overflow. Screenshots are kept
locally in ignored `marketing/screenshots/` and CI publishes browser artifacts.

Local preview: `http://localhost:8082`. Its enquiry storage is isolated test data,
not the production sales inbox. Stage/live verification is recorded separately
after release. Physical-phone and owner visual acceptance remain necessary.

Local Lighthouse mobile audit after optimization: performance 96, accessibility
100, best practices 100, SEO 100; FCP 1.8s, LCP 2.6s, total blocking time 0ms and
CLS 0.001. These are simulated local audit results, not production field metrics.
The initial audit exposed blocked unnecessary font subsets and oversized image
transfers; Latin-only fonts, responsive images and gzip resolved those findings.

Desktop Lighthouse also returned 100 for performance, accessibility, best
practices and SEO. Additional browser checks passed for Arrow/Home/End tab
navigation, parallax pause, native-dialog autofocus, Escape focus restoration
and a clean browser console. The owner approved continuing with this visual
direction after reviewing the preview on 15 October 2026.

Website CI passed on release `11077883d2b9bfd63ce641d5ee37d6b67a65defc`:
https://github.com/EduveraIITA/Eduvera/actions/runs/38697763717

## Verified live release

Stage release and deployment passed:
https://github.com/EduveraIITA/Eduvera/actions/runs/38697763736

Both `https://thatcampus.com/readyz` and the application `/releasez` identify
`11077883d2b9bfd63ce641d5ee37d6b67a65defc`. The gate passed 100 backend test
files, 137 mobile frontend test files, desktop build and deployment verification.
Public Chromium checks at 1440px and 390px verified the new hero, correct Login,
no horizontal overflow, six WebP screenshots with correct MIME types, workflow
switching, modal/Escape, and enabled/configured enquiry form. No synthetic lead
was submitted to the production inbox; persistence/outbox were tested in isolated
PostgreSQL locally and in CI. The canonical public response no longer has the
incorrect `noindex` header.

Known nonblocking edge configuration: Cloudflare injects its optional analytics
beacon but the existing self-only CSP blocks it, generating a console warning.
No website JavaScript errors were found. CSP was not weakened to enable tracking;
the local audit scores above do not include this edge-injected warning.

The owner accepted the visual direction. Live desktop/mobile browser verification
is complete; physical-device acceptance remains with the owner. Local preview
health was rechecked after release.
