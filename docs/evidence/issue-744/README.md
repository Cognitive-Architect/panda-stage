# Issue #744 — XFL / Panda / Animate endpoint ledger

## Verdict

**H — MIXED / INSUFFICIENT.** The two Panda FillStyle 1 graph endpoints are fully traced to the nine retained XFL Edge records. D-A gives strong local evidence for a command-decode mismatch at the authored `/` commands. D-B's Animate interior gradient contour changes membership and contains four HalfEdges with no exact raw/Panda geometry match, so one causal explanation for both fixtures is not established. This is a research result; production Open-Fill behavior remains unauthorized.

Parent PR [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677) was Open/Draft at preflight and remains the only delivery branch. Issue #744 remains open.

## Frozen inputs and provenance

The original external archives were present and matched the frozen #743 hashes. M2 and D-A are byte-identical; D-B differs by the documented one-line representation change. The source FLA archives are not in this repository.

| Fixture | External archive SHA-256 | Raw XFL member SHA-256 | XFL target Shape block SHA-256 |
| --- | --- | --- | --- |
| D-A (same bytes as M2) | `5A501D1F787707A3965BECC31E2E5B8F5DDC519B25369E16EF68E72AF674EB5D` | `BB7C837C9AADD88D7FD0FBC55E2C457336BF4A73B1B0F7678492071BAC9994CE` | `2FB70F1737011A13A9590B2C2EDF17FE7FDE241C32467984FD21F89B2A7A3C04` |
| D-B | `2ADC8598EE0B4747E95E48F83BA8FE57617E2B189F922B90943EB72C5BAC50A0` | `351954B7F4678535D388939BBD6C9EF9CA460FB5E1C49DF5A9BC36D0EA30C309` | `E38D450769AF85E76C47C88A21E3D2CBE5B97C7305F6D7239CD5C8CEC3DC428D` |

Both target the same `Shape` (`fla-shape-196ba2d2358441409a8b4dce`), frame 0 / layer 0, XFL child path `0/2/1/1/0`, Animate DOM path `0/2/1/1`, and FillStyle 1. Exact external paths, member names, byte lengths, all nine Edge XML hashes, and capture/receipt hashes are in [receipt.json](./receipt.json), the two [endpoint ledgers](./endpoint-ledger-D-A.json) and [D-B endpoint ledger](./endpoint-ledger-D-B.json).

## Endpoint findings

The current Main decoder uses the accepted #738 signed fixed-point rule and divides XFL twips by 20. These target coordinates are decimal integer twips, so each listed point has an exact px conversion. Source command indexes and Edge ordinals are zero-based; each `/` record separately reports how many following coordinate tokens were present. No endpoint tolerance, snapping, or synthetic segment was used in the comparisons.

| Panda endpoint | Raw XFL source | Current Panda FillStyle 1 contribution | Animate observation |
| --- | --- | --- | --- |
| `(960.85,643.6)` | Edge 0 command 0 moves to `(19217,12872)`; command 1 is `/ 19207 12777` (two coordinate tokens). Edge 1 command 1 is a quadratic beginning at the same point. | Boundary 4 is Edge 1 subsegment 1, FillStyle 1 side, directed from `(960.85,643.6)` to `(953.65,645.8)`. Degree is `in=0 / out=1`. The `/` payload has no Panda boundary mapping. | D-A target contour 1 contains HalfEdge 16 from `(960.85,643.6)` to `(960.35,638.85)`, exactly the slash current-point/payload pair. D-B's target interior gradient contour does not contain this vertex; its source Edge 1 geometry appears in a no-fill contour instead. |
| `(935.25,659.15)` | Edge 4 command 1 is a line from `(18705,13183)` to `(18835,13238)`. FillStyle 0 owns target FillStyle 1 on this record. Edge 0 command 9 is `/ 18705 13183` (two coordinate tokens). | Boundary 12 is Edge 4 subsegment 1, FillStyle 0 side normalized in reverse, from `(941.75,661.9)` to `(935.25,659.15)`. Degree is `in=1 / out=0`. In D-A the production close mapping for Edge 0 returns to the subpath start `(960.35,638.85)`, not the slash payload. | D-A target contour 1 contains HalfEdge 3 from `(933.3,656.55)` to `(935.25,659.15)`, exactly the second slash current-point/payload pair. D-B's target interior gradient contour no longer contains `(935.25,659.15)`; the source Edge 4 segment is in a no-fill contour. |

