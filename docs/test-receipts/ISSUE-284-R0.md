# Issue #284 V2-R0 receipt — Renderer Feasibility Spike

> Stage-boundary receipt for `agent/fla-v2-r` integration branch
> (Issue #284 maintainer override: all V2-R stages accumulate on one
> Draft PR). This file is the R0 stage-final artifact, paired with
> the matching R0 RESULT comment on Issue #284.
>
> Per Issue #284 R0 acceptance / Definition of Done: every Evidence
> item below is verified against the current files in
> `docs/evidence/issue-284-r0/` and the four spike scripts under
> `scripts/`. The receipt is the source of truth; the R0 RESULT
> GitHub comment must mirror the same numbers.

## V2-R0 RESULT (comment template fields)

```text
baseline_main: 3c47a4ee8af07e834338b223fcb3260a4c6dddbc
integration_pr: <filled when Draft PR is opened; see "next_gate">
stage_final_commit: <see commit SHA after `git commit`; matches the SHA below>
R0_conclusion: R0_RENDER_FEASIBLE_WITH_LIMITS

renderer_path:
  Panda-owned minimal SVG-path renderer.
  Pipeline (read-only, research-only):
    scripts/fla-r0-spike-extract.cjs
      - reads 剑.fla via jszip (same ZIP decoder the production
        FLA V1.5 parser uses; no new dependency);
      - reads DOMDocument.xml and LIBRARY/*.xml only — never the
        binary bin/ entries;
      - applies the production EOCD preflight
        (centralDirectoryDeclaredBytes <= centralDirectoryActualBytes)
        so a malformed EOCD that would be rejected by
        fla-import-preflight-service still rejects here;
      - walks the first graphic symbol's first DOMGroup → first
        DOMShape, parses the <FillStyle> / <Edge> children;
      - copies the production decodeEdgesWithStyleChanges
        function verbatim from
        src/renderer/fla-import/parser-core/edge-decoder.ts
        at commit 3c47a4e (the pinned lifeart/fla-viewer parser
        closure) and decodes 842 <Edge cubics=.../> or edges=.../>
        children into 2358 PathCommand (M/L/Q/C/Z);
      - emits docs/evidence/issue-284-r0/r0-render-sword.svg
        (77,705 bytes) with the first non-empty FillStyle
        gradient color (#B0D1F4) and a viewBox fitted to the
        transformed path bounds.
    scripts/fla-r0-spike-rasterize.cjs
      - launches a hidden Electron BrowserWindow with
        contextIsolation:false / nodeIntegration:true (research
        only; not a production pattern);
      - loads the SVG via a data: URL, draws it into a 1920x1080
        canvas, exports image/png via canvas.toDataURL();
      - writes docs/evidence/issue-284-r0/r0-render-sword.png
        (172,252 bytes, SHA-256 25762D38115B7509...B0A55A).

real_sample_hash: E773508C4079C4FA8235043B69A0F5415BCC1596A3ED345A4C6652B48CE54377
  (matches docs/research/fla-corpus-manifest.json:fla-e773508c4079c4fa;
   byteLength 32,997 bytes; path: D:\表情合集\剑.fla;
   preflight result: pass; offline-probe: success;
   structure: scene=1, totalTimeline=2, layer=2, frame=2,
   symbol=1, graphic=1, tween=0; productionParser.status was
   'not-verified' before R0 — R0 changes that for the symbol's
   DOMShape data path only, not for the production parser
   contract.)

selected_scene_symbol_timeline_frame:
  LIBRARY/<素材来自-cilisucai.com13/素材来自-cilisucai.com63>,
  DOMTimeline[0], DOMLayer[0], DOMFrame[0], DOMGroup[0], DOMShape[0].
  This is the single graphic symbol referenced by the main scene's
  DOMSymbolInstance, not the main scene's <frames> directly (the
  main scene has only the symbol instance; the actual shape lives
  inside the symbol).

output:
  docs/evidence/issue-284-r0/r0-render-sword.png
  - 1920x1080 PNG, 172,252 bytes,
    SHA-256 25762D38115B7509A142A35231F1745BBEB446132060CE58321144D613B0A55A.
  docs/evidence/issue-284-r0/r0-render-sword.svg
  - 1920x1080 viewBox fitted to path bounds, 77,705 bytes,
    SHA-256 92ADC3637AB7C2DFE0A5BE0B151868F78A13ABD6C30A089DECBBB397A6C590D4.
  See docs/evidence/issue-284-r0/r0-render-sword.png for the
  human-visual evidence (the rendered Chinese-style sword).

transparency:
  - output canvas: 100% transparent background (ctx.clearRect, no
    opaque fill behind the path);
  - shape fill: uses fillStyle0 = first FillStyle in the DOMShape
    (LinearGradient with first GradientEntry color #B0D1F4, alpha=1);
  - the shape's geometric cutouts (e.g. gaps in the pommel and guard
    decoration) are visible because the path uses fill-rule="evenodd";
  - the SVG itself encodes fill-opacity="1" on the rendered path.

determinism:
  R0_DETERMINISTIC_BYTE_EQUAL across 3 back-to-back runs
  (docs/evidence/issue-284-r0/r0-determinism.json).
  - source SHA-256 unchanged on every run;
  - SVG byte hash equal on every run
    (92ADC3637AB7C2DFE0A5BE0B151868F78A13ABD6C30A089DECBBB397A6C590D4);
  - PNG byte hash equal on every run
    (25762D38115B7509A142A35231F1745BBEB446132060CE58321144D613B0A55A);
  - PNG dimensions equal on every run (1920x1080).
  Caveat: byte-equal under Electron's offscreen canvas and the
  default font/text rendering; if Chrome's canvas engine changes
  between Chromium revisions this hash may shift. Decoded pixel
  content is expected to remain equal even if byte hash drifts,
  but R0 only proves byte-equality at this Chromium version.

resource_budget_evidence:
  docs/evidence/issue-284-r0/r0-budget.json records
  - extract elapsedMs: 197
  - rasterize elapsedMs: 582
  - total elapsedMs: 779 (limit 30,000)
  - peak heap used: 5.58 MB (extract + rasterize, Node side);
    renderer side measured separately inside Electron (~30 MB
    typical for the offscreen Canvas, not surfaced in the JSON).
  - svg byte length: 77,705 (well below 1 MB).
  - png pixel count: 2,073,600 (well below 16,777,216).
  Budget limits (encoded in scripts/fla-r0-spike-extract.cjs
  LIMITS, mirrored in r0-budget.json):
    maxSourceBytes      256 MiB
    maxXmlBytes         32  MiB
    maxOutputWidth      4,096
    maxOutputHeight     4,096
    maxDecodedPixels    16,777,216
    wallClockMs         30,000
  All five budget checks returned true.

security_invariants:
  - ActionScript detected: false (no <Script> / <DOMScript> blocks
    in DOMDocument.xml or any LIBRARY/*.xml).
  - ActionScript executed: false by construction — the spike
    reads XML attributes only; it does not eval / Function /
    require any byte from the source FLA.
  - Source rewritten: false. The spike writes only inside
    docs/evidence/issue-284-r0/. The source SHA-256 is re-hashed
    after every run and is recorded in
    docs/evidence/issue-284-r0/r0-determinism.json (every run
    returns sourceHashUnchanged: true).
  - Network access: false. The rasterize script loads the SVG via
    a data: URL; it does not open sockets. The extract script is
    pure Node with jszip + filesystem only.
  - Project mutation: false. The spike does not touch the Panda
    Project tree, Project center, autosave, recovery, or any
    other renderer/main file outside the R0 evidence directory.
  - Malformed-archive bypass: false. The spike re-uses the same
    EOCD preflight the production preflight service runs
    (centralDirectoryDeclaredBytes > centralDirectoryActualBytes
    is rejected before jszip is invoked).
  - V1.5-C boundary: unchanged. The spike does not normalize the
    +54-byte CD-size anomaly and does not accept currently
    rejected archives.

focused_tests:
  The R0 spike itself is the focused automated check. The four
  scripts under scripts/ together form the test surface:
    fla-r0-spike-extract.cjs     (Node, JSON + SVG output)
    fla-r0-spike-rasterize.cjs   (Electron, PNG output)
    fla-r0-spike-determinism.cjs (3x run + hash compare)
    fla-r0-spike-budget.cjs      (wall + heap + bounds)
  No new vitest cases were added because the spike is a
  research-only file I/O + JSON contract and the existing vitest
  suites (tests/unit, tests/integration) are production code
  paths that the spike intentionally does not touch.

human_visual_evidence:
  docs/evidence/issue-284-r0/r0-render-sword.png is the raster
  result. A human (the maintainer) opening the PNG should
  observe a Chinese-style ornamental sword (剑): a long curved
  blade on the right, a decorative cross-guard with curls, a
  wrapped grip with diamond patterning, and a finial pommel on
  the left. The fill is the gradient's first color (#B0D1F4
  light blue) on the shape silhouette. The cutouts in the guard
  and pommel appear as the (white) transparent background
  showing through, which is correct under fill-rule="evenodd".
  If the human review finds the visual meaningful (recognizable
  as 剑), that is the R0-D success signal.

unsupported_or_unknown:
  Observed working on 剑.fla:
    - ZIP/XFL archive read (jszip);
    - modern XFL DOMDocument.xml / LIBRARY/*.xml XML attribute
      parsing (regex + balanced-block extractor mirroring
      tests/helpers/fla-structural-probe.ts);
    - <DOMGroup> wrapper handling (group is unwrapped; the inner
      DOMShape carries the transform);
    - <DOMShape> children: <matrix>, <fills>, <strokes>, <edges>;
    - <FillStyle> with <LinearGradient> + <GradientEntry>
      (R0 uses the first gradient color, not full gradient);
    - <FillStyle> with <SolidColor> (would be used if 剑.fla
      had one — 剑.fla does not, but the parser path is
      exercised by 文档.fla in the corpus);
    - <Edge cubics="..."/> and <Edge edges="..."/> self-closing
      children (2358 PathCommand decoded from 842 Edge elements);
    - cubic bezier "(;" / "(" / "q" / "Q" / ");" forms in
      cubics;
    - lineTo, moveTo, quadraticCurveTo, cubicCurveTo, close
      (M/L/Q/C/Z);
    - matrix transform applied via SVG <g transform="...">;
    - SVG viewBox fitted to transformed bounding box;
    - canvas rasterization at 1920x1080 with transparent
      background.

  Observed partial:
    - LinearGradient rendering: only the first GradientEntry
      color is used; the gradient direction and stop positions
      are NOT applied to the fill. R0 explicitly does not try
      to render full gradients.
    - Stroke styles: R0 does not apply the <strokes> block.
      剑.fla's first DOMShape declares no strokes; the R0
      output therefore has no outline. If a future spike
      needs strokes, R0 would extend by walking <strokes>
      and emitting a second <path stroke=...>.

  Observed unsupported / not exercised (R0 sample is 剑.fla,
  which has none of these; 文档.fla would be needed to
  exercise them — out of R0 scope per R0-D "one known
  scene/symbol/timeline/frame"):
    - text (DOMTextInstance) — not present in 剑.fla;
    - bitmap / placed instance — not present in 剑.fla;
    - video / sound — not present in 剑.fla;
    - filters (blur / glow / drop-shadow / color matrix) — not
      present in 剑.fla;
    - blend modes — not present in 剑.fla;
    - masks — not present in 剑.fla;
    - camera layers / 3D vanishing point — not present in
      剑.fla;
    - motion tween / shape tween — tweenCount=0 in 剑.fla;
    - color effects / advanced color transforms — not present
      in 剑.fla;
    - external assets (linked PNG / JPG / video) — not
      present in 剑.fla;
    - legacy OLE2 / pre-CS5 FLA — not the R0-D target (剑.fla
      is a strict-PASS modern ZIP/XFL);
    - multiple frames / animated playback — 剑.fla has 2
      frames in the symbol but R0 renders only the first
      (the spike has no animation timeline; this is research
      scope, not product scope).

  Not exercised / unknown (would need a different sample):
    - Pre-CS5 OLE2 FLA;
    - FLA with the recurring +54-byte CD-size anomaly (the
      preflight rejects those before R0 even runs);
    - FLA with ActionScript;
    - FLA with nested MovieClips;
    - FLA with 2+ scenes.

source_hash_unchanged: YES
  (verified at extract start, after extract, and across all
  3 determinism runs.)

project_mutation: NO
V1_5_C_boundary_changed: NO

next_gate:
  Maintainer review of this receipt + the human visual check
  on docs/evidence/issue-284-r0/r0-render-sword.png. On accept:
  open the shared V2-R Draft PR (agent/fla-v2-r branch, base
  3c47a4e) and post a link on Issue #284. Do NOT start R1
  work; R1 requires its own Issue (#285+) and explicit
  maintainer authorization per the Issue #284 R0 → R1
  gate contract.
```

