# Issue #836 DL-06 measurement plan and result

Report version: **1.18.0**
Frozen R3 plan revision: **1.4.0**, completed as one bounded four-run continuation
Plan date: **2026-10-23**
R3 status: **PARTIAL / NOT_ATTESTED**; all four v1.4.0 generated-probe cold/warm runs completed with `auto=PASS`, matching manifest/receipt hashes, and maximum sample gaps below the frozen 5,000 ms validity limit. These generated probes do not establish author-authorized real-project provenance. Phase wall times, Renderer pending-write queue peak, and post-terminal release time remain `NOT_MEASURED`; installer acceptance and human Gate B evidence remain unavailable. DL-06 and DL-07 remain **NO GO**.
R2 status: **PARTIAL**; the v1.0.0 AC08 staging-path boundary probe passed. The v1.1.0 supported deep-path Creator export completed through atomic commit, but its runner exited 1 on a harness enum mismatch; no retry was made.

## Evidence availability

The available acceptance-project inventory did not contain two distinct, author-authorized real Projects with three Shots and a total duration near 30 seconds. A read-only scan of 1,173 `project.json` files under `D:\PandaStage-Acceptance` found 21 files with three Shots and 24–36 seconds; all were under the Issue #827/#830/#832/#834 verifier fixture roots. The generator `generateIssue827Fixture` builds these from `demo-project/project-v1.example.json` with generated audio/background media, so they are valid probes but do not establish real-project provenance. Older candidates also included one five-Shot / 15-second fixture and one-Shot / 3-second fixtures. This plan therefore uses generated probes only and remains **PARTIAL / NOT_ATTESTED**.

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

Reviewing the first three failed runs found that the original runner watched the acceptance base folder rather than the verifier's timestamped `run-*` fixture directory, so its pre-export storage zeroes are invalid and are excluded from this report. The later runner amendments create unique invocation folders, find the nested fixture directory, leave storage fields `NOT_MEASURED` when it is absent, and retry foreground activation only after an Electron process has a main-window handle. The v1.0.4 and v1.0.5 invocations exercised these amendments; they do not retroactively change the first three retained run records.

### Bounded continuation plan (v1.0.4, frozen before continuation)

The user-authorized Issue objective remains active. The first three invocations above are retained as launch qualification failures; they did not begin formal export. A single continuation set is permitted because the latest runner now retries foreground activation only after an Electron main-window handle exists, samples the verifier's actual timestamped fixture root, preserves each invocation in a unique directory, and records missing values as `NOT_MEASURED`.

The runner code under test is the version committed at `ff8697243170587e8e2192fe41e8157c55b8779a`; the one invocation records the exact current HEAD (the plan-freeze commit) before launching. Run once with `powershell -NoProfile -File scripts/measure-issue836-dl06-r3.ps1 -AcceptanceRoot D:\PandaStage-Acceptance\issue836-dl06-r3-resumed`. The existing order and sample definitions are unchanged: sample 1 cold-process, sample 1 warm-followup, sample 2 cold-process, sample 2 warm-followup. This set is capped at four Electron process runs. The script stops on the first failed run; do not retry a failed sample. Preserve all outputs and update this report after the set. Even if all generated probes pass, R3 remains **PARTIAL / NOT_ATTESTED** because the available projects are generated rather than author-authorized real Projects and no installer/human Gate B acceptance is in scope.

The v1.0.4 invocation used runner/source SHA `885144e5f0841462b7aae417733d094a74e917cf`, run ID `5fdc4502-54b8-47ac-b203-972e90de42a9`, and stopped on sample 1 cold-process. It reached the Creator window and activated Electron PID 6808, but the formal export path guard blocked Save As: the selected target was 230 characters and its same-directory staging path would have been 306 characters. No formal Job started and no output or receipt was produced. The generated Project SHA-256 was `852120b9cce14ab35e7600aa5271d6f1749a431d7d1aeceb858bbfa5e9a3c17f`. The runner recorded 35,752 ms wall time, 62 process samples, peak sampled tree count 8, and maximum sample interval 620.1 ms. The guard acted as designed; the acceptance root made the harness path too deep. This is retained as a product-boundary observation, not an export attempt. Evidence root: `D:\PandaStage-Acceptance\issue836-dl06-r3-resumed\measurement-20261023T054411Z-3069ff99-e9b0-4bed-ae61-50a1bdfc0ae6\sample-1-cold-process`.

### Bounded continuation plan (v1.0.5, frozen before continuation)

This revision changes only the harness acceptance root and invocation folder length after v1.0.4 showed that its generated path could not pass the product's 259-character safety guard. The default root is now `D:\PandaStage-Acceptance\i836r3`; each invocation retains a full `invocationId` in its manifest and uses a unique 16-hex-character folder name. The longest generated same-directory staging path, calculated with the six-digit fixture process ID, project filename, and 97-character staging basename (prefix, two 36-character UUIDs, separator, and `.mp4` suffix), is 206 characters. This leaves 53 characters below the guard.

Freeze this plan before one invocation of `powershell -NoProfile -File scripts/measure-issue836-dl06-r3.ps1 -AcceptanceRoot D:\PandaStage-Acceptance\i836r3`. Preserve the existing four-run order and stop on the first failed run; make no further retry if this invocation fails. Its manifest must record the exact plan-freeze commit SHA. Even if the generated probes pass, R3 remains **PARTIAL / NOT_ATTESTED** because no author-authorized real Projects or installer/human Gate B acceptance are available.

The v1.0.5 invocation used runner/source SHA `a9a1be241415aa56b5308c977e519711f7a6fe9c`, invocation ID `20261023T054819Z-2d8e1de9-79b1-46ba-9bbc-a6cf1d7b0c3f`, and measurement root `D:\PandaStage-Acceptance\i836r3\m-27ac04202aa94de4`. It stopped on sample 1 cold-process as frozen. AppActivate succeeded for Electron PID 2920. The generated fixture root was `D:\PandaStage-Acceptance\i836r3\m-27ac04202aa94de4\sample-1-cold-process\run-2026-10-23T05-48-22-453Z-2920`; its Project SHA-256 was `53c8168cb80cf484a22cd878a5bf1f44eb580c372a3fea6473f7f365ab4ef435`, and its ten generated asset hashes matched the fixture manifest. The existing verifier cancellation subtest started one formal Job, cancelled it at 1/720 frames, and returned the visible cleanup state. The subsequent primary sample export did not pass native Save As UI Automation: `Timed out waiting for the native Save As dialog.` No R3 acceptance receipt or MP4 was produced. This was a Save As harness/UI-session failure, not an export result.

The runner recorded 33,971 ms wall time, 58 process samples, peak sampled tree count 8, and maximum sample interval 611.1 ms against the 500 ms target. The storage sampler observed a peak of 4 frame files / 1,612,141 bytes, frozen media 1,593,567 bytes, and no output staging bytes over 57 samples. These cover fixture preparation and the verifier's cancellation subtest only; they are not export memory, queue, phase-time, or successful-export disk measurements. The wrapper `exitCode` was `null`; the retained stderr and absent verifier receipt establish the failure. The failure JSON did not persist `saveDialogEvidence`, so it cannot establish whether Main entered `selectOutputPath` before the UIA timeout. Details are in `D:\PandaStage-Acceptance\i836r3\m-27ac04202aa94de4\measurement-runs.json`, `sample-1-cold-process\electron-stderr.log`, `sample-1-cold-process\run-2026-10-23T05-48-22-453Z-2920\evidence\electron-failure.json`, and `electron-failure.png` under that run's evidence directory. Sample 1 warm-followup and both sample 2 runs were not started.

### Supplemental generated-probe outputs from Issue #827 (not counted as DL-06 R3)

Two earlier Issue #827 receipts contain successful Creator UI outputs for the generated, distinct three-Shot / 30-second probes. Their MP4 files still exist in the acceptance folder and their current SHA-256 values match the receipts:

| Sample | Prior source commit / run | Generated Project SHA-256 | Output SHA-256 | Output |
| --- | --- | --- | --- | --- |
| 1 | `a21f520d2d9f57601df4438f7adc4911ddbdd376` / `bf45cc93-2c80-4c7d-b445-434961b4de54` | `e8de79f1f49c507a101c4cf5fabf26d6b03bfcf0cbf8bcf232554b6ad367e2ef` | `8c307cb4ff37b8bd75018ca2bd43b41d29c761d02d812fae956ba18d4b8da13f` | 30,000 ms; 720 frames; 24 fps; 1920×1080; H.264/AAC; static |
| 2 | `a21f520d2d9f57601df4438f7adc4911ddbdd376` / `bf45cc93-2c80-4c7d-b445-434961b4de54` | `d8a472c03bfdb36aa224219b38a8f90add437380494362d0a36ece175f697782` | `b2e65c46917a58caf151514d0a32c77541ba88174fc4fa039f48a1c8fb9fb07d` | 30,000 ms; 720 frames; 24 fps; 1920×1080; H.264/AAC; speaker-focus |

