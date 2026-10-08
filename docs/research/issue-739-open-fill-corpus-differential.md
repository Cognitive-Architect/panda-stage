# Issue #739 — Current Open-Fill Corpus Differential

- Date: 2026-10-08
- Baseline HEAD: `0fa3cd31ba4da96b48956799f7c32a027be04f45` (post-#738)
- Branch: `issue-676-p0-c01-display-list-resolver`
- Delivery: existing PR #677; keep Draft/Open.
- Scope: research-only. No production parser, renderer, or stitcher code changed.

## Result

All three V0 first-failing Shapes have the same **candidate F — ANIMATE_DERIVED_REGION_SEMANTIC** observation: Raw XFL and Panda agree on the whole-Shape draw-subsegment totals and on the target-fill boundary segments that have a source-side mapping. Every mapped target-fill line or quadratic has exact endpoints in an Animate contour, and each quadratic control point also matches exactly. Panda's target-fill graph is still blocked/open while Animate exposes closed target-fill contours with additional interior edges.

This is a stage-level finding, not a production repair contract. The Animate-only interior edges have no source-edge identity in the captured API, their counts differ by Shape, and the Issue #737 control also has extra Animate interior edges while Panda renders successfully. **Stop before implementation.** Do not infer that the extra-edge count alone causes the failures or that one shared fix is justified.

The Issue #737 historical control and the positive closed-fill control are recorded as **H — MIXED / INSUFFICIENT** because neither is a failing Shape to classify into A–G. The historical control renders and maps all 98 Panda boundary segments into Animate interior contours; the positive control renders and maps all 16.

## Per-Shape findings

`Animate interior` follows Adobe's documented `Contour.interior` property: true means the contour encloses an area; false means it does not. Adobe describes a Contour as a closed path of half edges. [Adobe Animate Contour documentation](https://github.com/AdobeDocs/developers-animatesdk-docs/blob/master/Contour_object/contour_summary.md)

| Shape / FillStyle | Raw XFL | Panda target boundary | Animate target fill | Class |
| --- | --- | --- | --- | --- |
| 汉服修仙女 / `#C3B4B3` | 179 Edge records; 273 subsegments (`23 L / 118 Q / 132 C`); 4 close markers | 84 segments (`83` raw + `1` authored-close semantic); 84 endpoints, 2 imbalanced, 2 cycles consume 54, remainder 30; blocked | 10 closed contours (`8` interior); 113 interior half-edges / 100 unique interior edges; `83/84` Panda segments match, `17` interior edges unmatched | **F** |
| 青绫修仙女（四视角） / `#C6CDD2` | 95 Edge records; 176 subsegments (`28 L / 72 Q / 76 C`); 4 close markers | 59 (`58 + 1`); 60 endpoints, 2 imbalanced, no complete cycle, remainder 58; blocked | 6 closed contours (`5` interior); 64 interior half-edges / 61 unique interior edges; `58/59` match, `6` interior edges unmatched | **F** |
| 修仙男 / FillStyle 1 gradient | 88 Edge records; 121 subsegments (`16 L / 39 Q / 66 C`); 11 close markers | 23 (`22 + 1`); 24 endpoints, 2 imbalanced, 1 cycle consumes 16, remainder 7; blocked | 3 closed contours (`2` interior); 25 interior half-edges / 25 unique interior edges; `22/23` match, `10` interior edges unmatched | **F** |
| #737 historical Shape / `#191917` | 160 Edge records; 277 subsegments (`1 L / 138 Q / 138 C`); no close markers | 98 raw segments; 98 balanced endpoints; cycles `75 / 13 / 10`; renders | 4 closed interior contours; 138 interior half-edges / 118 unique interior edges; `98/98` match, `20` interior edges unmatched | **H control** |
| Known-working closed-fill control / `#EDCFBC` | 33 Edge records; 63 subsegments (`0 L / 34 Q / 29 C`); no close markers | 16 raw segments; 16 balanced endpoints; one 16-edge cycle; renders | 2 closed contours (one interior); 16 interior half-edges / 16 unique interior edges; `16/16` match, no interior edge unmatched | **H control** |

### Raw XFL and Panda retention

| Shape | FillStyle 0 ownership records / subsegments | FillStyle 1 ownership records / subsegments | FillStyle 1 Raw draws → Panda draws | Panda commands / style runs / style changes | Reversed FillStyle 0 segments |
| --- | ---: | ---: | ---: | ---: | ---: |
| 汉服修仙女 | 21 / 78 | 16 / 37 | 99 → 99 | 463 / 179 / 0 | 63 |
| 青绫修仙女（四视角） | 9 / 48 | 8 / 16 | 61 → 61 | 282 / 95 / 0 | 45 |
| 修仙男 | 3 / 7 | 6 / 15 | 22 → 22 | 228 / 88 / 0 | 8 |
| #737 historical | 7 / 33 | 10 / 105 | 118 → 118 | 442 / 160 / 0 | 13 |
| Closed-fill control | 2 / 19 | 2 / 31 | 33 → 33 | 97 / 33 / 0 | 2 |

Raw marker counts:

| Shape | Raw Edge-style tuple transitions | Mid-edge style changes | Authored close markers | `S` selection markers |
| --- | ---: | ---: | ---: | ---: |
| 汉服修仙女 | 47 | 0 | 4 | 47 |
| 青绫修仙女（四视角） | 19 | 0 | 4 | 19 |
| 修仙男 | 22 | 0 | 11 | 0 |
| #737 historical | 22 | 0 | 0 | 22 |
| Closed-fill control | 4 | 0 | 0 | 4 |

All five Shapes have zero detected mid-edge style changes. `S` tokens are counted as selection markers, separately from style changes. Raw-to-Panda whole-Shape draw counts match for all five. Every Panda target-boundary record in the machine map links to its raw Edge index/subsegment ordinal and to the source-side entry used to build the oriented boundary. The map does not claim an Animate crosswalk for non-target-fill draws.

### First divergence and per-segment map

For each failing Shape, every `raw-edge-subsegment` in the Panda target boundary maps to an Animate target-fill HalfEdge by exact numeric endpoint equality. The line edges also report an Animate line type; the quadratic controls match exactly. All mapped Panda boundary directions are opposite the corresponding Animate HalfEdge direction. The same direction convention occurs in both controls, so direction alone does not support classification B.

The single unmatched Panda segment in each failing Shape is marked `authored-close-semantics`, not a raw draw subsegment. It came from the recorded XFL close marker and is listed with its exact endpoints in the JSON. No connector was inferred. Animate's selected target-fill contours are closed, but they do not expose a HalfEdge with that exact endpoint pair. The unmatched close segment and the Animate-only interior edges remain source-provenance gaps; the receipt preserves them explicitly.

Animate target-fill selector:

- Hanfu and Qingling: exact solid fill color from the selected XFL FillStyle.
- Male: exact gradient stop colors, 0–255 stop positions, and spread method. The source and per-contour matrices are all retained; matrix values were not used as the selector because the composite Shape exposes multiple contour matrices for the same stop signature. This is the least certain target-fill association.

The target DOM member paths resolve from XFL `8/0 → 8`, `0/0/2/0 → 0/0/2`, and `0/2/1/1/0 → 0/2/1/1`. Terminal XFL child index `0` is not exposed in Animate's DOM path. Hanfu/Qingling path evidence includes source matrix or selected fill agreement; for the male Shape, `tx/ty` match while `a/d` differ by about `0.000137329`.

Animate's full selected Shape inventories are 145 edges / 136 vertices / 17 contours (Hanfu), 104 / 99 / 13 (Qingling), 66 / 57 / 13 (male), 139 / 133 / 8 (#737), and 34 / 35 / 3 (closed-fill control). The JSON retains each complete Shape and its Contour/HalfEdge adjacency.

The exact endpoint comparison uses no tolerance, snapping, coordinate change, or synthetic segment. The machine map retains the full Panda boundary map, each exact Animate candidate (including contour interior/orientation, HalfEdge and Edge IDs, endpoints and control points), every unmatched Panda boundary segment, every unmatched Animate interior edge, the raw Edge token records, and the captured Animate Shape object.

## Classification and next step

| Shape | First divergence | Classification | Confidence / next action |
| --- | --- | --- | --- |
| 汉服修仙女 | Animate's derived interior topology differs from Panda's blocked exact boundary graph after 83 raw segments map; 17 additional Animate interior edges have no Panda boundary match. | **F candidate** | High within target-fill boundary; stop before implementation. Trace the 17 Animate-only edges before proposing a repair. |
| 青绫修仙女（四视角） | Animate's derived topology differs after 58 raw segments map; 3 mapped segments land in `interior=false` contours, and 6 Animate interior edges remain unmatched. | **F candidate** | High within target-fill boundary; stop before implementation. Trace the 6 Animate-only edges and preserve the 3 exterior matches as distinct. |
| 修仙男 | Animate's derived topology differs after 22 raw segments map; 7 matches are in `interior=false` contours, and 10 Animate interior edges remain unmatched. | **F candidate** | Medium-high. Gradient matrix/path differences and executable provenance caveat remain; verify those before a follow-up implementation proposal. |
| #737 historical Shape | Panda renders and all 98 boundary segments map to Animate interior edges; Animate has 20 more interior edges. | **H control** | Keep as historical cross-stage control. The prior published-SWF result is recorded in [the #737 closeout](issue-737-final-swf-crossstage-closeout.md); this issue did not rerun SWF export. |
| Closed-fill control | Panda renders; all 16 boundary segments map into 16 Animate interior edges. | **H control** | Keep as positive harness control. |

All three failures share the same candidate stage classification, but this evidence does not prove a common repair. The historical control demonstrates that extra Animate interior edges can coexist with a successful Panda render. The next bounded research, if authorized, is to establish provenance for the Animate-only interior edges and the authored-close mapping per Shape. No Open-Fill implementation is authorized by this result.

## Runtime and source provenance

| Item | Evidence |
| --- | --- |
| Animate install | `D:\AN2023\Adobe Animate 2023\Animate.exe`, reports `WIN 23,0,0,407`; ProductVersion `23.0.0` |
| Executable SHA-256 | `0F869BD383E679611C6F85D887F72FE636B16403A5B98F79DF87F6F563ED3838` |
| Authenticode | `HashMismatch`; certificate subject is Adobe Inc. This installation is not verified as an unmodified Adobe-signed binary. |
| Panda repeat | Two deterministic runs per Shape; target differential hashes match. |
| Animate repeat | Shape capture hashes match across two captures in the same open Animate session. The JSFL receipts omit a process ID, so this is not an independent-process repeat. |
| JSFL write safety | `saveApiCalled=false`; file modification values before/after match. The collector's `documentModifiedAfterCapture` field is null, so it is not represented as a proven false value. |
| Frozen source FLA hashes | All five original hashes match before/after; the five files opened by Animate are byte-identical copies in `D:\PandaStage-Acceptance\issue739-open-fill-differential-20261008\animate-inputs-run01`. |
| Original dirty Animate tab | After capture, the existing `黑衣修仙男.fla*` tab was reselected. It was not saved or closed. |

Frozen original hashes:

| FLA | SHA-256 |
| --- | --- |
| `汉服修仙女.fla` | `6AF14990029D4CED2C4E305721321835180C1BF041178A8799E1D14A1F62E535` |
| `青绫修仙女（四视角）.fla` | `D0958D4432DECBF6C54566BA15A2F5E97BD88C82D75DCB2F84603E9B2273F0E4` |
| `修仙男.fla` | `565C5609A7610EF64ED9F98B09D98DD82D5A45255ADB4D3D410A5A365E0EF4A5` |
| `黑衣修仙男.fla` | `A328A163DD212F0369E27B30E5078178FD42744954203FDAD6A9CD06F3B171FA` |

The four source files include the historical/control pair in the same FLA, so there are four distinct originals across five target Shapes.

## Evidence and reproducibility

- [Machine-readable Raw XFL → Panda → Animate differential](../evidence/issue-739/issue739-open-fill-corpus-differential.json)
- [Raw XFL/Panda capture helper](../../scripts/research/issue739-xfl-panda-differential.cjs)
- [Animate JSFL read-only collector](../../scripts/research/issue739-animate-oracle.jsfl)
- [Receipt composer](../../scripts/research/issue739-compose-differential.cjs)
- External source copies and original receipts: `D:\PandaStage-Acceptance\issue739-open-fill-differential-20261008`

The committed differential JSON is 5,571,000 bytes with SHA-256 `569898D8CA600BD25958E13DA8C3E38FBF64E8290CE64776F3CBB9F6700BC0F4`. Re-composing it from the same receipts produced the same file hash.

With the external receipts present, regenerate the committed differential with:

```powershell
node scripts/research/issue739-compose-differential.cjs --overwrite
```

The composer rechecks all source and Animate-copy hashes, Panda receipt stability, Animate Shape hashes, and executable Authenticode status. It refuses to overwrite the composed receipt unless `--overwrite` is provided.

## Validation and delivery

- User-requested `pnpm test:integration`: **38 test files, 189 tests passed**. Vite emitted existing empty legacy CSS and large-chunk warnings; no test failed.
- Research helper syntax checks and deterministic receipt composition: passed.
- Source and Animate-copy hashes: unchanged and byte-identical to the frozen values.
- `git diff --cached --check`: passed.
- Full CI and `pnpm verify:project`: not run; Issue #739 is research-only.
- PR #677 remains Draft/Open; Issue #739 remains open.

No production code, endpoint coordinates, or source FLA bytes were changed. Completion will be backfilled to parent Issue #733 as requested; the PR stays on the existing branch.