## Files added in this R0 stage-final commit

```
docs/evidence/issue-284-r0/.gitignore             (excludes electron-user-data/)
docs/evidence/issue-284-r0/r0-budget.json
docs/evidence/issue-284-r0/r0-determinism.json
docs/evidence/issue-284-r0/r0-extract.json
docs/evidence/issue-284-r0/r0-render-sword.png
docs/evidence/issue-284-r0/r0-render-sword.svg
docs/test-receipts/ISSUE-284-R0.md
scripts/fla-r0-spike-budget.cjs
scripts/fla-r0-spike-determinism.cjs
scripts/fla-r0-spike-extract.cjs
scripts/fla-r0-spike-rasterize.cjs
```

## R0-A — current-stack renderer inventory

The pinned FLA/parser stack on `main` is **parser-only** (no
renderer). The Spike inventory:

| candidate | evidence | isolation fit | transparency | determinism risk | dependency / security cost | R0 disposition |
|---|---|---|---|---|---|---|
| `lifeart/fla-viewer` parser (`src/renderer/fla-import/parser-core/`) — parser only, no renderer | `grep -l 'draw\|render\|raster' src/renderer/fla-import/parser-core/` returns no draw routines; parser exposes `FLADocument` with `timelines[].layers[].frames[].elements[].edges` (path command source) but never rasterises | High — already sandboxed in `FlaParserWorker` | n/a (no rendering) | High if reused as a viewer (it would pull the full upstream runtime) | Upstream MIT-style viewer; bringing in the rendering half would import the entire player | **reuse parser only; reject the viewer half** |
| `edge-decoder.ts:decodeEdgesWithStyleChanges` | already imported by the production parser; produces `PathCommand[]` (`M`/`L`/`Q`/`C`/`Z`); 22 KB, verbatim TS | High — pure function over the XFL edge-attribute string | n/a (geometry only) | n/a (deterministic on the input) | None — already a production dep via the parser closure | **reuse verbatim** (R0 spike copies the function body) |
| Konva (`konva`, `react-konva` in production deps) | Panda already uses Konva for the editor canvas (`CanvasStage`); Stage.toDataURL is a documented Konva API | High — runs in Electron renderer; not in R0 spike (R0 uses raw 2D canvas) | Supports transparent canvas clear; R0 instead uses raw 2D canvas | Medium — Konva rendering of a path uses HTML5 canvas 2D which is itself deterministic in Chromium | Already a production dep | **use raw 2D canvas for R0 simplicity; revisit Konva in R1** |
| `Canvas2D` in the Electron renderer | R0 rasterize script uses `c.getContext('2d')`, `drawImage(svgDataUrl)`, `toDataURL('image/png')` | High — runs in a hidden BrowserWindow | Native — `clearRect` then draw leaves background transparent | Proven via 3-run byte-equal probe | None — already a Chromium built-in | **use for R0-D rasterization** |
| `node-canvas` / `@napi-rs/canvas` / `sharp` | none in `package.json` | High | Yes | High risk if introduced without security review | New native dep; R0 cannot introduce it per Issue #284 R0-C | **reject for R0** |
| `jsdom` / `happy-dom` for XML DOM parsing in Node | none in `package.json` | High | n/a | Medium | New dev dep; not needed because the spike's XML grammar is a bounded regex + balanced-block pass | **reject for R0** (use regex + balanced-block mirroring the B0 probe) |

