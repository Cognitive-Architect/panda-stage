# Issue #704 — Black pose/state candidate discovery

- Date: 2026-10-04
- Status: bounded research/prototype complete; production implementation not authorized
- Mother PR: #677

## Result

The prototype enumerates **30 direct source-state candidates** (one Scene state and 29 authored starts across nine Graphic timelines), then adds two source-derived parent-composite candidates. The resulting manifest contains 32 unique candidate IDs and the five required render-address classes. Held ranges remain metadata on one authored state; the enumerator does not expand every held frame into a separate candidate.

Candidate IDs hash the source SHA-256, source address, render-address class, and concrete render address. IDs do not use display labels, reference pose names, list order, or random values. The source census is joined by source owner and authored frame, not by display name or candidate ordering. Source-class labels can overlap; render-address class counts form the 32-candidate partition.

| Render-address class | Candidates |
| --- | ---: |
| `PARENT_COMPOSITE` | 4 |
| `DIRECT_FULL_CHARACTER_STATE` | 3 |
| `DIRECT_COMPONENT_STATE` | 13 |
| `TEMPORAL_ONLY` | 4 |
| `UNSUPPORTED_OR_UNKNOWN` | 8 |

| Source-state class membership | Candidates |
| --- | ---: |
| `COMPONENT_ASSET` | 25 |
| `DUPLICATE_OR_HELD_STATE` | 2 |
| `FULL_CHARACTER_STATE` | 7 |
| `TEMPORAL_ACTION_CANDIDATE` | 12 |

Source-state membership counts overlap; a candidate can carry multiple labels.

## Reference and component controls

| Control | Source/render address | Candidate ID | Classification |
| --- | --- | --- | --- |
| A | Scene `场景 1@0`, wrapping `元件 1@0` with children `补间 1@0 / 补间 2@0 / 补间 3@0` | `B2-131741E7A086D1EE3ED3C91B` | Parent composite |
| Parent Graphic source state | Direct `元件 1@0` | `B2-8A7035B80257FB67A05D218A` | Parent composite; duplicate/held full-character state |
| B | `元件 1@6` → `补间 1@0 / 补间 2@6 / 补间 3@0` | `B2-C23E23F9335AFF7F2626F2AC` | Source-derived parent composite |
| C | `元件 1@7` → `补间 1@0 / 补间 2@7 / 补间 3@0` | `B2-CF4C869D9E2F745AC070137A` | Source-derived parent composite |
| D | Direct `补间 2@8` | `B2-6B59262065D28C279718C576` | Complete character; bypasses parent composition |
| E | Direct `补间 2@9` | `B2-C4146E01383AF6B709E38BDB` | Complete character; bypasses parent composition |
| Unmatched full state | Direct `补间 2@10` | `B2-B69A8D02EF0570958C68A6FA` | Complete character; no supported reference match |
| Head component | Direct `补间 1@0` | `B2-B651BA3047C03B16971269D0` | Component control |
| Body component | Direct `补间 2@6` | `B2-7511FB6C975B2A4CE13439E9` | Component/temporal control, not a full pose |

B and C are parent composites. Their underlying `补间 2@6/@7` states remain separate component/temporal candidates and are not promoted to complete poses. D, E, and the unmatched frame 10 state are direct complete-character addresses; wrapping any of them in `元件 1` would retain the outer head/hair siblings and create an incorrect mixed composition.

The Scene contains only one document frame. B2 probes the internal `元件 1` frame coordinate for B/C; it does not claim that Scene playback advances this one-frame wrapper to frame 6 or 7.

## Parent-route probes and limits

| `元件 1` frame | Result | Meaning |
| ---: | --- | --- |
| 0 | Supported; A control | Default-loop children resolve to frame 0 |
| 1–5 | Fail closed | Descendant Single Frame instances with explicit `firstFrame` are outside the #703 proven slice; `补间 2@5` contains two such instances |
| 6–7 | Supported; B/C | Default-loop child selections resolve to `补间 2@6/@7`; production SVG/PNG evidence is reused from #703 |
| 8–10 | Rejected as non-preferred | A complete child is mixed with visible outer siblings; use direct `补间 2@8/@9/@10` states |
| 11 | Fail closed | Nested `元件 2` is in a containing span starting at 11, outside the tested start-zero slice |

