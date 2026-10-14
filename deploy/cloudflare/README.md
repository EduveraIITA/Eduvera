# ThatCampus Cloudflare edge

Cloudflare terminates HTTPS for the two public surfaces while preserving separate Cloud Run origins:

- `thatcampus.com` serves the marketing website.
- `app.thatcampus.com` serves the school application.
- `www.thatcampus.com` permanently redirects to the marketing apex.

The Worker is intentionally a thin streaming reverse proxy. Application authorization, tenant isolation, action review and audit remain in the NestJS application. Static app assets have their browser `Origin` removed before the origin fetch because they require no CORS authorization; API requests preserve it for the application to enforce.

## Release and verification

1. Run `npm test` in this directory.
2. Run `npm run deploy` from an authenticated, reviewed Cloudflare session only when the edge routing itself changes.
3. Verify the homepage Login link resolves to `https://app.thatcampus.com/login` and the login UI renders.
4. Verify `www` redirects to the apex and both public hosts pass their readiness checks.

Normal pushes to `Stage` do not need a Worker deployment. The Stage workflow builds, tests and deploys both Cloud Run services; their fixed origin URLs remain behind this Worker, so successful promotions become visible on `thatcampus.com` and `app.thatcampus.com` automatically.