The corresponding receipts are `D:\PandaStage-Acceptance\issue827-dl04\i830-bf45cc93-2c80-4c7d-b445-434961b4de54\sample-1\run-2026-10-22T10-33-45-259Z-10712\acceptance-receipt.json` and `D:\PandaStage-Acceptance\issue827-dl04\i830-bf45cc93-2c80-4c7d-b445-434961b4de54\sample-2\run-2026-10-22T10-51-06-714Z-4240\acceptance-receipt.json`. Both are `AUTO=PASS`; the recorded output paths exist and were re-hashed read-only. The source commit is an ancestor of the DL-06 product implementation commit `f38a325`, but these runs predate DL-06's frozen measurement plan and its later production changes. They provide one historical output per generated sample, not cold/warm pairs or DL-06 resource measurements, so they do not satisfy R3 and do not change the R3 stop result.

### Final bounded R3 diagnostic continuation plan (v1.0.6, frozen before run; superseded after its result)

Inspection of the v1.0.5 failure evidence showed that the verifier omitted its in-memory `saveDialogEvidence` from `electron-failure.json`; the native UIA helper also reported only a timeout and did not preserve matching top-level window/control IDs. This revision adds both diagnostics without changing product code, sample definitions, or the 500 ms process/storage sampling. It records whether Main entered `selectOutputPath`; on a Save As timeout it records UIA owner/window classes, process IDs, enabled states, and descendant Button Automation IDs. It does not capture unrelated window titles or file contents.

This revision supersedes v1.0.5's no-retry conclusion after the post-run audit found that the failure record omitted the Main dialog-selection trace. It authorizes exactly one new four-run set, retaining the stop-on-first-failure rule; no additional R3 invocation will follow this plan.

Run one final bounded invocation with `powershell -NoProfile -File scripts/measure-issue836-dl06-r3.ps1 -AcceptanceRoot D:\PandaStage-Acceptance\i836r3`. The order remains sample 1 cold-process, sample 1 warm-followup, sample 2 cold-process, sample 2 warm-followup. The script stops on the first failure; do not retry any failed sample, and make no further R3 invocation after this plan. Preserve the manifest and all failure diagnostics. The exact source SHA is recorded in the run manifest. Generated probes still cannot establish real-project provenance, packaged-install behavior, or human Gate B acceptance; those statuses remain PARTIAL / DEFERRED regardless of this result.

### v1.0.6 observed result

The v1.0.6 invocation used source commit `1bde6c1c8b4c1927f46f0c9990181f04892aea2a` and stopped on sample 1 cold-process after 34,831 ms and 60 process samples. The sampled process-tree peak was 8, maximum sample interval 640.9 ms, and AppActivate succeeded for Electron PID 1364. Storage sampling observed 4 frame files / 1,612,141 bytes, 1,593,567 frozen-media bytes, and 0 output-staging bytes across 59 samples. These are setup/cancellation-subtest observations, not successful-export resource measurements. The generated Project SHA-256 was `f59363fdff1424a70a8490b8598eb8f01b86bcc8a026983aeeb336bb84ab3b74`.

