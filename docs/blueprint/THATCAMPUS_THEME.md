# ThatCampus theme

## Direction

ThatCampus should feel clear, warm and capable. Neutral surfaces, a confident type
hierarchy and generous spacing keep operational work serious. Small mint and gold
accents reflect the supplied logo. Recognizable coloured feature icons add identity
within quiet neutral surfaces; meaningful status/action colours remain separate.

This is the owner's 20 October 2026 direction for the entire application, including
signup, setup, ordinary workspaces and Simulation. It extends the interaction rules
in `THATCAMPUS_OPERATING_EXPERIENCE.md`; it does not change domain authority or the
Digital Twin architecture. Rendered revisions still need owner review.

Owner direction,29October2026: the active web app is the functional reference
for the universal React Native migration, not a requirement to reproduce stale
layouts. Improve active screens that conflict with this clean, balanced direction;
exclude unused legacy UI. Apply the same judgment to interaction and motion while
preserving working capabilities, authority, evidence and recovery. Prefer native
Apple surfaces/controls where useful. Transitions should explain navigation or a
person's state change, remain brief and interruptible, and never delay an action.
Honor live Reduce Motion preferences; avoid decorative repetition or animating
incoming operational data. Keep owner review of rendered results separate from
source/build checks.

## Shared foundations

Under the owner's29October native-only frontend decision,
`mobile/src/ui/theme-tokens.ts` owns the shared colors and radii for React Native
Web, iPhone, iPad and Android. All four Light/Dark and Live/Simulation palettes
were moved unchanged from the accepted frozen CSS reference. Native theme changes
now happen once here; no CSS generation or parallel old-frontend style maintenance
is required. The retained frontend CSS and its older compatibility aliases are
frozen migration provenance, not an active second design system.

| Element | Rule |
| --- | --- |
| Canvas and sections | Neutral canvas; use spacing and dividers before adding another card. Avoid nested cards around ordinary rows. |
| Type | System sans-serif. One page H1, typically 32px on mobile; section headings 20–24px, body 16px, supporting copy at least 14px. Compact chart axes, badges and navigation labels may be 12px. |
| Spacing | Use 4/8/12/16/20/24/32px steps. Mobile page gutter is 20px. Group related fields; leave larger gaps between different decisions. |
| Shape | Controls 16px, filled rows 20px, cards 24px, occasional featured surfaces and sheets 28px; pills only for short choices and statuses. |
| Depth | Use `shadow-control` for tappable controls, `shadow-card` for actionable cards, `shadow-raised` for sheets/menus and `shadow-inset` sparingly for recessed grouped inputs. Ordinary primary/secondary buttons use depth instead of decorative outlines. Keep focus rings, input edges and meaningful state indicators. No decorative left rails, heavy blue shadows, glossy tiles or gradients on routine feature headers. |
| Actions | One clear primary action per decision. Live filled actions use `--thatcampus-action` with `--thatcampus-on-action`; secondary and Cancel stay neutral. Use `--thatcampus-shadow-control` for gentle elevation and its pressed counterpart for feedback; text links stay flat. |
| Inputs | At least 16px input text and 44px touch targets. Labels remain visible; placeholders do not replace them. |
| Status | Explicit words and semantic positive/warning/danger tokens. Illustration colour never proves urgency, authority, app access, attendance or physical events. |

Logo green and gold remain brand colours. Existing illustration/data palettes
are separate from purposeful feature accents and semantic status/action
colours. Do not assign a decorative icon palette because a screen belongs to a
different role or area.

Every filled or highlighted row needs space inside its painted boundary. Use
`--thatcampus-row-inset` (16px minimum on both sides) between that edge and its icon,
text or arrow. Never leave a coloured list slab with zero side padding. A grouped
list clips its first and last rows to the shared corner radius; separated rows use
`--thatcampus-radius-row`. Plain transparent divider lists may remain flat.
Tappable filled entries use `--thatcampus-surface-row` and gentle card depth so
their boundaries remain visible in Light as well as Dark. White-on-white cards
without separation are not an acceptable Light-mode counterpart. Do not add depth
to every nested/static row: it must clarify what can be opened or acted on.

## Icons and brand artwork

