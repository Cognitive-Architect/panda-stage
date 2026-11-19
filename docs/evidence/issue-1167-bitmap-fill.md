# Issue #1167 bitmap fill verification

[Issue #1167](https://github.com/Cognitive-Architect/panda-stage/issues/1167) · [Pinned reference parser](https://github.com/lifeart/fla-viewer/blob/b14fa1d1e3e2d2b035e174bde472a7941d385b17/src/fla-parser.ts) · [Pinned reference renderer](https://github.com/lifeart/fla-viewer/blob/b14fa1d1e3e2d2b035e174bde472a7941d385b17/src/renderer.ts)

C-real is the specified FLA ending in `5c942dcda1cb44afb482ee39b7c33639`.
The baseline catalog rejected its carpet Graphic with
`FillStyle 1 uses unsupported bitmap fill`. The source contains three
repeating fills sharing a 507 by 497 bitmap.

The linear matrix coefficients are in twips per image pixel and are divided by
20. Translation is already in shape-local pixels. For the first fill, the
authored `ty=-113` is within 0.05 px of the contour's top at `-112.95`.
The authored scale `a=29.1982879638672` maps the 507 px image width to
approximately 740.18 px, matching the 740.20 px contour width. The other
fills' authored translations are within 0.35 px of their contour origins.

Windows Electron 43.1.1 produced a 2229 by 734 Graphic preview and a 1920 by
1080 scene preview from the production inspection, SVG composition, and
sandboxed rasterization path. All three patterns resolved and the original
FLA hash was unchanged. A Canvas comparison using the same authored
transforms and contour geometry matched all 19,634 sampled opaque interior
pixels within a per-channel tolerance of 15. This comparison covers visible
bitmap paint and excludes transparent or partially transparent edges.

Synthetic pixel checks covered repeat, one draw clipped to shape geometry,
nearest-neighbor sampling, and a non-diagonal bitmap matrix under two nested
parent transforms. Unit coverage also checks shared image deduplication,
malformed matrices and PNG dimensions, and local recovery for missing fill
media. The existing solid, linear, and radial fill tests passed.

**OWNER visual acceptance: PASS.** The owner reviewed and accepted the C-real Graphic and scene previews.
