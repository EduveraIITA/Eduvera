# Programmable virtual campus

Owner direction, 25 October 2026: deliver a mobile campus experience with an
editable, realistic 2.5D campus, reusable assets and per-campus layouts. A campus
may start from an institution-provided aerial image/site plan, a deliberate
OpenStreetMap name lookup, a licensed GeoJSON file, or manual drawing. The owner
approved the existing Vertex/Gemini setup for a small synthetic inference test.
Delivery evidence belongs in the implementation plan and QA record; this contract
does not claim inference accuracy or production readiness.

The owner's subsequent direction keeps graphics quality first: a rich, readable
campus with a floating name for the selected object, within one Virtual campus
experience. This experience now carries the former Campus View's space details,
timetable, activity and KPI panels, source actions and protected Simulation/Campus
Lab capabilities. Superseded entry points lead to this same experience rather than
maintaining a second campus view. Operational layers project existing DT evidence;
operating facts do not become attributes of the visual geometry.

The campus landscape should continue into the surrounding canvas, without a white
mat or a hard rectangular presentation slab. The selected object's floating name
remains readable as the user pans and zooms; unselected names do not cover the map.
Lighting uses the existing profile appearance setting: Light shows day, Dark shows
night, and System uses the resolved theme or campus-local evening/night time.
There is no separate map lighting selector. Simulation uses its selected-world
clock. Lighting is a visual treatment, never evidence that a building is occupied
or a physical lamp is switched on; appearance does not change the saved scene or
operational state. Daytime shadow direction and length follow campus-local time;
night uses soft contact shadows. Without surveyed north orientation and geographic
solar inputs, this is a deterministic illustration, not an astronomical prediction.
An explicit Light appearance outside daytime hours uses neutral daytime lighting.
Editable perimeter walls and entrance gates define a deliberate site boundary;
gate openings align with approach roads. The illustrative sample includes these
assets. Imported campuses acquire a perimeter only from reviewed source geometry
or an administrator's explicit drawing, never from the canvas bounds alone.

The owner explicitly requires code-native, programmable assets whose placement,
shape, dimensions and appearance remain editable. A flattened bitmap is not the
campus scene or a replacement for its reusable assets. Source images may assist
tracing and proposal generation while the resulting scene remains structured.
Reusable assets provide detailed, editable planting and architecture:
broadleaf, palm, conifer and slender trees, low shrubs and planted beds, with
deterministic visual variation. Rendering may split a long wall for correct depth
ordering, but the original wall remains one editable object with its original ID.
Sample placement must leave deliberate clearance between plants, buildings and
boundaries; rendering must not silently relocate an institution's authored layout.
The owner explicitly permits illustrative forest and river scenery outside the
campus. This deterministic, bounded backdrop is decorative, has no DT identities or
interaction targets, and never represents surveyed geography. It leaves the campus
and entrance corridors clear and is omitted from indoor and precision plan views.

The campus supports an informative, animated projection of authorized evidence.
Anonymous figures may illustrate time-bounded expected assignments and journeys
between them, subject to the source, route and clock rules below. They are not
tracked individuals, actual positions or observed actions, and their illustrated
number is not an occupancy measurement. A building marker that rolls up room
records does not place those people outside the building. Recorded presence and
point events retain their distinct truth semantics.

Planned capacity pressure requires one current assignment, its planned participant
count and one exact canonical place's recorded capacity. The warning may remain on
an outdoor building marker when that one room rolls up, but its explanation names
the room whose capacity was compared. Counts from different rooms or concurrent
assignments are never summed into a capacity claim. This indicates a plan exceeding
recorded capacity; measured congestion, queues and physical bottlenecks remain
separate capabilities requiring their own evidence.

## Anonymous people and movement projection

Owner direction, 27 October 2026: natural movement must work for any onboarded
campus from its own canonical people, activity and reviewed layout. This is an
additive, bounded read projection over existing authorized schedules,
participation, responsibility and point evidence. It adds no person, attendance,
location, behaviour or journey writer and no independently mutable population
model. Source records retain their exact place, validity window and revision;
animation never changes those facts or dispatches an operational action.

Institution-wide expectations require the same exact-institution administrative
authority as other operational layers. A member receives only their own authorized
expectations. Motion identities are opaque and scoped to the viewer, institution,
campus and selected world. This payload contains no names, contact details or
private participant roster. A complete authorized participant set may support
stable individual illustrations; incomplete membership uses a representative
group instead, without counting both the group and its known members. A bounded
projection reports truncation or missing source coverage rather than presenting
its subset as the whole campus.

A current exact linked room or outdoor polygon may contain stable representative
figures, with at most eight per group. Their full footprint remains within that
polygon. An illustration may transfer between two non-conflicting expected
contexts only along the same open, reviewed path vertices and explicit
entrance/stair/lift connections used by directions. A shorter nested assignment at
the same place cannot end the longer context early. There is no invented arrival
from a gate for the first known assignment, nearest-path snap, straight line
through a building or automatic floor connection. Unmapped, conflicting,
disconnected, closed or operationally unavailable portions remain unknown. A
known exact room context can remain visible when its route is unavailable.

Travel follows continuous cumulative drawing distance through authored junctions.
Deterministic visual pace, staggering and bounded path-width offsets are
illustrative, not actual speed, intent, attendance, travel time or an ETA. A changed
authorized destination may continue from the exact current edge only while that
edge, publication, selected world and operational route scope remain unchanged
and open. A closure or scope change invalidates the old route; the drawing cannot
continue through it. Canonical building ancestry may supply a known outdoor
entrance, but cannot put room occupants on a roof or imply a mapped indoor journey.
Timestamped observed/accepted point events use a distinct short-lived ring at an
interior-safe mapped anchor. A point event never becomes an interval of human
presence or a moving person.

