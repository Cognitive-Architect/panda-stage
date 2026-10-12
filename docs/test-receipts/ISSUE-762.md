# Issue #762 — Windows FLA static snapshot performance receipt

**Result:** P0 measured; P1 optimization verified on both real sources. P2 is
design only. Owner visual acceptance is pending. Parent PR #677 remains
Open/Draft/Unmerged.

## Run identity

- Date: 2026-10-12.
- Windows x64, OS `10.0.20348`; Electron `43.1.1`; Node `24.18.0`.
- Intel Xeon Platinum, 8 logical CPUs, 16.6 GB RAM; display scale 1.5 and
  work area 1670×771.
- Parent PR baseline HEAD: `6da6e8f3cf3047a16fa9e2b4db479017c22d4e05`, on
  `issue-676-p0-c01-display-list-resolver`.
- Optimized source tree was measured from that HEAD with working-tree SHA-256
  `920ed49ca02073ca6844f96591b49e3246ae562f3ba1ad7b135416edda15c622`.
  The final receipts record this exact tree fingerprint and `gitDirty: true`;
  no source FLA or acceptance project was stored in the repository.
- The existing import/recovery route normalized each FLA for inspection.
  The original source files had identical SHA-256 before and after each run.

## Real-source results

Per-candidate values are **min / median / p90 / max milliseconds**. All
baseline and optimized candidate outcomes were `preview-supported`, in the
same order, with identical target IDs and selected frames.

| Source | Candidates | Scan before → after | Reduction | Candidate time before → after (min / median / p90 / max) |
| --- | ---: | ---: | ---: | --- |
| `汉服修仙女.fla` (3,264,205 bytes; SHA-256 `6af14990029d4ced2c4e305721321835180c1bf041178a8799e1d14a1f62e535`) | 35 | 230,933 → 65,344 ms | 71.7% | 5,326.6 / 5,395.1 / 7,339.0 / 7,894.3 → 12.2 / 120.7 / 1,472.3 / 2,084.2 |
| `青绫修仙女（四视角）.fla` (3,758,039 bytes; SHA-256 `d0958d4432decbf6c54566ba15a2f5e97bd88c82d75dcb2f84603e9b2273f0e4`) | 64 | 522,055 → 51,463 ms | 90.1% | 7,622.6 / 7,774.0 / 8,536.7 / 9,138.3 → 16.1 / 149.8 / 835.9 / 1,489.2 |

## Stage findings

The largest measured cost was repeating the archive display-source adaptation
for each candidate preview. Catalog adaptation cost 5.17 s for Hanfu and 7.46 s
for Qingling; preview adaptation then repeated 37 times (191.89 s total) and 66
times (491.76 s total), respectively.

| Stage (cumulative unless stated) | Hanfu before → after | Qingling before → after |
| --- | ---: | ---: |
| Source read, preflight and parser inspection | 2.106 → 2.069 s | 2.454 → 2.444 s |
| Catalog ZIP open + XML extraction | 0.198 s / 1 call → 23.280 s / 2 calls | 0.272 s / 1 call → 18.931 s / 2 calls |
| Catalog display-source adaptation | 5.167 s / 1 call → 10.298 s / 2 calls | 7.459 s / 1 call → 14.763 s / 2 calls |
| Catalog candidate resolution + support + SVG capability composition | 16.986 s / 1 pass → 16.906 s per pass (2 passes logged) | 10.504 s / 1 pass → 10.430 s per pass (2 passes logged) |
| Preview ZIP open + XML extraction | 7.386 s / 37 calls → no preview archive reads | 13.550 s / 66 calls → no preview archive reads |
| Preview display-source adaptation | 191.889 s / 37 calls → 0 preview calls; 37 prepared-source cache hits | 491.762 s / 66 calls → 0 preview calls; 66 prepared-source cache hits |
| Preview SVG build total | 218.565 → 19.102 s | 515.182 → 10.055 s |
| Main preview round-trip | 221.677 → 22.337 s | 518.487 → 13.602 s |
| Sandboxed preview window ready | 0.090 s / 37 calls → 0.094 s / 37 calls | 0.090 s / 66 calls → 0.088 s / 66 calls |
| Renderer SVG image load + canvas draw + PNG encode | 1.314 → 1.313 s | 1.506 → 1.362 s |
| Sandboxed rasterizer round-trip | 3.038 → 2.866 s | 3.212 → 2.916 s |
| PNG IPC delivery | 2.774 → 2.614 s | 2.947 → 2.664 s |
| UI scan candidate total | 208.364 → 20.332 s | 503.393 → 14.774 s |
| UI preview queue wait | 5.2 → 12.1 ms | 9.3 → 13.6 ms |
| UI thumbnail create / React state commit | 0.189 / 0.078 → 0.716 / 0.344 s | 0.248 / 0.161 → 1.107 / 0.966 s |
| UI thumbnail image-element load | 1.512 → 16.842 s | 4.262 → 10.512 s |
| Focused full-resolution preview | 6.850 → 1.514 s | 7.786 → 0.131 s |
| Click to Asset Library sync | 6.859 → 1.538 s | 7.778 → 0.248 s |

The optimized receipts show two successful catalog passes per source. During
one preparation, the session/cache identity changed; the implementation
refused to cache that stale result, then cached the current source. The wall
times above are unadjusted and include this extra work. The source-identity
guard, rather than a calculated or selected “best” run, determines the reported
result. Instrumented spans can overlap; do not add their totals to reconstruct
the end-to-end wall time.

