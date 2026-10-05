# Issue #706: Cross-Corpus FLA Generalization

This report records the bounded discovery and static-preview campaign for the nine approved C3 FLA fixtures. The machine-readable receipts, per-candidate addresses, classifications, and artifact hashes are in [the JSON report](issue-706-cross-corpus-generalization.json). The source approval and recovery evidence is in [the C3 compatibility report](fla-v1.5-c3-compatibility-recovery.json).

## Method and source integrity

- Inspected each fixture through the production Electron Main and Preload APIs, production C3 recovery/classification, XFL parser, static snapshot catalog, and sandbox preview path.
- Kept the original `.fla` files read-only. Each source SHA-256 matched the approved C3 hash before and after the two-run campaign. Eight archives used the existing in-memory recovery path and passed strict parsing after normalization; the Sword fixture needed no recovery and parsed successfully through production inspection.
- Graphic candidates use the union of visible authored span starts. Held frames are not expanded. The Scene initial catalog frame is listed as a separate address because the current adapter does not expose a Scene span index.
- Reused the #705 PNG alpha analysis, exact-byte dedupe with full provenance, deterministic representative selection, and contact-sheet generation. FLA bytes never enter the rasterizer, and the probe does not call project commit APIs.
- Ran each fixture twice. Discovery IDs and addresses, candidate classifications, SVG/PNG artifact hashes, and contact-sheet hashes were deterministic in both runs.

## Results

| Fixture | Class | Candidate addresses | Discovered | PNG outputs | Blank PNGs | Exact duplicate groups | Unsupported outcomes | Candidate blocker families |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `wave1-static-character-a` | MIXED | 45 | 32 | 32 | 0 | 0 | 13 | `NESTED_GRAPHIC_TIMING` |
| `wave1-static-character-b` | MIXED | 32 | 24 | 15 | 0 | 0 | 17 | `NESTED_GRAPHIC_TIMING`, `TRANSFORM`, `UNKNOWN_SEMANTIC` |
| `wave1-static-character-c` | MIXED | 44 | 32 | 11 | 0 | 0 | 33 | `NESTED_GRAPHIC_TIMING`, `UNKNOWN_SEMANTIC` |
| `wave2-pose-action-a` | MIXED | 32 | 25 | 25 | 2 | 0 | 7 | `NESTED_GRAPHIC_TIMING` |
| `wave2-pose-action-b` | MIXED | 69 | 51 | 40 | 2 | 3 | 29 | `NESTED_GRAPHIC_TIMING`, `UNKNOWN_SEMANTIC` |
| `wave3-temporal-walk` | MIXED | 63 | 48 | 36 | 1 | 1 | 27 | `NESTED_GRAPHIC_TIMING`, `UNKNOWN_SEMANTIC` |
| `wave3-temporal-charge` | MIXED | 63 | 48 | 37 | 1 | 1 | 26 | `NESTED_GRAPHIC_TIMING`, `UNKNOWN_SEMANTIC` |
| `wave3-temporal-rotation` | MIXED | 14 | 7 | 7 | 0 | 3 | 7 | `NESTED_GRAPHIC_TIMING` |
| `wave4-prop-sword` | PROP | 2 | 2 | 2 | 0 | 0 | 0 | None |
| **Total** | **8 MIXED, 1 PROP** | **364** | **269** | **205** | **6** | **8** | **159** | |

PNG outputs include transparent blanks. The 159 unsupported outcomes include candidates that could not produce a supported preview; the family column reports only candidate-route blockers. Source-level compatibility observations such as ActionScript or MovieClip semantics are retained separately in the JSON and do not imply that every candidate was blocked. There were zero render failures and zero campaign failures.

The eight MIXED classifications reflect directly renderable Graphic assets coexisting with tweened or multi-span timeline content. Wave 2 and Wave 3 also carry a temporal-action evidence tag. Their snapshots remain authored-frame anchors; the campaign does not flatten timeline content into an action clip. The PROP classification for Sword is based on its approved asset-family hint and repeatable direct Graphic previews.

## Visual review and limits

I inspected all nine final run-1 contact sheets, including representative raster bounds. No gross clipping or contact-sheet/rasterization defect was visible. The fall fixture contains gray cloud/shadow-like entries that I could not match independently to the source. The Sword sheet shows two Prop previews; their PNG hashes differ, so they were not grouped as exact duplicates.

No independent Animate/reference images were available. This inspection therefore does not establish semantic correspondence, full-character poses, or maintainer acceptance. Maintainer visual review remains **PENDING**. The binary contact sheets and candidate PNG/SVG files are outside the repository at `D:\PandaStage-Acceptance\issue706-cross-corpus-20261005\run-final`.

## Completion receipt and capability priorities