Track compilation, route lookup and source reconciliation happen when bounded
inputs change, not every frame. Source subjects, claims and points, route caches,
visible figures and pixel density have explicit budgets. Screen-space culling,
level of detail and reusable detailed sprites keep animation work bounded. A
shared canvas draws bounded sprite batches without reconciling React on every
animation frame; geometry, reusable assets, place links and ordinary editing remain
structured and editable. This is a 2.5D presentation, not a full 3D model or a claim
of physical simulation. Reduced-motion preferences retain static eligible figures, and hidden
pages stop animation work. These rendering choices do not weaken source truth,
privacy or selected-world separation.

Live eligibility uses the approved application clock. Simulation uses only the
server-confirmed clock of its selected world, including while a run is marked
running. It never extrapolates future Simulation time from wall time. Rendering
may ease only inside a previous-to-new confirmed clock interval; pause, backwards
seek, unavailable clock and actor/campus/world/publication changes reset transient
motion state. A deterministic seek resamples only sources valid at that instant.
No clock or source failure falls back to Live, another world or an assumed
physical position.

## People and journey

An active institution administrator chooses a canonical campus, supplies a source,
and receives an unverified proposal. The administrator can trace buildings and
paths in plan view, move vertices, choose visual assets, change dimensions and
materials, name places, and link geometry to existing campus places. Undo/redo and
export preserve correction paths. Source replacement is explicit. A source import
does not automatically save, create campus places, or publish.

An optional **Review campus places** action proposes the useful place set from the
current layout together. The person edits names/types, chooses new or exact
existing places, corrects grouping and excludes visual-only features before one
explicit native action creates/connects the approved set and saves its linked
draft. No preliminary draft save or per-feature geometry approval is required.
The batch action preserves geometry review states and does not publish. Details
such as capacity, accessibility, floors and operating responsibility remain optional
native place configuration afterward. See `WHOLE_CAMPUS_GUIDED_SETUP.md` for the
review, atomicity, selected-world and retry contract.

Optional document-local `source_feature_id` groups outlines originating from one
source feature for this review only. It is neither a canonical place identity nor
a cross-import key. Separate features sharing a name or external ID remain
separate proposals; duplicating a graphic clears its source grouping marker.

Saving retains a revision-checked draft. Review identifies every object still
needing confirmation. Publishing requires a nonempty scene whose objects have
been reviewed. Members explore the published version in the ordinary application;
private source imagery and acquisition notes remain administrator-only. Reopening
creates a new draft while the previous publication remains visible. Conflicts keep
local edits and offer reload/export; an uncertain request retries its exact key.

The public-facing virtual campus is authenticated institution-member access, not
an anonymous campus directory. Virtual campus carries the operational evidence
panels and uses linked published geometry when available. Without a published
layout, authorized operational lists remain usable while the layout is prepared.
Expected activity, observations, accepted records and unknown state remain distinct.
No moving person, occupancy count or indoor layout is invented from an aerial image.

Owner interaction direction, 27 October 2026: the published map is a persistent
workspace rather than a card between separate forms. Search, selected place,
directions, personal activity and map options share one contextual panel: a bounded
lower dock on phones and a side panel on larger screens. Changing tasks does not
unmount the map, lose its camera, or require scrolling above and below it. Panel
expansion is explicit and keyboard accessible. The drawing has reserved visible
space so a route is not fitted behind its controls. Deep source/evidence actions
retain their existing authorized modal or domain destination and restore context
on return. Missing or unsafe routes remain explicit beside the route choice.

An optional full-screen map keeps search, layers, perspective, zoom/fit and the
contextual panel together. A visible exit, Escape and browser Back restore the
ordinary app without changing campus or authority. The ordinary shared shell is
retained by default. Full-screen Simulation retains the existing selected-world
clock, status and recovery controls; a presentation URL never selects a world.
Expanded display is not a new campus view, location tracker or domain editor.

Full institution-wide operational evidence controls and layers are restricted to an
administrator of the exact currently active institution. The owner-approved member
extension below exposes only published asset signals and the viewer's own authorized
activity; it does not expose this administrator payload. An administrator membership
in another institution or ordinary campus membership does not grant full access. The owning APIs recheck
authority, campus scope and selected world. Expected, observed, accepted and unknown
remain separate selectable layers; marker numbers count distinct source records,
never people or physical presence. Unknown does not mean empty. Historical point
events do not establish current presence.

Members also have a separate **My campus day** composition inside this same view.
Its owner API resolves the current account, institution, stable acting person and
selected world before reading that person's effective teaching, participation,
exact gate responsibilities and owned repair work. The academic schedule uses the
Core Operating day boundary with actor/enrollment scope applied before its query
bound; the teaching owner rechecks current access, cancellation, room and timing
before returning a session link. It never discloses the administrator's operational
payload, another learner's timetable, a roster or tracked people. Current/next
activities and assigned work retain expected/accepted provenance. The next teaching
day is searched within seven days; no result is a bounded absence of assignments,
not evidence that the campus is empty. Source failures preserve the physical map
with an explicit recovery state.

Walking directions use optional, explicitly reviewed navigation metadata on editable
path polylines. Only open walkable paths connect, and only at exact shared vertices
on the same floor. Roads, decorative paths, geometric crossings, nearby buildings
and place ancestry do not invent graph edges. Canonical start/end links identify
authored entrances; save/publication and native SQL validate their active campus
and floor scope. A path may be closed or declared step-free in the ordinary editor;
the declaration is not independent accessibility certification. The user chooses a
start rather than granting GPS access or creating a location observation.

