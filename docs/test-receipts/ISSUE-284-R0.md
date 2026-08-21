# Issue #284 V2-R0 receipt — Renderer Feasibility Spike (corrected)

> Receipt covers both the **initial R0 feasibility spike** and the
> **R0 corrective closeout** under Issue #286. Per Issue #286:
> history is preserved, not erased. The R0 stage-final commit is
> `1df6a67`; the R0 corrective commit is recorded in the
> "Corrective closeout" section below.

## Timeline

```text
R0 initial feasibility spike           1df6a67  (research(fla): complete V2-R0 renderer feasibility (#284))
R0 backfill receipt commit SHA         6cb44ea  (docs(fla): backfill R0 stage-final commit SHA into receipt)
PR #285 opened (Draft)                 ba6a6dc  (docs(fla): backfill PR #285 + R0 comment URL into receipt)
R0 RESULT comment posted on #284       <issuecomment-5365565441>
R0 acceptance review found gaps       —
R0 corrective closeout (this issue)    <see "Corrective closeout" below; new commit on agent/fla-v2-r>
```

The corrected R0 result is the one that is acceptance-grade.
The initial R0 result is preserved as initial-feasibility evidence
only.

---

# Corrective closeout (Issue #286)

## What changed

| area | R0 initial (1df6a67) | R0 corrected (this commit) |
|---|---|---|
| renderer isolation | `contextIsolation:false / nodeIntegration:true / sandbox:false` (research-only) | `sandbox:true / contextIsolation:true / nodeIntegration:false` plus `setWindowOpenHandler` deny, `will-navigate` / `will-redirect` preventDefault, `session.webRequest.onBeforeRequest` blocking non-`data:`, `onHeadersReceived` injecting CSP `default-src 'none'; …` |
| renderer path | inline script in `BrowserWindow` data: URL that calls `r0RenderImpl` | same; preload exists but only exposes a frozen `r0Boundaries` object for defense-in-depth (no IPC, no Node capability) |
| ownership | renderer had nodeIntegration=true and could in principle have written to disk | main process owns all file I/O; renderer only draws the canvas and reports back the PNG data URL + `performance.memory` |
| evidence location | `docs/evidence/issue-284-r0/r0-render-sword.png` and `.svg` were tracked in the repo | both are `git rm`'d; all real-sample visual bytes now live under `D:\PandaStage-Acceptance\fla-v2-r0\` (LOCAL_ONLY); the repo only retains safe metadata (hashes, dimensions, selected identity) |
| timing evidence | one warm-run `779ms` total claim, not separated | cold-start (Electron first-launch) measured at `28,279ms`; warm runs median `25,034ms`; **budget gate uses the worst observed `28,279ms`**, which still fits the declared `30,000ms` wall-clock budget |
| renderer memory | "~30 MB typical" estimate | measured via `performance.memory` (Chromium-only): `usedJSHeapSize: 10,000,000` (~10 MB) |
| byte-identical output | n/a | YES — the sandboxed renderer produces the **same** PNG bytes as the unsafe renderer (sha256 `25762D38115B7509A142A35231F1745BBEB446132060CE58321144D613B0A55A`), so the corrective is evidence-equivalent on the sample |

## V2-R0 RESULT (corrected) — comment template fields

