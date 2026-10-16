# Login Threads rendering — 16 October 2026

## Current background: Topography

At the user's request, both login layouts now render React Bits Topography
instead of Threads. The upstream JavaScript/CSS source and its MIT + Commons
Clause license are colocated with a TypeScript declaration. Source:
https://github.com/DavidHDev/react-bits/tree/main/src/content/Backgrounds/Topography

The shared login preset uses the requested 22 contours, elevation 1, foreground
0.2, tilt 32 degrees, forward travel at 0.25, lift hover and pulse clicks. Thin
0.75px theme-blue contours use light mode and reduced opacity/glow so the existing
translucent form stays readable. The full-viewport gradient, login-only shell
width override and positive background layering remain in place.

Local changes add render-readiness reporting, safe context loss/restoration,
rotation and visual-viewport resize listeners, and live reduced-motion updates.
Rendering is capped at 1920px and 1.5 million pixels. Animated SVG contour maps
remain visible when WebGL is unavailable or lost; reduced motion pauses them.

Validation: both production builds and changed TypeScript lint passed. Browser
checks passed both login routes at phone, iPad portrait/landscape and desktop
sizes, verifying edge-to-edge background, no overflow, moving WebGL rendering,
unavailable-WebGL fallback, contour morphing and reduced-motion pause. Physical
iPad verification remains outstanding. This version deployed successfully in
https://github.com/EduveraIITA/Eduvera/actions/runs/38859310286
Live checks on app.thatcampus.com passed both login routes, phone/iPad/desktop
viewport coverage, moving WebGL rendering and animated fallback contours. A
focused reduced-motion check confirmed the SVG pauses and resumes; it waits for
animationsPaused() before comparing geometry to avoid an asynchronous media-event
race in the initial assertion.

## Prior implementation history

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
