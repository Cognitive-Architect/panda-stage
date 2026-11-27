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

### Additional FLA Viewer evaluator provenance

Panda Stage's bounded XFL evaluator reimplements selected behavior studied at the fixed upstream revision [`lifeart/fla-viewer@b14fa1d1e3e2d2b035e174bde472a7941d385b17`](https://github.com/lifeart/fla-viewer/tree/b14fa1d1e3e2d2b035e174bde472a7941d385b17): Graphic playback in `src/symbol-loop.ts`, Classic Motion transform interpolation and matrix helpers in `src/layer-utils.ts`, and tween metadata/easing plus Rig matrix correction in `src/fla-parser.ts` and `src/renderer.ts`. Rigged child endpoint matrices are localized against their parent endpoint poses, interpolated in parent space, then composed with the parent's current pose; the adapter does not import the viewer renderer.

That revision's `package.json` declares `ISC` and its README carries an ISC badge, but no standalone `LICENSE` file is present at the pinned revision. This is `LICENSE_INTENT_ONLY` provenance, consistent with the prior repository review recorded in Issues #249 and #250; no separate upstream license text was available to copy. The Panda implementation is an independent adapter with explicit input validation and does not import the viewer's parser or renderer.

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

## Flare Classic Motion Sync behavior

Panda Stage's bounded nested Graphic playback adapts the Classic Motion Sync, Snap option, Rig parenting, and pivot-preserving interpolation behavior from [`Flare-Animate/Flare@a1f025f93f21df17c3de4d14d233880bb3838de5`](https://github.com/Flare-Animate/Flare/tree/a1f025f93f21df17c3de4d14d233880bb3838de5), principally `original/flare/sources/flarelib/model.rs` (`sync_first_frames`), `original/flare/sources/common/flash/ac_xfl_read.rs` (Classic Motion, Sync, and Snap metadata), `original/flare/sources/flarelib/mm_layer_tree.rs` (`rig_parent`), `original/flare/sources/flarelib/mm_layer_motion.rs` (`rig` / `object`), and `original/flare/sources/flarelib/mm_display.rs` (`lerp_instance`). Snap is read independently from `tweenType`; Rig ids are resolved from each `DOMFrame.parentLayerIndex` to a `DOMLayer.layerRiggingIndex`; the bounded runtime applies the parent's pose delta with a maximum parent depth of eight. Interior Classic Motion frames keep the authored pivot on the straight path between endpoint world positions while preserving the original endpoint matrices. Only normal Rig layers with one visible Graphic parent object and invertible endpoint poses are evaluated. The Panda implementation is a TypeScript adapter over its existing XFL frame and display-list model; it does not include or execute Flare's engine.

The upstream source is distributed under the BSD 3-Clause License. Its license text is reproduced below.

Copyright (c) 2016-2023, John Dancel (manongjohn)
Copyright (c) 2016-2026, DWANGO Co., Ltd.
Copyright (c) 2016-2026, the respective contributors
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