All **9/9** requested fixtures were available; none were blocked by source availability. Every source hash remained unchanged. Each fixture has one primary class, separate discovery and artifact outcomes, confidence, determinism, visual status, candidate-level blockers, and a fixture-specific follow-up recommendation in the [JSON receipt](issue-706-cross-corpus-generalization.json).

| Wave | Primary classes | Candidates | Discovered | PNG outputs | Blank | Exact duplicate groups | Unsupported |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 — character/static | MIXED | 121 | 88 | 58 | 0 | 0 | 63 |
| 2 — pose/action | MIXED | 101 | 76 | 65 | 4 | 3 | 36 |
| 3 — temporal/action | MIXED | 140 | 103 | 80 | 2 | 5 | 60 |
| 4 — Prop | PROP | 2 | 2 | 2 | 0 | 0 | 0 |

Observed source-state classes are `DIRECT_GRAPHIC_ASSET` and `AUTHORED_SCENE_STATE`. Render-address classes are `DIRECT_GRAPHIC_FRAME` (355 addresses) and the separately labeled `DIRECT_SCENE_FRAME` (9 addresses). No new semantic candidate class is justified. The Scene address is evidence-only because the current production adapter does not expose a Scene span index. The shared #705 artifact core gained optional generic contact-sheet section definitions; default B3 sections and exact-dedupe behavior remain unchanged. No corpus-specific production rule or persisted class was added.

Blockers are ranked by observed product impact. Counts below are unique candidate addresses; source-level compatibility observations are tracked separately.

| Priority | Gap | Evidence | Recommended action |
| ---: | --- | --- | --- |
| 1 | `NESTED_GRAPHIC_TIMING` | 92 candidate addresses across 8 fixtures | #703 is closed with a narrow synchronization result. If Stage C requires broader child-clock selection, create a separate bounded follow-up from these addresses; do not infer broader support from #703. |
| 2 | Temporal/tween fidelity | 8 sources contain tween spans; all 5 Wave 2/3 action fixtures are temporal | Continue under open [Issue #694](https://github.com/Cognitive-Architect/panda-stage/issues/694). Preserve static anchors without claiming action reconstruction. |
| 3 | `UNKNOWN_SEMANTIC` | 66 candidate addresses across 5 fixtures | Keep fail-closed and gather source/address evidence before defining an implementation issue. |
| 4 | `TRANSFORM` | 1 candidate address in 1 fixture | Defer a capability issue until another fixture or a confirmed Stage C requirement supports it. |

ActionScript and MovieClip compatibility diagnostics appear as source-level observations. They are not counted as candidate-route failures unless attached to a candidate. No execution/runtime follow-up is recommended from these observations alone. The fixture-specific recommendations and source-level families are preserved in the JSON receipt.

The approach generalized to repeatable, provenance-preserving direct Graphic snapshots and to a Prop control without character labels. It did not generalize Black-specific full-character/component semantics; those remain unknown without source/reference review. No follow-up Issue was opened as part of B4. [Issue #703](https://github.com/Cognitive-Architect/panda-stage/issues/703) was closed when checked for this report; its narrow result is a boundary, while [Issue #694](https://github.com/Cognitive-Architect/panda-stage/issues/694) was open and is the existing temporal-fidelity route.

Source mutation: **NO**. Product UI: **NO**. Persisted schema: **NO**. AI/perceptual classifier: **NO**. Focused `pnpm exec vitest run tests/unit/issue705-black-asset-batch.test.ts tests/unit/issue706-cross-corpus.test.ts`: **PASS, 2 files / 11 tests**. Focused ESLint for the B4 batch script and unit file: **PASS**. Automatic Focused core quality CI run [#37254992349](https://github.com/Cognitive-Architect/panda-stage/actions/runs/37254992349) passed on delivery commit `df29441`; the receipt update is covered by the automatic PR check for the new head.

## Stage C recommendation

Proceed with a bounded static-asset subset: deterministic discovery and review of direct Graphic authored-frame snapshots, alpha blank detection, exact PNG dedupe, and preserved source provenance. Keep nested Graphic timing, tween interpolation, MovieClip/script runtime, temporal reconstruction, and unknown semantics outside that supported subset. Do not promote a snapshot to a named pose or full-character composite without reference review.

This evidence updates mother PR #677 and does not mark it ready. No production editor behavior or project schema was changed.

**Next single action:** maintainer reviews the nine external contact sheets and representative PNGs, then decides whether the bounded Stage C subset is acceptable and whether a separate nested-timing issue is warranted. Keep PR #677 Draft until that review.

## Reproduction

Run `pnpm research:issue706-cross-corpus` from the repository root. The package script builds the Electron app, reads the approved source root `D:\表情合集`, and writes each run to a unique timestamped directory under `D:\PandaStage-Acceptance\`. The exact package script is in [package.json](../../package.json); the probe reuses [the #705 artifact core](../../scripts/research/issue705-black-asset-batch-core.cjs).
