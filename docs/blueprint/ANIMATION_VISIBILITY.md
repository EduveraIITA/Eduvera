# Animation visibility refinements — 16 October 2026

The user reported blank areas in the login Threads animation and an electric
chat border whose movement was not visible. Both changes retain the existing UI.

Threads now uses 160 strands with an overscanned band and anchors its outer
strands by tapering wave displacement to zero at the band edges. The projected
band extends past all viewport corners; existing resize/orientation listeners
remain. Both mobile and separate desktop renderers receive the same change.
Transparent login header/footer surfaces let the pattern show behind them.

The shared responsive assistant uses two blue strands at speed 0.8, chaos 0.3
and spread 0.22, with a 1.2px core and slightly stronger glow. Light-mode core
whitening is reduced so the moving current remains blue against white cards.
No arcs or interaction surges are added. Reduced-motion remains static.

Validation: frontend production build and 7 focused assistant interaction tests
passed. Desktop build and projected viewport corner checks are also run for
this slice. Browser visual verification could not run: local Chromium launch
was blocked by the environment's socket restriction. Live deployment remains
pending until the public release endpoint reports the merged revision.