Use **Phosphor** through `mobile/src/ui/Icon.tsx` for navigation,
feature identities, section illustrations and empty states. Its shared semantic
registry, `mobile/src/ui/icon-semantics.ts`, maps the actual destination or action
to a familiar symbol and explicit feature/status/brand role. Different jobs in one
area must not all inherit the area's parent icon. Resolve canonical paths and
reviewed view selectors; search text, identifiers and return links do not define
a screen's meaning. Unknown names use a neutral question mark, never an unrelated
feature icon. Import individual package modules, not the complete namespace.
Retain the Phosphor MIT notice; the frozen frontend implementation remains
migration provenance.

Owner decision,30October: use stable area accents with quiet neutral text,
surfaces and disclosure controls. Children retain the area's colour and differ
by recognizable glyphs and visible labels. Cross-links use the destination area's
identity, including Insights subviews that retain Insights colour rather than
borrowing Attendance or Assessments colour. Colour is a recognition aid, not an
action/status legend the person must learn. Do not give every icon a box, border
or backing plate. Dock anchors and Profile/Notifications use restrained identity colours, without
colouring their glass surfaces. Back, Search, Close and chevrons remain neutral or
use native action tint; preserve the existing glass surfaces.

`ProductIconIdentity` in the registry declares identity; `productIconAppearance` in
shared theme tokens owns the restrained, opaque Light/Dark inks. Reuse six hues
rather than inventing a difficult-to-distinguish colour for every feature:

| Accent | Areas |
| --- | --- |
| Soft mint | Attendance, Fees/Finance, Care |
| Ochre | Timetable, Resources, Dining, Virtual campus |
| Muted blue | Assessments, Messages, Learning |
| Soft violet | Events, Reports, Insights, Accommodation, Responsibilities |
| Teal | In & Out, People |
| Warm orange | Calendar, Departure, Facilities |

Soften saturation, not opacity. Check symbol contrast at least3:1 against actual
canvas, row and surface backgrounds in Light/Dark Live and Simulation. Today and Profile use mint; Work and Notifications use ochre; Areas uses teal;
More uses blue. These are stable navigation identities, not unread/status signals.
Other shared configuration stays neutral. Selection, links and filled buttons keep
the existing Live blue and Simulation amber action tokens.

Confirmed/complete, attention and failure retain owning semantic
positive/warning/danger colours, explicit text and status symbols. An Attendance
mint icon does not mean recording is complete. Visit Starts/Ends keep distinct
in/out glyphs with the In & Out accent; contact uses People identity. An initials
avatar can retain its neutral circular surface as a person marker. Confirmed status
remains independently green. Original Assistant artwork and its yellow dot are
protected brand exceptions. No feature colour grants access or proves physical
attendance. Preserve visible labels in every theme, consistent with the
[W3C colour guidance](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).

Use 24–26px in navigation, 28–32px for feature rows and up to 40px for a deliberate
empty-state illustration. Keep familiar plain utility icons for Back, Close,
Search, sorting, editing, disclosure, warnings and status evidence. Do not turn every
button into a colourful illustration. Icons beside visible text are decorative;
icon-only controls need an accessible label and a 44px target.

Owner clarification, 21 October: hidden informative help uses a circled **i** next
to its visible label, not an expansion triangle or chevron. Reuse `InfoSummary`
inside native `details` for File details, access explanations, keys, methodology
and provenance. Keep the label and a 44px target, native keyboard/expanded-state
semantics and theme-aware ink in every appearance and world. Do not hide required
errors or safety warnings there. Arrows remain appropriate for navigation,
expandable record lists, optional form fields and action menus; an information
icon must not mislabel an edit or selection as help.

The owner rejected 3D icons. Do not reintroduce raster 3D packs, glossy gradients,
emoji or fake 3D icon extrusion. Do not replace the **ThatCampus Assistant icon**: its
existing `AssistantIcon` artwork is the product's own identity, not part of the icon
pack. Supplied wordmarks, favicons and installed-app icons are also separate brand
assets. No generic robot, sparkle or pack icon may substitute for them.