Where an exact room has no authored walking endpoint, its known canonical building
ancestor may supply the outdoor entrance, with room/floor shown separately and the
unmapped indoor portion stated explicitly. Disconnected/closed networks show an
unavailable result, never a straight line across buildings. Relative drawings do
not supply metres or travel time; geographic drawing lengths are advisory and do
not establish surveyed pedestrian accuracy. Route context is partitioned by actor,
campus and selected environment and is cleared when its source changes. Published
scene revisions, closures and schedule changes use the same owners in Simulation;
they cannot alter Live or a sibling world.

Explicit canonical links locate records. A known same-campus parent building may
collect its rooms' markers in the outdoor view; an indoor view requires the exact
canonical room and floor. Name similarity, visual proximity or a graphic parent
never establishes a location. Unlocated or institution-wide records stay in the
activity list instead of acquiring invented coordinates. Marker selection opens
the source-backed detail and its existing action path. Layer or resource-status
failure leaves the published physical layout usable and offers recovery.

## Reviewed walking links

The owner-approved personal campus journey adds walking guidance as an editable
part of the reviewed scene. A `path` polyline can explicitly declare walking
access, open or closed status, administrator-reviewed step-free access, and the
canonical place at its first and last vertex. A blank endpoint is a junction,
not an inferred place. These optional links survive draft/save/review/publication,
export and selected-world capture in the same scene document. Roads, walls,
unreviewed paths and decorative scenery never become walking links automatically.

The route uses the fewest explicit floor/entrance transitions, then the shortest
horizontal drawn walk on open reviewed links. Only exactly shared authored
vertices on the same recorded floor establish a junction; a visual crossing,
nearby entrance, common building or matching name does not. A step-free request
excludes links without that explicit review. This is an administrator's declared
access property, not accessibility certification or measured physical conditions.
Closing a link requires the ordinary revision-checked scene edit and publication;
the previous publication stays available until its replacement is accepted.

The person chooses their starting place. No tracked position is invented. An
outdoor route may end at the exact authored entrance of a canonical ancestor of
the destination room, while the actual room and floor remain separately named.
That is labelled as an outdoor walk; it does not invent an indoor segment. Exact
same-floor room routes can use their own reviewed network. Explicit reviewed
entrance, stairs and lift fixtures extend that network between floors as described
below; there is no implicit connection between floors. Missing endpoints, closed or disconnected paths, and
unmapped interiors leave an honest unavailable state with the place details usable.

The overlay shares the canvas ground projection and only appears on its matching
floor. Relative-coordinate scenes show the reviewed path without distance or ETA.
Metre-coordinate length is advisory drawing length, not surveyed navigation
accuracy. The path network remains presentation data linked to canonical places;
it never grants access, creates places, records physical presence or modifies a
schedule. Snapshot/COW retains the same links and canonical IDs, and a branch's
published closure cannot alter Live or a sibling branch.

## One campus model

`institution_campuses` and `campus_spaces` retain ownership of place identities and
hierarchy. `campus_visual_scenes`, immutable `campus_scene_revisions`, and bounded
private `campus_scene_images` are a versioned presentation projection. Scene element
IDs identify graphics, not operational places. Optional `space_id` and `floor_id`
must resolve to current places in the same institution and campus. A place created
from setup uses the existing topology workflow; an import cannot silently create it.

A fixture may explicitly link through `holding_id` to one current individual
resource holding in the same institution and campus. The same holding may appear
on only one fixture in a scene. Search, save and publication validate the holding,
its non-retired state, individual tracking mode and active resource type through
the owning resource records. Linking never creates a holding or infers identity
from an asset's label, shape or nearby report.

Authorized linked-resource status reads current source availability. A linked lamp
whose holding is marked unavailable suppresses its illustrative night glow; the
status detail names resource availability as the basis and retains the owning
source action. Availability does not diagnose a broken bulb, a power outage or a
physical switch position. A missing holding, one moved out of the selected campus,
a retired or otherwise invalid holding, an inactive type, or unavailable status
data yields unknown state rather than an invented outage or an available default.
Unknown leaves lighting illustrative.
Free-text repair reports alone cannot extinguish a lamp. A separate, explicitly
selected structured repair signal can suppress its illustrative glow as described
below; it remains a reported fault rather than an independent physical diagnosis.

## Operational assets and activity layers

Owner approval, 26 October 2026: extend the same map with Classes, Events and
Maintenance layers and exact asset report-to-verification actions. A person needs
to find their next activity or see a shared asset issue, open its native source,
and understand the next responsible step. They should not re-enter a known item
or place, create a parallel repair record, or complete an inventory before reporting.

An authenticated current member may see the minimum health signal for an exact
individual holding already linked in the current published scene. Native resource
availability and reported repair status remain separate fields. A report may
explicitly select `not_working` or `degraded` for its linked item, with clear notice
that this limited signal is shared on the campus map. Ordinary reports without
that choice retain existing privacy and never acquire a diagnosis from their text.
The immutable intake choice remains tied to the repair's native state, receipts,
handler and configured verifier. Private problems, people, photos and repair IDs
are not shared asset details. Native repair links are returned only to the exact
currently authorized participant; reading the shared signal grants no repair access.

Any remaining open `not_working` report keeps that asset's reported fault active.
Claimed completion awaits checking. Verified closure clears only that report's
signal, and a further-work reopening restores it. Multiple reports are not silently merged.
Reopening distinguishes further work from a record amendment in the immutable
repair receipt. An amendment after verified closure preserves that last resolution;
it does not create a new physical fault. An amendment before any verification, or
after an unresolved further-work reopen, does not clear the existing reported fault.
A legacy untyped reopen after verification has unknown meaning until clarified.
Lamp glow is suppressed by native unavailable state or an active structured
not-working signal; degraded alone does not extinguish it. Closing a repair never
overrides unavailable/retired inventory state or manufactures a physical switch
observation. Unknown status remains explicit, and illustration may continue when
no known source suppresses it. Drawings for drinking water points and equipment
are reusable editable assets, not a new operational catalogue.

