# Assistant focus and latest-reply icon — 18 October 2026

Owner request: remove the square outer focus outline and show the existing moving
Assistant mark immediately above the highlighted latest full-screen reply.

- Add an explicit `.assistant-dock:focus-visible` override so the global focus
  selector cannot draw a rectangle around both response and composer.
- Retain programmatic panel focus, Escape handling and focus rings on controls.
- Reuse the existing animated SVG component, including its reduced-motion fallback;
  only the latest full-screen reply gets the mark and flowing border.
- Preserve earlier replies, composer, navigation labels and permissions.

Validation: nine focused component tests pass. Hosted deployment and owner visual
acceptance remain separate gates; the generated placement image is a mockup only.

Owner spacing refinement: reduce the icon-to-latest-response grid gap from 12px to
6px. Preserve icon size, floating motion, response border and all other spacing.
