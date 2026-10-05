# Issue #705 — Black asset batch rendering

- Date: 2026-10-05
- Status: batch implementation and machine evidence complete; maintainer visual review pending
- Mother PR: #677 (kept as draft)

## Result

The B3 runner consumes the accepted B2 candidate manifest and dispatches only the three supported static render-address classes. It produced SVG and PNG output for all 20 eligible candidates, with no candidate render failures. Four temporal candidates were skipped by class and eight unsupported candidates failed closed. No rejected D/E/non-preferred parent composite was previewed.

| Render-address class | Candidates | Result |
| --- | ---: | --- |
| `PARENT_COMPOSITE` | 4 | Rendered |
| `DIRECT_FULL_CHARACTER_STATE` | 3 | Rendered directly |
| `DIRECT_COMPONENT_STATE` | 13 | Rendered as components |
| `TEMPORAL_ONLY` | 4 | Skipped by class |
| `UNSUPPORTED_OR_UNKNOWN` | 8 | Unsupported; not previewed |

The non-preferred parent routes at frames 8, 9, and 10 remain excluded. Parent timing probes at frames 1–5 and 11 fail closed under the Issue #703 boundary. Single-frame nested Graphics remain at frame 0; other nested selections must match the supported default-loop, start-zero, no-wrap slice.

## Blank detection, duplicate grouping, and contact sheet

Blank detection uses decoded PNG alpha pixels and visible bounds, not candidate labels. None of the 20 Black renders was blank. The 20 Black PNG SHA-256 values were all unique, so the Black batch has no exact duplicate groups. Separate synthetic controls verified blank suppression, exact-PNG grouping with two distinct source addresses and retained provenance, and isolation of a single renderer failure; those controls are not Black candidates and are not contact-sheet tiles.

The deterministic contact sheet contains 20 tiles: seven full-character candidates and 13 component candidates in separate sections. The sheet is 1740 × 1980 pixels. Bounds-based cropping and scaling are presentation metadata only; canonical per-candidate PNGs remain unchanged.

- Contact-sheet PNG SHA-256: `442a6391c75d0470a190fff3824ff594c1dcebeac636c25cb7aa6a73695094fe`.
- Contact-sheet SVG SHA-256: `334f26185150d53e58d0deabfade1081898cb990fc39e599a90a7a4d21866b34`.
- Batch manifest SHA-256: `4381fac912f8e2d4ec0ca6463c3f183cf3711c3c93517fe44017190e7af3f608`.

Two independent Electron runs produced byte-identical batch manifests, receipts, all 40 per-candidate SVG/PNG files, and both contact-sheet formats. The emitted Electron user-data caches are runtime state and are excluded from this artifact comparison.

## B2 comparison and source integrity

All 20 B3 PNG hashes match the PNG evidence recorded by B2. Eight B3 SVG files also match B2 byte-for-byte; the other 12 have different SVG byte hashes despite matching PNG hashes. The per-candidate comparisons are retained in `priorB2EvidenceComparison` in the batch manifest; this result does not claim SVG byte equivalence.

The accepted B2 manifest SHA-256 is `fd76203dcd24dfb145bc968e9faf6b679e3478bdcbdce3ff50dbf9222980895d`. The original `黑衣修仙男.fla` SHA-256 was `a328a163dd212f0369e27b30e5078178fd42744954203fdad6a9cd06f3b171fa` before and after processing. Its normalized archive SHA-256 was `681237abb7b32e79ce89ff8e283b0573b4bf170c6b85830828c7a10911bc7a33`.

The complete candidate rows, render addresses, source provenance, per-file hashes, PNG bounds, duplicate groups, rejected routes, and synthetic controls are in the [B3 batch manifest](issue-705-black-asset-batch-manifest.json). A concise machine-readable receipt is in [issue-705-black-asset-batch.json](issue-705-black-asset-batch.json). Individual acceptance binaries remain outside the repository at `D:\PandaStage-Acceptance\issue705-black-asset-batch-20261005\run-1-final` and `D:\PandaStage-Acceptance\issue705-black-asset-batch-20261005\run-2-final`.

## Human review gate

The generated contact sheet was inspected by the agent for its two sections and 20 visible tiles. This is not maintainer acceptance. The required human visual review remains **pending**; Issue #705 remains open and PR #677 remains a draft.

## Validation

- `pnpm build` — passed.
- `pnpm test:unit -- tests/unit/issue705-black-asset-batch.test.ts` — 5 tests passed.
- `pnpm exec eslint scripts/research/issue705-black-asset-batch-core.cjs scripts/research/issue705-black-asset-batch.cjs tests/unit/issue705-black-asset-batch.test.ts` — passed.
- `node --check` for both new CommonJS research scripts and `git diff --check` — passed.
- `pnpm exec vitest run tests/contract/ci-routing.test.ts tests/contract/verification-manifest.test.ts tests/contract/ci-provenance.test.ts` — 96 tests passed.
- Two production Electron batch runs — each rendered 20/20 eligible candidates; the output manifest, receipt, 40 individual render files, contact-sheet SVG, and contact-sheet PNG matched across runs.

## Reproduction

Run from the repository root in PowerShell. The runner requires a current build and writes artifacts only to the requested external acceptance directory.

```powershell
pnpm build
$manifest = 'docs/research/issue-704-black-candidate-manifest.json'
$archive = 'D:\PandaStage-Acceptance\issue702-black-census-20261004\normalized-source.fla'
pnpm exec electron scripts/research/issue705-black-asset-batch.cjs --manifest $manifest --archive $archive --out 'D:\PandaStage-Acceptance\issue705-black-asset-batch-20261005\run-1-final'
pnpm exec electron scripts/research/issue705-black-asset-batch.cjs --manifest $manifest --archive $archive --out 'D:\PandaStage-Acceptance\issue705-black-asset-batch-20261005\run-2-final'
```

The implementation is [the B3 runner](../../scripts/research/issue705-black-asset-batch.cjs), with its deterministic parsing/grouping/layout helpers in [the batch core](../../scripts/research/issue705-black-asset-batch-core.cjs). Focused unit coverage is in [issue705-black-asset-batch.test.ts](../../tests/unit/issue705-black-asset-batch.test.ts).
