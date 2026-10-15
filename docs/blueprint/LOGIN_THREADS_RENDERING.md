# Login Threads rendering — 16 October 2026

The user reported a blank iPad background despite passing Chromium viewport checks.
Both login clients now put the background on layer 0 and content on layer 1,
avoiding a negative canvas layer. An animated SVG thread fallback is visible
until WebGL renders successfully, when WebGL is unavailable, and after context
loss. Context restoration reinitializes the GPU renderer. Reduced motion stops
the SVG drift. Viewport, browser chrome and rotation resize handling is retained.

Validation: both production builds and changed-file ESLint passed. Browser checks
passed portrait/landscape sizes, WebGL pixel coverage, forced context loss,
unavailable WebGL, animated fallback and reduced-motion fallback. These checks
used Chromium. WebKit installation lacked required host libraries; a physical
iPad/Safari result remains unverified. Deployment verification is pending.