Owner clarification, 27 October: the animated Assistant and shared loading marks
use the logo's feathers and yellow dot (`#fec106`). Preserve original geometry and
motion. Feathers are black (`#090909`) on Light surfaces and white (`#ffffff`) on
Dark surfaces, always with a transparent background and no backing plate. Inline
loaders on filled primary actions also use white feathers. Select explicit black/white asset variants from the app's resolved theme; do
not rely on an embedded SVG detecting the browser or operating-system scheme.
The yellow dot stays yellow in both appearances and both worlds. The main loader
is72px and the default inline loader18px. Owner direction,30October: when
Assistant is enabled on a compact bottom-navigation layout, keep the four
ordinary destinations together and place its original mark in a separate round
glass bubble to the right. The bubble mark is36px; preserve its original geometry
and motion and a minimum44px touch target.
Reduced motion presents the complete
static original feather-and-dot mark. Forced colours use the system text colour
for feathers so the transparent artwork follows the user's contrast scheme.

## Light, Dark and Simulation

Live retains blue actions and a neutral canvas. Simulation uses the same screens
with the complete warm amber theme, its virtual clock and Return to Live control.
Do not add an environment pill over the avatar or build a separate Simulation UI.
Dark mode retains readable neutral surfaces and the correct amber selection.
Child/person accents must not recolour the app or override the selected world.

Use paired surface/ink and action/on-action tokens. Never put literal white text on
a theme-dependent pale brand token. Feature illustrations can remain recognisable
in either world; their colours never replace the environment theme. Support forced
colours without hiding icons, labels or focus.

The React Native root must also provide the resolved appearance and semantic
colours to Expo Router's navigation theme. UIKit header glass follows that theme
independently of the page palette or window appearance; leaving its default Light
theme creates pale header capsules on Dark pages. Retain the system glass material
and accessibility behaviour instead of painting an opaque replacement. See the
[Expo native-header theme guidance](https://docs.expo.dev/router/advanced/native-tabs/).

## Workflows and mobile behaviour

Start with the person's outcome, not a configuration catalogue. Ask only for the
next necessary choice. Put optional fields and routine provenance in labelled
disclosures. Missing prerequisites must offer in-context creation, a clear handoff
or an honest Set up later route where the domain permits deferral.

Content comes before control density. On mobile, use one page title and a compact
primary action, then no more than two short rows of routine navigation before the
actual work. Do not repeat the page name in a context card or show a route link and
a view tab with the same label. Put occasional view settings, alternate calendars,
timezone explanation and provenance in labelled options. Reveal search on request
where it is secondary, keeping its scope explicit and clearing the filter when
closed. Preserve visible child/person identity where it changes whose data is
shown; reducing clutter must not conceal responsibility or authority boundaries.

Independent jobs belong at the same navigation level. Calendar is an Area, not
a view hidden inside Timetable. Cross-links retain the selected date, view and
authorized person or campus scope; they must not select a different person or
grant access merely to simplify navigation.

Calendar is the important-dates lookahead, distinct from Timetable's routine
sessions and duties. It opens with a compact month overview and the selected
day's dates below, with a List alternative for upcoming dates in that month.
Group month/year, previous/next and conditional Today together; keep view choice,
optional filters and Search on a separate compact tool row. Show source-backed
markers with accessible type/count labels, not inferred activity counts. Preserve
exact person scope and source-owned details; editing happens in the owning domain,
never a second calendar editor. See `CAMPUS_CALENDAR.md` for source completeness,
neutral campus semantics and remaining feed gaps. Published plans are not evidence
of presence, and neither weekends nor a teaching-day override imply campus closure.

Use finite results with search, filters and pagination or an explicit Load
earlier/more action. Pages may scroll naturally; do not put a second long scroll
region inside a page or grow an automatic infinite feed. Preserve position and
entered work when opening details or returning to a list.
For dense operational queues, use the domain's actual work categories (such as
To record, Awaiting review, Automatic pending, Upcoming and Final), full-result search and short pages
of roughly 8–10 entries; messaging directories may use 20. Counts and filters must
cover the authorized result set before pagination, not only the loaded page. Keep
an All view and never hide overdue or unrecorded work by default. Preserve date,
category, search and page in navigation. Small lists should not acquire a wall of
unnecessary filters. Never invent separate person engines or categories solely to
make a list fit the screen.

