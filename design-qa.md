# Gate QR scanner responsive QA

- Source visual truth: `/tmp/codex-remote-attachments/01a08c7f-eb32-70a1-90ed-c731d4ea3352/7ED95DA7-9E32-4A24-99CE-838AF4EFE228/1-Photo-1.jpg`
- Source pixels: 590 × 1274, mobile browser capture; CSS viewport and device density are not available from the attachment metadata.
- Implementation target: `frontend/src/features/gate/QRScanner.tsx` with `frontend/src/features/gate/gate.css`
- Intended viewport: narrow mobile, 320–580 CSS px
- State: authenticated Gate & Safety → Scan QR, active rear camera

## Full-view comparison evidence

The source capture shows a P0 horizontal-overflow failure: the scanner card extends
beyond the right viewport edge, the camera crop and scan frame are incomplete, the
instruction text is clipped, and a native file input appears beside the intended
Flashlight action. The implementation now establishes shrinkable grid/card/camera
boundaries, a width-bounded block video, wrapping controls, and an element-level
hidden file input behind the Gallery action.

A post-fix browser screenshot could not be captured in the same authenticated state:
the available local browser session is signed out and its synthetic public-demo
endpoint is unavailable in the running local backend. No credentials or production
session were bypassed for visual verification.

## Focused region comparison evidence

The source scanner region was inspected at original resolution. Code-level evidence
and focused tests confirm that the native file input is hidden and that the named
Gallery control remains accessible. A same-state post-fix pixel comparison remains
blocked until an authenticated mobile session loads the deployed scanner.

## Findings and comparison history

- P0 resolved in code: intrinsic-width overflow in the scanner grid, card, camera,
  viewfinder and video surfaces.
- P1 resolved in code: exposed native file input duplicated the Gallery action.
- P2 resolved in code: narrow-screen controls could not wrap and scan-frame radius/
  inset were sized for the wider layout.
- Remaining gate: deployed physical-phone visual confirmation at the source state.

## Required fidelity surfaces

- Fonts and typography: existing ThatCampus type tokens and hierarchy are unchanged;
  heading/supporting copy can now wrap within the available width.
- Spacing and layout rhythm: scanner/card padding, mobile gaps and frame inset are
  bounded at the narrow breakpoint; post-fix pixel confirmation is pending.
- Colors and visual tokens: existing semantic brand, surface, border and positive
  tokens are unchanged.
- Image quality and asset fidelity: live camera video remains `object-fit: cover` and
  is no longer allowed to exceed its viewfinder.
- Copy and content: existing English/Hindi copy is unchanged; the native browser
  file-control text is removed from the visible interface.

## Primary interactions checked

- Gallery action remains present and labelled.
- Hidden upload input remains programmatically addressable by that action.
- Existing Gate scan and movement tests remain green.
- Console-error inspection and same-state browser capture: blocked by unavailable
  authenticated local session.

final result: blocked
