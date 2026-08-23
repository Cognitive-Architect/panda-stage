# FLA V1.5-C4 recovered content routing

Issue: #304  
Execution date: 2026-08-23  
Live `main` at start: `3c47a4ee8af07e834338b223fcb3260a4c6dddbc`

## Integration topology

C4 uses a new history-preserving integration line. Neither dependency branch
was moved or rewritten.

- C3 / PR #303 exact head: `dc3126ad2b6c85b4ffff45d13c8f187a47b63b4f`
- V2-R / PR #285 exact head: `a111649df2615e8140e51eada17861fef0f6b403`
- merge base: `3c47a4ee8af07e834338b223fcb3260a4c6dddbc`
- integration merge: `c467f0eaf4f1f4c9ef4aa331b880a757846d2b45`
- C4 branch: `agent/fla-v1-5-c4-recovered-content-routing`

The normal non-destructive merge had one conflict, in
`scripts/verification-manifest.json`. The resolution retained both the C3
machine-evidence path and all V2-R HTML, renderer, evidence, and unit-test
routes. `FlaImportService.ts` and `FlaCompatibilityReviewSession.tsx`
auto-merged; both were then reviewed for the C3 recovery trace/source-byte
handoff and the V2-R zero-raster review surfaces.

## Product routing

`routeFlaInspection` is the single C4 policy boundary:

```text
failed inspection                    -> blocked
successful inspection, media > 0    -> existing V1 raster review/import
successful inspection, media = 0    -> existing V2-R target catalog/reviews
```

The decision does not inspect the recovery flag, filename, hash, seller/site,
or B1 structural counts. Recovery remains an ingest fact. A zero-raster result
only reaches the existing V2-R catalog; the existing V2-R builder remains the
authority for target support and frame counts. An empty catalog remains a
truthful no-target result.

The C3 in-memory normalized bytes are retained in the existing inspection
session and handed to the existing V2-R catalog/builder. There is no second
parser, importer, target scanner, rasterizer, or Project store.

## Automated real Windows/Electron evidence

Command:

```powershell
pnpm verify:fla-v1-5-c4 -- --root "D:\表情合集" --out "<external-receipt.json>"
```

The 2026-08-23 local receipt is outside Git at
`D:\PandaStage-Acceptance\issue304-c4-20260823-1913\c4-routing-receipt.json`.
It contains metadata only; no private FLA, extracted media, SVG, PNG, or
recognizable frame bytes are stored in the repository.

| Gate | Automated product-path result |
| --- | --- |
| A, strict raster | `文件.fla`, exact C3 hash, strict ingest, recovery false, 158 media, existing V1 route |
| B, recovered raster | `沙雕表情大全（免费分享，短剧慎用）.fla`, exact C3 hash, recovery true, 128 media, same V1 route |
| C, recovered structure-first | `向右走.fla`, exact C3 hash, recovery true, 0 media, existing V2-R catalog reached, 25 supported graphic-symbol targets |
| D, no target | repo-safe external synthetic FLA, 0 media, existing V2-R catalog reached, 0 targets, no forced route |
| E, repeat/back out | recovered raster and structure-first controls both repeated with identical routes; sessions released; source hashes unchanged; source-root directory listing unchanged |

For `向右走.fla`, the V2-R catalog reported frame counts
`1,1,1,1,1,1,2,1,1,1,1,1,1,1,1,1,7,6,5,2,1,4,1,1,10`. These values came
from the existing V2-R catalog/builder, not from the B1 document structural
frame count.

No V1, snapshot, or frame-sequence commit API was called by the automated C4
runner. Therefore Project mutation before confirmation was `NONE`; original
source hashes remained unchanged; and no recovery/temp artifact appeared
beside the approved sources.

## Automated quality status

- focused C2/C3/C4/V2-R tests: 41/41 PASS
- full unit: 145 files, 1176 tests PASS
- integration with explicit 30-second test budget: 29 files, 169 tests PASS
- typecheck: PASS
- lint: PASS
- build: PASS
- C4 real Electron metadata gate: A-E PASS (automation only)
- known pre-existing integration diagnostic: repeated
  `asset-thumbnail:read` unregistered-handler messages; tests still passed

## Human acceptance boundary

Maintainer Windows/Electron Gates A-E are `PENDING`. In particular, automation
does not claim the required bounded recovered-V1 asset Import, Save, Close, and
Reopen check. Formal #294 R2 acceptance was not restarted. C4 must remain Draft,
Open, and Unmerged until the maintainer performs the C4 checklist.

Current conclusion: `C4_RECOVERED_CONTENT_ROUTING_PASS_WITH_LIMITS`

The only remaining limit is pending maintainer product-path acceptance,
including the bounded recovered-V1 Save/Close/Reopen check. No safety or routing
requirement is being hidden by that limit.
