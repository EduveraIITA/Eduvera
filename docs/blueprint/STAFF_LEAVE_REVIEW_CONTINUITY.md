# Staff leave: review delivery and continuity

Status: bounded implementation contract, 26 October 2026. This retains the native
leave/coverage foundation and its current reviewer-routing contract. Roles and
dated assignments follow `WORK_PROFILE_ACCESS_ARCHITECTURE.md`, not the retired
fixed duty catalogue or work-profile eligibility model.

## Person, outcome and burden

A staff member requests dated leave and needs to know who is reviewing it. The
current authorised reviewer needs to decide once, with affected work passed to
the existing cover workflow. A changed officeholder must not strand the request
or silently inherit it. Do not require a new campus-wide setup tour or per-class
human confirmations merely to submit leave.

The personal application keeps its draft while review delivery is configured.
It shows the current reviewer or a specific missing prerequisite before Submit;
handover notes are optional. Existing leave policies and person identities are
reused. Missing institutional authority stays an explicit blocker, not an admin
override or a fabricated appointment.

## Minimum delivery confirmation

Only the exact current Governance leave-decision holder may explicitly confirm
request delivery to themselves. The confirmation binds the current rule, office,
appointment, canonical person and all authority-source revisions. It does not
create or adopt institutional power. It activates only one Request recipient;
no automatic decision, reminder, response SLA or expiry is implied.

Staff uses the existing Core configuration approval/activation ports. A stable
`staff_leave_review` key retains immutable configuration versions and revokes
superseded scoped reply grants. The narrow revision-read port avoids a second
Staff policy store. Stale or legacy unbound delivery requires explicit current-
holder reconfirmation; a read never repairs it.

## Explicit pending-request transfer

The requester may choose **Send to current reviewer**. The exact current reviewer
may choose **Take over review**. Neither chooses an arbitrary assignee: Governance
resolves the current authorised holder again in the transaction. Other technical
administrators cannot transfer or decide the request by virtue of admin access.

Reroute requires the current submitted revision and a retained command UUID. It
increments the native request revision, not its original submission timestamp,
and retains the original submit receipt. Staff prepares a typed command, records
its audit/outbox evidence, republishes the current submitted-review revision with
`action: review_rerouted`, supersedes the exact old Request through Core, and
retains the new route under the original correlation. No recipient response is
invented. Waiting and reviewer Work resolve the latest explicit route; only one
current Request is actionable. Withdrawal remains the requester's native right
after another reviewer takes over, without impersonating the protocol sender.

Unknown network results retry the same material command. Accepted writes whose
refresh fails offer read-only recovery; stale/denied writes require a fresh read.
Pending-command storage is partitioned by account, campus and selected world.

Completed personal requests reuse the existing compact history disclosure, headed
by leave type rather than repeating the signed-in person's name. Dates and status
remain visible; duration, cover and decision details are available on demand.

## Affected-work preview and cover discovery

Apply offers a requester-only, read-only preview after policy, dates and portion
are selected. It reuses the exact planned-class and dated-duty selectors used by
approval, request impact counts and rejected-decision counts. It carries source
revisions, a selected-world timestamp and timezone; errors never become empty
success. A 93-calendar-day query horizon and 100 returned items bound the read;
the total/truncation state remains visible. The UI pages four activities at a time.
Preview is not approval, a balance reservation or physical evidence; approval
rechecks current work. It introduces no new staff calendar or half-day rules.

Before approval, cards use affected-work counts, not the explicit zero native-task
count. Approved history uses actual retained cover tasks. Missing policies offer
an administrator handoff rather than an empty required selector. Existing admins
can reach the native settings page; reviewer authority alone does not grant it.

Coverage discovery follows owning-domain access to actual native cover records:
current administrators see campus cover/history, and an active canonical staff
member sees cover records already readable for their own profile. A reviewer
without those existing rights gains no Coverage surface. Current source facts
participate in the workspace fingerprint. An approved request with open cover
keeps the same native Coverage editor inside that exact request for existing
administrators; non-admin reviewers receive an administrator handoff, not an
inferred management grant. Standalone cover duties remain available for cross-
request coordination and replacement recipients; they are not a prerequisite for
finishing a leave review.

## Task-first simplification — owner accepted 26 October 2026

