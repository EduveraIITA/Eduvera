# Company provisioning and institution onboarding

The company operator is a separate, explicitly granted backend authority. A
school administrator is not a company operator. No company permission checkbox
is exposed in school roles, signup, invitations or ordinary account APIs.

1. Company operator signs in and opens `/company`. Create a school or college
   with its name, unique code, timezone and first administrator email. Creation
   and a 72-hour single-use admin invitation commit together. The company user
   does not become a school member. Operator reads expose institution metadata
   and company invitations, not student rosters or school operational data.
2. Share the invitation code privately. `/join` activates a new recipient's
   account or verifies the existing account password. Existing passwords are
   not overwritten. Codes are hashed in storage, bound to the recipient email,
   expire, can be revoked, and cannot be replayed. When SMTP is configured, email is attempted after the invitation commits.
   The UI distinguishes mail-server acceptance, unconfirmed delivery and manual sharing.
3. The first administrator signs in to `/principal/administration?school=…`,
   creates terms, classes and subjects, and enrolls students through the
   directory or reviewed import. Student and guardian records remain usable
   without login accounts.
4. **More → Invite members** issues staff, student and guardian invitations.
   Select the existing student/guardian record to activate account access
   without creating duplicate school people. Administrators may invite other
   admins and select an initial work profile at invitation time. Staff profile,
   responsibility and class assignment tools remain school leadership actions.
5. **More → Work profiles & access** creates an Admissions Coordinator profile
   eligible for Membership Coordinator and Student Records Officer work. Active
   assignments calculate the required onboarding and student-record access. That
   staff member can enroll/import students and manage non-admin invitations in the
   institution. They cannot create institutions, invite admins, change work profiles,
   grant company authority or edit guardian leave authority.

Company creation/admin invite/revoke/accept and school invitations/roles/enrollment
are audited. Invitations re-check the original creator's current authority on
acceptance. Removing a delegated permission or operator access invalidates
pending codes. Institution locks, account/record locks and composite role keys
protect concurrent edits and cross-institution assignment. Pending staff role
invitations prevent role deletion until revoked/expired.

## Bootstrap or revoke a real company operator

Use an existing active account, with its normal credentials, and the deployment
runtime's managed database connection. No application endpoint grants this role.
Do not enter database secrets in chat or commit them to the repository.

```sh
cd backend
node --import tsx src/database/company-operator.ts grant operator@company.example
node --import tsx src/database/company-operator.ts revoke operator@company.example
```

`DATABASE_URL` must be configured by the deployment environment. The CLI verifies
an existing active account, records a company audit event, and creates neither
accounts nor passwords. Grant only company personnel. Its changes take effect
on the next request and pending invitations recheck the operator.

In Stage demo mode, **Company view — Eduera** uses `company.demo`, an operator
with no school memberships. `seed-roles.ts` creates this synthetic identity only
alongside the verified Cambridge demo school and refuses production seeding.
Production already prohibits `DEMO_MODE`; no demo operator is bootstrapped there.

College provisioning selects institution kind and uses the existing academic
term/class enrollment model. University-specific course/credit administration
is outside this increment.

## Invitation email setup

Set these Railway service variables: `INVITATION_EMAIL_ENABLED=true`,
`SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`,
`SMTP_USER=projectpathyakram@gmail.com`, `SMTP_PASSWORD` to a newly generated
Google app password, and `PUBLIC_URL=https://omnischool-stage.up.railway.app`.
The address corrects the user-supplied `gamil.com` typo; verify account ownership
before enabling. Do not use the regular Google login password. Google app
passwords require two-step verification. Enter secrets directly in Railway;
never paste them into source, logs or version control.

Company first-admin, replacement admin, and school member invitations all use
this transport after their database transaction commits. The email contains the
single-use code, recipient email, trusted `/join` URL and expiry. Codes are not
placed in URLs. Server acceptance is not proof of inbox delivery or acceptance
of school membership. Errors return the committed private code and an explicit
unconfirmed status; create a replacement to retry (this revokes the old code).
No durable retry queue is included; a process crash after commit requires a
replacement invitation. Existing expiration, revocation and authority checks
remain in force. SMTP TLS certificate validation cannot be disabled.

### Temporary Stage demo override — 4 October 2026

The account owner explicitly requested committing the supplied demo credentials
until rotation. SMTP defaults now apply only when `DEPLOYMENT_ENVIRONMENT=stage`
and `DEMO_MODE` is enabled. The default enables invitation email; explicit
`SMTP_USER`, `SMTP_PASSWORD` and `INVITATION_EMAIL_ENABLED` environment values
always win. No such defaults apply to production, local development, tests or
non-demo Stage. Rotate the account credentials and remove this fallback after
review. The supplied credential's Gmail SMTP authentication has not been verified;
normal delivery failures remain visible with a private-code fallback.

### Railway email delivery — 5 October 2026

Railway only permits outbound SMTP on Pro and above. Free, Trial and Hobby
services must use an HTTPS email API. Invitation receipts now report safe
authentication, connection, recipient or provider failure categories; raw SMTP
responses, credentials and codes are not logged.

For HTTPS delivery configure `INVITATION_EMAIL_ENABLED=true`,
`INVITATION_EMAIL_PROVIDER=resend`, `RESEND_API_KEY`,
`INVITATION_EMAIL_FROM` (an address on a sender domain verified in Resend), and
the existing exact HTTPS `PUBLIC_URL`. A Gmail address cannot be used as a
Resend verified-domain sender. Resend's default testing sender can only send
to the Resend account owner's email, so it is not suitable for general school
invitations. Account verification and reset emails use the same transport.

The default remains `smtp`; on Railway Pro this requires valid Gmail SMTP
credentials (a Google app password) and a redeployment after upgrading.
Provider acceptance does not establish inbox receipt. Do not automatically
retry ambiguous failures; a connection timeout can occur after acceptance.

Sources: https://docs.railway.com/networking/outbound-networking and
https://resend.com/docs/api-reference/emails/send-email
