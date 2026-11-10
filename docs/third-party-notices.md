# Third-party notices

## FLA Viewer evaluator behavior

Panda Stage's bounded XFL evaluator reimplements selected behavior studied at the fixed upstream revision [`lifeart/fla-viewer@b14fa1d1e3e2d2b035e174bde472a7941d385b17`](https://github.com/lifeart/fla-viewer/tree/b14fa1d1e3e2d2b035e174bde472a7941d385b17): Graphic playback in `src/symbol-loop.ts`, Classic Motion transform interpolation and matrix helpers in `src/layer-utils.ts`, and tween metadata/easing plus Rig matrix correction in `src/fla-parser.ts` and `src/renderer.ts`. Rigged child endpoint matrices are localized against their parent endpoint poses, interpolated in parent space, then composed with the parent's current pose; the adapter does not import the viewer renderer.

That revision's `package.json` declares `ISC` and its README carries an ISC badge, but no standalone `LICENSE` file is present at the pinned revision. This is `LICENSE_INTENT_ONLY` provenance, consistent with the prior repository review recorded in Issues #249 and #250; no separate upstream license text was available to copy. The Panda implementation is an independent adapter with explicit input validation and does not import the viewer's parser or renderer.

## Flare Classic Motion Sync behavior

Panda Stage's bounded nested Graphic playback adapts the Classic Motion Sync, Snap option, and Rig parenting behavior from [`Flare-Animate/Flare@a1f025f93f21df17c3de4d14d233880bb3838de5`](https://github.com/Flare-Animate/Flare/tree/a1f025f93f21df17c3de4d14d233880bb3838de5), principally `original/flare/sources/flarelib/model.rs` (`sync_first_frames`), `original/flare/sources/common/flash/ac_xfl_read.rs` (Classic Motion, Sync, and Snap metadata), `original/flare/sources/flarelib/mm_layer_tree.rs` (`rig_parent`), and `original/flare/sources/flarelib/mm_layer_motion.rs` (`rig` / `object`). Snap is read independently from `tweenType`; Rig ids are resolved from each `DOMFrame.parentLayerIndex` to a `DOMLayer.layerRiggingIndex`; the bounded runtime applies the parent's pose delta with a maximum parent depth of eight. Only normal Rig layers with one visible Graphic parent object and invertible endpoint poses are evaluated. The Panda implementation is a TypeScript adapter over its existing XFL frame and display-list model; it does not include or execute Flare's engine.

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