```text
baseline_main: 3c47a4ee8af07e834338b223fcb3260a4c6dddbc
integration_pr: https://github.com/Cognitive-Architect/panda-stage/pull/285
stage_final_commit: 1df6a678627a6a61090d432904c54b0c3551855a
corrected_commit: <filled when corrective commit lands; see "next_gate">
R0_conclusion: R0_RENDER_FEASIBLE_WITH_LIMITS

renderer_path:
  Panda-owned minimal SVG-path renderer under the corrected isolation
  model. Pipeline (read-only, research-only, sandboxed):
    scripts/fla-r0-spike-extract.cjs (Node)
      - reads 剑.fla via jszip (same ZIP decoder the production
        FLA V1.5 parser uses; no new dependency);
      - applies the production EOCD preflight
        (centralDirectoryDeclaredBytes <= centralDirectoryActualBytes);
      - walks the first graphic symbol's first DOMGroup → DOMShape,
        parses <FillStyle> / <Edge> children;
      - reuses the production decodeEdgesWithStyleChanges verbatim
        from src/renderer/fla-import/parser-core/edge-decoder.ts at
        commit 3c47a4e; decodes 842 <Edge> elements into 2358
        PathCommand (M/L/Q/C/Z);
      - writes the SVG to D:\PandaStage-Acceptance\fla-v2-r0\.
    scripts/fla-r0-spike-rasterize.cjs (Electron Main)
      - creates a hidden BrowserWindow with
          sandbox: true
          contextIsolation: true
          nodeIntegration: false
          webSecurity: true
          allowRunningInsecureContent: false
          experimentalFeatures: false
          preload: scripts/fla-r0-spike-preload.cjs
      - guards: setWindowOpenHandler deny,
        will-navigate / will-redirect preventDefault,
        session.webRequest.onBeforeRequest blocks all non-data:
        subresources, onHeadersReceived injects CSP
        `default-src 'none'; style-src 'unsafe-inline'; script-src
        'self' 'unsafe-inline'; img-src data:; connect-src 'none'`;
      - loads scripts/fla-r0-spike-renderer.html as a data: URL (no
        file:// traversal);
      - waits for window.r0RenderImpl to install;
      - calls window.r0RenderImpl(svg, 1920, 1080) via
        webContents.executeJavaScript; receives { dataUrl, width,
        height, memory };
      - writes the PNG to D:\PandaStage-Acceptance\fla-v2-r0\.
    scripts/fla-r0-spike-preload.cjs
      - contextBridge.exposeInMainWorld('r0Boundaries', { sandbox,
        contextIsolation, nodeIntegration, blockedNavigations,
        blockedNewWindows, blockedRemoteResources, cspInjected,
        rendererCanWriteToDisk, rendererCanExecuteChildProcess,
        rendererCanRequireNode });
      - no IPC, no fs, no net.
    scripts/fla-r0-spike-renderer.html
      - inline script installs window.r0RenderImpl(svg, w, h) which
        builds a 1920x1080 canvas, draws the SVG via drawImage,
        toDataURL('image/png'), and reports performance.memory.
      - No eval, no new Function, no importScripts, no fetch.

real_sample_hash: E773508C4079C4FA8235043B69A0F5415BCC1596A3ED345A4C6652B48CE54377
  (matches docs/research/fla-corpus-manifest.json:fla-e773508c4079c4fa;
   byteLength 32,997 bytes; preflight result: pass; offline-probe:
   success; structure: scene=1, totalTimeline=2, layer=2, frame=2,
   symbol=1, graphic=1, tween=0.)

selected_scene_symbol_timeline_frame:
  LIBRARY/<素材来自-cilisucai.com13/素材来自-cilisucai.com63>,
  DOMTimeline[0], DOMLayer[0], DOMFrame[0], DOMGroup[0], DOMShape[0].
  842 <Edge> elements, 2358 PathCommand (M 855, L 17, Q 599, C 651, Z 236).

output:
  D:\PandaStage-Acceptance\fla-v2-r0\r0-render-sword.png
    - LOCAL_ONLY (not committed; reconstructed from svgSha256 below)
    - 1920x1080 PNG, 172,252 bytes,
      sha256 25762D38115B7509A142A35231F1745BBEB446132060CE58321144D613B0A55A
  D:\PandaStage-Acceptance\fla-v2-r0\r0-render-sword.svg
    - LOCAL_ONLY (not committed)
    - 77,705 bytes, sha256 92ADC3637AB7C2DFE0A5BE0B151868F78A13ABD6C30A089DECBBB397A6C590D4
  Tracked repo metadata (no visual bytes):
    docs/evidence/issue-284-r0/r0-extract.json
      - source sha256 + size, output svg sha256 + size, output
        width/height/pixelCount, selected identity, fill, security
        invariants, transparency; no PNG/SVG bytes.

transparency:
  - renderer canvas: 100% transparent background (ctx.clearRect, no
    opaque fill behind the path).
  - shape fill: first FillStyle LinearGradient first color #B0D1F4
    at fill-opacity 1.
  - cutouts in the pommel and guard decoration are visible because
    the path uses fill-rule="evenodd".

determinism:
  R0_DETERMINISTIC_BYTE_EQUAL across 3 back-to-back runs under the
  corrected renderer (see D:\PandaStage-Acceptance\fla-v2-r0\r0-determinism.json):
    - source SHA-256 unchanged on every run;
    - SVG byte hash equal on every run
      (92ADC3637AB7C2DFE0A5BE0B151868F78A13ABD6C30A089DECBBB397A6C590D4);
    - PNG byte hash equal on every run
      (25762D38115B7509A142A35231F1745BBEB446132060CE58321144D613B0A55A);
    - PNG dimensions equal on every run (1920x1080).
  Note: the unsafe R0 initial spike produced the same byte hashes
  for the same SVG, so the corrective did not change the rendered
  output for this sample.

resource_budget_evidence:
  See D:\PandaStage-Acceptance\fla-v2-r0\r0-budget.json.
    - cold_start_total_ms: 28,279  (first Electron launch dominates)
    - warm_run_totals_ms:        [25,793, 24,274]
    - warm_run_median_total_ms:   25,033.5
    - worst_observed_total_ms:    28,279  (the budget gate)
    - wall_clock_budget_ms:       30,000
    - max_output_width:           4,096
    - max_output_height:          4,096
    - max_output_pixels:          16,777,216
    - max_source_bytes:           256 MiB
    - max_xml_bytes:              32 MiB
    - renderer_memory: MEASURED via performance.memory (Chromium-only)
        usedJSHeapSize: 10,000,000
        totalJSHeapSize: 10,000,000
        jsHeapSizeLimit: 3,760,000,000
    All 5 budget checks pass. withinBudget: true.

security_invariants:
  See D:\PandaStage-Acceptance\fla-v2-r0\r0-security.json (9 checks
  all passed).
    - ActionScript execution: NO (no eval/new Function/importScripts
      in the renderer or preload; the spike never executes source bytes
      from the FLA).
    - arbitrary network: NO (webRequest.onBeforeRequest denies every
      non-data: request; CSP default-src 'none' + connect-src 'none').
    - arbitrary renderer filesystem access: NO (sandbox:true; the
      preload require()s only the built-in electron module; the
      renderer HTML does not import any node module).
    - Project mutation: NO (spike writes only inside the configured
      EVIDENCE_DIR and the small docs/ metadata dir; no write touches
      src/, scripts/verify-*.cjs, package.json, or any other product
      file).
    - source rewrite: NO (source SHA-256 verified before and after
      every spike run; equal on all 3 determinism runs).
    - V1.5-C boundary: NO change (extract re-runs the same
      CD-size preflight the production preflight service uses; the
      +54-byte malformed family still rejects before jszip).
    - sandbox disabled: NO (BrowserWindow webPreferences.sandbox = true).
    - nodeIntegration enabled: NO (webPreferences.nodeIntegration = false).
    - contextIsolation disabled: NO (webPreferences.contextIsolation = true).

focused_tests:
  The R0 corrected spike is the focused automated check. Five scripts
  under scripts/ together form the test surface (all drive the
  same FLA_R0_EVIDENCE_DIR, default D:\PandaStage-Acceptance\fla-v2-r0):
    fla-r0-spike-extract.cjs   (Node: ZIP + EOCD preflight + XML walk
                                  + edge-decode + SVG emit)
    fla-r0-spike-rasterize.cjs (Electron Main: sandboxed BrowserWindow
                                  + canvas + PNG export)
    fla-r0-spike-preload.cjs    (Electron preload: frozen
                                  r0Boundaries object only)
    fla-r0-spike-renderer.html  (sandboxed renderer main world:
                                  window.r0RenderImpl)
    fla-r0-spike-determinism.cjs (3x run probe; records per-run
                                    timings + sha256s)
    fla-r0-spike-budget.cjs     (cold + 2 warm runs; worst-observed
                                  timing; renderer memory)
    fla-r0-spike-security.cjs   (9 negative checks; static-inspection
                                  + live re-hash)

human_visual_evidence:
  D:\PandaStage-Acceptance\fla-v2-r0\r0-render-sword.png (LOCAL_ONLY)
  is the rendered raster. A human (the maintainer) opening the PNG
  should observe a Chinese-style ornamental sword (剑): a long curved
  blade, decorative cross-guard with curls, a wrapped grip with
  diamond patterning, and a finial pommel. The fill is the gradient's
  first color (#B0D1F4) on the shape silhouette; cutouts appear as the
  (white) transparent background showing through (fill-rule="evenodd").
  Recorded in this receipt as: R0_LOCAL_VISUAL_ACCEPTANCE = PENDING
  (the human acceptance step is the maintainer's call; do not upload
  the local PNG into the repo or any GitHub comment).

unsupported_or_unknown:
  See R0-G initial compatibility matrix in the issue #284 PR
  description. The R0 corrected architecture does not change the
  feature-matrix result (still a 0-tween, single-graphic, linear-gradient
  sample), only the isolation under which the same matrix is observed.

source_hash_unchanged: YES (every run)
project_mutation: NO
V1_5_C_boundary_changed: NO

next_gate:
  Maintainer review of:
    1. this receipt;
    2. r0-determinism.json, r0-budget.json, r0-security.json under
       D:\PandaStage-Acceptance\fla-v2-r0\;
    3. the local PNG at D:\PandaStage-Acceptance\fla-v2-r0\r0-render-sword.png
       (set R0_LOCAL_VISUAL_ACCEPTANCE = PASS or FAIL in the
       receipt via a follow-up commit);
    4. the 9-check security report.
  On accept: mark the corrected R0 receipt as R0_ACCEPTED. R1
  remains NOT STARTED until a separate R1 Issue exists and the
  maintainer explicitly authorizes it.
```