Shared asset refresh contains only exact campus/holding identity and minimal
accepted-source revision/command context. It uses the current selected world's
validated source and member audience. Existing participant-only repair refreshes
retain their audience and private payload rules. Source failure leaves the physical
layout usable with recovery, never a healthy default.

Member activity layers contain only the viewer's entitled classes, native activities,
authorized Events and exact repair work. Full operational plans/observations remain
administrator-only. Current and upcoming times are labelled; a scheduled marker or
illustrated figure is never a tracked person or measured occupancy. Event locations
use optional canonical place IDs from the Events owner. A session explicitly chooses
the event's location, its own place, or no map location. Legacy sessions remain
unmapped until reviewed. Venue text, similarity and proximity never establish place
identity. Off-campus or unlocated records stay in the authorized activity list.

## Explicit indoor connections

Owner approval, 26 October 2026: indoor wayfinding extends the reviewed path graph
through explicit entrance, stairs and lift point fixtures. Each connector identifies
its mapped building and exact active source/destination floors in that building.
An entrance connects outdoors to one floor; a stair or lift connects two distinct
floors. Its authored point is the junction on both sides. Corridors still connect
only at exact shared same-floor vertices; ancestry, overlap and proximity create no
edge. Stairs cannot be declared step-free. Cross-floor movement requires an open
reviewed connector, and a known unavailable/not-working linked lift is excluded.
A holding-linked lift without an exact current authorised asset response is also
excluded while status is pending, failed, omitted or mismatched. A valid explicit
unknown response remains a declared route with its condition limitation; a failed
source read never becomes an implicit healthy lift.

The same public selected-room directions work without a personal timetable assignment;
wayfinding grants no room-entry or operational authority. Indoor plans include the
reviewed corridors/connectors and display route legs for their matching floor only.
Floor changes are named steps with a correction path back to the campus. Connector
travel length and ETA remain unknown; route selection uses fewest explicit transitions
then horizontal drawing length, not invented stair/lift measurements. Step-free
declarations are not accessibility certification, and unknown equipment condition is
not a claim that a lift is working. Editing, save/review/publication, closure,
canonical validation and isolated-world mutation use the same scene owner throughout.

The generic place journey retains its chosen destination, exact starting endpoint,
step-free preference and selected floor in bounded URL state scoped to the canonical
campus and selected execution environment. A source action and Back restore these
choices against the current published places. A stale publication status projection
cannot contribute asset exclusions or a route until it is refreshed. Floor plans
retain the scene's authored global coordinates and drawing units; a focused camera
frames the selected building instead of translating geometry. The overlay and
connection steps use those same coordinates and explicitly named canonical floors.

## Universal rendering

The scene schema uses bounded local coordinates, polygons, polylines and points.
Reusable code-native assets provide building facades/roofs, paths/roads, trees,
grounds, water, parking and fixtures. A single renderer supports plan tracing and
2.5D viewing, finite pan/zoom, keyboard selection and mobile interaction.
The owner's supplied reference fixes the default 2.5D view to a straight elevated
front camera: zero yaw and 52-degree elevation. A common 1.6-times presentation
height exaggeration keeps facades, planting and fixtures readable on a mobile
screen. Ground, raised geometry, canopy heights, bounds and cast shadows share this
projection. This is an architectural illustration; presentation height does not
change saved physical dimensions, coordinates or the flat editing plan. Relative
image coordinates carry no survey scale. Geographic imports project a bounded
campus area into metres; no route or navigation accuracy is implied.

Scene draft/save/publish/reopen/image-upload commands pass through the reviewed
Model Core gateway and retain exact native receipts, source hashes, accepted events,
actor/tenant/world provenance and revision/idempotency checks. The scene adapter
does not add a second graph, permission engine or automation runtime. Import runs
retain proposals and external-compute allowance; they do not create operational
facts or claim accepted human review.