The retained failure JSON contained exactly one `saveDialogEvidence` entry, for the cancellation subtest's `issue827-cancelled-1.mp4` target. The primary sample did not call Main's `selectOutputPath`; no Save As dialog was open. The UIA timeout snapshot found only the enabled Electron main window (PID 1364) and no descendant windows. The screenshot showed the canceled task surface with its retry actions. Code inspection confirmed that the verifier then clicked the toolbar Export action, which restores any non-idle task surface and returns without starting a new formal export. Thus this run exposed a verifier action mismatch, not a native Save As or export failure. No primary formal Job, receipt, or output MP4 was created. The run manifest and diagnostics are under `D:\PandaStage-Acceptance\i836r3\m-063ab688606e4bf4\sample-1-cold-process\`.

### Final bounded R3 continuation plan (v1.0.7, frozen before run)

The v1.0.6 result newly establishes that the verifier never requested Save As for the primary sample: after the controlled cancellation, `startFromCreatorUi` clicked the toolbar action, while the product correctly restored the existing canceled task surface. The retry action wired to `retryCurrentExportContent` starts a fresh formal export. This revision updates the verifier to click “retry current content” for the post-cancellation sample. It changes no product code, sample definitions, measurement interval, or stop rule.

This plan supersedes v1.0.6 only because its retained failure evidence demonstrated the harness action mismatch above. It authorizes one final bounded four-run set on the corrected verifier, stopping on the first failed run. Do not retry a failed sample and make no further R3 invocation after this plan. Run `powershell -NoProfile -File scripts/measure-issue836-dl06-r3.ps1 -AcceptanceRoot D:\PandaStage-Acceptance\i836r3`; keep the existing order: sample 1 cold-process, sample 1 warm-followup, sample 2 cold-process, sample 2 warm-followup. The source SHA and all run evidence must be preserved. Generated probes still cannot establish real-project provenance, packaged-install behavior, or human Gate B acceptance; those statuses remain PARTIAL / DEFERRED regardless of this result.

### v1.0.7 observed result — stopped on sample 1 cold-process

The run used source commit `f94e84ed69b8c35b644bfe7e4194150d6684e561`, invocation `20261023T061016Z-71efc902-6df2-484b-b90d-7975c98e532b`, and runId `a065652e-73e8-4744-a497-b8f0924b431c`. It lasted 791,316 ms (13m 11s), with 1,341 process samples, sampled process-tree peak 8, maximum sample gap 731.3 ms, and successful AppActivate for Electron PID 14168. The runner recorded a peak of 724 frame files / 48,817,478 bytes, 1,593,567 frozen-media bytes, 189,106 output-staging bytes, and 50,600,151 bytes as the sum of independent category peaks. These are approximate sampled directory totals; frame-file count is not the Renderer pending-write queue.

The controlled cancellation subtest completed, then explicit retry started primary formal Job `26d86c0a-83d9-4417-a28c-98d65f8a2cd4` / attempt `fd984191-261e-44aa-9670-d294353c2675`. Main reported `completed`, phase `finished`, and 720/720 frames with no Job or cleanup error. The output exists at `D:\PandaStage-Acceptance\i836r3\m-6cf46ede1a4c43ee\sample-1-cold-process\run-2026-10-23T06-10-19-393Z-14168\Panda Stage formal export.pandastage\issue827-sample-1.mp4`; size 189,106 bytes, SHA-256 `8c307cb4ff37b8bd75018ca2bd43b41d29c761d02d812fae956ba18d4b8da13f`. A read-only FFprobe inspection found H.264 1920×1080 video at 24 fps, 30.000 seconds / 720 frames, plus AAC mono 48 kHz audio. This output inspection is retained evidence; it is not a substitute for the missing verifier receipt or its complete post-export assertions.

After the primary export, the verifier entered its existing-target/no-clobber follow-up. It again clicked the toolbar Export action while the completed task surface was open. The screenshot shows the completed task with its “导出新版本” action; the toolbar handler restores the non-idle task and does not open Save As. No third `saveDialogEvidence` entry exists, and UIA found no native Save As dialog. The native-dialog helper timed out, so the verifier did not reach its no-clobber assertions or write `acceptance-receipt.json`. The Electron process exit code is null in the manifest; the measurement wrapper exited 1 for the missing receipt. Sample 1 warm and both sample 2 runs were not started. v1.0.7's stop condition was honored; the new bounded plan below supersedes that stop after this additional action mismatch was confirmed.

Per-PID memory sampling covered the full run but is not a machine-wide total: FFmpeg PID 16296 had the largest observed working set (676,913,152 bytes) and private bytes (814,813,184 bytes) across 16 samples; Electron PID 9796 peaked at 479,596,544 working-set bytes and 202,629,120 private bytes across 1,340 samples. Phase timings, Renderer pending queue peak, cancellation-release duration, PCM checks, and successful-export cleanup assertions remain `NOT_MEASURED` by the verifier. Raw manifest, logs, failure JSON, and screenshots are under `D:\PandaStage-Acceptance\i836r3\m-6cf46ede1a4c43ee\sample-1-cold-process\`.

### Next bounded R3 continuation plan (v1.0.8, frozen before run)

The v1.0.7 evidence showed a second terminal-state action mismatch after the primary MP4 completed: the no-clobber subtest used the toolbar while the completed-task surface was active. The harness now inspects the existing task status and follows the corresponding Creator path: idle uses the toolbar; completed restores the task surface then selects “导出新版本”; failed/cancelled restores the surface then selects “按当前内容重新导出”; active states fail immediately instead of waiting for a Save As dialog that cannot open. The selected action is written into the verifier receipt. No product code, samples, or measurement parameters change.

This plan supersedes v1.0.7 only because its retained evidence identified the follow-on task-action mismatch. It authorizes one bounded four-run set, in the existing order sample 1 cold-process, sample 1 warm-followup, sample 2 cold-process, sample 2 warm-followup. Stop on the first verifier failure; do not retry any failed sample, and make no further R3 invocation after this plan. Run `powershell -NoProfile -File scripts/measure-issue836-dl06-r3.ps1 -AcceptanceRoot D:\PandaStage-Acceptance\i836r3`. Preserve the manifest, acceptance receipts, failure JSON, logs, and screenshots. The run source SHA must be the committed verifier/report plan SHA. Generated probes still do not establish author-supplied real-project provenance, packaged-install behavior, or human Gate B acceptance.

## R0–R4 and acceptance summary

- **R0: PASS.** Two expired owners each exhausted four automatic deletion attempts. While locked, an explicit Creator retry stayed `PREPARATION_BUSY`, created no Job, retained both owned directories, and kept snapshot paths/errors out of visible copy. After releasing the lock, the same Main service removed both old paths and completed a distinct same-session Job. Project SHA and prior MP4 SHA were unchanged. Receipt: `D:\PandaStage-Acceptance\issue836-dl06-r0\34651315-6606-42f0-a276-e9cc3d832614\run-2026-10-23T05-20-59-950Z-4188\acceptance-receipt.json`.
- **R1: PASS.** One versioned machine-readable matrix (`dl06-2026-10-23.1`) drives support checks, concise Creator copy, and the generated Markdown. It distinguishes all four capability layers and statuses; JPEG formal export remains `SUPPORTED_UNVERIFIED`, special FLA/Open-Fill remains `UNKNOWN` with #784/#786 references.
- **R2: PARTIAL.** Unit coverage passes exact/over limits for 256/257 Shots, 512/513 assets, 64 MiB + 1 byte, 256 MiB + 1 byte, and Windows 259/260 character target/staging paths. Earlier deep-path Electron probes exposed the tool path failure and are retained under `D:\PandaStage-Acceptance\issue836-dl06-r2-paths\`; the final code blocks unsafe target/staging paths. A post-guard deep-path Creator UI run was not completed.
- **R3: PARTIAL / NOT_ATTESTED.** The first three harness invocations stopped at Save As UI Automation; v1.0.4 stopped at the 259-character path guard; v1.0.5 stopped at Save As after its cancellation subtest; and v1.0.6 stopped before Main's Save As callback because the verifier restored the canceled task surface. In v1.0.7–v1.0.9, sample 1 cold-process produced a 720-frame MP4, but each verifier stopped in the existing-target follow-up before writing a receipt (v1.0.7 action mismatch; v1.0.8 native UIA `InvalidCastIConvertible`; v1.0.9 Windows overwrite prompt had an empty UIA rectangle and screenshot capture halted before the confirm click). v1.1.0 stopped earlier at 459/720 frames with a 5,832,594 ms sampling gap and no output. None is a qualifying R3 run. Sample 1 warm and both sample 2 runs, PCM checks, full verifier cleanup assertions, phase timings, Renderer pending queue peak, and cancellation-release duration remain `NOT_MEASURED`. No real user Projects were available; no installer or human acceptance was run.
- **R4: PARTIAL.** Versioned support matrix and this report are present; targeted quality checks and the focused R0 verifier passed. The R3 full verifier receipt, cold/warm sample pair, and complete cost/release observations remain unavailable.

AC01 **PASS**; AC02 **PASS**; AC03 **PARTIAL**; AC04 **PARTIAL**; AC05 **PARTIAL**; AC06 **PARTIAL**; AC07 **PARTIAL**; AC08 **PARTIAL**; AC09 **PARTIAL**; AC10 **PASS**; AC11 **PASS for local validation; final-SHA CI state is recorded in the Issue receipt**; AC12 **body-only Issue #836 receipt is the final external action after commit and CI lookup**.

## Interpretation and stop conditions

- A run is technically passing only if the verifier exits successfully, its receipt records a 30-second 24 fps export with 720 frames, the output has a recorded SHA-256 and nonzero byte count, the source Project hash is unchanged, and output/frame/preparation temporary cleanup passes.
- Preserve and report a failed run as failed; do not replace missing measurements with zero or claim a benchmark pass.
- The build is unpackaged Electron. This plan does not verify an installer, packaged resources, human audiovisual acceptance, Gate B, owner acceptance, DL-07, or the DL-07 GO decision.
- Regardless of generated-probe results, R3 remains **PARTIAL / NOT_ATTESTED** until qualifying real-project evidence and the required human/packaged acceptance exist.

The versioned capability profile is in [export-support-matrix.md](../export-support-matrix.md). The run command and current project fixtures are checked against the repository before execution.


## R3 bounded continuation result — v1.0.8

The v1.0.8 invocation used source commit `26754b3d2ed41ba19faba860167828376c5888ae`, invocation `20261023T063346Z-358545ca-a5d4-41a1-bb4a-f5ac29155885`, and runId `e20b69da-0758-4e49-9f09-81edbc76772a`. It stopped on sample 1 cold-process after 785,074 ms (13m 5s), with 1,318 process samples, process-tree peak 8, and maximum observed sample interval 2,616.8 ms against the 500 ms target. AppActivate succeeded for Electron PID 1460. The generated `project.json` SHA-256 was `192e30fbd5c71cb285b06eddef670ab30dcad372810b242e87c41a3fbe5dc20d`.

The controlled cancellation subtest completed. Primary formal Job `7477ab0b-e72e-4de5-a837-ee20bd384509` then completed all 720/720 frames with no Job or cleanup error. Output `D:\PandaStage-Acceptance\i836r3\m-4b93aca1f08c4b84\sample-1-cold-process\run-2026-10-23T06-33-49-541Z-1460\Panda Stage formal export.pandastage\issue827-sample-1.mp4` exists at 189,106 bytes with SHA-256 `8c307cb4ff37b8bd75018ca2bd43b41d29c761d02d812fae956ba18d4b8da13f`. Read-only FFprobe reported H.264 1920×1080 at 24 fps, 30.000 seconds / 720 frames, plus AAC mono 48 kHz. This is a generated probe output and is not a qualifying DL-06 receipt.

The existing-target/no-clobber follow-up reached a third Main `saveDialogEvidence` entry (`phase: opened`) but no selected result. The visible task remained at “正在选择保存位置…”. The native helper failed with PowerShell `InvalidCastIConvertible` while converting a value to `System.Int32`; the run did not capture the failing script line or exact value. The post-failure screenshot `D:\PandaStage-Acceptance\i836r3\m-4b93aca1f08c4b84\sample-1-cold-process\run-2026-10-23T06-33-49-541Z-1460\evidence\existing-target-no-clobber-save-as.png` shows the Panda Stage assets workspace rather than a native Save As dialog. Since this helper searched disabled Electron windows desktop-wide, a cross-window match is plausible but not proven; no matched owner PID or dialog bounds were recorded. The no-clobber assertion did not run and no `acceptance-receipt.json` was written. Sample 1 warm and both sample 2 runs were not started.

The runner sampled a peak of 724 frame files / 48,817,478 bytes, frozen media 1,593,567 bytes, output staging 189,106 bytes, and 50,600,151 bytes as the sum of independent category peaks. These are approximate sampled directory totals and do not measure the Renderer pending-write queue. Phase times and post-terminal release duration remain `NOT_MEASURED`. Full manifest, logs, failure JSON, and screenshots are under `D:\PandaStage-Acceptance\i836r3\m-4b93aca1f08c4b84\sample-1-cold-process\`.

### Next bounded R3 continuation plan — v1.0.9 (frozen before run)

The v1.0.8 evidence shows the completed primary Job and output, followed by a failure in the existing-target Save As helper. The helper's desktop-wide matching plus the screenshot of a different Panda Stage workspace makes a cross-window match a plausible explanation, but the run did not capture a matched PID, bounds, or error line, so the cause is not established. This revision narrows native-dialog lookup to the verifier's Electron PID, records the matched owner/dialog PIDs and bounds, validates screenshot dimensions with explicit `System.Drawing` constructors and contextual errors, and preserves both captured stdout and stderr through child-process `close`. It changes only measurement harness/native-dialog automation; product code, samples, measurement interval, and stop-on-first-failure rule are unchanged.

v1.0.9 supersedes v1.0.8 only because its retained evidence shows the primary generated-probe export passed while the native Save As helper failed during the follow-up. Freeze the exact source commit in the run manifest and Issue body before running. Execute exactly one bounded set using `powershell -NoProfile -File scripts/measure-issue836-dl06-r3.ps1 -AcceptanceRoot D:\PandaStage-Acceptance\i836r3`, preserving the existing order: sample 1 cold-process, sample 1 warm-followup, sample 2 cold-process, sample 2 warm-followup. Stop on the first failed run; do not retry a failed sample. Preserve all manifests, acceptance receipts, failure JSON, screenshots, and logs. Even if generated probes pass, R3 remains **PARTIAL / NOT_ATTESTED** because the Projects are not author-authorized real Projects; packaged-install and human Gate B acceptance remain outside this measurement.


## R3 bounded continuation result — v1.0.9

The v1.0.9 invocation used source commit `27bee2f11fcef2618a3ee7f6a2f464380e945e82`, invocation `20261023T065809Z-3cb26cb5-3188-421f-a4da-01ff014ad5f5`, and runId `a106ee7b-74e7-49c7-b0a6-7482387e93e4`. It stopped on sample 1 cold-process after 784,186 ms (13m 4s), with 1,318 process samples, process-tree peak 8, and maximum observed sample interval 2,597.8 ms against the 500 ms target. AppActivate succeeded for Electron PID 5336. The generated `project.json` file SHA-256 was `648ba41cefef46d8d9ce6bfda1fd22645dac1e331ee5e9af67ee52e810dde549`.

The controlled cancellation subtest completed. Primary formal Job `f645566c-5c9e-454f-970c-2b204da3eb26` completed 720/720 frames with no Job or cleanup error. The generated sample-1 MP4 is 189,106 bytes, SHA-256 `8c307cb4ff37b8bd75018ca2bd43b41d29c761d02d812fae956ba18d4b8da13f`. Read-only FFprobe reported H.264 1920×1080 at 24 fps, 30.000 seconds / 720 frames, plus AAC mono 48 kHz. The frame-jobs directory was empty after completion. This remains partial generated-probe evidence, not a qualifying DL-06 receipt.

The existing-target follow-up reached a third Main Save As request but recorded no selected result. The helper matched the verifier's own Electron PID: owner PID 5336, dialog PID 5336, target PID 5336; the Save As bounds were `0,0,626,771`. It then found the Windows overwrite prompt in the same process, but UIA returned `BoundingRectangle=Empty` for that prompt. Screenshot capture stopped before the confirmation button click because the empty rectangle has non-finite coordinates. The resulting error is captured in `electron-failure.json` and `electron-stderr.log`; `existing-target-no-clobber-windows-overwrite.png` was not created. The no-clobber assertion did not execute and no `acceptance-receipt.json` was written. The output remained present and its current hash matches the primary export, but this does not replace the missing before/after assertion. Sample 1 warm and both sample 2 runs were not started.

The runner sampled a peak of 724 frame files / 48,817,478 bytes, frozen media 1,593,567 bytes, output staging 189,106 bytes, and 50,600,151 bytes as the sum of independent category peaks. The maximum sampled FFmpeg process (PID 11656) reached 677,027,840 working-set bytes and 814,338,048 private bytes over 16 samples; Electron PID 6540 reached 482,537,472 working-set bytes and 204,054,528 private bytes. These are sampled per-process figures, not machine-wide memory. Phase times and post-terminal release duration remain `NOT_MEASURED`. Full manifest, logs, failure JSON, and screenshots are under `D:\PandaStage-Acceptance\i836r3\m-a699b1eb50a9440d\sample-1-cold-process\`.

### Next bounded R3 continuation plan — v1.1.0 (frozen before run)

The v1.0.9 result confirms the PID filter matched the verifier's own Electron process and found the Windows overwrite prompt. The failure is specifically that UIA exposed `BoundingRectangle=Empty` for that prompt, so the optional screenshot capture halted before the no-clobber confirmation click. This revision uses the prompt window rectangle when valid, otherwise computes a crop from visible descendant Text/Button bounds. If no usable bounds exist or screen capture itself fails, it records that the screenshot is unavailable and continues with the already matched confirmation button; screenshot diagnostics will not block the no-clobber assertion. Product code, sample definitions, sampling interval, and stop-on-first-failure rule remain unchanged.

v1.1.0 supersedes v1.0.9 only because its retained evidence identifies this screenshot-capture stop point. Freeze the exact source commit in the run manifest and Issue body before running. Execute exactly one bounded set using `powershell -NoProfile -File scripts/measure-issue836-dl06-r3.ps1 -AcceptanceRoot D:\PandaStage-Acceptance\i836r3`, in order sample 1 cold-process, sample 1 warm-followup, sample 2 cold-process, sample 2 warm-followup. Stop on the first failed run; do not retry a failed sample. Preserve all manifests, receipts, failure JSON, screenshots, and logs. Even if generated probes pass, R3 remains **PARTIAL / NOT_ATTESTED** because these are not author-authorized real Projects; packaged-install and human Gate B acceptance remain outside this measurement.


## R3 bounded continuation result — v1.1.0

The v1.1.0 invocation used source commit `87f830f0bf3acbfa29fb230e9cfe48f6741c9ff4`, invocation `20261023T071643Z-19061306-df7e-4595-b763-9b7bd9b57fe4`, and runId `e89d4841-dda1-4f78-87c1-cd03d126c805`. It stopped on sample 1 cold-process after 6,312,783 ms (105m 12.8s), with 816 process samples, process-tree peak 8, and maximum observed sample interval 5,832,594.4 ms (97m 12.6s) against the 500 ms target. AppActivate succeeded for Electron PID 2540. This gap makes the resource sampling incomplete; the cause is not established.

The controlled cancellation subtest completed. Primary formal Job `d8450d75-3bc1-4b21-af22-9d0d9f1184a6` was still `running` / `rendering` at 459/720 frames (63%) in the retained failure diagnostics, with no Job or cleanup error. The verifier timed out waiting for `completed` or `failed`. No final MP4 or acceptance receipt exists. The generated `project.json` file SHA-256 was `787bf9263fcb14966039d4c8037c21c1ee707b5f45006d924f7714765eabcf23`. The frame-jobs directory retained 462 files / 32,732,923 bytes; sampled frozen media was 1,593,567 bytes and output staging remained 0. No-clobber was not reached, so the v1.1.0 screenshot-fallback code was not exercised. Sample 1 warm and both sample 2 runs were not started.

After the run, read-only power-policy inspection reported the High Performance profile with sleep and hibernate idle timeouts set to 0 seconds. No matching Kernel-Power or Power-Troubleshooter events, or EventLog service restart events, were found for the run window. This does not identify the source of the 97-minute sampling gap. The manifest, logs, failure JSON, and screenshots are under `D:\PandaStage-Acceptance\i836r3\m-824e70dfcf6c46bd\sample-1-cold-process\`.

### Next bounded R3 continuation plan — v1.2.0 (frozen before run)

The v1.1.0 evidence is a failed, incomplete sample and does not qualify as an R3 run. The 500 ms target interval was missed by a maximum gap of 5,832,594 ms. This revision makes the data-quality limit explicit: the maximum accepted sample gap is ten times the target interval (5,000 ms for this run). The measurement runner now records that limit in its manifest and, after preserving the run record, stops the bounded set if any sample exceeds it. This limit applies only to the validity of process/storage sampling; it is not an export performance threshold. No production code, fixture definition, or sample order changes. The existing-target screenshot fallback remains untested because v1.1.0 did not finish the primary export.

v1.2.0 supersedes v1.1.0 because its retained evidence shows a 97-minute sampling gap and an incomplete primary render. Freeze the exact source commit in the run manifest and Issue body before running. Execute exactly one bounded set using `powershell -NoProfile -File scripts/measure-issue836-dl06-r3.ps1 -AcceptanceRoot D:\PandaStage-Acceptance\i836r3`, in the existing order sample 1 cold-process, sample 1 warm-followup, sample 2 cold-process, sample 2 warm-followup. Stop on the first verifier failure or measurement-invalid sample; do not retry any failed sample. Preserve all manifests, receipts, failure JSON, screenshots, and logs. Even if generated probes pass, R3 remains **PARTIAL / NOT_ATTESTED** because these are not author-authorized real Projects; packaged-install and human Gate B acceptance remain outside this measurement.


## R3 bounded continuation result - frozen plan v1.2.0

Source commit: `a56cd443434af45148e8d099cc32207a884aed0c`. Invocation: `20261023T091036Z-15968aa8-d164-4632-9c5b-ef244bbfda3f`. Measurement root: `D:\PandaStage-Acceptance\i836r3\m-f35a1a3fe3d24a8b`.

| Run | runId | Wall time | Process samples | Peak process count | Maximum sample gap | Peak transient storage |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Sample 1 cold-process | `0de07967-ac55-43fb-a4d0-f9ceea53c0ca` | 1,043,532 ms (17m 23.5s) | 1,762 | 8 | 797.1 ms | 50,600,151 bytes |
| Sample 1 warm-followup | `f35c972e-7fe7-4bf9-84db-ea324b57d1aa` | 802,810 ms (13m 22.8s) | 1,355 | 8 | 847.9 ms | 50,600,151 bytes |

Both observed sampling gaps are below the frozen 5,000 ms validity limit. Each run sampled a peak of 724 frame files / 48,817,478 bytes, frozen media of 1,593,567 bytes, and output staging of 189,106 bytes. The sampled category peaks sum to 50,600,151 bytes; they may not have occurred simultaneously. The Renderer pending-write queue, phase wall times, and post-terminal release time remain `NOT_MEASURED`.

Environment: Alibaba Cloud ECS with an Intel Xeon Platinum CPU string, 16,624,439,296 bytes physical RAM, Windows Server 2022 Datacenter build 20348 x64, 96 DPI / 100% system scale, and Electron 43.1.1 running as a built unpackaged app. The locked FFmpeg was `N-92722-gf22fcd4483`; FFprobe was `2023-02-13-git-2296078397-essentials_build-www.gyan.dev`. This is a cloud Windows Server VM, not an installer or ordinary desktop acceptance environment. AppActivate succeeded for the run Electron roots (cold PID 9088; warm PID 4004).

Cold-process completed with `auto=PASS`; receipt: `D:\PandaStage-Acceptance\i836r3\m-f35a1a3fe3d24a8b\sample-1-cold-process\run-2026-10-23T09-10-40-325Z-9088\acceptance-receipt.json`. The receipt records Creator Save/Close/Recent Projects Open, cancellation with no published target and empty temporary directories, a no-clobber check with zero formal Jobs and identical before/after output hashes, and a controlled second-Shot frame-map failure at 241/720 with no failed MP4, empty cleanup directories, unchanged editor state, unchanged `project.json`, unchanged media, and an unchanged prior MP4. The saved/reopened `project.json` hash was `211859702eff20563ac7b81f8b812afb9effac6f869c9668b9dab5a594d7438b`; the receipt's initial source project hash was `c62d97ddec6318ec167f8f120e88efa01b1025def0f7578a6e70cc4fa2ad13d8`.

The cold output is 189,106 bytes, SHA-256 `8c307cb4ff37b8bd75018ca2bd43b41d29c761d02d812fae956ba18d4b8da13f`. Read-only FFprobe reported H.264 1920x1080, yuv420p, 24 fps, 720 frames, 30.000 seconds, plus AAC mono 48 kHz. This remains generated-probe evidence; `owner=NOT_ATTESTED`.

Warm-followup's primary Job `4cc8b524-4d88-4472-b5f9-94a3fe5b0bb2` completed 720/720 with no Job, original, or cleanup error. Its 189,106-byte MP4 hashes to the same `8c307cb4ff37b8bd75018ca2bd43b41d29c761d02d812fae956ba18d4b8da13f`; the verifier captured FFprobe JSON, and a read-only FFprobe run after failure confirmed H.264 1920x1080 yuv420p at 24 fps, 720 frames, 30.000 seconds, plus AAC mono 48 kHz.

The warm run failed at the existing-target/no-clobber follow-up before its assertion or acceptance receipt. The third Save As request was recorded at `2026-10-23T09:41:01.520Z` with no selected path. The helper matched Electron PID `4004`, reported a Windows overwrite prompt, then used a coordinate click to accept it without confirming foreground ownership; it subsequently reported that the native `Export MP4` dialog remained open. Both retained helper screenshots show the unrelated VLC window instead of the prompt or Save As dialog. A read-only foreground probe after the run observed VLC PID `12036`; this supports, but does not prove, a foreground/focus mismatch at the click time. The warm fixture's on-disk `project.json` SHA-256 after the run was `e3fa1ff0cd11c49683849564ea79c876fa7cdd6dc9c12cacefd97c779b707e40`; the failure JSON's initial source project hash was `76760d370eba19fea53f807c36c919eeb30cd9919dc933a18b56b4167c599626`. The MP4's post-failure hash still matched the primary export, but the missing before/after assertion means this is not a no-clobber pass. Failure evidence is under `D:\PandaStage-Acceptance\i836r3\m-f35a1a3fe3d24a8b\sample-1-warm-followup\run-2026-10-23T09-28-03-957Z-4004\evidence\electron-failure.json`.

Sample 1 warm did not produce an acceptance receipt; the bounded runner exited 1 and stopped as frozen. Sample 2 cold and warm were not started. The measured per-PID peaks were: cold FFmpeg PID 6612, 676,839,424 working-set / 814,317,568 private bytes, and Electron PID 10588, 478,334,976 / 198,299,648 bytes; warm FFmpeg PID 11884, 676,896,768 / 814,985,216 bytes, and Electron PID 15132, 480,636,928 / 200,560,640 bytes. These are sampled process values, not a machine-wide physical-memory total. The full manifest and retained evidence are under the measurement root above. GitHub status for source SHA `a56cd443434af45148e8d099cc32207a884aed0c` was `CI_NOT_REPORTED`.

R3 remains **PARTIAL / NOT_ATTESTED** and DL-06 remains **NO GO**. The warm primary export is supplemental output evidence, not a successful warm acceptance attempt. The 4-run generated-probe set is incomplete, and it cannot establish author-project provenance, packaged-install acceptance, or human Gate B acceptance.

### Next bounded R3 continuation plan - v1.3.0 (frozen before run)

v1.2.0 confirmed that sample 1 cold-process and the warm primary export completed, but the warm no-clobber helper captured VLC instead of its matched native dialogs and failed before the assertion. This revision changes only `scripts/issue816-native-dialog.ps1`: activate and verify the matched Windows overwrite dialog is foreground before screen capture or any coordinate fallback, use the button's UI Automation `InvokePattern` first, and permit coordinate fallback only after foreground-process verification. This is a harness safety and evidence correction; no product code, fixture definitions, sample order, measurement interval, or 5,000 ms sampling validity limit changes.

Freeze the exact source commit in the Issue body and measurement manifest before invocation. Execute exactly one bounded set using `powershell -NoProfile -File scripts/measure-issue836-dl06-r3.ps1 -AcceptanceRoot D:\PandaStage-Acceptance\i836r3`, preserving the order sample 1 cold-process, sample 1 warm-followup, sample 2 cold-process, sample 2 warm-followup. Stop on the first verifier failure or measurement-invalid sample; do not retry a failed sample. Preserve all manifests, receipts, failure JSON, screenshots, and logs. Even if all generated probes pass, R3 remains **PARTIAL / NOT_ATTESTED** because these are not author-authorized real Projects; packaged-install and human Gate B acceptance remain outside this measurement.


## R3 bounded continuation result - frozen plan v1.3.0

Source commit: `1234a1f01d001f0f578c3dc50d40e69a1729b795`. Invocation: `20261023T095151Z-a4b1bf5c-a858-4618-bf6b-cae804883fc2`. Measurement root: `D:\PandaStage-Acceptance\i836r3\m-843d042632374661`.

Sample 1 cold-process stopped after 4,935 ms / 6 process samples with peak process count 7 and a maximum sample gap of 621.5 ms, below the 5,000 ms limit. AppActivate succeeded for Electron PID 1476. The generated fixture's initial source project hash was `00c68e1d43379c40c3372df5bc06c9f5734555f747f88a44b0074182ab4175d4`.

The verifier opened its first Save As request at `2026-10-23T09:51:56.808Z`, but the native helper failed while compiling its embedded C# declarations: `IntPtr` was not found because the source omitted `using System;`. The error occurred in `scripts/issue816-native-dialog.ps1` before any formal Export Job started (`formalStarts=[]`). No acceptance receipt or output MP4 was produced. The bounded runner exited 1 and honored stop-on-first-failure; sample 1 warm and both sample 2 runs were not started. Evidence: `D:\PandaStage-Acceptance\i836r3\m-843d042632374661\sample-1-cold-process\run-2026-10-23T09-51-54-621Z-1476\evidence\electron-failure.json`.

The 621.5 ms gap is within the measurement validity limit, but this pre-export run does not provide exporter cost evidence. The storage sampler's zero frame/frozen-media/staging counts are pre-export observations and must not be treated as measured export peaks; export cost, phase times, pending-frame queue, and terminal release remain `NOT_MEASURED`. Source SHA `1234a1f01d001f0f578c3dc50d40e69a1729b795` had no GitHub status entries or workflow runs (`CI_NOT_REPORTED`).

### Next bounded R3 continuation plan - v1.4.0 (frozen before run)

v1.3.0 did not reach an Export Job because the newly added P/Invoke declarations failed compilation. This revision adds `using System;` to the embedded C# source in `scripts/issue816-native-dialog.ps1`; the v1.3 foreground activation and UI Automation behavior remain unchanged. Before freezing, validate both PowerShell parse and compilation of the exact embedded C# type. This is a measurement-harness compile correction; product code, fixture definitions, sample order, measurement interval, and 5,000 ms validity limit remain unchanged.

Freeze the exact source commit in the Issue body and measurement manifest before invocation. Execute exactly one bounded set using `powershell -NoProfile -File scripts/measure-issue836-dl06-r3.ps1 -AcceptanceRoot D:\PandaStage-Acceptance\i836r3`, in order sample 1 cold-process, sample 1 warm-followup, sample 2 cold-process, sample 2 warm-followup. Stop on the first verifier failure or measurement-invalid sample; do not retry a failed sample. Preserve all manifests, receipts, failure JSON, screenshots, and logs. Even if all generated probes pass, R3 remains **PARTIAL / NOT_ATTESTED** because author-authorized real Projects, packaged-install acceptance, and human Gate B evidence remain unavailable.

## R3 bounded continuation result - frozen plan v1.4.0

Report: `docs/evidence/issue-836-dl06-measurement.md`, version 1.14.0. Runner/source SHA: `2cb7e8084fa0e2b7205f53cdf7ce877dbe8f8e01`. Invocation: `20261023T095434Z-f0be2569-d9ff-429c-be03-9d793541ab16`. Measurement root: `D:\PandaStage-Acceptance\i836r3\m-6298ad32cc12454f\`. Machine-readable manifest: `measurement-runs.json` under that root; it contains each per-PID sample and storage record. All four receipt SHA-256 values match the manifest and all four receipts parse as JSON.

The frozen order completed without retry: sample 1 cold-process, sample 1 warm-followup, sample 2 cold-process, sample 2 warm-followup. All four wrapper invocations report `auto=PASS`, `owner=NOT_ATTESTED`, and successful foreground activation. The maximum observed sample gap is 2,968.4 ms, below the frozen 5,000 ms validity limit. This is a sampling-valid generated-probe set, not a cold-OS-cache benchmark, installer run, or author-project acceptance.

| Run | runId | Wall time | Process samples | Peak process count | Maximum sample gap | Project file SHA-256 | MP4 bytes / SHA-256 |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Sample 1 cold-process | `486db67d-5de8-4bd0-b641-747b695c8d3d` | 1,039,884 ms (17m 19.9s) | 1,774 | 8 | 668.8 ms | `511a55c5af179424a36720a08299fe6601e1924469485cce9c74faf30eb6b03a` | 189,106 / `8c307cb4ff37b8bd75018ca2bd43b41d29c761d02d812fae956ba18d4b8da13f` |
| Sample 1 warm-followup | `c7834773-13de-41fa-9b62-91052773ce76` | 1,043,247 ms (17m 23.2s) | 1,748 | 8 | 842.1 ms | `5320ca61de8c554a2004f4bbef571b4af315d69f4b8490e07a7c1d3db6d29b05` | 189,106 / `8c307cb4ff37b8bd75018ca2bd43b41d29c761d02d812fae956ba18d4b8da13f` |
| Sample 2 cold-process | `e6fb0a86-27cc-458f-bcf5-0aae604b2533` | 978,846 ms (16m 18.8s) | 1,601 | 11 | 2,968.4 ms | `d2862c3fabcc634916fd62f6d68642bfcaad1963233d21ec41b1a05eeabb40fe` | 283,805 / `b2e65c46917a58caf151514d0a32c77541ba88174fc4fa039f48a1c8fb9fb07d` |
| Sample 2 warm-followup | `46c2b1c2-20f3-4e44-8562-e8f8da162d5c` | 977,423 ms (16m 17.4s) | 1,668 | 8 | 710.7 ms | `174564de7c60595d48e966419761fa52f25f55eaef7555936f760bfaf12a40ca` | 283,805 / `b2e65c46917a58caf151514d0a32c77541ba88174fc4fa039f48a1c8fb9fb07d` |

All outputs are 30,000 ms / 720 frames / 24 fps, 1920×1080 H.264 yuv420p with a 30-second AAC audio stream. Cold and warm MP4 hashes match within each generated sample. Sample 1 used the static camera mode; sample 2 used speaker-focus. The receipts include decoded-audio evidence, Shot boundaries and per-Shot frame maps, source media hashes, save/reopen evidence, and selected-frame checks.

Both sample 1 receipts record cancellation with no published target and empty temporary directories. Their no-clobber tests record equal before/after MP4 hashes, zero formal Jobs started, and empty temporary directories. The controlled second-Shot map failure was run in sample 1 only, at 241/720: it published no failed MP4, cleaned staging, and left editor state, project file, source assets, and the previous successful output unchanged. Sample 2's `runtimeRenderFailure` is null by verifier design; the deterministic late-Shot injection is limited to sample 1. Both sample 2 receipts also record successful cancellation and no-clobber assertions with unchanged before/after hashes and zero formal Jobs.

Sample 1 runs each sampled 724 frame files / 48,817,478 frame-job bytes, 1,593,567 frozen-media bytes, and 189,106 output-staging bytes; the independent category peaks sum to 50,600,151 bytes. Sample 2 runs each sampled 724 frame files / 51,215,015 frame-job bytes, 1,497,279 frozen-media bytes, and 283,805 output-staging bytes; independent category peaks sum to 52,996,099 bytes. These category peaks may not have occurred simultaneously, short-lived peaks may be missed, and frame-file count is not the Renderer pending-write queue.

The largest per-PID working-set/private-byte observations were FFmpeg PID 13956 at 677,085,184 / 814,919,680 bytes (sample 1 cold), PID 11500 at 676,892,672 / 814,292,992 bytes (sample 1 warm), PID 9100 at 708,898,816 / 815,079,424 bytes (sample 2 cold), and PID 13168 at 708,976,640 / 814,895,104 bytes (sample 2 warm). The manifest retains the peaks for every sampled PID, including Electron processes. The host was an Alibaba Cloud ECS with Windows Server 2022 Datacenter build 20348 x64, 16,624,439,296 bytes physical RAM, 96 DPI / 100% system scale, and Electron 43.1.1 as a built unpackaged app. FFmpeg was `N-92722-gf22fcd4483`; FFprobe was `2023-02-13-git-2296078397-essentials_build-www.gyan.dev`. This is not installer or ordinary desktop acceptance.

Current requirement audit: R0 PASS; R1 PASS; R2 PARTIAL; R3 PARTIAL / NOT_ATTESTED; R4 PARTIAL. AC01 PASS; AC02 PASS; AC03 PARTIAL; AC04 PARTIAL; AC05 PARTIAL; AC06 PARTIAL (four generated-probe runs passed, but the required author-authorized real Projects and installer/human acceptance are absent); AC07 PARTIAL (per-PID/resource and storage samples are recorded, while phase timings, Renderer pending-write queue peak, and post-terminal release remain NOT_MEASURED); AC08 PARTIAL; AC09 PARTIAL; AC10 PASS; AC11 PASS; AC12 PASS.

AUTO=PARTIAL at the DL-06 acceptance scope, despite four probe receipts reporting `auto=PASS`.
TECH_REVIEW=NOT_READY_FOR_FINAL_REVIEW
OWNER_MANUAL=DEFERRED_TO_DL07
CI=CI_NOT_REPORTED for source SHA `2cb7e8084fa0e2b7205f53cdf7ce877dbe8f8e01`
R3=PARTIAL / NOT_ATTESTED
DL06=NO GO
DL-07=NO GO
NEXT: Obtain two distinct author-authorized real Projects and a separately frozen plan for any remaining real-project / packaged-install / human Gate B acceptance. No further R3 run was started under v1.4.0.
PR #817 remains OPEN / DRAFT / CONFLICTING. No merge, conflict resolution, Ready transition, Issue closure, or Issue comment was made.

## Frozen R2 AC08 path-boundary plan - v1.0.0 (before run)

This is one focused Creator UI boundary attempt on the exact verifier source SHA to be recorded in the Issue body before invocation. It uses Issue #827 sample 1 only as a generated probe derived from `demo-project/project-v1.example.json`; it does not establish author-project provenance or change the R3 result. No retry is permitted.

Acceptance root: `D:\PandaStage-Acceptance\i836-r2-path-boundary-v1`. Fixture base: `D:\PandaStage-Acceptance\i836-r2-path-boundary-v1\中文 工作区\长路径 深层资料\一级目录-层级导出测试\二级目录-层级导出测试\deep project root`. Frame-job root is isolated at `D:\PandaStage-Acceptance\i836-r2-path-boundary-v1\frame-jobs`. The fixture generator adds its timestamp/PID run directory and `Panda Stage formal export.pandastage` project directory. Creator Save As enters a long MP4 filename with a Chinese prefix and ASCII padding, computed so the selected target path is exactly 259 characters. The same-directory candidate staging filename is `.panda-stage-export-` + 36 UUID characters + `-` + 36 UUID characters + `.mp4` (97 characters); its full path is expected to exceed 259 characters.

Frozen invocation: run `pnpm build`, then with `PANDA_STAGE_ISSUE827_DL04=1`, `PANDA_STAGE_ISSUE827_SAMPLE=1`, `PANDA_STAGE_ISSUE836_R2_PATH_BOUNDARY=1`, `PANDA_STAGE_ISSUE827_ROOT` set to the fixture base above, and `PANDA_STAGE_ISSUE836_FRAME_ROOT` set to the isolated frame-job root, invoke `pnpm exec electron scripts/verify-issue819-dl02.cjs` once.

Expected boundary result: the native Save As dialog returns the exact 259-character target to Main; Main `ExportPreparationService.selectOutput` returns `OUTPUT_LOCATION_UNSUPPORTED` with the 259-character limit in both the problem and next step; Creator shows the actionable block; no preparation snapshot, formal Export Job, FFmpeg/FFprobe run, output MP4, or staging directory is created. The receipt compares the editor revision/dirty/History/selection, saved Project bytes and fingerprint, and source media hashes before and after. If selection is accepted unexpectedly, the harness immediately cancels during preparation or cancels the first cancellable Main Job, records the first unexpected result, and stops. No retry or R3 rerun.

This probe measures the boundary failure point in Main before tool execution or atomic commit. Even on PASS, AC08 and R2 remain **PARTIAL** until a Chinese/space/deep path also completes a successful tool and atomic-commit path, and other R2 cases remain covered.

## R2 AC08 bounded path-boundary result - plan v1.0.0

Verifier/source commit: `561a15e59ccd954d6e306cf929edf10e5fffc979`. Report delivery commit is recorded after this result is committed. GitHub combined status and PR-workflow lookup for the verifier/source SHA returned no entries: `CI_NOT_REPORTED`.

The planned single run completed on 2026-10-23 at `D:\PandaStage-Acceptance\i836-r2-path-boundary-v1\中文 工作区\长路径 深层资料\一级目录-层级导出测试\二级目录-层级导出测试\deep project root\run-2026-10-23T11-19-40-651Z-6208`. Fixture source: generated Issue #827 sample 1 derived from `demo-project/project-v1.example.json`; not an author-authorized real Project. Host: Microsoft Windows Server 2022 Datacenter, build 20348, x64. The built Electron executable was v43.1.1. `pnpm build` passed, followed by exactly one `pnpm exec electron scripts/verify-issue819-dl02.cjs` invocation with the frozen Issue #836 R2 mode and isolated frame-job root.

The Creator Save As dialog selected the exact observed 259-character target path, including Chinese and spaces in the deep directory and an 80-character filename with a Chinese prefix. The same-directory longest staging candidate measured 276 characters. Main `ExportPreparationService.selectOutput` returned `blocked / OUTPUT_LOCATION_UNSUPPORTED` before preparation, with the user-facing problem “正式 MP4 导出目标或同目录暂存路径超过 Windows 259 字符上限。” and next step “改选更浅的本机 NTFS 文件夹或缩短文件名，使目标和暂存路径都不超过 259 个字符。” The Creator task surface displayed the same actionable boundary.

No preparation response, formal Export Job, Job update, formal commit, output MP4, output temporary, frame-job directory, or frozen-media snapshot was created. The Project file SHA-256 remained `07f6d5e01915b77711253c2c05334fb2fe729062aca01b88cad5ab8fb752d5e6`; Editor revision 0, clean state, undo/redo counts 0, selected Shot, and source asset hashes were unchanged. The machine-readable receipt records these assertions and the Main response; its SHA-256 is `97d8e18d382a6a789f81ec7f9980e2f1467be59a4ab18ad44fa37bf1cecd8aba`. Save As and blocked-state screenshots and the receipt are under the run's `evidence` directory; evidence remains outside the repository.

| Check | Result |
| --- | --- |
| Creator Save As selected the intended target | PASS; observed target matched the frozen path |
| Final target / longest same-directory staging candidate | 259 / 276 characters |
| Main boundary | PASS; `OUTPUT_LOCATION_UNSUPPORTED`, `selectOutput`, actionable 259-character copy |
| Job, media tools, commit, output, and temporary files | None started or created |
| Project, editor state, and source assets | Unchanged |
| Focused AC08 probe | PASS for the blocked staging-path boundary |

Requirement audit remains R0 PASS; R1 PASS; R2 PARTIAL; R3 PARTIAL / NOT_ATTESTED; R4 PARTIAL. AC01 PASS; AC02 PASS; AC03 PARTIAL; AC04 PARTIAL; AC05 PARTIAL; AC06 PARTIAL; AC07 PARTIAL; AC08 PARTIAL; AC09 PARTIAL; AC10 PASS; AC11 PASS; AC12 PASS. This result does not prove that a supported Chinese/space/deep path reaches FFmpeg and atomic commit, and it does not close the remaining R2 budgets, real-project, or recovery cases.

AUTO=PARTIAL at DL-06 scope; the focused path-boundary subprobe reports PASS.
TECH_REVIEW=NOT_READY_FOR_FINAL_REVIEW
OWNER_MANUAL=DEFERRED_TO_DL07
R2=PARTIAL
AC08=PARTIAL
R3=PARTIAL / NOT_ATTESTED
DL06=NO GO
DL-07=NO GO
NEXT: Exercise a supported Chinese/space/deep output path through a successful media-tool run and atomic commit; separately obtain two author-authorized real Projects for any remaining real-project / packaged-install / human Gate B acceptance. Do not start another R3 run under frozen v1.4.0.

## Frozen R2 AC08 supported-path success plan - v1.1.0 (before run)

This is one separate Creator UI attempt to exercise a supported Windows path end to end. It reuses generated Issue #827 sample 1 from `demo-project/project-v1.example.json`; it is not a real-project or R3 run. The exact verifier SHA will be recorded in Issue #836 before the build and invocation. No retry is permitted.

Acceptance root: `D:\PandaStage-Acceptance\i836-r2-success-v1`. Fixture base: `D:\PandaStage-Acceptance\i836-r2-success-v1\中文 工作区\长路径\一层\二层\root\三级目录-中文 Windows\四级目录`. The fixture generator adds its timestamp/PID run folder and `Panda Stage formal export.pandastage`. Frame-job root is isolated at `D:\PandaStage-Acceptance\i836-r2-success-v1\frame-jobs`. The filename begins `i836-r2-成功路径-中文长文件名-` and is padded dynamically so the full Save As target path is exactly 259 characters. The longest same-directory UUID staging candidate is computed from the same actual directory and must remain at or below 259 characters (expected 255–257 for the Electron PID width observed in this environment).

Frozen invocation: run `pnpm build`, then with `PANDA_STAGE_ISSUE827_DL04=1`, `PANDA_STAGE_ISSUE827_SAMPLE=1`, `PANDA_STAGE_ISSUE836_R2_PATH_SUCCESS=1`, `PANDA_STAGE_ISSUE827_ROOT` set to the fixture base above, and `PANDA_STAGE_ISSUE836_FRAME_ROOT` set to the isolated frame-job root, invoke `pnpm exec electron scripts/verify-issue819-dl02.cjs` once. Creator preparation must reach a running Job within 90 seconds; the Job has a 1,200,000 ms terminal bound. On either timeout the harness cancels any cancellable preparation/Job and stops.

Expected evidence: native Save As and Main select the exact target; preparation returns READY; exactly one formal Job completes; the actual staging path and target are both within 259 characters; Main records the no-replace atomic commit and the staging file is gone. A read-only FFprobe invocation against the exact long-path output must report H.264/yuv420p 1920×1080, 24 fps, 720 frames / 30 seconds, and one 48 kHz AAC track. The receipt records output SHA-256, before/after Project SHA and Editor revision/dirty/History/selection, source media hashes, job/commit records, and temporary cleanup. If any assertion fails, preserve its first failure evidence and do not retry.

This run is bounded to the successful AC08 path. It does not add performance measurements or close other R2 budget, failure, cancellation, provenance, or human acceptance requirements. The prior v1.0.0 boundary result remains separate; no R3 run is allowed by this plan.

## R2 AC08 supported-path result - frozen plan v1.1.0

Verifier/source SHA: `06bf78a81c2c5dd6bfd720cf7cd4864c5fbfc106`. The exact invocation ran once on 2026-10-23 from `D:\PandaStage-Acceptance\i836-r2-success-v1\中文 工作区\长路径\一层\二层\root\三级目录-中文 Windows\四级目录\run-2026-10-23T11-29-55-596Z-7008`. Host: Windows Server 2022 Datacenter build 20348 x64; Electron v43.1.1. `pnpm build` passed. The single `pnpm exec electron scripts/verify-issue819-dl02.cjs` process ran from 11:29:56.216Z to 11:42:24.070Z and exited 1.

The Save As dialog selected the intended target exactly: its full path is 259 characters, including a 101-character Chinese-prefixed filename. Main selected the same path and returned `PREPARATION_READY`. The formal Job completed 720/720 frames and passed Main's FFmpeg/FFprobe/atomic-commit path. The actual same-directory staging path was 255 characters; Main's no-replace commit record names the expected output and records `stagingRemoved=true`. The 189,106-byte MP4 SHA-256 is `8c307cb4ff37b8bd75018ca2bd43b41d29c761d02d812fae956ba18d4b8da13f`. Read-only FFprobe on the exact long-path output reported H.264/yuv420p 1920×1080, 24 fps, 720 frames / 30 seconds, and one 48 kHz AAC track.

The Project SHA-256 remained `7241b034c560357d9042bdc3c545fa980afa5b593c9d5f8b95ea2e369a5a95d5`. Editor state, persisted Project fingerprint, source media hashes, and temporary cleanup assertions all remained unchanged/clear. These are generated-probe results, not author-project or installer acceptance.

The raw machine receipt is preserved unchanged with `status=FAIL`, SHA-256 `c519a97a4a0b6dda41774a4f6761ec0ae8c6b5d5e247ae32a78a213c69d04fe3`. Its sole false predicate expected the preparation status string `READY`; the actual response was `PREPARATION_READY`, which is the formal enum returned by `ExportPreparationService` and declared in the shared response schema. All other frozen end-to-end and preservation predicates evaluate true from that receipt. The verifier assertion was minimally corrected after the run to compare `PREPARATION_READY`; no Electron rerun was made because the frozen plan prohibited retries. A separate audit sidecar records the classification without changing the original receipt: `D:\PandaStage-Acceptance\i836-r2-success-v1\中文 工作区\长路径\一层\二层\root\三级目录-中文 Windows\四级目录\run-2026-10-23T11-29-55-596Z-7008\issue836-r2-path-success-audit.json`, SHA-256 `9f6c04e64bae501c36dd253f08fadc95e29f2dd8a2c6d0e43f33fef9cdae5580`.

Assessment: **AC08 PASS by observed end-to-end path evidence** (boundary failure plus successful 259-character target / 255-character staging export). The raw runner remains exit 1 for the harness mismatch; this is not reported as an automatic verifier PASS. R2 remains PARTIAL because other capacity, failure, and project-provenance requirements remain open.

Current requirement audit: R0 PASS; R1 PASS; R2 PARTIAL; R3 PARTIAL / NOT_ATTESTED; R4 PARTIAL. AC01 PASS; AC02 PASS; AC03 PARTIAL; AC04 PARTIAL; AC05 PARTIAL; AC06 PARTIAL; AC07 PARTIAL; AC08 PASS; AC09 PARTIAL; AC10 PASS; AC11 PARTIAL (the last focused Electron verifier invocation exited 1 on the corrected harness enum; no retry under the frozen plan); AC12 PASS.

AUTO=PARTIAL at DL-06 scope; the supported path operation completed, while its original automated receipt remains FAIL because of the enum mismatch.
TECH_REVIEW=NOT_READY_FOR_FINAL_REVIEW
OWNER_MANUAL=DEFERRED_TO_DL07
AC08=PASS (observed end-to-end path; original verifier status FAIL)
R2=PARTIAL
AC11=PARTIAL
R3=PARTIAL / NOT_ATTESTED
DL06=NO GO
DL-07=NO GO
NEXT: Continue the remaining R2 budget and failure cases and obtain two distinct author-authorized real Projects for remaining real-project / packaged-install / human Gate B acceptance. Do not retry the frozen v1.1.0 path run or rerun R3 v1.4.0.

## Frozen R2 preparation-budget boundary matrix plan - v1.0.0 (before run)

This is a single unit-suite validation of the existing formal Shot-count and export-preparation budget rules. It adds explicit under-limit cases to the existing exact-limit / one-over assertions; it changes no production limits or behavior. The fixture values derive from the formal support source: 256 Shots, 512 actual media assets, 67,108,864 bytes per asset, and 268,435,456 total media bytes. The exact source SHA will be recorded in Issue #836 before running validation. No retry is permitted.

Frozen matrix and expected outcomes:

| Dimension | Below limit | At limit | One above | Expected |
| --- | ---: | ---: | ---: | --- |
| Project Shots | 255 | 256 | 257 | 255/256 have no support issue; 257 returns `UNSUPPORTED_IN_CURRENT_EXPORT_SLICE` with the 256 limit and an actionable Shot next step. |
| Actual media asset entries | 511 | 512 | 513 | 511/512 have no budget issue; 513 returns `PREPARATION_BUDGET_EXCEEDED` with the configured asset limit and a next step. |
| One media asset | 67,108,863 B | 67,108,864 B | 67,108,865 B | First two have no budget issue; the last identifies the Shot/background, 64 MiB limit, and next step. |
| Aggregate media bytes | 268,435,455 B | 268,435,456 B | 268,435,457 B | First two have no budget issue; the last returns `PREPARATION_BUDGET_EXCEEDED`. Each constituent asset remains at or below its single-asset limit. |

Run `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, and `git diff --check` once on the frozen source SHA. A failing command or unrelated suite failure is retained as the first result and stops this plan; no fix-and-retry is included. This is domain/unit evidence only: it does not demonstrate Creator UI behavior, filesystem resource limits, a real author Project, packaged Electron behavior, or completion of R2. Do not run Electron, integration, build, Full CI, `verify:project`, or any additional verifier for this plan.

