#!/usr/bin/env python3
"""One-time Railway bootstrap for the stage environment.

Creates the Railway project, one service that runs backend/Dockerfile (serving
the mobile app, the desktop dashboard and the API from one origin), pins it to
Singapore (Railway's config-as-code file is deprecated, so this script is the
infrastructure definition), gives it a public domain and an uploads volume, sets its variables,
and stores what GitHub Actions needs (Railway/migration secrets and exact target variables)
so pushes to Stage deploy automatically.

Requires:
  RAILWAY_ACCOUNT_TOKEN   an account or workspace token from https://railway.com/account/tokens
  GH_TOKEN                a GitHub token with repo scope (to store the secret/variable)
  DATABASE_URL            runtime URL; the Supabase transaction pooler is supported
  EVENT_DATABASE_URL      direct/session URL for LISTEN (never transaction pooling)
  MIGRATION_DATABASE_URL  direct/session deployment URL (direct is preferred)
  COOKIE_SECRET           stable random value of at least 32 characters
  METRICS_TOKEN           stable random bearer token of at least 32 characters

Install the pinned bootstrap dependency first:
  python3 -m pip install -r deploy/requirements.txt

Everything here is idempotent enough to re-run: it reuses a project/service with
the same name if one exists, and re-upserts variables.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlparse

RAILWAY_API = "https://backboard.railway.com/graphql/v2"
PROJECT = os.environ.get("RAILWAY_PROJECT", "omnischool-stage")
SERVICE = os.environ.get("RAILWAY_SERVICE", "omnischool")
ENVIRONMENT = os.environ.get("RAILWAY_ENVIRONMENT", "stage")
REGION = os.environ.get("RAILWAY_REGION", "asia-southeast1-eqsg3a")   # Singapore
GH_REPO = os.environ.get("GH_REPO", "EduveraIITA/Eduvera")
UPLOAD_MOUNT_PATH = "/app/storage/leave-documents"
TLS_MODES = {"require", "verify-ca", "verify-full"}


def need(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        sys.exit(f"{name} is required")
    return v


def postgres_url(name: str, *, persistent_session: bool) -> str:
    value = need(name)
    parsed = urlparse(value)
    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname:
        sys.exit(f"{name} must be a valid PostgreSQL URL")
    if parsed.hostname.lower() in {"localhost", "127.0.0.1", "::1"}:
        sys.exit(f"{name} must not point to a loopback host for stage")
    query = {key.lower(): values[-1].lower() for key, values in parse_qs(parsed.query).items() if values}
    if query.get("sslmode") not in TLS_MODES:
        sys.exit(f"{name} must set sslmode=require, verify-ca, or verify-full")
    try:
        port = parsed.port
    except ValueError:
        raise SystemExit(f"{name} contains an invalid port") from None
    if persistent_session and (port == 6543 or query.get("pgbouncer") == "true"):
        sys.exit(f"{name} cannot use transaction pooling")
    return value


def strong_secret(name: str) -> str:
    value = need(name)
    unsafe_markers = ("development-only", "change-me", "replace-with", "generate-a", "compose-demo", "omnidemo")
    invalid = (
        len(value) < 32
        or any(character.isspace() for character in value)
        or any(marker in value.lower() for marker in unsafe_markers)
    )
    if invalid:
        sys.exit(f"{name} must be a stable, unique random value of at least 32 characters")
    return value


def gql(query: str, variables: dict | None = None) -> dict:
    req = urllib.request.Request(
        RAILWAY_API,
        data=json.dumps({"query": query, "variables": variables or {}}).encode(),
        headers={
            "Authorization": f"Bearer {need('RAILWAY_ACCOUNT_TOKEN')}",
            "Content-Type": "application/json",
            "User-Agent": "omnischool-bootstrap/1.0",   # Railway's edge rejects the default urllib agent
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            body = json.loads(r.read())
    except urllib.error.HTTPError as e:  # type: ignore[attr-defined]
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode(errors='replace')[:400]}") from None
    if body.get("errors"):
        raise RuntimeError(json.dumps(body["errors"], indent=1))
    return body["data"]


def gh(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(
        "https://api.github.com" + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "Authorization": f"Bearer {need('GH_TOKEN')}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, (json.loads(r.read() or b"{}") if r.status != 204 else {})
    except urllib.error.HTTPError as e:  # type: ignore[attr-defined]
        return e.code, json.loads(e.read() or b"{}")


# ---------------------------------------------------------------- project + environment
def find_or_create_project() -> tuple[str, str]:
    # Works with both account tokens and workspace tokens (the latter cannot query `me`).
    data = gql("""query { projects { edges { node { id name environments { edges { node { id name } } } } } } }""")
    for edge in data["projects"]["edges"]:
        node = edge["node"]
        if node["name"] == PROJECT:
            envs = {e["node"]["name"]: e["node"]["id"] for e in node["environments"]["edges"]}
            env_id = envs.get(ENVIRONMENT)
            if not env_id:
                created = gql(
                    """mutation($input: EnvironmentCreateInput!) { environmentCreate(input: $input) { id name } }""",
                    {"input": {"projectId": node["id"], "name": ENVIRONMENT}},
                )["environmentCreate"]
                if created["name"] != ENVIRONMENT:
                    raise RuntimeError(f"Railway created unexpected environment {created['name']!r}")
                env_id = created["id"]
                print(f"environment created: {ENVIRONMENT} ({env_id})")
            print(f"project exists: {PROJECT} ({node['id']}) · environment {env_id}")
            return node["id"], env_id
    data = gql(
        """mutation($input: ProjectCreateInput!) { projectCreate(input: $input) { id environments { edges { node { id name } } } } }""",
        {"input": {"name": PROJECT, "defaultEnvironmentName": ENVIRONMENT}},
    )
    proj = data["projectCreate"]
    environments = {edge["node"]["name"]: edge["node"]["id"] for edge in proj["environments"]["edges"]}
    env_id = environments.get(ENVIRONMENT)
    if not env_id:
        raise RuntimeError(f"Railway project was created without the requested {ENVIRONMENT!r} environment")
    print(f"project created: {PROJECT} ({proj['id']}) · environment {env_id}")
    return proj["id"], env_id


def find_or_create_service(project_id: str, env_id: str) -> str:
    data = gql("""query($id: String!) { project(id: $id) { services { edges { node { id name } } } } }""", {"id": project_id})
    for edge in data["project"]["services"]["edges"]:
        if edge["node"]["name"] == SERVICE:
            print(f"service exists: {SERVICE} ({edge['node']['id']})")
            return edge["node"]["id"]
    data = gql(
        """mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }""",
        {"input": {"projectId": project_id, "environmentId": env_id, "name": SERVICE}},
    )
    print(f"service created: {SERVICE} ({data['serviceCreate']['id']})")
    return data["serviceCreate"]["id"]


def configure_service(service_id: str, env_id: str) -> None:
    """Region, Dockerfile and health check live on the service instance.
    railway.json config-as-code is deprecated, so this is the source of truth."""
    settings = {
        "multiRegionConfig": {REGION: {"numReplicas": 1}},   # a JSON scalar: keys are region ids
        "dockerfilePath": "backend/Dockerfile",              # setting this selects the Docker builder
        "healthcheckPath": "/readyz",
        "healthcheckTimeout": 180,
        "restartPolicyType": "ON_FAILURE",
        "restartPolicyMaxRetries": 5,
    }
    gql(
        """mutation($s: String!, $e: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $s, environmentId: $e, input: $input) }""",
        {"s": service_id, "e": env_id, "input": settings},
    )
    print(f"service configured: region {REGION}, backend/Dockerfile, /readyz")


def ensure_domain(project_id: str, service_id: str, env_id: str) -> str:
    data = gql(
        """query($p: String!, $s: String!, $e: String!) { domains(projectId: $p, serviceId: $s, environmentId: $e) { serviceDomains { domain } } }""",
        {"p": project_id, "s": service_id, "e": env_id},
    )
    existing = data["domains"]["serviceDomains"]
    if existing:
        print(f"domain exists: {existing[0]['domain']}")
        return existing[0]["domain"]
    data = gql(
        """mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }""",
        {"input": {"serviceId": service_id, "environmentId": env_id, "targetPort": 8000}},
    )
    print(f"domain created: {data['serviceDomainCreate']['domain']}")
    return data["serviceDomainCreate"]["domain"]


def ensure_volume(project_id: str, service_id: str, env_id: str) -> None:
    query = """query($id: String!) {
      project(id: $id) {
        volumes { edges { node {
          id name volumeInstances { edges { node { id serviceId environmentId mountPath region } } }
        } } }
      }
    }"""

    def instances() -> list[dict]:
        data = gql(query, {"id": project_id})
        return [
            instance["node"]
            for volume in data["project"]["volumes"]["edges"]
            for instance in volume["node"]["volumeInstances"]["edges"]
        ]

    existing = [item for item in instances() if item["serviceId"] == service_id and item["environmentId"] == env_id]
    if existing:
        item = existing[0]
        if item["mountPath"] != UPLOAD_MOUNT_PATH or item["region"] != REGION:
            raise RuntimeError("The existing uploads volume is attached to the wrong mount path or region")
        print(f"volume verified at {UPLOAD_MOUNT_PATH} in {REGION}")
        return

    gql(
        """mutation($input: VolumeCreateInput!) { volumeCreate(input: $input) { id } }""",
        {"input": {"projectId": project_id, "environmentId": env_id, "serviceId": service_id, "mountPath": UPLOAD_MOUNT_PATH, "region": REGION}},
    )
    created = [item for item in instances() if item["serviceId"] == service_id and item["environmentId"] == env_id]
    if not created or created[0]["mountPath"] != UPLOAD_MOUNT_PATH or created[0]["region"] != REGION:
        raise RuntimeError("Railway did not attach the uploads volume to the expected service, environment, path, and region")
    print(f"volume created and verified at {UPLOAD_MOUNT_PATH} in {REGION}")


def set_variables(
    project_id: str,
    service_id: str,
    env_id: str,
    public_url: str,
    database_url: str,
    event_database_url: str,
    stable_cookie_secret: str,
    metrics_token: str,
) -> None:
    variables = {
        "DATABASE_URL": database_url,
        "EVENT_DATABASE_URL": event_database_url,
        "COOKIE_SECRET": stable_cookie_secret,
        "METRICS_TOKEN": metrics_token,
        "COOKIE_SECURE": "true",
        "TRUST_PROXY": "true",
        "ALLOWED_ORIGINS": public_url,
        "PUBLIC_URL": public_url,
        "DEPLOYMENT_ENVIRONMENT": "stage",
        "RELEASE_SHA": "bootstrap-pending",
        "DEMO_MODE": "false",
        "RATE_LIMIT_STORE": "postgres",
        "AI_PROVIDER": "mock",
        "LOG_LEVEL": "info",
        "DATABASE_POOL_MAX": "5",
        "EVENT_BROKER_CONNECT_TIMEOUT_MS": "5000",
        "EVENT_CLEANUP_BATCH_SIZE": "1000",
        "PORT": "8000",   # Railway injects its own PORT otherwise; the domain targets 8000
    }
    gql(
        """mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }""",
        {"input": {"projectId": project_id, "environmentId": env_id, "serviceId": service_id, "variables": variables, "skipDeploys": True}},
    )
    print(f"variables set ({len(variables)})")


def project_token(project_id: str, env_id: str) -> str:
    data = gql(
        """mutation($input: ProjectTokenCreateInput!) { projectTokenCreate(input: $input) }""",
        {"input": {"projectId": project_id, "environmentId": env_id, "name": "github-actions"}},
    )
    print("project token created for GitHub Actions")
    return data["projectTokenCreate"]


def store_in_github(
    token: str,
    migration_database_url: str,
    metrics_token: str,
    public_url: str,
    project_id: str,
) -> None:
    from nacl import encoding, public  # PyNaCl

    status, key = gh("GET", f"/repos/{GH_REPO}/actions/secrets/public-key")
    if status != 200 or not key.get("key") or not key.get("key_id"):
        raise RuntimeError(f"Unable to read the GitHub Actions public key (HTTP {status})")
    box = public.SealedBox(public.PublicKey(key["key"].encode(), encoding.Base64Encoder()))

    secrets_to_store = (
        ("RAILWAY_TOKEN", token),
        ("MIGRATION_DATABASE_URL", migration_database_url),
        ("METRICS_TOKEN", metrics_token),
    )
    for name, value in secrets_to_store:
        sealed = base64.b64encode(box.encrypt(value.encode())).decode()
        status, _ = gh(
            "PUT",
            f"/repos/{GH_REPO}/actions/secrets/{name}",
            {"encrypted_value": sealed, "key_id": key["key_id"]},
        )
        if status not in (201, 204):
            raise RuntimeError(f"Unable to store GitHub Actions secret {name} (HTTP {status})")
        print(f"GitHub secret {name} stored")

    variables = (
        ("STAGE_URL", public_url),
        ("RAILWAY_PROJECT_ID", project_id),
        ("RAILWAY_SERVICE", SERVICE),
        ("RAILWAY_ENVIRONMENT", ENVIRONMENT),
    )
    for name, value in variables:
        st, _ = gh("PATCH", f"/repos/{GH_REPO}/actions/variables/{name}", {"name": name, "value": value})
        if st == 404:
            st, _ = gh("POST", f"/repos/{GH_REPO}/actions/variables", {"name": name, "value": value})
        if st not in (201, 204):
            raise RuntimeError(f"Unable to store GitHub Actions variable {name} (HTTP {st})")
        print(f"GitHub variable {name} stored")


def main() -> None:
    # Validate every local prerequisite before creating or changing remote resources.
    if ENVIRONMENT != "stage":
        sys.exit("RAILWAY_ENVIRONMENT must be exactly 'stage' for this stage bootstrap")
    try:
        import nacl  # noqa: F401
    except ModuleNotFoundError:
        sys.exit("PyNaCl is required; run: python3 -m pip install -r deploy/requirements.txt")
    need("RAILWAY_ACCOUNT_TOKEN")
    need("GH_TOKEN")
    database_url = postgres_url("DATABASE_URL", persistent_session=False)
    event_database_url = postgres_url("EVENT_DATABASE_URL", persistent_session=True)
    migration_database_url = postgres_url("MIGRATION_DATABASE_URL", persistent_session=True)
    stable_cookie_secret = strong_secret("COOKIE_SECRET")
    metrics_token = strong_secret("METRICS_TOKEN")
    if metrics_token == stable_cookie_secret:
        sys.exit("METRICS_TOKEN and COOKIE_SECRET must be different values")

    project_id, env_id = find_or_create_project()
    service_id = find_or_create_service(project_id, env_id)
    configure_service(service_id, env_id)
    domain = ensure_domain(project_id, service_id, env_id)
    public_url = f"https://{domain}"
    ensure_volume(project_id, service_id, env_id)
    set_variables(
        project_id,
        service_id,
        env_id,
        public_url,
        database_url,
        event_database_url,
        stable_cookie_secret,
        metrics_token,
    )
    token = project_token(project_id, env_id)
    store_in_github(token, migration_database_url, metrics_token, public_url, project_id)
    print()
    print(f"Done. Push to Stage (or run the workflow) and the site appears at {public_url}")
    print(f"  mobile   {public_url}/")
    print(f"  desktop  {public_url}/staff/")
    print(f"  api      {public_url}/api/docs")


if __name__ == "__main__":
    main()