The universal React Native application uses **React Native Skia v2** for its
editable 2D/2.5D canvas. Static scene commands become retained vector pictures;
camera gestures, selection and moving figures do not rebuild the campus drawing.
Geometry, appearance or relevant resource-condition changes invalidate the affected
drawing. Detailed procedural assets remain individual editable scene elements;
caching never flattens their canonical identities into a background image.
The opaque sRGB [Canvas](https://wcandillon.github.io/react-native-skia/v2/docs/canvas/overview/)
uses Android `SurfaceView` for the plain published rectangle to avoid an extra
composition copy, and `TextureView` for the rounded, scrolling draft editor to
retain clipping; this platform trade-off still requires actual Android-device
profiling and rendered acceptance.

Gesture Handler and Reanimated shared values keep pan/pinch transforms on the UI
runtime, with the same bounded camera/inset rules as the shared scene contract.
Bounded people packets feed a reusable direction/walk-cycle **Atlas**, with
screen-space culling and authored building/interior occlusion. Compilation and
source reconciliation happen when inputs change. Reduced motion keeps eligible
static figures, and hidden/background screens stop the frame loop. Actor, campus,
world and publication changes invalidate transient camera, picking and motion
state; copied IDs never establish permission to retain another world's state.

Resource overlays retain exact reviewed graphic plus individual `holding_id`
bindings and the current authorized publication/world. Availability, structured
reported fault, reduced service, awaiting verification and unknown remain distinct.
Only the owning unavailable/not-working rules above suppress illustrative lamp
glow; an unresolved source yields unknown rather than a working default. Selection
opens the existing resource/Facilities action with its exact identity. Road/path
closures use the reviewed navigation contract; drawing a road does not invent a
resource condition, physical sensor or new operational writer. Scheduled figures,
point-event rings and accepted records retain their separate evidence semantics.

React Native Web uses the same renderer after loading **CanvasKit** from a local,
versioned WASM asset matched to the installed Skia dependency. Initialization is
lazy and retryable; it does not fetch an unpinned CDN runtime or fall back to an
embedded web application. This graphics asset is application code, not campus
data. Private scene images, DT responses, authority and Simulation clock rules
retain their existing selected-world transport and privacy boundaries. The running
reference web application remains subject to its separate retirement/parity gate.

The choice follows primary documentation for Skia [retained pictures](https://wcandillon.github.io/react-native-skia/v2/docs/shapes/pictures/),
[Atlas batches](https://wcandillon.github.io/react-native-skia/v2/docs/shapes/atlas/),
[UI-runtime animation](https://wcandillon.github.io/react-native-skia/v2/docs/animations/animations/)
and [CanvasKit web loading](https://wcandillon.github.io/react-native-skia/v2/docs/getting-started/web/).
The maintained [v2 Android graphics path](https://wcandillon.github.io/react-native-skia/docs/getting-started/migration/)
avoids making Vulkan a new requirement. [Filament instancing](https://margelo.github.io/react-native-filament/docs/guides/instancing)
and [React Three Fiber native](https://r3f.docs.pmnd.rs/getting-started/installation#react-native)
remain candidates for a deliberate full-3D product: both require a mesh/asset and
camera pipeline beyond the current editable plan projection. Neither supplies DT
identity or authority. Skia preserves that projection across native and web with
less authoring migration. This is a technical fit decision, not a benchmark claim;
release-build frame pacing, memory, heat and actual-device acceptance remain
separate verification gates.

## Building explorer and authored room detail

Owner direction, 27 October 2026: keep a selected building's context in the map's
existing side panel or mobile sheet. A collapsible canonical floor/place/resource
list selects the corresponding map view; viewing another floor or room retains
the building hierarchy. The ordinary shared shell owns the page title and institution
brand. The map does not repeat the institution name in a second page header.

Administrators may compose the current authorized campus directory with published
map links to show unmapped places explicitly. Members use published mapped places
only. Exact parent identities and holding/place bindings determine containment;
names, label similarity and geometry do not. Selection and floor state remain
campus/world scoped through native report/source links and Back. A single Report
problem action hands the selected canonical place and, when valid, exact individual
holding to the existing Facilities composer, which rechecks current authority.

Reusable indoor symbols include desks, chairs, computers, meeting tables, cabinets,
server racks, printers, first-aid cabinets, extinguishers, sanitary fixtures, doors,
windows, projectors and whiteboards. Optional depth and rotation are bounded scene
properties, editable through the same inspector and saved through the existing
scene owner. Floor drawing uses the exact room polygon, walls, restrained tile
detail and collision-aware room labels. Furniture placement creates no inventory,
door swing creates no access grant, and an extinguisher drawing is not an inspected
fire-safety or evacuation certification.

Individual mapped resources retain existing availability and report signals.
For administrators, an exact selected-room read may also show recorded pooled
quantities from the existing resources endpoint. Pools have no fabricated individual
positions or per-item report action. Pending, failed or revoked reads clear private
inventory rows. All reads and edits use the selected execution environment, with
the same native persistence, tenant checks and isolated copy-on-write behavior.

The owner-authorized Aaranya authoring fixture maps Administration Building and
Computing Centre II using fictional, coherent interiors. Its repeat-safe script
uses ordinary topology, inventory and scene APIs, preserves existing canonical
room identities and unrelated campus geometry, and refuses to overwrite another
person's draft. It is sample content, never the generated default for another
campus or a representation of IIITA's actual interiors.

## Floor-plan onboarding and reusable room arrangements

Owner approval, 28 October 2026: a mapped building offers Add a floor plan in the
same editor. The person chooses an existing floor or supplies a new floor name,
then uploads one rights-confirmed raster plan. Notes, codes and finer adjustments
remain optional. The image provider returns bounded room/corridor polygons and
visual openings as needs-review suggestions. New floor and room identities are
not invented by the model or represented by provisional canonical UUIDs.

The scoped proposal merges into the existing campus draft without replacing its
source or unrelated geometry. The person may align the whole floor, correct
individual outlines and review room names/types together. The native reviewed-place
batch may include an explicit floor row with its interior drawing IDs, and room
rows may reference that reviewed floor by a request-local proposal ID. Floor
creation/reuse, exact parent/reuse revisions, room creation, floor assignments and
the linked draft commit atomically through the existing owners and Core receipts.
Request order never proves ancestry. A failed final row leaves no partial floor,
rooms or draft. Replay never overwrites a newer draft or silently moves an existing
room from another floor. Publication and geometry approval remain separate.

Optional Office, Teaching room, Computer laboratory and Meeting room arrangements
add reusable editable fixture illustrations after a room has a canonical floor.
They omit furniture that cannot fit the room and do not create holdings, stock,
capacity, electrical condition or access authority. Actual resources are registered
and linked through existing Resources and Facilities paths. The shared selected-world
services and captured/manual-image substitute apply in Simulation as in other imports.

## Sources and inference

Image intake requires explicit rights confirmation and a PNG/JPEG/WebP no larger
than 4 MiB. Source images stay in the selected world's store. The approved provider
is Vertex, `gemini-3.1-flash-lite`, global region, with server-side application
default credentials. Images and notes are untrusted data. The model can emit only
bounded geometry proposals; schema validation rejects invalid polygons, unexpected
properties, arbitrary assets and oversized responses. No model tool execution or
automatic publication is possible. A failed/disabled provider leaves manual tracing
available. Every generated object begins `needs_review`.

Cloud generation shares the Assistant's durable daily/monthly budget lock and
user allowance. Reserve before generation; failed or interrupted billable attempts
retain the reservation. Hidden SDK generation retries are disabled. Deployment
operators control provider enablement and allowance, not campus administrators.

OpenStreetMap lookup is a deliberate full-name search with an explicit candidate
selection. Bounded Overpass requests retrieve source geometry; unrecognised/missing
features are not replaced by a fabricated campus. Provider timeouts and partial
responses fail visibly. Names and geometry may be incomplete or outdated; nearby
features must be reviewed. Attribution is retained in the published scene.
GeoJSON import requires source attribution and rights confirmation. Unsupported
holes/complex geometry are omitted with an explanation instead of filled silently.

Google Maps screenshots are not a supported automated extraction source. The
institution should provide imagery it has rights to use or use open map data.
There is no scraping/downloading arbitrary user URLs. A deployment-owned HTTPS
Overpass endpoint can replace the public development endpoint.

## Simulation and resource boundaries

The same scene services, database constraints, Model Core path and frontend run in
Live and isolated Simulation. Snapshot/COW coverage includes the scene, immutable
history, images and import proposal ledger. Canonical IDs survive capture. Private
source metadata is sanitised under the snapshot privacy contract; image bytes stay
run-local and are never fetched from Live after capture.

Operational queries, expected assignments and linked-resource availability resolve
within that same selected world. Scene-to-place and scene-to-holding identities
survive capture; a branch change can affect only its own projected figures,
capacity warning or lamp treatment. Simulation time drives temporal eligibility and
illustrative sunlight. Missing coverage or an unavailable world cannot fall back to
Live records, resource state or wall-clock interpolation.

Simulation may reuse captured proposals. A new image can become an explicit manual
trace source with a contained compute-effect receipt. New map/AI requests never
read Live credentials or call Live providers; uncaptured map results fail visibly,
while local GeoJSON and manual editing remain available. This is a declared connector
substitute, not a claim that Simulation performed real inference.

Source images, scene history and allowance records are retained as evidence. Upload
and document sizes and request rates are bounded; deployment quotas and long-term
retention still need review before broad onboarding. No active Simulation is
silently expired or deleted to make room. Tests use explicitly disposable databases
on the existing PostgreSQL17 server and remove only their exact owned targets.

## Boundaries of this increment

The implementation provides an editable visual replica, campus-place links and
reviewed entrance/corridor/stair/lift wayfinding. Photogrammetry, surveyed accuracy,
unreviewed automatic interior reconstruction, sensor-guided indoor turn-by-turn navigation,
accessibility-certified paths, live occupancy and visitor
publications remain separate future capabilities. A deliberately labelled synthetic
sample demonstrates the asset library; it is never the generated answer for an
unknown real campus.

## Phone-only facility navigation: target and provider gate

Owner direction,30October2026: make venue onboarding and navigation useful for a
mall or other facility as well as an educational campus. Reuse a mature positioning
provider; do not build a new geomagnetic/inertial positioning engine. The owner
rejects installed positioning hardware, QR/physical location markers and
camera-based visitor navigation. The owner explicitly permits mapping staff to use
a phone camera during the one-time setup survey; this does not permit requiring
visitors to use a camera while navigating. The [clarification receipt](../../artifacts/indoor-navigation-planning-20261030/staff-survey-camera-decision.json)
resolves the earlier open constraint without selecting a supplier. The following is a product
target, not delivered automatic positioning or a selected supplier. Current authored
directions and their explicit starting-point behaviour remain unchanged.

### Research problem and completion goal

Owner refinement,30October2026: an ordinary mall/facility worker, acting alone or
with other ordinary workers, must be able to create and maintain a precise indoor
map through a guided mobile experience, without technical surveying skills. One
or more ordinary supported smartphones must suffice for setup; a visitor uses
their ordinary supported smartphone to navigate from their actual point A to the
correct point B, including the correct floor and destination entrance. Staff may
use cameras while mapping; visitor navigation must not require a camera. Existing
plans are optional accelerators, not prerequisites. Installed beacons, QR/location
markers, fixed spare phones, specialist survey equipment, mandatory technician
visits and a LiDAR/depth-only phone requirement do not satisfy this target.
Required existing Wi-Fi/BLE infrastructure would also make a candidate conditional
rather than a solution to the stated phone-only requirement. Internet/cloud use,
cost and offline limitations must be disclosed and evaluated rather than silently
assumed; the owner has not yet required fully offline operation.

The target is **less than1metre absolute horizontal error in the visitor's current
position**, within an independently verified metric venue coordinate frame, with
the correct floor and correct destination entrance. Evaluate mapping geometry,
map-to-position alignment, live localization and displayed guidance together;
relative drift, repeatability, a visually convincing map or a route-snapped dot
does not establish this outcome. This is a demanding research target, not a
current capability or a promise that it is achievable with every phone/venue.

**Completion goal:** Obtain and independently validate a fast, simple,
smartphone-only indoor mapping and camera-free visitor-navigation solution that
ordinary workers can deploy alone or collaboratively, and mark the goal achieved
only when reproducible real-venue evidence meets the sub-metre, correct-floor,
correct-destination, setup-effort, usability, coverage and recovery acceptance
criteria across the declared supported phones and operating conditions.

The owner's request for an exceptional working result strengthens the outcome
bar; novelty, an impressive demonstration or a provider's advertised accuracy is
not acceptance. Research mature providers and reusable scientific implementations
first. A managed survey, extra infrastructure, specialist phone or camera-enabled
visitor workaround must be reported as a constraint mismatch, not quietly adopted
as success. If no candidate meets the constraints, the overall goal remains
unachieved even when a bounded research phase has finished.

### Scientific research workstreams

| Workstream | Question and required evidence |
| --- | --- |
| Feasibility and observability | With visitor cameras off and no required site infrastructure, what independently informative signals remain? Test whether different positions/floors can be distinguished, unknown-start location/heading can be acquired and unbounded drift can be corrected. State necessary assumptions and unresolved ambiguities before choosing an algorithm. |
| Existing solutions and prior art | Review reproducible papers, datasets, code and mature providers against the exact constraints. Separate measured results, vendor claims and untested assumptions; examine survey/self-service rights, commercial licences, multi-venue reuse and data export. Prefer integration where it genuinely meets the target. |
| Ordinary-phone support | Establish a representative iOS/Android sensor/API matrix, including budget devices, sampling/timestamp quality, permissions and phone-carrying positions. Declare the support envelope before evaluation; optional depth, barometer, Wi-Fi RTT or UWB cannot silently become universal requirements. Browser sensor parity needs its own finding. |
| Precise phone-only mapping | Compare camera/inertial mapping, metric scale estimation, loop closure and automatic floor/door/route extraction without mandatory CAD. Measure accumulated distortion and errors in glass, repetitive corridors, low texture, crowds and stairs/lifts. Require visible incomplete coverage and guided correction. |
| Collaborative survey and alignment | Determine how independently recorded worker walks merge into one metric map without manual coordinate registration, duplicate rooms or inconsistent floors. Bind any camera-derived geometry and camera-free positioning fingerprints to the same coordinate frame/version; test interrupted/resumed surveys and contradictory observations. |
| Camera-free positioning | Compare reusable inertial/PDR, geomagnetic matching, learned motion and map-constrained fusion, plus any optional signals, using component ablations. Test calibration transfer between phones, phone/body heading differences, stationary users, unknown starts and similar-looking or similar-signal locations. A known-start experiment must not stand in for automatic acquisition. |
| Navigation and recovery | Test correct-floor and correct-door guidance, turn timing, route deviation, accessible vertical transitions, position uncertainty, screen lock, denied permissions, connectivity loss and relaunch. Measure current-position error including processing/display delay; confident false guidance is a failure. |
| Human usability and maintenance | Have first-time nontechnical workers complete mapping, merge/review, publish and update tasks without coaching, and first-time visitors complete unfamiliar journeys. Measure training, total worker time, repeats, corrections, resurvey burden, confusion and assistance; do not replace worker evidence with an expert demo. |
| Independent evaluation and deployment | Freeze an evaluation protocol, reference uncertainty and held-out phones/people/routes/days/venues before scoring. Report failures and error distributions alongside coverage, floor/arrival results, latency, battery, processing cost, privacy, cloud dependence, licences and reproducibility. Then validate the same solution through the shared React Native app with the smallest necessary native adapters. |

Useful starting evidence includes [NIST's localization testing programme](https://www.nist.gov/ctl/pscr/testing-indoor-localization-systems),
[RoNIN](https://ronin.cs.sfu.ca/) for inertial methods and
[ADVIO](https://arxiv.org/abs/1807.09828) for visual-inertial evaluation including
mall and vertical-transition conditions. These are component/testing resources,
not proof of this combined product requirement. RoNIN's truth follows a separate
body-mounted tracking phone and its data/models have research-only terms; ADVIO
uses a multi-device recording rig. Check fitness, reference uncertainty and
licences before reuse; neither collection setup is the proposed operator workflow.

### Acceptance definitions and research sequence

- **Accuracy stays strict.** Report p50/p95/p99 and the worst observed absolute
  error per phone/venue/scenario, correct-floor failures, stale/missing fixes and
  coverage. An average or95th-percentile error below1metre alone does not satisfy
  the owner's unqualified sub-metre target. Any proposed percentile relaxation
  needs an explicit requirement decision. A finite passing test supports only its
  declared conditions; it cannot prove a universal future-error guarantee.
- **No hidden exclusions.** Define supported traversable coverage and start,
  floor-transition and recovery intervals before testing. Track all route time,
  including acquiring/lost states, and report unavailable time separately so
  withholding every difficult fix cannot manufacture accuracy. Do not post-align
  a full test trajectory to improve its score, or discard wrong-floor/door cases.
- **Speed and simplicity need budgets.** Proposed research starting targets are
  no more than5minutes of introductory guidance and at least90% unassisted novice
  task completion, initial position within10seconds and recovery within5seconds.
  These are proposed targets, not measured results or accepted substitutes for
  the accuracy requirement. Establish a numerical mapping-time and tracking-
  availability budget before the validation protocol is frozen. Measure total
  worker-minutes per1000m² plus venue/route complexity, retries, processing wait
  and maintenance; parallel workers do not make total labour disappear.
- **Independent truth is required.** Reference geometry/trajectories must have
  known uncertainty materially smaller than1metre and must not be the same
  unverified mapping/localization output under test. Declare how real test truth
  is obtained and distinguish evaluation-only measurement apparatus, if needed,
  from equipment demanded of the mapper/visitor. A replay or Simulation walk
  cannot by itself certify real-site accuracy or novice usability.

Proceed through feasibility/prior-art review, reproducible component comparisons,
one integrated shared-app prototype, independent novice-worker and visitor trials,
then held-out venue/device replication. Include a building entrance, at least two
floors, repeated corridors, stairs/lifts and changed day/crowd/furnishing conditions
in the pilot; success in one pilot is not general venue acceptance. Name the unmet
gate at each stage and preserve unsuccessful results.

The assistant owns the literature/provider-document research, experiment design,
reproducible code, available-data analysis, integration and evidence review.
Physical survey walks, real phone recordings and independent real-site reference
measurements cannot be performed remotely by the assistant alone. Without adequate
physical evidence the overall goal remains unachieved; do not claim that desk
research, source tests or the owner's separate web-retirement device waiver prove
this sensor-dependent outcome. The [research brief receipt](../../artifacts/indoor-navigation-planning-20261030/research-brief.json)
records this target and its currently open gates without selecting a supplier.

### Smallest understandable operator journey

Navigation-only setup asks for the venue, its physical buildings/floors and useful
destinations, not students, classes, attendance or a complete organisation model.
Reuse the existing campus/topology, reviewed-place batch, scene editor and guided
setup. Do not create another map editor, frontend, place catalogue or public copy
of the operational graph. Existing raster intake is implemented; batch PDF intake,
proposed route authoring and provider survey integration remain new work.

1. **Choose the venue.** Reuse its canonical campus, locate its real boundary and
   building entrances, and keep save/resume available throughout.
2. **Capture the indoor map; reuse plans if available.** Guide ordinary workers
   through phone-only capture, or accept existing floor plans as an optional bulk
   input. Propose building/level order, scale/alignment, rooms and useful public
   destinations for batch review. Preserve captured evidence and source plans;
   distinguish uncertain suggestions from reviewed facts. Reuse matching floor
   alignment where applicable, without assuming every floor has the same geometry.
3. **Review connected routes.** Propose corridor centre lines, entrance/door
   endpoints and explicit stair/lift/escalator connections. Operators resolve
   uncertain junctions, restricted areas, level connections and step-free choices.
   A drawn boundary or opening never silently creates a traversable connection.
4. **Complete the supported self-survey.** Select a supplier only if it permits
   and supports the ordinary-worker, phone-only workflow. A supplier requiring a
   technician or managed survey does not meet the refined research target.
   Check the mapping phone before work starts, show coverage/missing areas, retain
   resumable progress and return processing/retry status to this same venue.
   Do not promise that uploading a plan activates indoor positioning.
5. **Test real journeys.** A separate field walk tests initial location, correct
   floor, correct destination entrance, vertical transitions, deviation/rerouting
   and loss/recovery. Survey completion is not independent accuracy acceptance.
6. **Publish an explicit navigation audience.** Public mall directions and exact
   private-visit directions require their own minimized navigation publication;
   existing institution-member scene publication does not grant anonymous access.
   Publish only the connected, reviewed and accepted coverage. Keep the last usable
   publication while a replacement is prepared; permit staged building/floor rollout.

The operator can rename/move destinations and close/reopen passages without
rebuilding a complete campus model. Naming/content changes should not require a
new physical survey. Geometry or provider-relevant environmental changes require
an explicit coverage/review decision and, where necessary, a resurvey. Temporary
closures and route audience/time constraints need an owning, revisioned operational
path; the current scene-publication closure mechanism is not yet that capability.

### Visitor outcome

For a public venue, the proposed shortest journey is a place link or venue search,
destination selection, **Navigate**, necessary just-in-time permissions, initial
position acquisition and spoken/visual/haptic guidance. Navigation alone should
not require profile setup or an account. Private campuses retain their explicit
invitation/access policy. No direction grants entry or operational authority.

The live map shows the position's age, confidence and detected floor; browsing a
different floor does not change measured location. Low-confidence/old data never
becomes a confident moving dot, automatic reroute or arrival. Distinguish acquiring,
tracking, lost, unsupported and ended states, with a clear correction/retry path.
Do not snap every observation onto the planned route and thereby conceal a wrong
turn. Arrival targets the correct accessible entrance on the correct floor, not a
room polygon's centre. Outdoor-to-indoor handover, floor transitions, accessible
routes and phone interruption/relaunch require their own acceptance.

The native app-install requirement must be explicit. Reviewed suppliers expose
native iOS/Android SDKs; identical live positioning in React Native Web or a mobile
browser is not established. Keep one shared React Native interface with the
smallest native provider adapter. Web map/search/route preview may remain useful
without claiming the same sensor access. App Clips/instant-app/offline behaviour
must not be assumed from a vendor's native SDK description.

### Provider and data boundaries

Shortlist providers against no-installed-hardware operation on both iPhone and
Android, camera-free visitor navigation, permitted staff camera use during setup, acquisition/calibration
burden, supported phones, floor changes, SDK/RN integration and internet/offline
requirements. Obtain actual survey effort, subscription/usage costs, multi-venue
and white-label/reseller rights, mapping API access, support/SLA, data export and
provider-exit terms before committing. Vendor accuracy marketing is not venue
acceptance, and the provider's documentation does not yet establish self-service
or white-label mapping rights for ThatCampus.

Keep canonical venue/floor/place identities independent from provider IDs and
coordinate frames. Reviewed geometry, routes and positioning coverage must refer
to compatible versions. Persisted scene bounds or an illustrative map camera are
not a surveyed geographic/local-position transform. Adding that binding is new
work, and updates must preserve existing links/history and a safe publication
rollback. Visitor navigation exposes only authorised destinations and routes,
never operational layers, private rooms, identities or another person's location.
Navigation position is not attendance, entry permission or occupancy evidence.

Publications, route updates and provider effects need the existing authority,
selected-world, revision, idempotency, resource and correction contracts. Simulation
must use an explicit run-local recorded/scripted position substitute, never Live
device readings, a real survey upload or Live provider credentials. A simulated
walk tests the UI/recovery; it cannot certify real positioning accuracy.

### Validation and first delivery

Begin with one building, its outdoor entrance and two connected floors. Agree
measurable pilot criteria before vendor commitment: independent-route completion,
initial-fix time, correct-floor rate, tail position error, correct-door arrival,
rerouting, lift/stair transitions, unsupported/denied permissions, screen lock and
relaunch recovery, battery and survey/remapping effort. Include varied supported
iPhones/Android devices and building conditions. The owner's physical-device waiver
for old-web retirement does not certify this new sensor-dependent feature; on-site
mapping and independent real-phone walks remain necessary.

The source/provider review and unresolved choices are recorded in
[the planning evidence](../../artifacts/indoor-navigation-planning-20261030/review.json).
