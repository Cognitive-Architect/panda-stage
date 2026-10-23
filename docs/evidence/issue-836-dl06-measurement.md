# Issue #836 DL-06 measurement plan and result

Report version: **1.1.0**
Frozen plan revision: **1.0.3**, committed before the bounded R3 set
Plan date: **2026-10-23**
R3 status: **PARTIAL / NOT_ATTESTED**; three harness attempts stopped before export and their evidence is retained.

## Evidence availability

The available acceptance-project inventory did not contain two distinct, author-authorized real Projects with three Shots and a total duration near 30 seconds. The checked candidate projects were prior issue fixtures: one was five Shots / 15 seconds and the others were one Shot / 3 seconds. They do not satisfy the requested R3 sample shape or provenance, so this plan uses generated probes only and will remain **PARTIAL / NOT_ATTESTED**.

The probes use the existing Issue #827 fixture generator based on `demo-project/project-v1.example.json`:

- Sample 1: three Shots of 10,003 ms, 9,997 ms, and 10,000 ms.
- Sample 2: three Shots of 9,000 ms, 11,000 ms, and 10,000 ms.
- Both total 30,000 ms at 24 fps (720 expected output frames) and use generated fixture media. They are not real user Projects.

## Frozen run plan

1. `pnpm build` and the focused R0 verifier build completed on product implementation commit `f38a325cd40a5152cf1ee027d66b9b2955ab8cd0`. Later commits through the third R3 attempt changed only the measurement harness/report; the production build inputs remained unchanged.
2. The planned bounded invocation was `powershell -NoProfile -File scripts/measure-issue836-dl06-r3.ps1 -AcceptanceRoot D:\PandaStage-Acceptance\issue836-dl06-r3-foreground`. It stopped during sample 1 before Save As completed; sample 1 warm-followup and both sample 2 runs were not started.
3. “Cold” means a fresh Electron process and generated fixture root; Windows caches are not flushed. “Warm” means an immediate repeat of the same generated sample definition in a fresh Electron process; system caches may remain warm. These runs do not form a controlled OS cold-cache benchmark.
4. The runner samples each Electron process-tree PID every 500 ms and records per-PID peak working-set and private bytes, process sample counts, root PID, and elapsed wall time. It does not estimate p95 or substitute missing samples with zero.
5. Each existing Issue #827 verifier receipt supplies the actual Project hash, FFprobe dimensions/frame count/duration, output byte count and SHA-256, source media hashes, and temporary cleanup evidence. The runner stores its own process-memory summary and a hash of each verifier receipt.
6. The three pre-export harness-failure attempts are retained under `D:\PandaStage-Acceptance\issue836-dl06-r3\`, `D:\PandaStage-Acceptance\issue836-dl06-r3-corrected\`, and `D:\PandaStage-Acceptance\issue836-dl06-r3-foreground\`. The summarized pre-export evidence is `D:\PandaStage-Acceptance\issue836-dl06-r3\preexport-evidence.json`. No user Project was copied or changed.

### Corrected launch addendum (v1.0.2)

The first invocation used `Start-Process -WindowStyle Hidden`; the second used `-WindowStyle Normal`; the third used a normal window plus one immediate `AppActivate` request. All stopped sample 1 before export because the native Save As dialog timed out. The third attempt recorded `creatorWindowForegroundActivated=false`, so focus was not confirmed. Each stderr log records the UI Automation timeout; none produced an acceptance receipt or started a formal Export Job. These are harness/UI-session failures, not export failures. The frozen stop condition was reached after the third attempt; no further R3 runs were made.

### Pre-run capture addendum (v1.0.1)

Before launching the first export process, the runner records the logical-volume filesystem/capacity/free-space inventory, physical-disk model/interface/capacity, Windows system DPI plus current-user DPI registry values, Electron version, and the resolved FFmpeg/FFprobe executable paths, first version lines, and binary SHA-256 hashes. It records the exact commit SHA and the frozen 500 ms target interval. During each run it records observed maximum sampling interval, sample count, sampled concurrent process-tree count, per-PID memory peaks, and approximate frame-job/frozen-media/output-staging bytes. The monitor samples filesystem sizes and process state from the same Windows host; sub-interval peaks and very short-lived child processes may be missed.

The verifier does not expose per-stage timestamps, renderer pending-write-queue peak, or the exact post-task resource-release duration in its receipt. Those fields remain **NOT_MEASURED**; frame-file count is recorded separately and is not substituted for the pending-write queue. The probes do not run cancellation on the two generated 30-second samples; cancellation/release claims remain limited to the existing focused R0/R4 evidence.

## Observed pre-export results

The runner reached the native Save As step, but the existing dialog helper could not find a visible Save As window. All three attempts ended before a formal Job, encoding, FFprobe, commit, or cleanup phase. There are no R3 output MP4s or verifier receipts. The generated Project files were still present on disk and were hashed after the attempts; they prove fixture identity only, not Save/Reopen or export success.

| Attempt | Runner SHA | runId | Wall time | Process samples | Sampled process-tree peak | Max observed sample interval | Result |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| Hidden-window launch | `baf5a3e4d8f337fa226f6923942a808c53d47497` | `e3de03c2-f365-422c-821e-7849fce40711` | 32.863 s | 57 | 8 | 627.5 ms | Native Save As UIA timeout; no receipt |
| Normal-window launch | `54e65bf6d7abaf6622585e65c547d3474463c461` | `35529aee-b684-4606-8759-cc840e9c6b32` | 32.828 s | 57 | 8 | 624.3 ms | Native Save As UIA timeout; no receipt |
| Normal window + immediate activation request | `268c59ef603c973b68bf798ba8ffca321e220f28` | `1d35724e-e148-4605-b384-70b927fe4efd` | 33.817 s | 58 | 8 | 629.9 ms | Activation returned false; native Save As UIA timeout; no receipt |

The wrapper's `exitCode` field was `null` in all three run manifests, so it is not presented as an observed process exit code. The failure evidence is the retained stderr from `scripts/issue816-native-dialog.ps1` (`Timed out waiting for the native Save As dialog`) and absence of an acceptance receipt. The per-PID working-set/private-byte peaks are preserved in each raw manifest, but they cover **pre-export process/UI automation startup only**. The sampled tree includes verifier helper processes; its peak of 8 is not an exporter concurrency measurement and must not be used as a product resource result.

### Machine and tool snapshot

- Device: Alibaba Cloud ECS, `Intel(R) Xeon(R) Platinum`; reported physical memory **16,624,439,296 bytes**.
- OS: Windows Server 2022 Datacenter, `10.0.20348` build `20348`, 64-bit. Logical C: and D: volumes were NTFS. The reported physical devices were Red Hat VirtIO SCSI disks (virtual machine storage).
- DPI: `GetDpiForSystem()` returned 96 DPI / 100%. Active per-window DPI was not queried; raw per-monitor registry values are included in the external JSON.
- Runtime: Electron `43.1.1`, unpackaged built app. FFmpeg: `N-92722-gf22fcd4483`, SHA-256 `c8abc49e7be62dde8e12972af373959e0076a7b8dc8040eb45978e0608f8781e`. FFprobe: `2023-02-13-git-2296078397-essentials_build-www.gyan.dev`, SHA-256 `f28c4751e7367205267025aaf0fcfc921e34d9b7edaa46bd9c8abaf367fc9051`.

### Generated fixture identity observed before Save As

Only sample 1 reached fixture generation. Its generated Projects each contain 3 Shots / 30,000 ms and the same 10 assets totaling **1,785,611 bytes**. The source `demo-project/project-v1.example.json` SHA-256 is `2e7fe7a9758ba4849406fceab371d8e7715fd19b18f773f631f77bfc8fee6829`. Generated Project file hashes were:

- First attempt: `c30ce81052fd031c3b690492c51d696b73b1efac935080834faa7ad4ddee6ae7`.
- Second attempt: `d51f437ab998c5a5c024968dd610dff10c168e8b14bc8065c4ad4d2f12418565`.
- Third attempt: `8ec6e21ddaa5d617648804ae9082e8fa1e7ca01652609565a8181cb1954d2cff`.

All ten generated asset file hashes matched the Project manifest in each attempt. The full per-asset path/SHA/byte list, per-PID observations, run timestamps, environment values, and retained log paths are in `D:\PandaStage-Acceptance\issue836-dl06-r3\preexport-evidence.json`. These fixture hashes are not output hashes. Sample 2 was never generated in this R3 invocation.

### Capture-tool review after the stop

Reviewing the failed runs found that the first runner version watched the acceptance base folder rather than the verifier's timestamped `run-*` fixture directory, so its pre-export storage zeros are invalid and are excluded from this report. After the stop, the runner was amended to create unique invocation folders, find the nested fixture directory, leave storage fields `NOT_MEASURED` when it is absent, and retry foreground activation only after an Electron process has a main-window handle. These post-stop tool changes received a PowerShell parser check only and were **not executed**; they do not retroactively change the three retained run records.

### Bounded continuation plan (v1.0.4, frozen before continuation)

The user-authorized Issue objective remains active. The first three invocations above are retained as launch qualification failures; they did not begin formal export. A single continuation set is permitted because the latest runner now retries foreground activation only after an Electron main-window handle exists, samples the verifier's actual timestamped fixture root, preserves each invocation in a unique directory, and records missing values as `NOT_MEASURED`.

The runner code under test is the version committed at `ff8697243170587e8e2192fe41e8157c55b8779a`; the one invocation records the exact current HEAD (the plan-freeze commit) before launching. Run once with `powershell -NoProfile -File scripts/measure-issue836-dl06-r3.ps1 -AcceptanceRoot D:\PandaStage-Acceptance\issue836-dl06-r3-resumed`. The existing order and sample definitions are unchanged: sample 1 cold-process, sample 1 warm-followup, sample 2 cold-process, sample 2 warm-followup. This set is capped at four Electron process runs. The script stops on the first failed run; do not retry a failed sample. Preserve all outputs and update this report after the set. Even if all generated probes pass, R3 remains **PARTIAL / NOT_ATTESTED** because the available projects are generated rather than author-authorized real Projects and no installer/human Gate B acceptance is in scope.

## R0–R4 and acceptance summary

- **R0: PASS.** Two expired owners each exhausted four automatic deletion attempts. While locked, an explicit Creator retry stayed `PREPARATION_BUSY`, created no Job, retained both owned directories, and kept snapshot paths/errors out of visible copy. After releasing the lock, the same Main service removed both old paths and completed a distinct same-session Job. Project SHA and prior MP4 SHA were unchanged. Receipt: `D:\PandaStage-Acceptance\issue836-dl06-r0\34651315-6606-42f0-a276-e9cc3d832614\run-2026-10-23T05-20-59-950Z-4188\acceptance-receipt.json`.
- **R1: PASS.** One versioned machine-readable matrix (`dl06-2026-10-23.1`) drives support checks, concise Creator copy, and the generated Markdown. It distinguishes all four capability layers and statuses; JPEG formal export remains `SUPPORTED_UNVERIFIED`, special FLA/Open-Fill remains `UNKNOWN` with #784/#786 references.
- **R2: PARTIAL.** Unit coverage passes exact/over limits for 256/257 Shots, 512/513 assets, 64 MiB + 1 byte, 256 MiB + 1 byte, and Windows 259/260 character target/staging paths. Earlier deep-path Electron probes exposed the tool path failure and are retained under `D:\PandaStage-Acceptance\issue836-dl06-r2-paths\`; the final code blocks unsafe target/staging paths. A post-guard deep-path Creator UI run was not completed.
- **R3: PARTIAL / NOT_ATTESTED.** Three sample-1 harness attempts stopped before Save As; sample 1 warm, both sample-2 runs, output/frame/PCM/FFprobe evidence, export phase timings, export memory, temporary disk peak, renderer queue peak, and cancellation-release duration are `NOT_MEASURED`. No real user Projects were available; no installer or human acceptance was run.
- **R4: PARTIAL.** Versioned support matrix and this report are present; targeted quality checks and the focused R0 verifier passed. The R3 sample-export evidence and full R3 cost/release observations remain unavailable.

AC01 **PASS**; AC02 **PASS**; AC03 **PARTIAL**; AC04 **PARTIAL**; AC05 **PARTIAL**; AC06 **PARTIAL**; AC07 **PARTIAL**; AC08 **PARTIAL**; AC09 **PARTIAL**; AC10 **PASS**; AC11 **PASS for local validation; final-SHA CI state is recorded in the Issue receipt**; AC12 **body-only Issue #836 receipt is the final external action after commit and CI lookup**.

## Interpretation and stop conditions

- A run is technically passing only if the verifier exits successfully, its receipt records a 30-second 24 fps export with 720 frames, the output has a recorded SHA-256 and nonzero byte count, the source Project hash is unchanged, and output/frame/preparation temporary cleanup passes.
- Preserve and report a failed run as failed; do not replace missing measurements with zero or claim a benchmark pass.
- The build is unpackaged Electron. This plan does not verify an installer, packaged resources, human audiovisual acceptance, Gate B, owner acceptance, DL-07, or the DL-07 GO decision.
- Regardless of generated-probe results, R3 remains **PARTIAL / NOT_ATTESTED** until qualifying real-project evidence and the required human/packaged acceptance exist.

The versioned capability profile is in [export-support-matrix.md](../export-support-matrix.md). The run command and current project fixtures are checked against the repository before execution.