Personal leave begins with dates, leave type with its own usable balance, reason
and Send request. Do not add unlike policy balances together. Pending days are
deducted consistently from usable balances. Full day is the default; half-day and
handover inputs stay available in optional details. Balances are an inline
disclosure, not another primary destination. Staff who also review requests get
My leave and To review; Apply is not a competing action while reviewing.
Ready routing names the approver without exposing delivery configuration. Missing
authority/policy remains visible and blocked, with setup or handoff available only
through existing rights; this simplification does not fabricate readiness.

Approvers see dates, reason and impact, with Approve or Decline. A decline opens
a required reason before its separate final button. Affected activity details use
the existing focused workspace read, bound to the retained submitted request and
its revision. The query expands only that already-visible owner/current-reviewer
request, never every list row or an arbitrary staff ID. It reuses the preview's
bounded source selector. Over-93-day retained requests omit detail; the UI reports
it unavailable rather than inventing zero work. Approval always checks again.

Approved open cover is visible in the request summary and opens in place for an
existing authorised administrator. Its exact native tasks include offers,
accepted replacements and resolved outcomes; planned impact is not substituted
for those records. Selecting a colleague is local only. Offer cover is explicit;
the colleague's acceptance remains a separate action. A failed/stale/ambiguous
offer or failed refresh cannot silently resend from the old revision: recovery
refreshes status. The existing offer API still lacks a command UUID; this UI
guard does not claim a new idempotent writer or Core migration.

## Simulation and retained boundaries

The same services and ports operate in an isolated COW world. A successor
confirmation, explicit reroute and withdrawal must leave Live and a sibling's
request/owner/Work unchanged. This is software coordination evidence, not proof
that a class was physically covered.

Delivery confirmation retains its configuration approval/activation commands and
audit receipts but has no new realtime event. Native/HTTP and selected-world tests
do not establish worker or complete browser/Simulation realtime delivery parity.

Genuine first-use authority adoption and configurable staff working calendars and
half-day boundaries remain separate delivery gaps.
The Finance-only private-founder authority exception is not extended to Staff
without the owner's explicit decision. Existing technical staff/admin boundaries
on the broader Staff workspace are not a claim of general member-reviewer parity.

## Native leave coverage lifecycle

Approved leave creates coverage work for affected effective timetable periods and
dated event/operational assignments through their owning selectors and prospective
reconciliation. Coverage is not a second timetable or a grant of unrelated access.
Use the existing staff profile and native class/event/assessment/journey staffing;
an account title or a descriptive work designation does not appoint a replacement.

The retained native task lifecycle is `open → offered → accepted → completed`,
`offered → declined → offered`, and `open|offered|accepted → cancelled`. An
authorized coordinator offers concrete scoped work; the exact replacement accepts
or declines. A decline returns responsibility to the coordinator. Offering rejects
approved leave, effective timetable clashes and conflicting offered/accepted
coverage. The institution/schedule lock, current staff eligibility and prospective
reconciliation must agree before committing a replacement; timing or role changes
cannot leave stale offers actionable.

Reserved completion/cancellation states in a schema are not proof of working UI,
day-completion automation or a leave-reversal policy. Verify each exposed transition
against the current service and delivery record; never invent physical coverage
because an assignment was accepted or its date passed. A declined/revoked/expired
assignment retains evidence but no current authority. Required decline/revocation
reasons and independent domain constraints remain explicit.

Native `staff_leave_requests`, `staff_coverage_tasks` and their audits remain
authoritative. Class staffing and event/assessment/journey assignments keep their
own records; projections do not become additional writable duty catalogues.
Tenant-qualified references, current membership, source revisions, atomic audits
and authorized outbox facts protect each transition. Historical assignment imports
do not repurpose or delete original staffing records. No salary, disciplinary or
performance-surveillance model is implied.

Coverage acceptance includes exact-recipient visibility, source-linked Work,
concurrent/stale offers, leave/time conflicts, independent acceptance, revoked
authority, duplicate/recovery handling and unchanged Live/sibling records. Genuine
no-show/completion automation, wider workload planning, event judging/rubric and
score moderation, examination-paper custody, committee proceedings and unsupplied
decision policies remain owning-domain gaps,
not capabilities granted by a generic responsibility label.
