# FLA V1.5-C3 compatibility recovery

Issue #302 productizes the exact safe recovery envelope authorized by C2. This
delivery does not widen the envelope, create an importer, route recovered
content to V1/V2-R, or mutate a Project.

## Result

`C3_COMPATIBILITY_RECOVERY_PASS_WITH_LIMITS`

The normal Main-owned FLA inspection path now does the following:

```text
bounded source read
  -> existing strict production preflight
  -> only after strict reject: the C2 classifier
  -> only RECOVERY_CANDIDATE: Panda-owned in-memory EOCD size correction
  -> the same strict production preflight again
  -> the existing isolated parser worker
```

Strict-valid input bypasses recovery. `REJECT` and `AMBIGUOUS` never reach
normalization or the parser. A failed post-normalization preflight also stops
before the parser.

## Production implementation

- The classifier core is now [Main-owned](../../src/main/services/fla-recovery-classifier.js).
  The C2 research entry point is a logic-free wrapper, so C2 and production do
  not have two drifting algorithms.
- [FlaImportService](../../src/main/services/FlaImportService.ts) reads the
  bounded source once, keeps the original bytes immutable, and sends only the
  validated original or in-memory normalized bytes to the existing parser.
- [fla-import-preflight-service](../../src/main/services/fla-import-preflight-service.ts)
  exposes the bounded read separately so strict rejection can be classified
  without a second source read or a source-directory copy.
- The ephemeral response trace records `ingestMode`, classifier state,
  recovery attempt/application, post-normalization strict result, parser result,
  source hash and bounded classifier reason codes. It is not Project schema.
- The review surface shows a short success notice stating that Panda handled a
  compatibility problem and did not modify the original FLA. Rejection uses
  beginner-readable compatibility copy; EOCD/offset jargon remains developer
  detail.

The only normalized field is the classic ZIP EOCD
`centralDirectorySize`. No ActionScript executes, no Renderer filesystem or
network capability was added, and no original file or durable recovered copy is
written.

## Evidence

The repo-safe machine matrix is [fla-v1.5-c3-compatibility-recovery.json](./fla-v1.5-c3-compatibility-recovery.json).
The full external Electron receipt is:

`D:\PandaStage-Acceptance\issue302-c3-20260823-1710\c3-receipt.json`

The real Windows/Electron receipt covers all 12 approved top-level FLA files:

| Path | Result |
| --- | --- |
| 2 strict-valid controls | `2/2` normal strict path; recovery `false` |
| 10 C2 candidates | `10/10` recovered; post-strict `PASS`; existing parser success |
| recovered raster gate | `沙雕表情大全（免费分享，短剧慎用）.fla`, 128 media, parser success |
| recovered non-raster gate | `人物倒地.fla`, 0 media, structural inspection success |
| unsupported/ambiguous gate | synthetic `c2-neg-multiple-eocd`, no recovery, no parser, beginner-readable failure |
| repeat/cleanup gate | recovered raster sample opened twice deterministically |
| source hash invariance | `PASS` for all real samples and Gate D fixture |
| Project mutation before import | `NONE` |

Known C2 negative conformance remains fail-closed: 19 fixtures, including 18
unsafe `+54` look-alikes, produced zero recovery false accepts and zero parser
entries through recovery. ZIP64, encryption, multi-disk, data descriptors,
unsupported compression, unsafe paths, resource abuse and ambiguous layouts
remain rejected exactly as C2 defined.

One structured-success Electron probe (`飞行中旋转.fla`) also reported the
pre-existing `HiddenWindowManager` shutdown warning when the isolated process
exited. The inspection result was already complete and the source hash was
unchanged; this warning is recorded separately and is not attributed to the C3
recovery layer.

## Checks

- `pnpm exec vitest run tests/unit/fla-import-recovery.test.ts` — PASS, 4/4
- `pnpm exec vitest run tests/unit/fla-c2-safe-recovery-envelope.test.ts` — PASS, 4/4
- `pnpm test:unit` — PASS, 131 files / 958 tests
- `pnpm research:fla-v1-5-c2 -- --root "D:\表情合集" --out "<external>"` — PASS, 12 real samples, 19 fixtures, 0 false accepts
- `pnpm typecheck` — PASS
- `pnpm lint` — PASS
- `pnpm build` — PASS
- `pnpm test:integration` — the default 5-second timeout failed one existing
  thumbnail test; the same 29 files / 169 tests passed with
  `--testTimeout=30000`. The run also emitted the existing
  `asset-thumbnail:read` unregistered-handler warning; no unrelated module was
  changed for this C3 scope.
- real Electron C3 receipt runner — PASS, Gates A–E

## Limits and scope stop

The compatibility envelope remains intentionally narrow and is not general ZIP
repair. Original-file rewrite, Project schema changes, C4 recovered-content
routing, R2 human-acceptance restart, R3, V2-S, and changes to PR #285 were not
started. The next gate is maintainer review of C3; only after that should C4 be
created or authorized.
