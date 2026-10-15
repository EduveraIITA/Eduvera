# Stitch redesign — 15 October 2026

Source: `Stage`, `marketing/`. Existing service: `thatcampus-web`, project
`eduera-511111`, region `asia-south1`. The live homepage was inspected in the browser
before implementation; its six original screenshot sets and interactive showcases
matched the Stage source. The uploaded ZIP includes `code.html`, `DESIGN.md` and
a 28-byte `screen.png`; the actual reference is its HTML, not that image stub.

The latest owner brief explicitly restores the Stitch surrounding design while
preserving the live demonstrations. New surrounding styles live in `stitch.css`;
the original `style.css` and showcase functions remain byte-identical. The baseline
manifest records hashes of all 12 screenshot assets, original stylesheet and eight
showcase functions (including workflow data and original animation transforms).
The original logo is reused without an opaque logo container. No authenticated
application source, screenshot capture script or product screenshot was modified.

Reference adaptations: use requested Plus Jakarta Sans instead of the reference’s
Hanken Grotesk. Replace its fabricated dashboard with the unchanged real website
showcase. Omit unsupported uptime/compliance claims. Keep experimental timetable,
sandbox payment and college/university suitability disclosures. Preserve the
production Login URL from service configuration; staging can set LOGIN_URL to
`https://eduvera-stage-367469594690.asia-south1.run.app/login`.

Validation: local TypeScript, lint, production build and 11 tests pass. Browser
verification checks six desktop/tablet/mobile/light/dark/reduced-motion variants,
original gallery, native screenshot dialog, keyboard controls, image loading and
page overflow. Full database enquiry/outbox verification runs in website PR CI.
Production requests are never used to create a synthetic lead.

Release: merge with `[website-only]` in the merge title to select the bounded mode
in the existing trusted workflow. Its path guard rejects application changes.
The existing normal application release remains unchanged for other commits.
Website-only delivery updates only its image and RELEASE_SHA, preserves environment
and secrets, creates a tagged no-traffic candidate, checks HTTPS routes/readiness,
compares screenshot response hashes, and runs responsive browser checks before
promotion. Final public-domain verification checks the release and hashes; existing
application specification and traffic are checked read-only. Failed promotion
verification restores the previous website revision. Preview captures are uploaded
as the `stitch-preview-verification` workflow artifact.

Deployment remains unverified until the workflow and public-domain checks pass.
