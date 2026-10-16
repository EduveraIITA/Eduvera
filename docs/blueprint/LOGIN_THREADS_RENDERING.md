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

## Edge-to-edge colour and fluid motion

The 16 October iPad screenshot identified a separate colour boundary: the mobile
app's shared `.app-viewport` retained its 780px width and shadow while the fixed
canvas extended beyond it. The login alone now expands that parent to viewport
width and removes its shadow. The gradient also belongs to the fixed background.
Other app screens retain their existing width. Validation checks the login and
its outer container, rather than only the canvas, at 320–1920px on both clients.

WebGL strands use a 0.65 CSS-pixel half-width with device-ratio scaling, faster
continuous noise evolution and slightly wider waves. Fallback paths now morph
smoothly using SVG animation, with non-scaling 0.65px strokes. Reduced motion
pauses both SVG morphing and the existing drift. Local browser checks verified
edge-to-edge colour, no horizontal overflow, WebGL movement, fallback shape
changes and reduced-motion pause. Physical iPad verification remains outstanding.
