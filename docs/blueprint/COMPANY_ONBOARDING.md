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
   expire, can be revoked, and cannot be replayed. No automatic email provider
   is configured; the UI says explicitly that delivery is manual.
3. The first administrator signs in to `/principal/administration?school=…`,
   creates terms, classes and subjects, and enrolls students through the
   directory or reviewed import. Student and guardian records remain usable
   without login accounts.
4. **More → Invite members** issues staff, student and guardian invitations.
   Select the existing student/guardian record to activate account access
   without creating duplicate school people. Administrators may invite other
   admins and select a custom staff role at invitation time. Staff profile,
   responsibility and class assignment tools remain school leadership actions.
5. **More → Roles & permissions** creates an Admissions Coordinator with
   `sis.manage` and `members.invite`, then assigns it to staff. That role can
   enroll/import students and manage non-admin invitations in its institution.
   It cannot create institutions, invite admins, change custom role assignments,
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