## R2 preparation-budget boundary matrix result - frozen plan v1.0.0

Frozen source SHA: `fbf8e7ee2ff147f90963d0da4425d07f45b6a22d`. The planned `pnpm test:unit` completed with exit 0: 357 test files and 2,688 tests passed. `pnpm typecheck` completed with exit 0. The planned `pnpm lint` exited 1 with two `preserve-caught-error` findings at `scripts/verify-issue819-dl02.cjs:1327` and `:1379`; this frozen matrix change touched only `tests/unit/export-preparation.test.ts` and this evidence report. Per the stop rule, the sequence ended there: `git diff --check` was not run, no fix was attempted, and no command was retried.

The below/at/one-over unit assertions passed for Shot count, actual media entry count, single-file bytes, and aggregate bytes using the formal constants. The budget-matrix unit evidence is PASS; this plan's full validation is PARTIAL because lint did not pass. This does not establish Creator/Main boundary behavior, filesystem/resource limits, author-project provenance, or overall R2 acceptance. R2 remains PARTIAL; AC11 remains PARTIAL; no Electron run, integration test, build, Full CI, or repository-wide verifier was started.

## Frozen R2 verifier lint correction plan - v1.0.0 (before run)

The matrix run's two lint findings are in timeout wrappers added by R2 verifier commit `06bf78a`; `git blame` confirms the exact lines were introduced there. This narrow follow-up attaches each caught timeout error as the `cause` of the existing safety-abort error, preserving both the current user-facing message and abort behavior. It changes no product code or validation behavior. The exact corrected source SHA will be recorded in Issue #836 before validation. Run `pnpm lint` once on that SHA; zero lint findings is expected. If the command fails, retain its first result and stop without retry. No unit, integration, build, Electron, Full CI, `verify:project`, or additional verifier is part of this plan.

