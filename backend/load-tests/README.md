# Morning attendance read load test

`morning-attendance.mjs` is a bounded Node 22 load harness for the morning teacher workflow. It exercises concurrent teacher-home and attendance-register **reads**, with an optional Server-Sent Events connection soak. It has no third-party dependencies.

The request layer has a fixed allowlist. It can only call:

- `GET /api/v1/auth/csrf/`
- `POST /api/v1/auth/login/`
- `GET /api/v1/screens/teacher/home/`
- `GET /api/v1/screens/teacher/attendance/`
- `GET /api/v1/events/stream/`

It never calls attendance submission, correction, register lock/unlock, leave, or any other business mutation endpoint. Login necessarily creates authenticated session and audit records, so use a dedicated load-test teacher account and clean those records according to the environment's normal retention policy.

## Safety model

- The default target is loopback: `http://127.0.0.1:8000`.
- Any non-loopback target is refused unless `ALLOW_NON_LOCAL_TARGET=true` is set. Remote targets must use HTTPS.
- Credentials are accepted only through environment variables and are never printed in the plan, metrics, or error output.
- Redirects are not followed, preventing a redirect from forwarding cookies or credentials to another origin.
- Concurrency, duration, start rate, request count, response size, SSE count, and SSE bytes are all hard-capped.
- No new read starts after the duration deadline. Delayed schedule slots are dropped instead of replayed as a catch-up burst; an already-started read can run only until its request timeout.
- Each request has a timeout. `Ctrl-C` aborts active reads and SSE streams.
- At most one SSE connection is opened per authenticated session.

Only run load tests against an environment you own or have explicit permission to test. Start below the expected morning peak, observe database/API saturation, and increase one dimension at a time.

## Quick start

Start the backend, then run:

```sh
TEACHER_IDENTIFIER='load.teacher' \
TEACHER_PASSWORD='set-in-your-shell' \
node backend/load-tests/morning-attendance.mjs
```

The harness obtains a CSRF cookie, submits it with the login request, creates the configured number of sessions, discovers the school date and first assigned class from teacher home, preflights one register read, then runs the read phase. The preflight prevents a typo or unauthorized class selection from becoming a burst of failing requests.

Validate a plan without sending any network traffic:

```sh
TEACHER_IDENTIFIER='load.teacher' \
TEACHER_PASSWORD='set-in-your-shell' \
VIRTUAL_USERS=25 \
REQUESTS_PER_SECOND=50 \
node backend/load-tests/morning-attendance.mjs --dry-run
```

Show help without setting credentials:

```sh
node backend/load-tests/morning-attendance.mjs --help
```

## Configuration

| Variable | Default | Allowed | Purpose |
| --- | ---: | ---: | --- |
| `TARGET_URL` | `http://127.0.0.1:8000` | HTTP loopback or opted-in HTTPS origin | Backend origin only; paths, queries, fragments, and URL credentials are rejected. |
| `ALLOW_NON_LOCAL_TARGET` | `false` | `true` / `false` | Explicit acknowledgement required for a non-loopback target. |
| `TEACHER_IDENTIFIER` | — | required | Staff/admin username or email. Never printed. |
| `TEACHER_PASSWORD` | — | required | Staff/admin password. Never printed. |
| `VIRTUAL_USERS` | `10` | 1–200 | Maximum concurrent read workers. |
| `SESSION_COUNT` | min(VUs, 4) | 1–200, no more than VUs | Authenticated sessions shared across read workers. |
| `AUTH_CONCURRENCY` | min(sessions, 2) | 1–10 | Concurrent CSRF/login flows. Login rate limits still apply. |
| `DURATION_SECONDS` | `30` | 1–300 | Read workload duration. |
| `REQUESTS_PER_SECOND` | `20` | 0.1–500 | Aggregate scheduled request start rate. VU capacity may make the achieved rate lower. |
| `MAX_REQUESTS` | `10000` | 1–50000 | Absolute request cap; the lower of this and duration × rate is used. |
| `REQUEST_TIMEOUT_MS` | `10000` | 100–60000 | Read and SSE-connect timeout. |
| `MAX_RESPONSE_BYTES` | 5 MiB | 1 KiB–50 MiB | Maximum buffered JSON response size. |
| `DATE` | API school date | real `YYYY-MM-DD` | Attendance date to read. |
| `CLASS_SECTION_ID` | first assigned class | string | Class used for register reads. Useful on a day with no scheduled classes. |
| `HOME_WEIGHT` | `1` | 0–100 | Relative share of teacher-home reads. |
| `REGISTER_WEIGHT` | `3` | 0–100 | Relative share of attendance-register reads. At least one weight must be nonzero. |
| `SSE_CONNECTIONS` | `0` | 0–100, no more than sessions | Optional SSE connections, each using a distinct session. |
| `SSE_DURATION_SECONDS` | read duration | 1–300 | SSE soak duration after connections are established. |
| `SSE_MAX_BYTES_PER_CONNECTION` | 10 MiB | 1 KiB–100 MiB | Per-connection stream byte guard. |
| `MAX_ERROR_RATE` | `0.01` | 0–1 | Exit-code failure threshold for read requests. |
| `OUTPUT_FORMAT` | `text` | `text` / `json` | Human-readable table or machine-readable result. |

Environment values outside these limits are rejected rather than silently clamped.

## Workload examples

Read-only local morning burst with register-heavy traffic:

```sh
TEACHER_IDENTIFIER='load.teacher' \
TEACHER_PASSWORD='set-in-your-shell' \
VIRTUAL_USERS=40 \
SESSION_COUNT=4 \
DURATION_SECONDS=60 \
REQUESTS_PER_SECOND=80 \
HOME_WEIGHT=1 \
REGISTER_WEIGHT=5 \
node backend/load-tests/morning-attendance.mjs
```

Add four SSE clients while the read workload runs:

```sh
TEACHER_IDENTIFIER='load.teacher' \
TEACHER_PASSWORD='set-in-your-shell' \
SESSION_COUNT=4 \
SSE_CONNECTIONS=4 \
SSE_DURATION_SECONDS=60 \
node backend/load-tests/morning-attendance.mjs
```

An explicitly authorized staging target:

```sh
TARGET_URL='https://staging-api.example.edu' \
ALLOW_NON_LOCAL_TARGET=true \
TEACHER_IDENTIFIER='load.teacher' \
TEACHER_PASSWORD='set-in-your-shell' \
VIRTUAL_USERS=20 \
REQUESTS_PER_SECOND=30 \
node backend/load-tests/morning-attendance.mjs
```

Do not put the password on the command line as an argument, commit it to a file, or enable shell tracing while running the harness. A secret manager or an interactive shell environment is preferable for staging credentials.

## Results and exit codes

The report includes per-endpoint request counts, 2xx/non-2xx/transport failures, status distribution, transferred bytes, average latency, and p50/p95/p99/max latency. It also reports achieved throughput. SSE output includes connection status and latency distributions, frames, events, heartbeats, bytes, and stream errors.

The process exits:

- `0` when reads ran, their error rate is within `MAX_ERROR_RATE`, and every requested SSE soak completed without connection/stream errors;
- `1` for invalid configuration, setup/auth failure, an exceeded error threshold, or an SSE failure;
- `130` when interrupted.

HTTP 4xx/5xx responses and request timeouts count as failures. Authentication and discovery are reported separately and must succeed before load begins.
