# Third-Party Notices

This file records upstream sources that materially informed Panda Stage code.
It is intentionally small: only sources with a concrete implementation or
compatibility relationship belong here.

## lifeart/fla-viewer

- Upstream: https://github.com/lifeart/fla-viewer
- License declared by upstream: ISC (`package.json`)
- Reference file: `src/symbol-loop.ts`
- Reference revision used for the 2026-11-15 provenance audit:
  `b14fa1d1e3e2d2b035e174bde472a7941d385b17`
- Panda implementation:
  `src/shared/fla-graphic-playback.ts`

### What Panda reuses

Panda's `evaluateFlaGraphicFrame()` follows the behavior of fla-viewer's
`graphicSymbolFrame()` for Animate Graphic playback:

- Loop
- Play Once
- Single Frame
- Loop Reverse
- Play Once Reverse
- `firstFrame`
- optional `lastFrame`
- wrap/hold behavior at playback boundaries

Panda keeps this as a small adapted implementation rather than importing the
viewer as a runtime dependency. Panda adds project-level validation and returns
an explicit error result for malformed frame inputs instead of relying on the
viewer's normalization behavior.

The Graphic evaluator, Character integration, History wiring, Stage/Preview/
Export integration, persistence schema, and UI are Panda Stage code.

### License note

The reviewed fla-viewer revision declares `"license": "ISC"` in its
`package.json`. At that revision the repository root does not contain a
standalone `LICENSE` file, so this notice records the upstream project,
declared license identifier, reference file, and reviewed revision without
inventing a license text or copyright notice that is not present upstream.

If a future fla-viewer revision adds or changes its license notice, update this
record before copying additional implementation code.

## Semantic references (no source code copied for the P1 Character adapter)

The STRUCT-05 P1 design was also checked against these projects for behavior and
architecture:

- Flare: https://github.com/Flare-Animate/Flare — BSD-3-Clause
- AniCraft: https://github.com/storytold/anicraft — Apache-2.0

For P1 these projects are semantic/architecture references (Definition /
Instance playback, undoable edits, and shared evaluation), not vendored source
code.
