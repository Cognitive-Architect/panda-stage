# Issue #737 Final SWF Cross-Stage Closeout

**Date:** 2026-10-08
**Scope:** Research-only closeout for Issue #737 / parent Issue #736. No production decoder, renderer, or fill-stitching changes were made.

## Final classification

**A — XFL_INTERPRETATION_BUG.** The SWF comparison preserves the corrected-XFL conclusion: all 118 target segments map one-to-one from XFL to Animate geometry and isolated SWF edges; the 98-edge fill boundary forms exact closed cycles of 75, 13, and 10 edges. No connector is needed. The naturally closed control also passes the same path.

The signed fixed-point decoder defect is real and merits a bounded production fix with regression coverage. It does **not** explain the historical Issue #693 open-remainder diagnosis by itself; that causal chain remains incomplete.

## Frozen source and identity

| Field | Value |
| --- | --- |
| Source | `D:\表情合集\黑衣修仙男.fla` |
| SHA-256 before / after | `A328A163DD212F0369E27B30E5078178FD42744954203FDAD6A9CD06F3B171FA` / same |
| Animate-reported version | `WIN 23,0,0,407` |
| Selected DOMShape | `fla-shape-f715af380bb888b2571345e2` |
| Source address | `graphic:补间 1/layer-0-frame-0/0/0/0` |
| Shape block SHA-256 | `06B1AB5BFBF2C2C92398738AF8DAF170CD0BC2D374D894EA3EC3F5E79123CF62` |
| Selected FillStyle | index `1`, solid `#191917` |
| Frozen XFL archive recovery | `RECOVERY_CANDIDATE`, in-memory-only `EOCD.centralDirectorySize` adjustment of 54 bytes; original bytes were not written |

The JSFL receipt reports `expectedPathMatches: true`, `saveApiCalled: false`, and unchanged before/after file modification metadata. A final disk hash check also matched the value above.

## Signed fixed-point evidence

The exact token occurs once in target XFL edge 2, segment 3, at the quadratic control point's x coordinate. The adjacent authored coordinates are `from=(-3963,5362)`, `control=(#FFF086.FB,5362)`, `to=(-3958,5362)` in twips.

| Interpretation | Twips | Animate local coordinate |
| --- | ---: | ---: |
| Existing Panda `decodeCoord()` sign rule | `-3962.98046875` | `-198.1490234375 px` |
| Correct signed-integer plus unsigned-fraction decode | `-3961.01953125` | `-198.0509765625 px` |
| Animate JSFL control point | — | `(-198.0509765625, 268.1) px` |

The corrected value matches Animate exactly. The corresponding SWF record is DefineShape4 ID `1`, edge `3`, record `5`: a line from `(193,-2298)` to `(199,-2298)` integer twips. The transformed expected control point is `(196,-2298)` twips and lies on that line, so the SWF stores the same straight locus without an explicit quadratic control point. The inverse-normalized SWF endpoints and the absent control are retained in the [machine-readable map](../evidence/issue-737/swf-crossstage-map.json).

