# Third-party notices

## FLA Viewer evaluator behavior

Panda Stage's bounded XFL evaluator reimplements selected behavior studied at the fixed upstream revision [`lifeart/fla-viewer@b14fa1d1e3e2d2b035e174bde472a7941d385b17`](https://github.com/lifeart/fla-viewer/tree/b14fa1d1e3e2d2b035e174bde472a7941d385b17): Graphic playback in `src/symbol-loop.ts`, Classic Motion transform interpolation in `src/layer-utils.ts`, and tween metadata/easing behavior in `src/fla-parser.ts` and `src/renderer.ts`.

That revision's `package.json` declares `ISC` and its README carries an ISC badge, but no standalone `LICENSE` file is present at the pinned revision. This is `LICENSE_INTENT_ONLY` provenance, consistent with the prior repository review recorded in Issues #249 and #250; no separate upstream license text was available to copy. The Panda implementation is an independent adapter with explicit input validation and does not import the viewer's parser or renderer.
