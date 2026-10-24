# EXP-PERF-03: Hidden-window background throttling A/B

**Result: `RESEARCH_STOP` · hypothesis: `INCONCLUSIVE`**

One authorized A→B pair was attempted. A completed with valid 108-frame instrumentation and output. B stopped before a formal export Job because the fixed-project harness had no expected background-fingerprint entries. During B setup, the shared generated `project.json` also changed. The Issue requires stopping on either condition, so there was no retry. A alone reproduces the roughly one-second rAF wait seen in #843; this run does not establish causality.

## Scope and source

- Owner authorization in this conversation covered one A+B pair for Issue #844. It did not authorize a production optimization.
- Pinned production source: `c6c356f660001af694bb706cc7553974ff8d1cfc`.
- Research branch: `research/issue-844-background-throttling-ab`.
- Diagnostic preparation commit: `3918058998f7917879ac59789d443798920b9705`.
- Production source files and PR #817 were not changed. The experiment reused the #843 frame timer and added a temporary B-only `backgroundThrottling:false` source patch. The patch was restored byte-for-byte after each build.

## Preflight and build evidence

Both A and B `--preflight` runs passed after the isolated worktree installed the lockfile dependencies. One initial parallel A check collided with Electron's first local binary setup; the serial rerun passed. Both `--prepare-build` runs passed with `sourceRestored=true`, no Electron process, no formal Job, and no acceptance project created.

The temporary source comparison verified that B adds only `backgroundThrottling:false` to `HiddenWindowManager`; the four #843 timing-instrumentation source transforms are identical. A leaves the option omitted. A and B builds each contained the same renderer bundles, Main entry, and all 184 build files outside `hidden-window-manager.js` (aggregate SHA-256 `3077c10fa47df127668e5ad47c60e97d9ac24796f7003f6ddb11b3695e8e9515`). The compiled HiddenWindowManager hashes differ as expected:

- A: `8bc56b81267f64d376b09f98349071ac670f9f2b2b140717e12589e638c073fb`
- B: `0b6e4fecc17f4b7565fa7aa90f03e44ed65f3977ee60f9389ce6f1ec48f47de9`

## Fixed sample and environment

The A run generated one Issue #827 sample 1 project and used that same project path for B. It contained 3 Shots × 1,500 ms, 4.5 seconds total, 108 frames at 24 fps, 1920×1080, 10 assets, and 4 audio events. The `project.json` SHA-256 before A and before B was `7cffd545634e0400af4a6e7b5c0b32242c226e50b2763aca1ab14be5cf9f3d6d`.

Environment: Windows Server 2022 build 20348, Electron 43.1.1, Chromium 150.0.7871.114, Node 24.18.0, Intel Xeon Platinum with 8 logical processors and 16.6 GiB RAM. Windows reported virtual display adapters AspDod/AspIdd; GPU status was unknown. The build was unpackaged.

Other Electron roots observed before A and again before B remained present: #804 visual acceptance (PID 10752), #839 G3 import (PID 13520), the existing Panda Stage app (PID 13344), and #842 F04 diagnosis (PID 4080). No existing process was closed. Total CPU samples were 5.6%, 2.0%, and 1.2% before A, and 0.7%, 0.5%, and 0% before B.

## A: valid baseline sample

| Measure | A |
| --- | ---: |
| Frame timing coverage | 108/108; unique Job; no duplicate or missing frame keys |
| Hidden BrowserWindow | `isVisible=false`; `getBackgroundThrottling()=true` |
| Renderer visibility | `visible`; `document.hidden=false` |
| rAF wait total | 105.833 s |
| rAF median / p95 / max | 980 ms / 981.5 ms / 987.9 ms |
| `T_renderFrames` | 111.821 s |
| Export Job start to commit | 118.374 s |
| UI click to completed | 121.885 s |
| Stage ready median / p95 | 0.85 ms / 1.5 ms |
| `toBlob` median / p95 / max | 17.5 ms / 19.2 ms / 1,011.1 ms |
| Three Shot-first `toBlob` callbacks | 1,011.1 ms / 1,010.2 ms / 1,010.8 ms |
| Estimated IPC/dispatch residual, sum | 104.083 ms |
| `writeFrame` / write-slot wait, sum | 80.488 ms / 0.489 ms |
| Video encode / audio mux | 1.946 s / 0.255 s |

FFprobe passed: H.264/yuv420p, 1920×1080, 24 fps, 108 frames, 4.5 seconds, AAC 48 kHz, 4.5 seconds. Output SHA-256: `e136f5ff31b8286c91dc9dc3ae49fb9517327f9620e11a6bd256f0c066f686e1`. Project bytes, all 10 source assets, editor revision/dirty/undo/redo state were unchanged during A. The Job and process count returned to zero and temporary/staging files were removed.

## B: stop before export

B was built with explicit `backgroundThrottling:false`, then launched against the same project path with a different output target. It stopped in the pre-export fingerprint guard:

> `Project background references or bytes changed before formal export.`

The guard compares the project's background fingerprints with `fixture.backgroundEvidence`. The fixed-project loader supplied an empty expected list, so the harness rejected the input before the formal Job. No B Job, output, FFprobe result, effective getter observation, or frame timing was produced.

The project file hash also changed during the B setup window: from `7cffd545634e0400af4a6e7b5c0b32242c226e50b2763aca1ab14be5cf9f3d6d` before B to `85b54607a8e85724253e6bf6d75178d421cbc767387ee1db8a48af56aafe74ff` afterward. The 10 asset hashes still matched A. The B output target did not exist, no B Electron process remained, and the launcher receipt recorded `STOP_OR_PARTIAL`, exit code 1, no run directory, and no timer-based kill. The generated project file was left as found after B; this report records the changed hash and does not restore it.

## Interpretation and next action

The single valid A result confirms the measurement instrument works for the baseline and reproduces the #843 rAF delay in this environment. There is no valid B sample, so no delta, decoded-frame comparison, decoded-audio equivalence, or causal conclusion is available. Mark the hypothesis `INCONCLUSIVE`, not `NOT_SUPPORTED` or `SUPPORTED`.

This ticket's sampling stops here. A new pair would require a new explicit owner release after the fixed-project loader can supply and verify background-fingerprint metadata without changing the project file. No production optimization ticket or implementation is authorized. `OWNER_GO_TO_OPTIMIZE=NOT_GRANTED`; PR #817 remains OPEN/Draft/UNMERGED; #843, #838, #836, and DL-07 remain unchanged.

The small machine-readable summary is [issue-844-background-throttling-ab.json](./issue-844-background-throttling-ab.json). The updated reused diagnostic runner is [issue843-perf-diagnostic.cjs](../../scripts/issue843-perf-diagnostic.cjs). Raw screenshots, local receipts, and MP4 output remain in the local acceptance directory and are not part of this commit.
