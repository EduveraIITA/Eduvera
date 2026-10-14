#!/usr/bin/env bash
# One-time bootstrap, run by a project administrator in Google Cloud Shell.
# No existing Eduera service, app secret, authentication setting or DNS is edited.
set -euo pipefail
release="${1:?Usage: bash marketing/bootstrap-cloud-shell.sh <uploaded-release-sha>}"
if [[ ! "$release" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'Provide the exact full SHA of the uploaded, verified release.' >&2
  exit 1
fi
cd "$(dirname "${BASH_SOURCE[0]}")/.."
project='eduera-511111'
secret='thatcampus-form-secret'
if ! gcloud secrets describe "$secret" --project="$project" --format='value(name)' >/dev/null 2>&1; then
  node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))" |
    gcloud secrets create "$secret" --project="$project" --replication-policy=automatic --data-file=- --quiet
fi
gcloud secrets add-iam-policy-binding "$secret" --project="$project" \
  --member='serviceAccount:stage-runtime@eduera-511111.iam.gserviceaccount.com' \
  --role='roles/secretmanager.secretAccessor' --quiet >/dev/null
# Metadata only: the deployment account does not need to read the secret value.
gcloud secrets add-iam-policy-binding "$secret" --project="$project" \
  --member='serviceAccount:github-stage-deploy@eduera-511111.iam.gserviceaccount.com' \
  --role='roles/secretmanager.viewer' --quiet >/dev/null
GITHUB_REPOSITORY='EduveraIITA/Eduvera' GITHUB_REF='refs/heads/Stage' RELEASE_SHA="$release" node marketing/deploy.mjs
# Restrict future deployment authority to the new public website service.
gcloud run services add-iam-policy-binding thatcampus-web --project="$project" --region=asia-south1 \
  --member='serviceAccount:github-stage-deploy@eduera-511111.iam.gserviceaccount.com' \
  --role='roles/run.admin' --quiet >/dev/null
echo 'ThatCampus deployment verified. Configure domain ownership and DNS using the returned service URL.'
