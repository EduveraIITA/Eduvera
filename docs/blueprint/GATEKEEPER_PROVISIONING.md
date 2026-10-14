# Authorized Stage gatekeeper provisioning

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
