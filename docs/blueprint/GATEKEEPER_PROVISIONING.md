# Authorized Stage gatekeeper provisioning

## New gate.demo account — 15 October 2026

The owner explicitly superseded the proposed assignment to `kavita.staff`: create
a new user instead and leave Kavita unchanged. The fixed-target maintenance path
`[provision-gatekeeper] [new-gate-demo]` creates only `gate.demo` in Cambridge (`cis`),
with an active non-teaching profile and a Gatekeeper role containing exactly
institution-scoped `gate.manage`. Account, membership, binding, audits and access
outbox event commit together after scope verification. Existing usernames cause
rollback; no existing account, password or assignment is updated.

The trusted runner generates the initial password and passes only its salted
application-compatible scrypt hash to the private execution. It emits an
RSA-OAEP/AES-GCM encrypted credential packet to GitHub logs before execution, so a
later failure cannot lose the credential. Delivery is permitted only after the
private account operation succeeds. The password never enters Cloud Run arguments
or logs; the hash and encoded program are masked in runner logs. This avoids the
previous Cloud Logging read-permission blocker without changing IAM. The private
recipient key stays outside Git. On failure, inspect the first encrypted packet
and execution result before retrying; never reset an existing account.

The normal Verify gate, trusted workflow identity, private migration job and
persisted runtime configuration remain. Public-demo sessions remain read-only.
All 19 local deployment contracts and backend typecheck/lint pass. The native
PostgreSQL regression covers successful creation, credential verification, gate-only
scope, refusal to overwrite, outbox evidence and unchanged Kavita records. Hosted
CI, live account creation and private credential delivery are pending.

## Earlier gatekeeper.review operation — 14 October 2026

On 14 October 2026 the user explicitly approved creation of `gatekeeper.review`
with only Manage In & Out access, then requested a direct database entry after
browser authentication was declined. This authorizes the bounded maintenance
operation below; it does not grant general-purpose cloud SQL access.

The trusted Stage workflow has a one-account maintenance path triggered only by
an explicit `[provision-gatekeeper]` commit marker. It waits for the normal Verify
job, uses the existing approved reusable-workflow identity and `gcp-stage`
environment, and verifies the existing runtime and migration-job boundaries.
The ordinary application-deployment path excludes maintenance-marker commits.

The existing `eduvera-stage-migrate` job receives temporary execution arguments;
its persisted schema-migration command, image, secrets, identity, resource limits,
retry policy and future behavior remain unchanged. This is a deliberate,
user-authorized exception to the schema-only purpose of that execution, not a
relaxation of normal deployment checks or an additional public SQL endpoint.
No IAM change, database-password export, new secret or public database proxy is
introduced.

Inside the private job, the operation finds the active review principal and
Cambridge school (`cis`), then calls the already tested `GateService.gatekeeper`
transaction directly using the existing database connection. It verifies an
active non-teaching staff profile, exactly one active institution membership,
institution-scoped gate access, and no effective permission except `gate.manage`.
An existing username is verified without overwriting its password or role.

The recipient RSA public key may be committed. Its private key and all passwords
must remain outside Git. The generated password is encrypted with AES-256-GCM;
the AES key is wrapped with RSA-OAEP/SHA-256. Cloud/GitHub logs contain ciphertext
only. The recipient decrypts the result privately and delivers the account's
credentials outside the repository. Retain the recipient private key until the
credential delivery succeeds.

Local validation: 13 deployment/maintenance contract tests, valid workflow YAML,
and the actual encoded container operation against a disposable PostgreSQL WASM
schema. That test successfully created the non-teaching account, verified only
`gate.manage`, and recovered the encrypted credentials. Live execution evidence
will be recorded after the authorized Stage operation completes.


## Live Stage evidence — 14 October 2026

- Initial workflow 38606743742 stopped before database execution because the app had moved to the reviewed branded origin while that run held the earlier URL contract. PR #32 aligned the encrypted credential login URL with https://app.thatcampus.com/login.
- A newer ordinary Stage release replaced the pending retry. PR #33 gave explicit gatekeeper-maintenance runs a separate verification queue; the shared Google Cloud execution queue remains serialized.
- Workflow 38609626549 passed all backend/mobile/desktop Verify checks. Its private database execution `eduvera-stage-migrate-g7qrk` completed successfully at 17:56:20 UTC. The encoded program verified `gatekeeper.review`, active non-teaching staff, one active school membership, institution-scoped access, and exactly `gate.manage` before returning successfully.
- The workflow failed afterward while reading the encrypted result: the deployment service account was denied access to Cloud Logging views. The account transaction succeeded, but the generated password has not been recovered or delivered. No IAM grants, password resets, or duplicate accounts were attempted.
- Credential delivery remains blocked on retrieving the single `GATEKEEPER_PROVISION_RESULT:` ciphertext line from that execution's logs. Keep the recipient private key outside Git until decryption and private delivery succeed. Do not re-run account creation to try to recover a password: existing-account verification intentionally preserves it.
