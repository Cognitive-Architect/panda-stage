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

## Stage C recommendation

Proceed with a bounded static-asset subset: deterministic discovery and review of direct Graphic authored-frame snapshots, alpha blank detection, exact PNG dedupe, and preserved source provenance. Keep nested Graphic timing, tween interpolation, MovieClip/script runtime, temporal reconstruction, and unknown semantics outside that supported subset. Do not promote a snapshot to a named pose or full-character composite without reference review.

This evidence updates mother PR #677 and does not mark it ready. No production editor behavior or project schema was changed.

## Reproduction

Run `pnpm research:issue706-cross-corpus` from the repository root. The package script builds the Electron app, reads the approved source root `D:\表情合集`, and writes each run to a unique timestamped directory under `D:\PandaStage-Acceptance\`. The exact package script is in [package.json](../../package.json); the probe reuses [the #705 artifact core](../../scripts/research/issue705-black-asset-batch-core.cjs).
