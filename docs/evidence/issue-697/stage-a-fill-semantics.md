# Issue #697: Stage A fill-semantics research

**Status:** research complete; implementation not authorized
**Issue:** [#697](https://github.com/Cognitive-Architect/panda-stage/issues/697)
**Mother PR:** [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677), remains Draft/Open
**Evidence HEAD:** `e845d020dac723bd1c02d31b93b100909d351f15`
**Research date:** 2026-10-04

## Result

**Classification: C — PARSER/NORMALIZATION CORRECTIVE CANDIDATE.** Confidence is high that Panda's current decoder changes the two target fill graphs through its 0.5 px comparisons. Confidence in the complete Adobe Animate interpretation is medium: the external XFL implementation used here is reverse-engineered corroboration, not an Adobe specification. This evidence does not claim C06 acceptance.

The earliest demonstrated differences are in Panda's edge-command decoding, before fill graph construction:

- Black has one source-authored quadratic whose endpoint is 3 by 4 source units from its start. Panda treats it as closed under its per-axis 0.5 px tolerance and adds a closing segment that was not authored.
- Alchemy has eight non-zero source-authored line commands with 1–8 unit deltas. Panda suppresses them under the same tolerance.

Preserving each encoded command and closing only at exact decoded endpoint equality makes both source-derived fill graphs balanced, without snapping coordinates, inventing connectors, or discarding authored segments. The exact-mode builds also preserve the tested accepted controls byte-for-byte. A narrow corrective Issue should define any implementation and its validation; no production code or FLA was changed for this research.

## Source identity and targets

| Fixture | Original source SHA-256 before / after | In-memory normalized SHA-256 | Target / shape / fill |
| --- | --- | --- | --- |
| Black (`黑衣修仙男.fla`) | `A328A163DD212F0369E27B30E5078178FD42744954203FDAD6A9CD06F3B171FA` / identical | `681237ABB7B32E79CE89FF8E283B0573B4BF170C6B85830828C7A10911BC7A33` | Scene 0 `fla-render-target-680581b05cd778ce0f05f78b9b4e31fdfcc938d10ccb84a40f4d035074cd48f1`; `fla-shape-f715af380bb888b2571345e2`; FillStyle 1 |
| Alchemy (`炼丹房.fla`) | `3ED47C25685ECE18AFE50E646996DE9C39AB22B29DCDE96A81FAB291368209D2` / identical | `F3BD2C75620AB2FBC7F0CFC083546773B1E67AD452F1793F6D5B46BB089A47E9` | Scene 0 `fla-render-target-94f2f4930fca612309fb1856a6603cd7995efc86203afdae0e6bcc27245f57d3`; `fla-shape-e58f2cebcb8125366fb1d679`; FillStyle 10 |

Both archives needed a one-byte, in-memory ZIP EOCD `centralDirectorySize` compatibility correction before parsing. Black's declared size was changed from 1629 to 1575 at archive offset 3503245 (byte `93` to `39`); Alchemy's from 742 to 688 at offset 1575068 (byte `230` to `176`). The source files were not rewritten; their before/after hashes match. The normalized hashes identify the in-memory inputs and are included to make the recovery step auditable.

The selected target fill's complete raw Edge records, including XML and both raw geometry attributes, are in [target-fill-edges.json](./target-fill-edges.json). Absolute fixture paths are intentionally omitted.

## Source and current-parser observations

The current builder divides ordinary coordinate values by 20, then uses `EPSILON = 0.5` for move and line comparisons and for inferred near-closure. On closure it emits `Z`; fill reconstruction materializes a line back to the start if the endpoint is not exact. The production implementation points are [coordinate decoding and edge commands](../../../src/main/services/fla-static-snapshot-svg-builder.ts#L267), [move/line epsilon comparisons](../../../src/main/services/fla-static-snapshot-svg-builder.ts#L408), [near-closure](../../../src/main/services/fla-static-snapshot-svg-builder.ts#L548), [geometry attribute selection](../../../src/main/services/fla-static-snapshot-svg-builder.ts#L804), [fill reconstruction](../../../src/main/services/fla-static-snapshot-svg-builder.ts#L1387), and [world transform application](../../../src/main/services/fla-static-snapshot-svg-builder.ts#L2719).

### Black, FillStyle 1

The selected fill has 14 Edge records. Its shape contains 160 records: 22 have `edges` only, 138 have `cubics` only, and none has both attributes. All 14 records selected for FillStyle 1 carry `edges`; the edges-only diagnostic reproduces production selection exactly.

Edge 15 contains the source command sequence `!-3970 5379S7[-3968 5377 -3967 5375`. Its quadratic starts at `(-3970, 5379)`, has control `(-3968, 5377)`, and ends at `(-3967, 5375)` in source units. After division by 20, the endpoint delta is `(0.15 px, 0.20 px)` (5 twips in Euclidean length). The 0.5 px per-axis final comparison infers closure. Fill reconstruction then adds a non-authored line from `(-198.35, 268.75)` to `(-198.50, 268.95)`.

That additional line accounts for the imbalance reported by #693: at raw `(-3970,5379)` the current graph has in=1/out=2; at raw `(-3967,5375)` it has in=2/out=1. Preserving the open quadratic command rather than inferring `Z` leaves 98 authored segments and 98 endpoints, balanced as 3 exact cycles. The current parser graph had 99 segments, including the extra close.

### Alchemy, FillStyle 10

The selected fill has 17 Edge records. Its shape contains 3763 records: 1734 have `edges` only, 2029 have `cubics` only, and none has both. All 17 records selected for FillStyle 10 carry `edges`; the edges-only diagnostic reproduces production selection exactly.

The decoder omits eight non-zero `|` line commands whose per-axis deltas are below 0.5 px (ordinary source units are divided by 20, so this threshold spans 10 source units per axis). Edge 17 has three such commands from `(29412,11865)` through `(29417,11866)` and `(29419,11868)` to `(29424,11870)`. Edge 1108 has three from `(8682,11085)` through `(8677,11086)` and `(8676,11088)` to `(8671,11091)`. Edge 111 and Edge 1107 each contribute one more suppressed short line. The full encoded records are preserved in the JSON appendix.

The current 78-segment graph consequently has the four unmatched endpoints from #693: `(8671,11091)` in=1/out=0; `(8682,11085)` in=0/out=1; `(29412,11865)` in=1/out=0; and `(29424,11870)` in=0/out=1. Retaining the eight encoded lines produces 86 authored segments and 86 endpoints, balanced as 2 exact cycles. No coordinate values are adjusted.

## Style, orientation, fields, and transforms

The target Edge records are selected by their `fillStyle0` or `fillStyle1` ownership, and their raw records are retained in the appendix. An alternate diagnostic using the opposite global fill-side orientation also produces balanced graphs for both targets; reversing orientation does not repair or create the production imbalance. Thus fill-side direction alone is not causal.

The target-selected records all contain `edges` and have empty `cubics`. The shape-wide `cubics || edges` preference therefore cannot explain either target result: the chosen field for these styled records is `edges` either way. A cubics-only counterfactual removes their style-bearing geometry and is not a valid target-fill comparison. The global field-coverage counts above are not evidence that the attributes are interchangeable.

Boundary graphs are assembled in shape-local coordinates. Panda applies the resolved node world transform after fill reconstruction. Black's shape matrix is `(a=1.18701171875, b=0, c=0.13714599609375, d=1.2557373046875, tx=208.1, ty=-451.55)` and the resolved node transform is `(a=1.18701171875, b=0, c=0.13714599609375, d=1.2557373046875, tx=1153.4, ty=-205.2000000000001)`. Alchemy's direct shape translation `(-124.05,-109.5)` is canceled by its parent symbol translation `(+124.05,+109.5)`, yielding the identity world transform. Endpoint comparisons are not mixing transform spaces.

## In-memory exact-command counterfactual

The diagnostic loaded a compiled copy of the production builder and changed only its move/line near-equality predicates (2 replacements) and near-close predicate (1 replacement). Repository source remained unchanged. No snapping, coordinate nudging, nearest-point join, or synthetic connector was used.

| Fixture / diagnostic | Current production | Exact-command counterfactual | Result |
| --- | --- | --- | --- |
| Black FillStyle 1 | 99 segments; 2 unmatched endpoints; inferred close present | 98 segments; balanced; 3 exact cycles; no inferred close | All authored segments retained |
| Alchemy FillStyle 10 | 78 segments; 4 unmatched endpoints | 86 segments; balanced; 2 exact cycles | All 8 suppressed authored lines restored |
| Black / Alchemy, alternate fill-side orientation | unbalanced current graph | balanced exact-command graph | Orientation-independent balance |

An independent parser based on the reverse-engineered XFL edge grammar also reconstructed balanced source graphs. The independent implementation documents `!` move, line and quadratic commands, coordinates scaled by 20, and fill-side orientation. It is corroboration, not an Adobe-authoritative format specification: [xfl2svg edge parser](https://github.com/PluieElectrique/xfl2svg/blob/master/xfl2svg/shape/edge.py). Additional reverse-engineered notes describe shared edges, fill side, and twip scaling: [SavageFlask FLA notes](https://github.com/SasQ/SavageFlask/blob/master/doc/FLA.txt).

## Negative controls and limits

All checks below were targeted, in-memory diagnostics; no test suite or repository verifier was run.

- Five previously accepted Flying C06 non-bitmap targets remained successful and their SVG bytes/hashes matched exactly. Three bitmap targets were outside this diagnostic. This is a no-regression observation only; it is **not** a C06 pass.
- C02 adjacent fills, disconnected closed contours, and a closed composer square remained byte-identical. The open-fill case remained deterministically unsupported.
- #692 T-junction, degree-four crossing, connected chain, and closed-loop stroke controls kept the same output and segment/path counts; branched strokes remain separate authored subpaths.
- #688 zero-style references retained their no-style semantics. #691 S1–S7 stayed rendering-neutral; unsupported S0 and S8 remained deterministic rejections.
- Before/after source hashes match for both FLA files. No source FLA was mutated and no production file was edited.

These findings isolate Panda's tolerance-based command normalization as the earliest demonstrated divergence. They do not establish pixel fidelity against Adobe Animate, explain every FLA encoding, or authorize production changes. The appropriate next step is a separate narrowly scoped corrective Issue covering exact preservation of authored non-zero lines and explicit closure semantics, with production implementation and validation defined there.

## Required completion receipt

```text
Issue: #697
parent roadmap: #696
related: #686 / #693 / PR #677

Black:
source hash: A328A163DD212F0369E27B30E5078178FD42744954203FDAD6A9CD06F3B171FA (unchanged)
target: fla-render-target-680581b05cd778ce0f05f78b9b4e31fdfcc938d10ccb84a40f4d035074cd48f1
shape: fla-shape-f715af380bb888b2571345e2
fillStyle: 1
raw source topology: selected raw Edge records retained; one quadratic ends 3x4 source units from its start
parser topology: 99 segments; one inferred close; two degree imbalances
Panda topology: current production rejects open fill; exact-command graph is 98 segments, 3 cycles
earliest divergence: 0.5 px per-axis near-closure in edge decoding
candidate semantic: preserve encoded segment endpoints; close only on exact decoded endpoint equality
confidence: high for Panda-side cause; medium for Adobe interpretation

Alchemy:
source hash: 3ED47C25685ECE18AFE50E646996DE9C39AB22B29DCDE96A81FAB291368209D2 (unchanged)
target: fla-render-target-94f2f4930fca612309fb1856a6603cd7995efc86203afdae0e6bcc27245f57d3
shape: fla-shape-e58f2cebcb8125366fb1d679
fillStyle: 10
raw source topology: 17 selected Edge records include eight non-zero short line commands
parser topology: 78 segments; four unmatched endpoints
Panda topology: current production rejects open fill; exact-command graph is 86 segments, 2 cycles
earliest divergence: 0.5 px per-axis line suppression in edge decoding
candidate semantic: preserve each encoded non-zero line; no endpoint movement
confidence: high for Panda-side cause; medium for Adobe interpretation

edge/style ownership: both fill-side references inspected; alternate global orientation remains balanced; S markers are neutral
coordinate units: ordinary source coordinates are divided by 20
precision/rounding: 5-twip Black gap and 1–8-unit Alchemy authored lines were suppressed by 0.5 px comparisons
transform spaces: graphs are shape-local; world transform is applied after fill reconstruction; Alchemy direct/parent translations cancel
parser loss: Black gains one un-authored closing line; Alchemy loses eight non-zero authored lines
quantization/tolerance evidence: the observed 0.5 px rule is Panda code behavior, not evidence of an Animate tolerance rule
external corroboration: reverse-engineered xfl2svg grammar and SavageFlask notes; neither is Adobe-authoritative

negative controls: five Flying targets, C02 closed/open fixtures, #692 stroke controls, #688 style-zero, #691 marker cases; outputs unchanged
source hashes unchanged: yes

result:
- C PARSER/NORMALIZATION CORRECTIVE CANDIDATE

production implementation authorized:
NO

next single action:
Open a narrow corrective Issue; implement and validate only under that Issue.
```