The same sign rule is present in the bounded Main decoder at [fla-static-snapshot-svg-builder.ts](../../src/main/services/fla-static-snapshot-svg-builder.ts#L298), and duplicated in the renderer's `fla-parser.ts` and `edge-decoder.ts`. Issue #737 does not change any of them.

## XFL and Animate mapping

| Measure | Target | No-op control |
| --- | ---: | ---: |
| Selected Animate library item | `补间 1`, member `0/0` | member `0/4` |
| Raw target-color geometry | 118 segments | 33 segments |
| Same-fill interior edges | 20 | 17 |
| FillStyle1 / FillStyle0 boundary edges | 85 / 13 | 14 / 2 |
| XFL → Animate exact geometry matches | 118 / 118 | 33 / 33 |
| XFL geometry missing / Animate-only | 0 / 0 | 0 / 0 |
| Raw geometry direction same / reversed | 26 / 92 | 15 / 18 |
| Boundary direction after FillStyle0 reversal, same / reversed vs JSFL half-edge | 0 / 98 | 0 / 16 |

The XFL-to-Animate multiset comparison uses the full decoded coordinates without rounding or endpoint tolerance. Animate's JSFL contour API supplies one unique edge identity for each matched authored segment. Boundary direction is recorded separately from geometry identity because the JSFL half-edge orientation follows the opposite side convention for these fills.

For the target, the exact-coordinate XFL boundary graph has 98 endpoints, each with one incoming and one outgoing edge. It consumes all 98 segments into cycles `75 / 13 / 10`, with zero open remainder. The control has a single exact 16-edge cycle; the other 17 target-color segments are same-fill interior edges.

## Published SWF comparison

The whole-document export is reproducible: seven exports (`issue736-adobe-published.swf` and `-1` through `-6`) are byte-identical, SHA-256 `973FF8312E495E4BB7724A4C535715365A24A6CAE92DBF41B818C6AC6B8D9477`. Its parser found 3 DefineShape tags and no parse errors, but those movie-level shapes aggregate content and do not uniquely identify the selected library Shape.

The JSFL collector therefore exported the selected SymbolItem with `libraryItems[4].exportSWF(...)`; see [issue736-animate-oracle.jsfl](../../scripts/research/issue736-animate-oracle.jsfl#L515). In the isolated `issue736-target-symbol-2.swf` (CWS, version 43, SHA-256 `EECCF5899D8FCE1D19FA6E30C4BEA62F25991A4D593536AFAF43D660A83F93B2`), all 5 DefineShape tags parsed without errors:

| Role | DefineShape | Total edges | Target-color edges | Interior | Closed boundary cycles |
| --- | --- | ---: | ---: | ---: | --- |
| Target `#191917` | ID 1, `DefineShape4` | 139 | 118 | 20 | `75 / 13 / 10` |
| Control `#EDCFBC` | ID 5, `DefineShape4` | 34 | 33 | 17 | `16` |

The target Shape matrix is `a=1.18701171875, b=0, c=0.13714599609375, d=1.2557373046875, tx=208.1, ty=-451.55`. The control matrix is `a=d=1.3843841552734375, b=c=0, tx=-966.4, ty=-285.65`.

Normalization follows the recorded units: XFL fixed-point twips `/ 20` → local pixels → Animate Shape matrix → pixels `* 20` → integer-twip rounding at SWF ShapeRecord serialization. The boundary graph itself is built on exact source coordinates. Cross-stage endpoint association is one-to-one, retains original and projected values, and reports each residual; it does not merge or move vertices.

| SWF mapping | Target | Control |
| --- | ---: | ---: |
| Distinct projected / SWF endpoints | 117 / 117 | 34 / 34 |
| Mapped geometry / missing XFL / extra SWF | 118 / 0 / 0 | 33 / 0 / 0 |
| Endpoint residual L1 histogram, in twips | 88 at 0, 29 at 1 | 34 at 0 |
| ShapeRecord type pairs | 71 quadratic→quadratic, 47 quadratic→line | 26 quadratic→quadratic, 7 quadratic→line |
| Strict exact ShapeRecord geometry matches | 29 / 118 | 26 / 33 |
| Fill-side ownership mismatches | 0 | 0 |
| Boundary direction after FillStyle normalization, same / reversed vs XFL | 84 / 14 | 16 / 0 |
| Maximum quadratic-to-line midpoint deviation | 5.1157 twips (`0.2558 px`) | 4.9064 twips (`0.2453 px`) |

All 118 target and 33 control geometries have a one-to-one edge association with no missing or extra edge. Observed representation differences include integer-twip residuals and 47 target / 7 control curves stored as lines; per-edge types, coordinates, controls, directions, fill sides, and residuals remain explicit in the machine map. The represented boundary topology and cycle lengths are unchanged, and no publish-only target connector is present.

Three isolated SymbolItem exports have different container hashes:

| Export | SHA-256 |
| --- | --- |
| `issue736-target-symbol.swf` | `ADDC4E8935B8C4E024249456E92DB491C8998ED43A8753EB22E48CA14C234D07` |
| `issue736-target-symbol-1.swf` | `07EE146386F48013B45A038ADCEC8D4BAB1FF9A617F3B0BA4E001F1A6041F1D4` |
| `issue736-target-symbol-2.swf` | `EECCF5899D8FCE1D19FA6E30C4BEA62F25991A4D593536AFAF43D660A83F93B2` |

The normalized decoded edge-geometry fingerprints for target Shape ID 1 and control Shape ID 5 are identical across all three exports. The target fingerprint is `6E6829CD2EE4CA80F5FCE3E1BDD120A64C161C5B920A7F2DD6BF2C472DF7B043`; the control fingerprint is `3149621E39081CECE76614024903470CC5D94D5FEA59EC5839977971525BADDF`.

## Historical Issue #693 remainder

The Issue #693 receipt at `D:\PandaStage-Acceptance\issue693-c02-20261004\issue693-phase-a-fill-graph-diagnostics.json` records 99 authored segments, 98 endpoints, and two imbalanced vertices: `(-198.5,268.95)` with in/out `1/2`, and `(-198.35,268.75)` with in/out `2/1`. It uses the same original FLA SHA-256 and normalized archive SHA-256 as this closeout.

The old-minus and corrected-plus interpretations of the current fixture both produce 118 raw segments, 98 boundary edges, zero imbalanced vertices, and the same `75 / 13 / 10` cycles. More decisively, `#FFF086.FB` is a control-point coordinate, not a boundary endpoint. Its sign correction changes curve geometry but cannot by itself explain the historical endpoint imbalance or the 99-versus-98 segment count. The later `49b66df` change removed the prior `0.5 px` path epsilon and made closure exact; this is a plausible separate source of historical diagnostic drift, but the evidence does not prove that causal chain. The #693 remainder explanation is therefore **incomplete**.

## Runtime provenance and safety

The installation is present at `D:\AN2023\Adobe Animate 2023`. `Animate.exe` reports Adobe Animate 2023 `23.0.0.407`, but its Authenticode status is `HashMismatch` (SHA-256 `0F869BD383E679611C6F85D887F72FE636B16403A5B98F79DF87F6F563ED3838`). The same-version `Animate.exe.bak` is signed `Valid` (SHA-256 `6283A8B15C44CD7F9DBB63FBFA65A068117BF1CDB1C08A2EEF8B85C2F8CA9811`); `HeadlessAnimateApp.exe` is also signed `Valid`.

The existing responsive process is PID `3848`, running from `Animate.exe` with `黑衣修仙男.fla*` open. A launch check of the signed `.bak` returned to that existing Animate process, so it did not establish a separate clean-binary run. The live oracle evidence is therefore recorded as captured from this installation; the executable's vendor integrity is not verified. This is a provenance limitation, not contradictory Shape geometry. No document was saved or closed, and no additional live capture was made after discovering the signature mismatch.

| Safety field | Result |
| --- | --- |
| Production files changed | No |
| Source FLA mutated | No; before/after and current disk SHA-256 match |
| Endpoint snapping / epsilon closure | No |
| Synthetic geometry | No |
| Full CI manually triggered | No |
| PR #677 | Remains Draft/Open |

## Decision and next action

**Implementation gate:** `BOUNDED_COORDINATE_DECODER_FIX_JUSTIFIED`. The next single action is a separate, narrowly scoped production ticket to decode the negative signed integer plus its unsigned fractional field correctly and add regression coverage for the duplicate decoder paths. Keep the historical #693 root cause unclaimed until its 99-segment / two-vertex imbalance is independently reproduced.

The Issue #737 research parser changes are in `scripts/research/issue736-swf-oracle.cjs` and `scripts/research/issue737-swf-crossstage-map.cjs`. The durable edge-level data, including input receipt hashes, both transforms, direction, fill ownership, strict record matches, and every coordinate residual, is in [swf-crossstage-map.json](../evidence/issue-737/swf-crossstage-map.json).

Targeted validation performed: `git diff --check`, Node syntax checks for both research helpers, and the captured JSFL syntax check passed. Unit/integration suites and Full CI were not run.