For D-A the two raw slash tokens each carry two trailing coordinate tokens. Current production emits `Z` and advances over the `/` token; it does not consume those coordinates as line geometry. The first marker contributes no fill boundary segment. The second marker produces one current-Panda close-derived segment back to the previous subpath start. Animate's D-A target contour instead contains the two exact current-point/payload HalfEdges described above. This is a strong, specimen-local **COMMAND_DECODE** discrepancy; it does not establish a universal `/` grammar rule.

D-B has one remaining `/` marker and replaces the second D-A marker with explicit line `| 19207 12777`. Panda still reports the same two imbalance points. Its target gradient contour has only three exact Panda segment matches; four additional HalfEdges are not exact matches to any target XFL/Panda segment. Endpoint-only overlaps are recorded as anchors, not proof of curve subdivision or source ancestry.

## Animate contour and 17 vs 7

JSFL captured one target Shape per fixture and the captures repeat exactly after normalizing transient Animate object IDs. The target contour is identified by the exact ordered gradient colors plus the unique interior contour in the selected Shape. JSFL does not expose the source FillStyle index directly. D-A also has an exterior contour with the same gradient signature; it is recorded separately.

| Fixture | Target contour | Closed / interior / orientation | HalfEdges | Lines / curved | Exact Panda matches | Slash-payload pairs | Unresolved target HalfEdges |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| D-A | 1 | yes / yes / -1 | 17 | 7 / 10 | 15 | 2 | 0 |
| D-B | 4 | yes / yes / -1 | 7 | 4 / 3 | 3 | 0 | 4 |

D-A's 17 are 15 exact Panda geometry matches plus two exact slash-payload HalfEdges. D-B's seven are three exact Panda matches plus four captured HalfEdges without exact raw/Panda matches. D-A's other contours contain 17 no-fill HalfEdges, 5 exterior gradient HalfEdges, and 5 solid-fill HalfEdges. D-B's other contours contain 22 and 8 no-fill HalfEdges, 3 and 6 solid-fill HalfEdges. The captures therefore account for where the 17 and 7 counts occur, but they do **not** prove why D-B's four extra target-contour edges are split, reassigned, or reconstructed; JSFL does not expose their source-edge relation. Full contour walks, `next`/`prev`, vertices, geometry/control points, target style signatures, and exact mismatch lists are in [topology-D-A.json](./topology-D-A.json), [topology-D-B.json](./topology-D-B.json), and [unmatched-segments.json](./unmatched-segments.json).

## Coordinates and transform observations

Raw XFL edge geometry is in Shape-local twips. Panda's direct probe uses an identity world transform and reports local px after twips `/ 20`. JSFL HalfEdge vertices are local coordinates; the exact matched edges confirm direct coordinate equality for those segments. The comparison did not apply any placement matrix.

The raw XFL Shape matrix and Animate `Shape.matrix` are both recorded. Their translations match, while their `a`/`d` values do not match exactly. The target gradient matrices also differ at the precision returned by Animate. Nested JSFL element matrices are retained in the ledgers, but the capture does not establish whether each is relative or already composed, so their composition is `UNOBSERVABLE` and they were not multiplied. These matrix differences are not hidden behind a tolerance.

## Controls and limits