Wrap mobile actions rather than shrinking labels or hiding them with font-size:0.
Provide Back from selected messages and drill-downs. Keep sheet/dialog headings and
dismissal visible. Forms must work with the keyboard open and safe-area insets;
fixed navigation must not cover the final field, saved state or action. Confirm
consequential actions, not ordinary navigation. Never conceal safety warnings.
Shared sheets follow the visible viewport when a mobile keyboard opens, including
viewport panning. Preserve focus and constrain scrolling to the sheet; do not
disable useful autofocus or move the whole document as a workaround. Keep the
focused input and its adjacent import action together when space permits, with
sticky heading/actions accounted for. Retain a CSS fallback without the viewport
API, and verify physical-phone keyboard behaviour separately from emulation.
Sticky action bars are surfaces too: retain at least the shared 16px internal
inline inset, rounded corners and a visible gap above bottom navigation. At narrow
widths, place saved/unsaved status above adjacent actions when a single row would
squeeze or crop them. A clean single-action state should remain compact.

Present history as useful human actions, not an unedited audit table. Lead with
what changed, who changed it and when; disclose individual changes and technical
evidence on demand. Preserve correction reasons and original evidence. Batch
counts must reflect the actual recorded batch, never a partial loaded page or
an invented grouping of unrelated changes.

### Card actions

Latest owner decision, 24 October 2026: remove the unreliable swipe experiment
entirely. Do not replace it with an extra icon button or overflow menu. Tapping a
Fees card opens its ordinary detail page and existing permitted actions;
Attendance retains its visible native controls and explicit Save/Submit.

Keep fee rows compact and full-width, with name/reference on the left and
amount/status on the right. Use restrained vertical padding, natural wrapping and
44px minimum touch targets, not forced stacked amounts that make every card tall.
Long names and references remain readable. Financial review, authority and
selected-world guards stay on the existing owning action path.

Finance screens keep related context together: collection metadata, current
balances and its correction action share a compact summary, followed by connected
People/Receipts choices. Align labels, values and form groups; keep amounts
tabular and human-readable dates together. Reviews use an inset summary rather
than disconnected plain text. Receipt correction and printing share one action
row, while payment plans and authority setup follow the same restrained spacing.
Reduce empty space, not required warnings, identity, payment status or review.

Person profiles use one identity header, with concise Overview, Connections and
Groups views where the content warrants them. Learning, work, family and app-access
facts attach to that same person; they are not separate person types or portals.
Put related editing choices behind one clearly labelled action and reuse the owning
editors. Do not surround every missing field with a large setup button. Preserve
current capability checks, bounded lists and exact source links for consequential
permissions. A signed-in account summary can share this visual language, but must
remain explicitly an account: sign-in email is not campus contact email, and a
display name does not establish a canonical-person link.
The owner's profile reference informs a rounded, softly raised identity card,
clear name hierarchy and compact factual summaries, not copied branding or
decorative statistics. Show only authorized, successfully loaded group/connection
totals; loading or denial must never become a zero count. On narrow phones,
stack summaries below the identity rather than squeezing the name between an
avatar and a statistic column. Related-person navigation retains the originating
view and page, and closing an action sheet restores focus after it is dismissed.

Insights leads with useful information, not a large “Current view” introduction
that repeats the page title. Keep a compact selector only when there are multiple
authorized views; retain a person's name when it is needed to identify whose
information is shown. Present headline metrics as generous rounded tiles with a
prominent value, concise label and explicit period/scope nearby. Use one column
when a narrow phone cannot comfortably fit two, and keep unknown values distinct
from zero. Alert/review actions remain separate from metric summaries. Visual
polish does not change a metric's definition, denominator, source or permission.

## Entry and first use

Sign-in, account creation, recovery and invitations share a quiet, branded entry
layout with one task heading, visible labels and a clear next action. Preserve
security validation and invitation/recovery context; simplifying the screen must
never discard an opaque link or imply account access has already been granted.

