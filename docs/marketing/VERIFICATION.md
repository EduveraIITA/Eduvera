# ThatCampus verification — 14 October 2026

## Delivered

Merged PR: https://github.com/EduveraIITA/Eduvera/pull/29

Merged release: `e1c00815f4adc0de9c785f9b0d42f3a72332efcd`.
The marketing site is separate from the authenticated app. Direct Login remains:
https://eduvera-stage-367469594690.asia-south1.run.app/login

Implemented: responsive marketing pages, original transparent logo, configurable
Login, honest feature descriptions, labelled sample previews, role/solution views,
pricing enquiry, secured PostgreSQL demo form, notification outbox using the
existing email transport, company-operator review/status/audit UI, prerendered
SEO/legal pages, metadata, robots/sitemap, security headers and analytics hooks.

## Verified evidence

- Full application regression retry: **812 backend tests and 934 frontend tests
  passed**, with mobile and desktop type checks/builds and repository secret scan.
  https://github.com/EduveraIITA/Eduvera/actions/runs/38595007546
- Merged website CI passed TypeScript, lint, build, **8 HTTP/security/deployment
  configuration tests**, real PostgreSQL form storage/outbox and Chromium checks
  at desktop 1440px, tablet 768px and mobile 360px. Navigation, Login, interactive
  previews, legal page and absence of horizontal overflow were checked. Screenshots
  are attached to the run as `thatcampus-viewport-checks`.
  https://github.com/EduveraIITA/Eduvera/actions/runs/38598878027
- The merged Stage release passed all verification and deployed the existing
  application, applied migrations, verified its candidate and verified its public
  service. The release log confirms `Verified Stage e1c00815...` at
  https://eduvera-stage-367469594690.asia-south1.run.app.
  https://github.com/EduveraIITA/Eduvera/actions/runs/38598878117
- The marketing image was built and uploaded:
  `asia-south1-docker.pkg.dev/eduera-511111/eduera/thatcampus:e1c00815f4adc0de9c785f9b0d42f3a72332efcd`.
- Local dependency audit reported zero known vulnerabilities in the new marketing
  dependency tree, including build dependencies.

## Exact deployment blocker

The separate website deployment stopped before service creation because
`github-stage-deploy@eduera-511111.iam.gserviceaccount.com` was denied
`secretmanager.secrets.get` and `secretmanager.secrets.create` for the new
`thatcampus-form-secret`. The existing application deployment had already passed.
There is **no verified public marketing URL yet**. No DNS records were changed.

A Google Cloud project administrator can complete the one-time bootstrap from
Cloud Shell without sharing credentials in chat:

```sh
git clone --branch Stage --single-branch https://github.com/EduveraIITA/Eduvera.git thatcampus-release
cd thatcampus-release
bash marketing/bootstrap-cloud-shell.sh e1c00815f4adc0de9c785f9b0d42f3a72332efcd
```

The bootstrap generates the independent form secret through stdin, grants the
runtime access to its value, grants the CI account metadata-only access, deploys
and verifies the already uploaded image, then scopes future CI Cloud Run admin
access to the new website service. It does not edit the existing app or registrar
DNS. The administrator must have permission to create secrets, grant those policies,
deploy the new service and use the existing runtime service account.

## Remaining release actions

1. Run the bootstrap and verify its literal returned HTTPS service URL. Public
   form submission on that Cloud Run URL still requires deployed-environment
   verification; CI database storage is verified separately.
2. Set the actual sales inbox as `MARKETING_NOTIFY_TO` on the existing backend.
   Verify a real notification through its configured SMTP/Resend service. No
   recipient was invented; delivery has not been claimed.
3. Complete Google domain ownership and the supported custom-domain/load-balancer
   HTTPS flow, then use Google's exact returned DNS records in the authoritative
   DNS account. See DEPLOYMENT.md. Apex and www HTTPS have not been configured or
   verified. app.thatcampus.com remains unmodified.
4. Review the working website on the final URL, including the demo form and legal
   content. University suitability and online payment sandbox limits are disclosed.