- Animate at `D:\AN2023\Adobe Animate 2023\Animate.exe` is version `23.0.0.407`, SHA-256 `0F869BD383E679611C6F85D887F72FE636B16403A5B98F79DF87F6F563ED3838`, Authenticode `HashMismatch`. The executable hash matched the before/after host receipts and current file. This is treated as modified/untrusted; the signature result alone did not block the research.
- D-A and D-B each have two JSFL captures with matching normalized contour topology, unchanged source-copy hashes, `saveApiCalled=false`, and byte-identical stage PNGs (`F37C33D2129622855F09C635E642F82D2FBB123CA832301637ACD3DE48465483`).
- The #737 historical oracle and known-good closed-fill control each have two matching JSFL Shape-topology captures and unchanged source hashes. Fresh Panda receipts at this Issue's `b28d410` baseline rendered both controls with two equal run hashes. The historic FLA needed a 54-byte EOCD size normalization in memory; no source bytes were written.
- The first JSFL census run left four extra source-copy documents open (`9 → 13`); it did not call save and the captured control geometry matched run 2. Run 2 restored the original count (`9 → 9`). This lifecycle variance is preserved in [receipt.json](./receipt.json).
- Fresh Panda runs for both target fixtures each returned `BLOCKED / TARGET_UNSUPPORTED`, 23 boundary segments, and two deterministic equal hashes. The same two endpoints remain imbalanced in both.

## Classification and next action

The overall #739 taxonomy stays **H — MIXED / INSUFFICIENT**. D-A supports a local decoder discrepancy; D-B's target region has a different Animate contour membership and four HalfEdges without exact source mapping. `EDGE_ASSEMBLY` remains a descriptive submechanism, not taxonomy class C. This evidence does not establish that the three character fixtures share one root cause, and it does not authorize a production fix.

**Single proposed next action:** open one bounded research follow-up to map D-B target-gradient HalfEdges 3–6 to exact source Shape edges and determine whether that contour is a split/reassembled region or a distinct fill-side ownership result.

## Reproduction

The source archives and JSFL receipts remain external under `D:\PandaStage-Acceptance\issue743-authored-close-minimization-20261009`. The fresh current-Panda receipts used to build these ledgers are under `D:\PandaStage-Acceptance\issue744-endpoint-provenance-run01`. No source FLA was copied into the repository.

From PowerShell at the repository root, rebuild the current Electron modules, produce fresh target/control Panda receipts from the existing #743 read-only instrumentation, then regenerate the ledgers:

```powershell
pnpm build
$issue744Root = 'D:\PandaStage-Acceptance\issue744-endpoint-provenance-run01'
$issue743Scripts = 'D:\PandaStage-Acceptance\issue743-authored-close-minimization-20261009\scripts-run01'
node "$issue743Scripts\issue743-xfl-panda-m2.cjs" --target xiuxian-male-open-fill --out "$issue744Root\panda-DA-byte-identical-M2.json"
node "$issue743Scripts\issue743-xfl-panda-final.cjs" --target xiuxian-male-open-fill --out "$issue744Root\panda-DB-current.json"
node "$issue743Scripts\issue743-xfl-panda-m2.cjs" --target issue737-historical-oracle --out "$issue744Root\panda-issue737-historical-control.json"
node "$issue743Scripts\issue743-xfl-panda-m2.cjs" --target issue737-closed-fill-control --out "$issue744Root\panda-issue737-closed-fill-control.json"
node scripts/research/issue744-build-ledgers.cjs --acceptance-root 'D:\PandaStage-Acceptance\issue743-authored-close-minimization-20261009' --panda-root $issue744Root --overwrite
```

The D-A Panda run deliberately reads M2 because the frozen D-A and M2 archives are proven byte-for-byte identical. The repeat JSFL oracle receipts are `issue743-animate-M2.json` + `issue743-animate-D-A-M2-run02.json` for D-A, and `issue743-animate-D-B-M2-run01.json` + `issue743-animate-D-B-M2-run02.json` for D-B. They were captured from copies using the existing #743 Animate JSFL seams; the receipt includes their paths and hashes. To repeat the Animate captures, use `issue743-animate-M2-run01.jsfl` and `issue743-animate-DA-M2-run02.jsfl` for D-A, `issue743-animate-DB-M2-run01.jsfl` and `issue743-animate-DB-M2-run02.jsfl` for D-B, and `issue743-animate-census.jsfl` for the two controls. Open only frozen-source copies and save receipts/screenshots under the external acceptance directory, then rerun the ledger builder.
