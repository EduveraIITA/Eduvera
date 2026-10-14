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
