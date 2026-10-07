# Edura photo-attendance inference service

This is a private inference sidecar adapted from the MIT-licensed Attendance Lab prototype.
It contains the tested image decoding, tiled YuNet detection, SFace embeddings, conservative
one-to-one matching, encrypted local templates and short-lived analysis evidence. The prototype
interface, local access credentials, database and test images are deliberately not copied.

OmniSchool owns authentication, tenant/class authorization, authorization references, review,
audit and final attendance submission. The sidecar only proposes likely present students. A face
that is not detected or matched never becomes an absence. The ordinary register remains usable
when this optional service is unavailable.

## Local setup

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python scripts/download_models.py
ATTENDANCE_API_TOKEN=<at-least-24-random-characters> \
  .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8100 --workers 1
```

Keep `data/` private and back up its encryption key with its SQLite database. The model binaries
are excluded from source control and downloaded with fixed SHA-256 verification.

This remains an experimental, feature-flagged integration. It has no liveness guarantee and no
classroom-accuracy claim. A school privacy/legal decision, purpose-specific authorization,
non-biometric alternative, calibrated evaluation and operating procedure are required before a
real-student pilot.