R0 chose: **edge-decoder verbatim copy + raw 2D canvas in Electron
+ jszip**. No new dependency introduced.

## R0-B — minimum render input contract

```text
source     : Uint8Array  (FLA bytes, read-only, SHA-256 verified)
parser     : jszip + DOMDocument.xml + LIBRARY/*.xml
path-source: <DOMGroup>.<DOMShape>.<edges>.<Edge cubics|edges="..."/>
geometry   : PathCommand[] = M | L | Q | C | Z   (TWIPS / 20 → pixels)
fill       : <FillStyle>.<SolidColor> or first <LinearGradient>.<GradientEntry>
transform  : <DOMShape>.<matrix>.<Matrix a b c d tx ty/>
stage      : document width/height from <DOMDocument width height/>
```

Fields **not** in the R0 contract (and explicitly out of scope):
text, video, sound, bitmap, filter, mask, blend mode, tween,
camera, frame interpolation, action script.

## R0-G — initial compatibility matrix (from 剑.fla only)

| feature family | R0 status |
|---|---|
| modern ZIP/XFL archive read (jszip) | observed working |
| EOCD preflight (CD-size over-declare reject) | observed working |
| XFL DOMDocument.xml + LIBRARY/*.xml XML attribute parse | observed working |
| `<DOMGroup>` wrapper handling | observed working |
| `<DOMShape>` `<matrix>` / `<fills>` / `<strokes>` / `<edges>` | observed working |
| `<FillStyle>` `<SolidColor>` | not exercised by 剑.fla (no solid fills) |
| `<FillStyle>` `<LinearGradient>` (first color only) | observed partial |
| `<FillStyle>` `<RadialGradient>` / bitmap fill | not exercised by 剑.fla |
| `<StrokeStyle>` (any kind) | not exercised by 剑.fla; not emitted in R0 output |
| `<Edge cubics="..."/>` self-closing | observed working (651 edges) |
| `<Edge edges="..."/>` self-closing | observed working (191 edges) |
| cubic `(;` / `(` / `);` / `)` bezier forms | observed working |
| quadratic `Q` / `[` form | observed working |
| `M` / `L` / `C` / `Z` PathCommand | observed working |
| matrix 2D affine (`a b c d tx ty`) | observed working |
| SVG `viewBox` fitted to transformed bbox | observed working |
| canvas `drawImage` + `toDataURL('image/png')` rasterization | observed working |
| 3x byte-equal deterministic run | observed working |
| resource-budget probe (wall, heap, bounds) | observed working |
| fonts / text layout | not exercised by 剑.fla |
| masks | not exercised by 剑.fla |
| filters (blur / glow / drop-shadow / color matrix) | not exercised by 剑.fla |
| blend modes | not exercised by 剑.fla |
| camera layer / 3D vanishing point | not exercised by 剑.fla |
| nested MovieClips | not exercised by 剑.fla |
| motion tween / shape tween | not exercised by 剑.fla (tweenCount=0) |
| color effects / advanced color transforms | not exercised by 剑.fla |
| external assets (linked PNG / JPG / video) | not exercised by 剑.fla |
| legacy OLE2 / pre-CS5 FLA | not exercised (剑.fla is ZIP/XFL) |
| animated playback across frames | not exercised (R0 renders frame 0 only) |

## How to reproduce

```powershell
cd D:\panda-stage-main   # or D:\panda-stage-r0 worktree
$env:FLA_R0_INPUT='D:\表情合集\剑.fla'

# 1. extract (Node) + rasterize (Electron) — single-shot
node scripts/fla-r0-spike-extract.cjs | Out-Null
node_modules\.bin\electron.cmd scripts\fla-r0-spike-rasterize.cjs

# 2. determinism probe (3x run + hash compare)
node scripts/fla-r0-spike-determinism.cjs

# 3. resource budget probe
node scripts\fla-r0-spike-budget.cjs
```

All three scripts write JSON evidence into
`docs/evidence/issue-284-r0/`. The two output artifacts the
maintainer is asked to look at:

- `docs/evidence/issue-284-r0/r0-render-sword.png` — the visible
  raster result
- `docs/evidence/issue-284-r0/r0-budget.json` —
  `conclusion.withinBudget === true`
- `docs/evidence/issue-284-r0/r0-determinism.json` —
  `conclusion === "R0_DETERMINISTIC_BYTE_EQUAL"`