## R0-CORRECTIVE RESULT (Issue #286 completion comment template)

```text
V2-R0 CORRECTIVE RESULT

issue: #286
shared_pr: #285
corrective_commit: <filled when commit lands; see PR #285 head SHA>
corrected_pr_head: <same SHA after push>

sandbox: true
contextIsolation: true
nodeIntegration: false
renderer_arbitrary_fs: NO
renderer_arbitrary_network: NO
ActionScript_executed: NO
Project_mutation: NO
V1_5_C_boundary_changed: NO
source_hash_unchanged: YES

tracked_private_png_removed: YES
tracked_private_svg_disposition: REMOVED (both r0-render-sword.png
  and r0-render-sword.svg are git rm'd from PR #285; identical
  copies live at D:\PandaStage-Acceptance\fla-v2-r0\ LOCAL_ONLY)
local_visual_evidence: PENDING (awaiting maintainer open of the
  local PNG; receipt is intentionally not claiming PASS until the
  maintainer opens the local file)
repo_visual_artifact_bytes: NONE (no PNG/SVG bytes committed;
  docs/evidence/issue-284-r0/ contains r0-extract.json metadata
  only — hashes + dimensions + selected identity, no visual bytes)

cold_start_total_ms: 28279
warm_run_totals_ms: [25793, 24274]
warm_run_median_total_ms: 25033.5
worst_observed_total_ms: 28279
wall_clock_budget_ms: 30000
renderer_memory: MEASURED via performance.memory (Chromium-only)
  usedJSHeapSize: 10000000
  totalJSHeapSize: 10000000
  jsHeapSizeLimit: 3760000000
determinism: R0_DETERMINISTIC_BYTE_EQUAL (3/3 runs byte-equal,
  source sha256 unchanged, PNG dimensions consistent)

focused_checks: 5/5 budget + 9/9 security negative checks pass
draft_ci: not yet run; spike scripts are the focused checks; PR
  remains Draft per the V2-R packaging rule
R0_corrected_acceptance: PENDING (awaiting maintainer review)
remaining_limits:
  - same R0 fidelity limits as initial (only first gradient color
    used; strokes not emitted; Animate feature families not exercised
    by 剑.fla; animation across frames not rendered)
  - byte-equal determinism is proven at this Chromium version; if
    Chromium's canvas engine changes between versions the hash may
    shift (decoded pixels are expected to remain equal)
  - performance.memory is Chromium-specific; on a non-Chromium
    runtime the spike would mark renderer_memory as NOT MEASURED +
    reason (it is currently measured)

next_gate: maintainer reviews the 3 JSON files under
  D:\PandaStage-Acceptance\fla-v2-r0\ + opens the local PNG, sets
  R0_LOCAL_VISUAL_ACCEPTANCE on a follow-up receipt update, then
  authorizes R1 via a new Issue (recommended #287+).
```

