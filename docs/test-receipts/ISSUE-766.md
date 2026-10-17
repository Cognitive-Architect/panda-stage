# Issue #766 — first-load responsiveness receipt

**Result: P0 verified; P1 responsiveness correction verified with latency limits; owner Windows acceptance pending.** No HUMAN PASS is claimed. PR #677 remains Draft/Open/Unmerged, and #757 has not started.

## Environment and source identity

- Date: 2026-10-12. Windows x64, OS `10.0.20348`; Electron `43.1.1`; Node `24.18.0`.
- Intel Xeon Platinum, 8 logical CPUs, 16.6 GB RAM; display scale 1.5 and work area 1670×771.
- Baseline PR HEAD: `5ea89f3f5fbf8e868fc80969891709b4b5da2515` on `issue-676-p0-c01-display-list-resolver`.
- P0 probe tree fingerprint: `7d95004877e7ae48ca58c12a253142865a7fe239d8153a2ea7ecedd1cdb798be`.
- P1 source/test tree fingerprint: `14d0c0b00b9b92e306b3d4a8acabbee74a7f5c4dfdce5d4ec8dbfef3d761b1e5`.
- P1 measurements used the final tracked P1 patch based on the same HEAD. `docs/handoff/10.7/` was pre-existing untracked user work and was left untouched; it is not included in the P1 commit.
- Fresh Electron process and isolated user-data/project location per run. OS filesystem cache was not cleared, so “cold” below means a fresh app process/profile, not a controlled cold disk cache. Repeat Qingling run followed earlier source reads.
- Qingling `D:\表情合集\新人物\青绫修仙女（四视角）.fla`, 3,758,039 bytes, SHA-256 `d0958d4432decbf6c54566ba15a2f5e97bd88c82d75dcb2f84603e9b2273f0e4`.
- Hanfu `D:\表情合集\新人物\汉服修仙女.fla`, 3,264,205 bytes, SHA-256 `6af14990029d4ced2c4e305721321835180c1bf041178a8799e1d14a1f62e535`.
- Each run’s source SHA-256 was identical before and after.

## P0 findings

The first-load window has one `catalog()` IPC request for one session on the current #677 HEAD; the old #762 same-session duplicate pass did not reproduce. The delay is CPU-bound work on Electron Main, not a slow sandboxed PNG rasterizer: synchronous display-source adaptation and per-target resolution/SVG capability checks occupy Main while Renderer timers continue.

The reported cold/warm label is limited to process/profile state; OS disk cache state is uncontrolled. Timings below are from the Workbench open action.

| Source/run | Catalog calls / candidates | Catalog wall time | First candidate list | First focused 1920×1080 preview | Main heartbeat max gap (open → first preview) | Windows `Responding` during catalog |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Qingling P0 fresh profile 1 | 1 / 64 | 18,112 ms | 20,637 ms | 22,307 ms | 17,862 ms | 3 false samples in the untimed 56-sample run; exact catalog overlap unavailable |
| Qingling P0 fresh profile repeat | 1 / 64 | 18,042 ms | 20,543 ms | 22,283 ms | 17,788 ms | 3 false / 5 timed overlapping samples |
| Qingling P1 fresh profile | 1 / 64 | 18,231 ms | 20,718 ms | 22,418 ms | 1,465 ms | 0 false / 32 overlapping samples |
| Hanfu P0 fresh profile | 1 / 35 | 22,908 ms | 25,069 ms | 25,953 ms | 22,769 ms | 4 false / 6 overlapping samples |
| Hanfu P1 fresh profile | 1 / 35 | 22,626 ms | 24,773 ms | 25,621 ms | 2,801 ms | 0 false / 18 overlapping samples |

P0 stage measurements (P1 follows in the same rows):

| Stage | Qingling P0 → P1 | Hanfu P0 → P1 |
| --- | ---: | ---: |
| Source read + preflight + parser inspection | 2,447 ms → 2,433 ms | 2,086 ms → 2,080 ms |
| Catalog ZIP open + XML extraction | 280 ms → 297 ms | 223 ms → 218 ms |
| Display-source adaptation | 7,274 ms → 7,314 ms | 5,282 ms → 5,214 ms |
| Candidate enumeration | 10,553 ms → 10,615 ms | 17,399 ms → 17,190 ms |
| Sum of per-candidate total durations (min / median / p90 / max) | 1.9 / 98.1 / 769.4 / 1,061.5 ms → 1.8 / 98.2 / 764.5 / 1,087.9 ms | 0.4 / 16.1 / 1,357.3 / 1,965.2 ms → 0.4 / 16.0 / 1,354.6 / 1,939.3 ms |
| Full 64 / 35 candidate preview scan | 33,169 ms → 32,858 ms | 43,771 ms → 43,247 ms |