## R2 verifier lint correction result - frozen plan v1.0.0

Frozen source SHA: `79c7f2990edb7f5b4db4ed9f17e691737f4dc275`. `pnpm lint` completed once with exit 0. The two timeout wrappers now attach the caught error as `cause`; their existing safety-abort action and displayed timeout messages are unchanged. This follow-up passes its single lint check. The earlier budget-matrix run remains recorded as lint exit 1 on its earlier SHA; no command or frozen Electron probe was retried. R2 and AC11 remain PARTIAL because this does not rerun the corrected Electron verifier or establish the remaining real-project/runtime acceptance.

## Frozen R2 actionable budget-failure copy plan - v1.0.0 (before run)

This focused test-only follow-up strengthens the one-over cases against R2's requirement that preflight budget failures identify the affected object, concrete limit, and actionable next step. It changes no production code or limit. The frozen over-limit cases are: 257 Shots must identify the Project and 256-Shot limit with a Shot-oriented next step; 513 media entries must identify `工程素材`, the 512-item limit, and reducing the used asset count; 67,108,865 B for one asset must identify `镜头“开场”的背景`, the 64 MiB limit, and using a smaller source; 268,435,457 B total must identify `工程素材`, the 256 MiB limit, and reducing the combined source size. Existing below/at/over input values remain unchanged. The exact source SHA will be recorded in Issue #836 before validation.