Purpose selection uses compact two-column tiles on phones, flat colourful icons,
short visible titles, full accessible names and explicit selection marks. Explain
the chosen purposes on demand. The review step shows one shared campus foundation
and lets the person choose the first activity directly; do not repeat that choice
in another dropdown. The graphic explains reuse, not a literal database graph.
Owner clarification, 21 October: People / Groups / Places / Schedules / Resources
form a compact hub-and-spoke arrangement around a fixed central campus illustration,
directly on the page with no background box. Use richer paired illustration
colours, not barely visible pastels or merely an entrance transition on static
icons. Keep the diagram compact but legible (232px wide by 200px high, 32px outer
illustrations placed 72px from the centre so labels have room around the campus).
Connect the five items to the campus with individual spokes, not a circular track.
Only the illustrations gently sway side to side in place; positions, labels and
campus stay still. Do not orbit or rotate any component. Do not repeat “One connected
campus” above it; the central Campus label explains the composition. Do not add
pause/replay controls to this illustration; the device's reduced-motion setting
must produce a complete static version immediately. Use lightweight CSS/SVG,
no sound or flashing, and never delay an action for animation. This explicit
control-free loop is an owner-directed exception, not a blanket accessibility
conformance claim or a reason to animate routine operational screens.

An existing setup opens its ordinary workspace rather than silently creating a
duplicate. Keep creation of another entry point/activity explicit. Optional
capabilities, naming and organisation verification stay available without
dominating first use. Lock the relevant fields and in-flow navigation while a
setup command is being accepted, then hand off only on its real result.
Account/campus creation and real organisation-verification control-plane screens
explain their Live-only boundary in Simulation and never switch worlds silently.

Continue this direction through the minimum-setup screens, not just purpose
selection. Use a compact feature identity and one useful heading. Present ready
tools as bounded tiles; explain the next prerequisite once beside its action.
Group forms by the person's decisions (people, time, place, recording), reveal
optional context on demand, and keep a concise review before publication. Keep
draft versus published outcomes and responsibility confirmations explicit.
Verification is an optional trust task with truthful status, not a completion
score or a prerequisite to private campus work. A successful submission, error,
cancel or return should leave the person with clear context and usable focus.

Minimum-setup forms use compact decision groups, not a stack of oversized
fieldsets and bordered disclosures. Keep date, time, overnight state and timezone
understandable together; place and responsibility choices must not be displaced
by routine explanation. Optional notes and infrequent settings can expand on
demand, but invalid hidden fields must open and receive focus. Preserve visible
required-place and assignment warnings, actual overnight dates and the distinction
between saving a draft and publishing. In-context creation asks for the minimum
record details, retains consequential creation context and returns to the same
unfinished activity. Do not repeat instructions for obvious Cancel and Back actions.

Available attendees use compact selectable profiles: canonical name, real initials
when no authorized photo exists, and a native checkbox with a visible selected
fill/check. Show a small roster directly; disclose Find rather than making search
the first task. Keep search visible for large or remotely paged rosters. Preserve
selected identities across filtering and show a bounded selected count, not a
growing block of every name. An account owner or recorder is not automatically an
attendee; no visual badge may invent an account link or permission.

Owner clarification, 21 October: adding and correcting a campus person asks for
one **Name**, not separate first and last names. Preserve the entered name without
guessing family-name boundaries, normalizing internal spacing or transliterating.
Any current storage-length limit must be explicit; never silently truncate an
existing name. Name correction remains revision-checked with a reason, and does
not change an account name, access or historical published snapshots.

The shared Add people sheet opens directly to a Name field: no source chooser or
extra One person click before typing. That same field accepts several names on
separate lines. One name stays a quick add; multiple lines lead to a finite review.
Keep Import file as a compact secondary action on the same sheet, with typed
names preserved when the user returns. Do not split names at commas or spaces.
Completed names appear as compact rounded chips with restrained depth inside the
same field, each with accessible edit/remove actions. A chip means the input was
parsed, not that identity was verified; duplicate state needs explicit text.
Keep this entry sheet brief: no repeated “one person or a list” heading, a one-line
hint, compact Import file action on the Name label row above the input (or beside
it when space permits), and optional connection
behind a disclosure. Show detailed identity/access explanations when relevant to
a collision or decision, not as a wall of introductory copy.
Keep the originating activity/directory intact. File selection leads to a small
sheet/column preview, then a finite review with unresolved collisions surfaced
first. Use readable profile candidates and explicit choices, not a dense editable
spreadsheet or a wall of warning banners. Never resolve identity by colour alone
or preselect the first name match. Show accepted/remaining counts and a clear Retry
or Done path if individual saves stop; no success toast may conceal partial work.
The file-import step offers a downloadable Excel template filled with clearly
identified synthetic sample data: at least ten people, Name marked required, and
Connection, Email and Phone marked optional, including examples with blank optional
cells. Phone cells are text so a leading + or zero survives. Keep a brief reminder
to replace the examples. It must round-trip through the same importer;
downloading it never inserts sample people into a campus.
Keep every import step as concise as direct entry. File selection has one clear
upload action, a short format label and the sample download; avoid a native file
control framed inside another card. Technical size/row/sheet limits, unsupported
formats and formula handling live in File details until relevant. Column preview
shows sample people, not a column heading presented as a person. Review explains
only actionable collisions inline; technical identity and access context remains
available on demand. Failed or unconfirmed saves must still be explicit.