The independently observed Windows `Responding` samples changed from false during both timed P0 catalog windows to true for every P1 catalog-overlap sample. Renderer heartbeat maximum gaps stayed below 220 ms in every run. P1’s worst Main heartbeat gap was 2,801 ms on Hanfu; its Windows process samples remained responsive. A single complex candidate resolver remains synchronous and can account for a brief multi-second Main heartbeat gap.

The candidate-result vector was built from the ordered `fla.catalog.candidate.total` events as `(targetId, targetKind, selectedFrameIndex, previewSupported, isBlank)`. P0 and P1 fingerprints match exactly:

- Qingling, 64 candidates: `097759b504ebb1840c4f9e6efa7ff68d5b32913ba7e6d9eb206e7c16a238a6ff`.
- Hanfu, 35 candidates: `f84b9b5b6b82a425b7eaa5bdd0f3e1bff684866e62b98593e6038b9d1e620ccb`.
- Both sets retained their original order, identity, supported/blank status, and 64-item cap. No candidate was dropped or reclassified.

## P1 correction and safety

The catalog path now yields to Electron’s event loop between bounded archive entries, symbol/frame adaptation steps, and catalog candidates. It checks the same source-byte identity and SHA after each yield. The existing session owner marks active catalogs cancelled on cancel, session invalidation, or close; stale/cancelled work returns `SESSION_NOT_FOUND` and is not cached. The synchronous adapter API and frame-sequence caller keep their existing behavior. No Worker, global cache, parallel renderer, or early-import state machine was added.

P1 improves responsiveness, not the wait for the complete catalog: first candidate lists still appear after about 20.7 s (Qingling) and 24.8 s (Hanfu). Those times are effectively unchanged from P0; no first-candidate speedup is claimed. The full candidate-preview scan also remained within run variation. The UI still builds the complete catalog before entering its candidate-scan state.

For each P1 scan-only run, the isolated project remained at 0 assets / revision 0, both source hashes were unchanged, and all preview Blob URLs were released (Qingling 66/66; Hanfu 37/37). The first focused preview was full resolution. Unit coverage cancels an active catalog at an event-loop yield boundary; the complete automated scan-only path also completed for both sources. Real import/save/reopen was not repeated for #766 because commit and persistence code were untouched; see the prior [#762 receipt](ISSUE-762.md) for that real-source transaction evidence. Owner interaction with the loading/cancel UI remains pending.

## Validation

- `pnpm typecheck` — pass.
- `pnpm lint` — pass.
- `pnpm test:unit` — 347 files / 2,512 tests passed.
- `pnpm test:integration` — 38 files / 189 tests passed.
- `pnpm build` — pass. Existing empty legacy CSS imports and large-chunk warnings remain.
- Focused adapter, render-session, and nested-Graphic tests — 61 passed.
- `node --check scripts/verify-issue396-stage-d.cjs` and `git diff --check` — pass.
- P1 real-source runs used the existing production Electron verifier with `--issue766-first-load --measure-scan-only`; no Full CI or repository-wide verifier sweep was run.

## Owner acceptance and local raw receipts

Human Windows acceptance is **pending**. The owner should load Qingling from a fresh app process, note the first-list wait, interact with/cancel during loading, confirm Windows never reports “Not Responding,” inspect `重复项目文件夹/元件 1` and `元件 4`, then preview/import/use as desired. Automated `Get-Process.Responding` samples are not a human acceptance.

Raw JSON profiles, process-response samples, and isolated projects remain outside the repository:

- P0 Qingling: `D:\PandaStage-Acceptance\issue766-first-load-20261012\qingling-cold-03\` and `qingling-warm-01\`.
- P0 Hanfu: `D:\PandaStage-Acceptance\issue766-first-load-20261012\hanfu-cold-01\`.
- P1 Qingling: `D:\PandaStage-Acceptance\issue766-first-load-20261012\qingling-after-03\`.
- P1 Hanfu: `D:\PandaStage-Acceptance\issue766-first-load-20261012\hanfu-after-01\`.
- Reproduction entry: [`verify-issue396-stage-d.cjs`](../../scripts/verify-issue396-stage-d.cjs). Example:

  ```powershell
  pnpm exec electron scripts/verify-issue396-stage-d.cjs --issue766-first-load --measure-scan-only --source 'D:\表情合集\新人物\青绫修仙女（四视角）.fla' --acceptance-root 'D:\PandaStage-Acceptance\issue766-first-load-20261012\qingling-after-03' --scan-timeout-ms 900000
  ```

Commands were checked against [`package.json`](../../package.json). Main-side scope: [`render session`](../../src/main/services/fla-static-snapshot-render-session.ts), [`display-list adapter`](../../src/main/services/fla-static-snapshot-display-list-adapter.ts), and [`catalog builder`](../../src/main/services/fla-static-snapshot-svg-builder.ts). Focused tests: [`adapter`](../../tests/unit/fla-static-snapshot-display-list-adapter.test.ts) and [`render session`](../../tests/unit/fla-static-snapshot-render-session.test.ts).