Run `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, and `git diff --check` once on the frozen SHA. Any failure ends this plan without a fix or retry. This is domain/unit message-contract evidence only; it does not establish visible Creator UI text, filesystem exhaustion handling, real-project provenance, or overall R2 acceptance. No integration, build, Electron, Full CI, `verify:project`, or additional verifier is in scope.

## R2 actionable budget-failure copy result - frozen plan v1.0.0

Frozen source SHA: `5a0621f0c7126c9d87e49bdd28dd20547ff43e4d`. All planned commands passed once: `pnpm test:unit` exit 0 (357 test files / 2,688 tests), `pnpm typecheck` exit 0, `pnpm lint` exit 0, and `git diff --check` exit 0. Assertions now verify the object/location, configured limit, and concrete next step for over-limit Shot count, used-asset count, single-asset bytes, and aggregate bytes. This is domain/unit message-contract evidence only; no visible Creator UI, filesystem exhaustion handling, or author-project result is established. R2 remains PARTIAL; AC11 remains PARTIAL pending final-SHA CI and required Electron evidence.

## Frozen R2 preparation-copy failure plan - v1.0.0 (before run)

This single service-level unit validation injects a controlled `disk full` write error into the temporary media-copy store during export preparation. Expected outcome: `BLOCK` with `PREPARATION_FAILED`, the exact used-asset Shot/object location, a concrete problem and available-disk next step; it must not be misclassified as missing/corrupt source media. The selected output target must remain absent, an existing-output sentinel byte-for-byte unchanged, and persisted `project.json` unchanged. The sentinel is a unit-test preservation marker, not an encoded MP4 or real-project artifact. The test changes no production code, limits, or UI.

The exact source SHA will be recorded in Issue #836 before validation. Run `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, and `git diff --check` once; stop on any failure without a fix or retry. This is service/unit evidence only and does not prove Creator UI copy, actual disk exhaustion behavior, Windows filesystem limits, author-project provenance, or overall R2 acceptance. No integration, build, Electron, Full CI, `verify:project`, or extra verifier is in scope.

## R2 preparation-copy failure result - frozen plan v1.0.0

Frozen source SHA: `584c3ac7041b244207557a17e87eb539f41a4519`. The single planned `pnpm test:unit` command exited 1 after 42.25 seconds: 356 files / 2,687 tests passed and one test failed before reaching `ExportPreparationService.prepare`. The added assertion tried to read `project/project.json`, which the unit `harness()` does not create (`ENOENT`). The run therefore supplies **no disk-full/preparation response evidence**. Per the frozen stop rule, `pnpm typecheck`, `pnpm lint`, and `git diff --check` were not run for this plan; no retry was made. Cleanup commit `f9ff402` removed the unverified test-only delta and restored the prior test body; no post-cleanup test was run. R2 remains PARTIAL.