The supported boundary is narrow: nested Graphic, `loop`, omitted `firstFrame` and `lastFrame`, containing span starting at zero, and no wrap crossing. Unknown modes, explicit bounds, Single Frame descendants, nonzero span origins, tween interpolation, MovieClip behavior, and ActionScript remain unsupported. The render outputs are evidence for candidate discovery; they do not authorize a production resolver change.

## Evidence and repeatability

- Original FLA SHA-256 before/after: `a328a163dd212f0369e27b30e5078178fd42744954203fdad6a9cd06f3b171fa`.
- Reference image SHA-256 before/after: `7c53292222edcd183bb0d40ee647435ef860f9894cd4203150317364ca679eac`.
- Normalized archive SHA-256: `681237abb7b32e79ce89ff8e283b0573b4bf170c6b85830828c7a10911bc7a33`.
- The B1 census and B3 synchronization inputs are preserved in [Issue #702](issue-702-black-multi-pose-census.md) and [Issue #703](issue-703-nested-graphic-frame-sync.md). Candidate states are independently re-enumerated with the existing production `adaptFlaXflDisplaySource` adapter; those prior receipts are used for classifications and render-hash checks.
- Two separate Node processes emitted byte-identical manifests. Both SHA-256 values are `fd76203dcd24dfb145bc968e9faf6b679e3478bdcbdce3ff50dbf9222980895d`; the candidate/classification core hash is `c545ce0708585bfcac0d3bc6cf4aa0c34c093c93738d3b455b3f9620f3868288`.
- All 70 unique SVG/PNG files referenced by the 32 candidates and three rejected routes matched their recorded hashes. The files remain in `D:\PandaStage-Acceptance\issue704-black-candidates-20261004\artifacts`; the repository manifest stores their relative names and hashes.
- The untouched original FLA has a malformed ZIP central directory and is rejected by JSZip. Analysis reused the normalized archive from #702 and separately verified the original source and reference hashes after both runs.

The machine-readable deliverables are [the candidate manifest](issue-704-black-candidate-manifest.json) and [the completion receipt](issue-704-black-candidate-discovery.json). The prototype is [issue704-black-candidate-discovery.cjs](../../scripts/research/issue704-black-candidate-discovery.cjs).

## B3 handoff

B3 may use the stable source-address candidate identities, one-row-per-authored-start policy, held ranges, A/B/C parent routes, and direct D/E/unmatched full-character routes as inputs to a narrowly scoped implementation contract. Keep component and temporal rows distinct from complete-character rows. Preserve fail-closed handling for all routes outside the #703 evidence boundary, and add explicit wrap, nonzero-origin, `firstFrame`/`lastFrame`, Single Frame, Play Once, tween, and MovieClip controls before broadening support.

## Reproduction

The prototype reads the existing compiled production adapter, so build first. With the original source, normalized archive, reference image, and #703 run receipt available at the paths recorded in the #702 census:

```powershell
pnpm build
$census = Get-Content -Raw -Encoding UTF8 docs/research/issue-702-black-multi-pose-census.json | ConvertFrom-Json
$prior = 'D:\PandaStage-Acceptance\issue702-black-census-20261004'
$sync = 'D:\PandaStage-Acceptance\issue703-nested-graphic-20261004'
$acceptance = 'D:\PandaStage-Acceptance\issue704-black-candidates-20261004'
node scripts/research/issue704-black-candidate-discovery.cjs --source $census.source.localPath --archive (Join-Path $prior 'normalized-source.fla') --reference $census.reference.localPath --census docs/research/issue-702-black-multi-pose-census.json --sync-receipt docs/research/issue-703-nested-graphic-frame-sync.json --sync-run (Join-Path $sync 'issue703-prototype-receipt.json') --artifact-dir $acceptance --out (Join-Path $acceptance 'run-1-manifest.json')
```

Run a second independent process with `run-2-manifest.json` as the output path and compare the two manifest files byte-for-byte. The script writes only to the requested evidence directory; it does not modify the FLA, reference image, production parser/resolver, UI, or project schema.