For recognized spreadsheet headings, lead with what was found and a short profile
preview, not a bank of column selectors. Put mapping controls and the header-row
choice behind Change columns; open them when names cannot be recognized safely.
Distinguish source rows from confirmed people, and let users inspect which fields
will be included. Avoid repeating a separate information control for every preview
row. Name conflicts lead with the people who need a decision and concise selectable
profiles: use a specific existing person, create a separate person or skip. Keep
All available, show meaningful ready/unresolved counts, and disclose technical
record references without turning the choice into an audit card. Never hide
invalid data or automatically infer identity. Use a short primary action that fits
beside Back on a narrow phone; an unresolved count explains why it is unavailable.

## Auth background and Assistant decoration

The current sign-in background is shared React Bits Topography, not the superseded
Threads preset. It fills the viewport behind transparent auth shell surfaces without
changing ordinary app width. Preserve render-readiness/context-loss recovery,
orientation/visual-viewport resize handling and a complete SVG contour fallback
when WebGL is unavailable or lost. The fallback remains visible until rendering is
ready. Reduced motion pauses both WebGL and SVG animation and responds to live
preference changes. System and explicit app Light/Dark appearance apply to the
background, form, controls and identity-provider button together.

The authored Topography preset is 22 contours, elevation 1, foreground 0.2, 32°
tilt, forward speed 0.25, lift hover, pulse clicks and thin 0.75px contours. Retain
the renderer's bounded resolution/pixel budget, cleanup and low-power behavior;
do not reintroduce a blank screen or full-page shadow/color boundary to preserve
an old effect. Keep its upstream source and license beside the component.

Assistant response decoration uses the shared theme-aware wrapper, not one GPU
context per historic response. Composer input remains undecorated. Current CSS
owns the flowing edge and static reduced-motion fallback; superseded strand-count,
blue/indigo tuning and WebGL electric-border receipts are not a second visual
specification. Content and edge share the same radius, with readable ink/focus in
all appearances. The original Assistant artwork is unchanged.

Check real phone/tablet/desktop layout, no-WebGL and forced context loss,
orientation, edge-to-edge coverage and live reduced-motion/theme changes.
Chromium screenshots are not physical iPad/Safari acceptance; record that boundary
explicitly rather than retaining old unverified release claims.

## Definition of done

Every changed screen uses these foundations and its owning domain action path.
Review normal, loading, empty, failed, denied and stale states that it exposes.
Check actual rendering at 320px and a common phone width, then tablet and desktop
as appropriate. Confirm no horizontal page overflow, clipped actions or fixed-UI
overlap. Test a meaningful interaction, not only a screenshot.

Verify Light Live, Dark Live, Light Simulation and Dark Simulation using the same
components. Normal-text contrast must reach 4.5:1 and meaningful controls/icons 3:1.
Verify focus, accessible names and targets; screenshots alone do not establish
accessibility. Run shared theme regressions, owning workflow tests and guarded
builds. Record actual UI evidence, source/test-only coverage and remaining gates
separately. Simulation impact and conformance remain part of the same delivery.

### Nested corner alignment

Nested segmented controls subtract their 4px inset from the outer control radius
using `--thatcampus-radius-control-inset`; do not repeat the outer radius on the
inner selected surface. Decorative Assistant response borders share the card
radius with their content, including the animated edge; no inline radius may
override that shared geometry.

## Source

[Phosphor React documentation and licence](https://github.com/phosphor-icons/react)
describe the maintained family, duotone weight, individual imports and tree-shaking.
Palette, mappings and interaction rules above are ThatCampus's theme, not claims of
endorsement by Phosphor.