## R0-G initial compatibility matrix (unchanged from initial R0)

See the matrix in the R0 initial section of the V2-R Draft PR #285
description. The corrected architecture does not change which
Animate feature families are exercised by the 剑.fla sample; it
changes only the isolation under which the matrix is observed.

## Files in this R0 corrective commit

```
scripts/fla-r0-spike-rasterize.cjs  (rewritten: sandbox:true, all
                                     boundary guards, performance.memory
                                     measurement, no Node in renderer)
scripts/fla-r0-spike-preload.cjs    (new: frozen r0Boundaries only)
scripts/fla-r0-spike-renderer.html  (new: window.r0RenderImpl in main
                                     world; no eval/Function; inline
                                     data-URL image; CSP via meta tag)
scripts/fla-r0-spike-extract.cjs    (updated: default EVIDENCE_DIR is
                                     D:\PandaStage-Acceptance\fla-v2-r0;
                                     emits repo metadata only into docs/)
scripts/fla-r0-spike-determinism.cjs (unchanged contract; new evidence
                                       under sandboxed renderer)
scripts/fla-r0-spike-budget.cjs     (rewritten: cold + warm split;
                                     worst-observed gate; renderer
                                     memory from rasterize JSON)
scripts/fla-r0-spike-security.cjs   (new: 9 negative checks; static
                                     inspection + live re-hash)
docs/evidence/issue-284-r0/r0-extract.json (rewritten: metadata only,
                                              no visual bytes)
docs/test-receipts/ISSUE-284-R0.md  (rewritten: this file)
```

