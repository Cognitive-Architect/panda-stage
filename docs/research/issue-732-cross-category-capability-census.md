# Issue #732 — Cross-Category FLA Capability Census

- Issue: [#732](https://github.com/Cognitive-Architect/panda-stage/issues/732)
- Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677) (OPEN / DRAFT at report generation)
- Frozen baseline: `1e7091c4b34e4ff8b7d77bc5c10015b6e37f0c9f`
- Corpus: 28 FLAs (characters 11, props 7, effects 10)
- Inventory delta from maintainer list: none; recursive filesystem census exactly matched 28 expected files.
- Source hashes: 28 recorded; all unchanged after both probes.
- Production changes / FLA mutations / fixture workarounds: 0 / 0 / 0.

## Capability summary

The baseline safely parsed all 28 sources, found at least one product catalog candidate in each, and emitted 567 candidate previews from 1435 authored-state rows. The preview emission rate is 39.5%; it is not a correctness or product-readiness rate. The static probe repeated deterministically for 28/28 files.

The production frame-sequence seam completed 14/21 temporal files and 15 unique root-timeline clips. It resolved 423/3129 requested frames (13.5%): 161 AUTHORED, 0 TWEEN_RECONSTRUCTED, 262 HELD, and 2706 BLOCKED. The seven remaining temporal files are split across six renderer-blocked sources and one source whose Scene temporal root was not exposed by the bounded product catalog.

No independent authored reference images or maintainer visual sign-off were available. Therefore G3 is REFERENCE UNAVAILABLE for all 28 files. Strict Issue-defined Product Ready and Engine Renderable rates (A and A+B) are both 0/28; this is an evidence-conservative rate, not a claim that no output was produced. Seven-gate and per-file details are in [CSV](issue-732-cross-category-capability-census.csv) and [JSON](issue-732-cross-category-capability-census.json).

## Category results

| Category | Total | Product ready | Engine renderable (A+B) | Temporal | G5 complete | Candidate previews / authored states |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CHARACTER | 11 | 0/11 (0%) | 0/11 (0%) | 11 | 5 | 347/1204 |
| PROP | 7 | 0/7 (0%) | 0/7 (0%) | 0 | 0 | 58/58 |
| EFFECT | 10 | 0/10 (0%) | 0/10 (0%) | 10 | 9 | 162/173 |

## Class distribution

| Class | Files |
| --- | ---: |
| A | 0 |
| B | 0 |
| C | 2 |
| D | 4 |
| E | 22 |

A/B remain zero because the Issue requires visual correctness and product usability, neither of which was signed off. C is reserved for the two explicitly identified linear-stroke-fill blockers. D covers three open-fill-boundary sources and one motion-tween source outside the bounded transform-only subset. E covers the catalog-root omission and files whose source/product correctness remains unknown pending review.

## Blocker concentration

| Family | Files | Categories | First gate | Likely class | Representative files |
| --- | ---: | ---: | --- | --- | --- |
| SHAPE_REGION_GENERATION_OPEN_FILL_BOUNDARY | 3 | 1 | G5 | D — NEW_SEMANTIC_FAMILY | 汉服修仙女.fla、青绫修仙女（四视角）.fla、修仙男.fla |
| BOUNDED_LINEAR_STROKE_FILL | 2 | 1 | G5 | C — BOUNDED_ENGINE_GAP | 魔修.fla、浅蓝修仙女.fla |
| MOTION_TWEEN_METADATA_OUTSIDE_BOUNDED_SUBSET | 1 | 1 | G5 | D — NEW_SEMANTIC_FAMILY | 直播间.fla |
| TEMPORAL_ROOT_NOT_EXPOSED_BY_PRODUCT_CATALOG | 1 | 1 | G5 | E — SOURCE_OR_UNKNOWN / PRODUCT GAP SUSPECTED | 蓝发修仙女.fla |
| VISUAL_REFERENCE_AND_PRODUCT_REVIEW_PENDING | 21 | 3 | G3/G6 | E — SOURCE_OR_UNKNOWN | 飞奔.跑.fla、尴尬.fla、内心独白.fla、人物死亡消失.fla、生气.fla |

Observed outcome families: 5 total, including 4 concrete engine/product blocker families and one visual/product-review evidence family. The largest three concrete families are 1) SHAPE_REGION_GENERATION_OPEN_FILL_BOUNDARY (3); 2) BOUNDED_LINEAR_STROKE_FILL (2); 3) MOTION_TWEEN_METADATA_OUTSIDE_BOUNDED_SUBSET (1).

The legacy Issue #706 probe's `NESTED_GRAPHIC_TIMING` and `UNKNOWN_SEMANTIC` labels are preliminary observations only. The final blocker grouping uses the production temporal seam's exact first failure; the legacy labels were not counted as final semantic families.

## Gate rollup

- G0: PASS 28/28; 25 sources used in-memory archive normalization and 3 parsed without it. Source bytes were never written.
- G1: PASS 28/28; candidate discovery is heuristic and does not prove product identity.
- G2: 28/28 partial pending coherence review; rendered output exists for 28/28. Strict coherent-static confirmation remains 0 until review.
- G3: HUMAN PASS 0; PARTIAL 0; FAIL 0; REFERENCE UNAVAILABLE 28. Contact sheets exist for 26/28; the two over-budget files retain individual candidate render indexes. Seven limited exploratory visual spot checks were not counted as acceptance.
- G4: structural temporal facts captured for 21 files; source probes still mark family review as needed. Static N/A 7.
- G5: complete 14; partial 6; blocked/no catalog root 1; static N/A 7.
- G6: not product usable 7; unknown 21; product-ready 0; engine-ready/product-gap 0.

## Interpretation and next action

Current measured boundary: Panda parses this mixed corpus and emits candidate previews across all three categories. On the production temporal path it reconstructs complete source-timed sequences for 14 temporal files; it stops on open fill boundaries, linear stroke fills, one out-of-subset motion tween, and one catalog-root omission. These results do not establish that the candidates are visually faithful or directly usable by an ordinary creator.

Biggest product question: whether candidate fragments, repeated states, and multi-view characters can be organized into an ordinary creator-facing asset. The census did not validate that flow.

Biggest engine/semantic gap by repeated files: open-fill boundary / Shape Region Generation (3 character files), followed by linear stroke fill (2 character files).

Recommended next investment: maintainer reviews the 26 contact sheets and the two over-budget candidate indexes, supplies or identifies authored references where possible, and records G3/G6. Then decide whether the three-file open-fill family merits a bounded evidence issue.

### Evidence locations

- Static census: `D:\PandaStage-Acceptance\issue732-b5u-round1-20261007b`
- Temporal production probe: `D:\PandaStage-Acceptance\issue732-b5u-temporal-20261007-v2`
- Contact sheets / frame PNGs / decoded MP4s remain outside the repository under those acceptance directories. The JSON and CSV carry per-file source hashes and artifact paths.
