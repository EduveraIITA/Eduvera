# ThatCampus marketing site

The uploaded Stitch design is the source of truth for the marketing website. The static export is maintained separately from the Eduera application. Login must link to the current Eduera /login endpoint.

## Integration requirements
- Preserve the supplied Stitch layout, palette and typography.
- Replace synthetic dashboard illustrations with authentic screenshots captured from the actual Eduera application, after removing student names, contact details and other sensitive information.
- Keep screenshots as static, optimized WebP assets. Do not embed authenticated app pages or expose demo credentials.
- Deploy the marketing site separately from the existing Cloud Run application.
- Keep the existing app operational and use its current login page.

## Deployment
Use a separate Cloud Run service and configure thatcampus.com after testing its temporary URL.