Removed from PR #285 (history still has them in 1df6a67):
```
docs/evidence/issue-284-r0/r0-render-sword.png
docs/evidence/issue-284-r0/r0-render-sword.svg
```

## How to reproduce (corrected)

```powershell
cd D:\panda-stage-r0                       # or any worktree on agent/fla-v2-r
$env:FLA_R0_INPUT='D:\表情合集\剑.fla'
$env:FLA_R0_EVIDENCE_DIR='D:\PandaStage-Acceptance\fla-v2-r0'

# 1. extract (Node) -> writes r0-render-sword.svg to EVIDENCE_DIR
node scripts/fla-r0-spike-extract.cjs | Out-Null

# 2. rasterize (sandboxed Electron) -> writes r0-render-sword.png
node_modules\.bin\electron.cmd scripts/fla-r0-spike-rasterize.cjs

# 3. determinism probe (3x run, sandboxed)
node scripts/fla-r0-spike-determinism.cjs

# 4. resource budget probe (cold + 2 warm, sandboxed)
node scripts/fla-r0-spike-budget.cjs

# 5. security negative checks (9 checks)
node scripts/fla-r0-spike-security.cjs
```

All three scripts write JSON evidence into
`D:\PandaStage-Acceptance\fla-v2-r0\`. The two output artifacts the
maintainer is asked to look at:

- `D:\PandaStage-Acceptance\fla-v2-r0\r0-render-sword.png` (LOCAL_ONLY)
- `D:\PandaStage-Acceptance\fla-v2-r0\r0-budget.json`
  (`conclusion.withinBudget === true`)
- `D:\PandaStage-Acceptance\fla-v2-r0\r0-determinism.json`
  (`conclusion === "R0_DETERMINISTIC_BYTE_EQUAL"`)
- `D:\PandaStage-Acceptance\fla-v2-r0\r0-security.json`
  (`conclusion.allPassed === true`)
