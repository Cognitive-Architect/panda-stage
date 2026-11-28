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

## d3/d3-ease

- Upstream: https://github.com/d3/d3-ease
- Documentation reference: https://d3js.org/d3-ease
- Upstream license file: https://github.com/d3/d3-ease/blob/main/LICENSE
- Reference source files: `src/sin.js`, `src/cubic.js`, `src/circle.js`,
  `src/poly.js` (quint / exponent 5), `src/back.js` (default overshoot
  `1.70158`), and `src/bounce.js`
- Provenance note: adapted from the upstream `d3/d3-ease` `main` formulas and
  documentation without adding an npm package dependency or pinning a package
  release tarball
- Panda implementation: `src/domain/geometry/richEasing.ts`
- Packaged binary distribution notice: `resources/licenses/D3-EASE-NOTICE.txt`
  (copied into packaged Windows builds under `licenses/` by
  `electron-builder.yml`)

### License text (BSD 3-Clause)

```text
Copyright 2010-2026 Mike Bostock
Copyright 2001 Robert Penner
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the author nor the names of contributors may be used to
  endorse or promote products derived from this software without specific prior
  written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## excalidraw/excalidraw

- Upstream: https://github.com/excalidraw/excalidraw
- Upstream license file: https://github.com/excalidraw/excalidraw/blob/dabd83c4aa6b9e42d0dd0a42be62200eb8e3cce9/LICENSE
- Reference source files:
  - `packages/element/src/align.ts`
  - `packages/element/src/distribute.ts`
- Reference revision: `dabd83c4aa6b9e42d0dd0a42be62200eb8e3cce9`
- Panda implementation: `src/domain/layout/excalidrawBoundsMath.ts`

### What Panda reuses

Panda adapts Excalidraw's pure bounding-box alignment (`start`/`center`/`end`
along X/Y) and distribution (center-sorted equal-gap distribution with
center-distribution fallback on negative gaps) math without importing
Excalidraw's scene mutation, whiteboard bindings, or runtime store.

### License text (MIT)

```text
MIT License

Copyright (c) 2020 Excalidraw

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