PNG rasterization and IPC were not the bottleneck. UI thumbnail image-load
events were asynchronous and cumulative (Hanfu 1.512 → 16.842 s; Qingling
4.262 → 10.512 s); they are not serial scan wall time. The observed UI event-loop
maximum gaps were 1,026 ms baseline / 1,002 ms optimized for Hanfu and 1,070 ms
baseline / 1,038 ms optimized for Qingling; no run exceeded 1,500 ms. No scan
timed out. Normal per-preview request cleanup completed for all 37 / 66
previews. Preview-window-ready medians were below 1 ms; maximum observed waits
were 89.8 / 93.3 ms for Hanfu and 89.2 / 87.2 ms for Qingling (baseline /
optimized).

## P1 change and safety

The Main render session retains one prepared display source, keyed by
inspection-session ID, trusted source SHA-256 and the exact source-byte object.
It is limited to sources no larger than 8 MiB with extracted XML no larger than
24 MiB; both real sources fit (Hanfu 3,264,205 bytes / 16,377,356 XML bytes;
Qingling 3,758,039 bytes / 19,154,972 XML bytes). The trusted import-session
SHA-256 values were
`10edd07e226db3296a5cac01b4cdf9654385ce477894a8f7b4d0c90db9e327f7` and
`d0f940d6f7398c099d15da1104bb8615feb361d6e38d211f944ab072808acaf4`.
Preview SVGs, PNGs and resolved targets are still built fresh. Frame-local node
accounting and shape tables are reset between authored-frame resolutions,
including when returning to frame zero. A session-scoped cancel, close or
source identity change clears the prepared source; request-scoped preview
cancellation still cancels that request and releases its result while
preserving the session's parsed source.

For both sources, scan-only work left assets and revision unchanged (0 assets,
revision 0). The full-resolution preview passed; explicit commit advanced the
isolated project to 1 asset / revision 1; save/reopen passed on schema v8; all
observed preview Blob URLs were revoked (Hanfu 37/37, Qingling 66/66). The
source SHA-256 remained unchanged. The optimized real runs recorded no failed
candidate or timeout.

## Stage D and validation

Final synthetic Electron Stage D: 25/25 named checks passed; its 25-candidate
scan completed in 779 ms. Scan cancellation left the project unchanged; the
focused-preview race returned a full-resolution preview; duplicate reuse,
commit, revision update and Asset Library sync passed; all 81/81 observed
preview Blob URLs were released. This synthetic run is not a substitute for
owner acceptance on Windows.

- `pnpm typecheck` — pass.
- `pnpm lint` — pass.
- `pnpm test:unit` — 347 files / 2,510 tests passed.
- `pnpm test:integration` — 38 files / 189 tests passed on the isolated rerun.
- `pnpm build` — pass. Vite reported existing empty legacy CSS imports and
  large bundle warnings.
- Focused adapter, render-session and SVG-builder tests — 44 passed.
- `git diff --check` — pass.
- The initial four-way parallel validation run had one unrelated 5-second
  audio-probe integration timeout; it did not reproduce in the isolated full
  integration run.
- Owner manual Windows visual acceptance — **pending**; no human PASS is
  claimed.

## P2 — design only

No early-import or Workbench state-machine code was added. A follow-up design
can let users stage selection from already-proven candidates while scanning
continues, with transitions `scanning → pausing → focused-preview → committing → scanning | complete | cancelled | stale`. Before pausing the scan queue, it
must cancel or settle in-flight request IDs while retaining Main's single
rasterizer. Commit must revalidate the inspection session and source SHA, use
the latest confirmed full-resolution preview SHA, and update the Asset Library
only after the existing Main transaction succeeds. Unscanned, unsupported and
blank targets remain unavailable for import. The design and tests must cover
focus changes, duplicate selection, cancel/reopen, source replacement, stale
preview rejection, and save/reopen. This remains outside #762 implementation
scope until separately authorized.

## Local raw receipts

- Hanfu baseline: `D:\PandaStage-Acceptance\issue762-profile-20261012\real-baseline-hanfu-run01\issue761-fla-scan-measurement.json`
- Qingling baseline: `D:\PandaStage-Acceptance\issue762-profile-20261012\real-baseline-qingling-run01\issue761-fla-scan-measurement.json`
- Hanfu optimized: `D:\PandaStage-Acceptance\issue762-profile-20261012\final-optimized-hanfu-run01\issue761-fla-scan-measurement.json`
- Qingling optimized: `D:\PandaStage-Acceptance\issue762-profile-20261012\final-optimized-qingling-run01\issue761-fla-scan-measurement.json`
- Stage D: `D:\PandaStage-Acceptance\issue762-profile-20261012\final-stage-d-smoke-run01\issue398-stage-d-receipt.json`
- Reproduction entry point: `scripts/verify-issue396-stage-d.cjs`; real runs use
  `pnpm exec electron scripts/verify-issue396-stage-d.cjs --issue762-profile --measure-scan-only --profile-commit --source <absolute-fla-path> --acceptance-root <isolated-run-directory> --scan-timeout-ms 900000`.
- Existing package commands verified in `package.json`: `pnpm typecheck`,
  `pnpm lint`, `pnpm test:unit`, `pnpm test:integration`, and `pnpm build`.
