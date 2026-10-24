# Issue #836 DL-06 measurement plan and result

Report version: **1.20.0**
Frozen R3 plan revision: **1.4.0**, completed as one bounded four-run continuation
Plan date: **2026-10-23**
R3 status: **PARTIAL / NOT_ATTESTED**; all four v1.4.0 generated-probe cold/warm runs completed with `auto=PASS`, matching manifest/receipt hashes, and maximum sample gaps below the frozen 5,000 ms validity limit. These generated probes do not establish author-authorized real-project provenance. Phase wall times, Renderer pending-write queue peak, and post-terminal release time remain `NOT_MEASURED`; installer acceptance and human Gate B evidence remain unavailable. DL-06 and DL-07 remain **NO GO**.
R2 status: **PARTIAL**; the v1.0.0 AC08 staging-path boundary probe passed. The v1.1.0 supported deep-path Creator export completed through atomic commit, but its runner exited 1 on a harness enum mismatch; no retry was made. Budget boundaries, the commit race, and generated-fixture media/copy/controlled-output-permission cases have bounded passing evidence. The real-ACL follow-up stopped at native Save As UI Automation before Main received a target; it is inconclusive. Complete failure, resource-budget, and author-Project coverage remain open.

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

## R2 frame and temporary-disk budget audit

| Area | Existing bound or guard | Evidence and remaining limit |
| --- | --- | --- |
| Project / media preparation | 256 Shots, 512 used assets, 67,108,864 B per asset, 268,435,456 B aggregate | Formal support values and the passing budget boundary matrix are recorded above. |
| Frame write concurrency | Main allows at most 3 pending frame writes (`MAX_PENDING_FRAMES`) | `ExportService` unit cases cover bounded writes at 72/120 frames, injected frame-write failure and partial-directory cleanup, cancellation, and cleanup failure. This is not a total frame-byte or duration cap. |
| Temporary media-copy failure | A write failure maps to `BLOCK / PREPARATION_FAILED` with a disk-space next step | Existing unit case injects `disk full` and verifies block classification separate from missing/corrupt media. It does not assert the exact issue location/message or prior-output/project preservation. The later v1.0.0 assertion attempt failed before `prepare` and was reverted; it adds no evidence. |
| Full export resources | No approved maximum for total formal frames, decoded-memory peak, frame-job bytes, or output-staging/temp-disk bytes was found in the inspected Main/shared export source; no available-disk-space query was found in `src/main` | The R3 monitor samples per-process memory and directory sizes at 500 ms; sub-interval peaks can be missed. These samples are descriptive, not a hard resource guard or approved budget. |

Minimal safe boundary: retain existing preparation caps, the 3-write bound, write-error failure/cleanup, and no-replace final commit. Do not invent a RAM or disk threshold. Until an owner-approved resource ceiling exists, report full-export disk/memory capacity as `NOT_MEASURED`; any future preflight ceiling needs a separately frozen basis and an acceptance test that proves failure before publication while preserving the Project and prior output. R2 remains PARTIAL.

## R2 output-conflict and cancellation evidence map

| Case | Existing evidence | Limit |
| --- | --- | --- |
| Target already exists | Generated Creator UI R3 sample 1 cold/warm receipts record unchanged before/after output SHA, zero formal Jobs, and no output/frame/preparation temporaries. Sample 2 also records unchanged no-clobber results. | Generated probes; this does not establish author-project provenance. |
| Target appears after preflight | `tests/unit/file-system-service.test.ts` test “preserves a file created after preflight when the exclusive commit meets a name conflict” writes a third-party sentinel after output preparation, expects no-replace commit rejection, verifies sentinel bytes unchanged, and removes staging. This test passed in the recorded unit run. | FileSystemService-level race evidence, not a full Creator/Main end-to-end race. |
| Formal cancellation | Both generated R3 samples record cancelled jobs, no published output, and empty temporary directories. `ExportService` unit tests also verify cancellation waits for in-flight frame writes before cleanup. | Generated fixtures; no real-project acceptance. |
| Frame write / cleanup failure | Unit tests inject a frame write error and verify partial-directory cleanup; separate cleanup-failure cases retain the Job/error detail and exercise idempotent cleanup retry. Temporary media-copy `disk full` is blocked and distinguished from missing/corrupt media by the existing preparation test. | The failed v1.0.0 extension did not reach `prepare`; exact copy-failure presentation and Project/previous-output preservation are not additionally verified. |

These existing results cover several R2 failure paths at UI, service, and filesystem layers, but they do not close the resource-budget gaps above or prove every failure path through Creator/Main on two independent author projects. R2 remains PARTIAL; do not repeat frozen R2 or R3 probes.

## Frozen R2 Creator/Main commit-boundary target-race plan - v1.0.0 (before run)

This is one isolated Creator UI export against the generated single-Shot Issue #819 safe fixture. The target starts absent. The focused verifier mode selects it through native Save As, runs one formal Job, then inserts a third-party sentinel after Main's final output check and immediately before the atomic no-replace commit. The expected result is a failed Job with the actionable Creator copy “保存位置在导出期间出现了同名文件。现有文件未被修改，请换一个新文件名重试。”, zero successful commits, the sentinel unchanged, no remaining staging/frame/frozen-media files, and unchanged editor/session state, persisted Project bytes, and source asset hashes. This is full Creator/Main/FFmpeg/FFprobe commit-boundary evidence using a generated safe fixture, not an author Project or real video preservation test.

Acceptance root: `D:\PandaStage-Acceptance\i836-r2-commit-race-v1`; isolated frame root: `D:\PandaStage-Acceptance\i836-r2-commit-race-v1\frame-jobs`. The generated fixture contains one Shot longer than five seconds and is a probe only. The exact source SHA will be recorded in Issue #836 before validation. Run `node --check scripts/verify-issue819-dl02.cjs`, `pnpm lint`, and `pnpm build` once in that order. If any command fails, stop without retry and do not launch Electron. If all pass, set only `PANDA_STAGE_ISSUE836_R2_COMMIT_RACE=1`, `PANDA_STAGE_ISSUE819_ROOT` to the acceptance root, `PANDA_STAGE_ISSUE836_FRAME_ROOT` to the isolated frame root, `PANDA_STAGE_ISSUE836_SOURCE_SHA` to the frozen SHA, and `PANDA_STAGE_ISSUE836_RUN_ID=i836-r2-commit-race-v1`; invoke `pnpm exec electron scripts/verify-issue819-dl02.cjs` exactly once. Stop on any failed assertion; no retry or R3 run. No `pnpm test:unit`, integration, Full CI, `verify:project`, or additional verifier is included.

## R2 Creator/Main commit-boundary target-race result - frozen plan v1.0.0

Frozen source SHA: `578e74c0713da10b5ae7c9886bd7764c2fb95d6f`. The planned commands each ran once and passed: `node --check scripts/verify-issue819-dl02.cjs` exit 0, `pnpm lint` exit 0, `pnpm build` exit 0 (existing empty-CSS-import and large-chunk warnings), and the single `pnpm exec electron scripts/verify-issue819-dl02.cjs` exit 0. No retry or R3 run was made.

Windows Electron 43.1.1 run `i836-r2-commit-race-v1` completed at `2026-10-23T12:18:06.451Z` under `D:\PandaStage-Acceptance\i836-r2-commit-race-v1\run-2026-10-23T12-15-15-836Z-2900`. The target began absent; a 54-byte third-party sentinel was inserted after Main's final output check and before atomic no-replace commit. The formal Job finished `failed`, with zero successful commits and the Creator task copy “保存位置在导出期间出现了同名文件。现有文件未被修改，请换一个新文件名重试。” The final target SHA-256 `8d3e75b9ddc58fb3d6768311b03744941916d8d800ef1ddcf337f478ce1567eb` matches the injected sentinel. Receipt assertions and an independent disk audit confirm unchanged editor state, unchanged `project.json` SHA-256 `c343ad346648cf82a0039cec883433b70d9f2ef9c08df5229e742e4a3c5f481c`, unchanged hashes for all four source assets, no output/frame/preparation temporary entries, and zero remaining directories under the isolated frame root.

The raw receipt is duplicated at the run root and `evidence\issue836-r2-commit-race-receipt.json`; both copies have SHA-256 `CAB417288DD6691BA63FB92634AC21D33E20B100DDF903367964C55E99294A90`. The run reports `AUTO=PASS`, `OWNER=NOT_ATTESTED`; it used the generated one-Shot Issue #819 fixture and is not an author-owned Project, real-video preservation check, packaged-install acceptance, or human Gate B. It closes the earlier full Creator/Main commit-race evidence gap only for this injected case. Full-export resource ceilings remain `NOT_MEASURED`; R2 and AC11 remain PARTIAL.

## Frozen R2 preparation-copy failure follow-up - v1.1.0 plan and result

### Plan

Frozen source SHA: `44fd6ed20da50bcf119ed26bf2a2e7e009a97e53` on `issue-816-dl01-formal-export-preparation`. This is a distinct, test-only follow-up to v1.0.0. The v1.0.0 run failed in fixture setup before `ExportPreparationService.prepare` and was not retried. This version gives the test a persisted `project.json`, a separate existing-output byte sentinel (test marker, not a valid MP4), and the real owned snapshot directory while injecting disk-full at media-copy write. It changes no production behavior or budget.

Expected: BLOCK with PREPARATION_FAILED for each consumed media entry, each using its specific domain-provided Shot/object location and the exact disk-space problem/next step; no REQUIRED_MEDIA_UNAVAILABLE; project.json bytes and the sibling output sentinel unchanged; selected target absent; owned preparation snapshot cleaned. Run `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, and `git diff --check` exactly once in that order. Stop on any failure without fix or retry. No integration, build, Electron, Full CI, `verify:project`, or additional verifier is included. This remains service/unit evidence only; it does not prove actual filesystem exhaustion, Creator UI presentation, real-MP4 preservation, author-project provenance, or overall R2 acceptance.

### Result

On frozen SHA `44fd6ed20da50bcf119ed26bf2a2e7e009a97e53`, all planned commands passed once: `pnpm test:unit` exit 0 (357 files / 2,688 tests), `pnpm typecheck` exit 0, `pnpm lint` exit 0, and `git diff --check` exit 0. The revised controlled unit case wraps the actual `NodeExportPreparationFileStore` for create/delete and injects the write error. It verifies BLOCK with a PREPARATION_FAILED issue at each consumed entry's concrete domain-provided location, exact problem and disk-space next step, and no REQUIRED_MEDIA_UNAVAILABLE classification. The harness's persisted Project JSON bytes and sibling output sentinel bytes were unchanged, the selected output target remained absent, and the owned temporary snapshot directory was removed.

The sibling sentinel is a byte marker, not a valid MP4, and the error was injected rather than produced by exhausting a Windows filesystem. This adds service/unit evidence for actionable copy failure and cleanup only. It does not prove actual disk-full behavior, Creator/Main UI presentation, previous real-MP4 preservation, author-project provenance, or overall R2 acceptance. R2 and AC11 remain PARTIAL.

## R2 Creator/Main preparation-copy failure result - frozen plan v1.2.0

Frozen source SHA: `4ba450c6483f35ce0e0e7ddddc5f591d243e78fa`. The planned commands ran once and passed: `node --check scripts/verify-issue819-dl02.cjs` exit 0, `pnpm lint` exit 0, and `pnpm build` exit 0 (including typecheck; existing empty-CSS-import and large-chunk warnings). The single `pnpm exec electron scripts/verify-issue819-dl02.cjs` run exited 0. No retry or second Electron run was made.

Windows Electron 43.1.1 run `i836-r2-copy-failure-v1` completed at `2026-10-23T14:46:49.448Z` under `D:\PandaStage-Acceptance\i836-r2-copy-failure-v1\run-2026-10-23T14-46-44-817Z-12272`. The generated one-Shot Issue #819 fixture injected one controlled media-copy write error. Creator showed location `镜头“Opening”的背景“Background”`, problem `素材副本无法安全写入临时准备目录。`, and next step `检查可用磁盘空间后重新检查；工程和已有输出未被修改。`; the raw injected error was not shown. The task failed before any formal Export Job or commit, and the selected target remained absent.

The receipt records `AUTO=PASS`, `OWNER=NOT_ATTESTED`; its Project file SHA-256 `0cc87c1659448a40637e65aa6f712a0c17b09772cd41b680501d1f42f70acbf6` is unchanged before/after. Editor/session state and all four source media hashes are unchanged. The 46-byte sibling output sentinel hash `0f3acaee98838ee3e4dfbc7349cfd9fbff503a16ccb170705f7074cede802f34` is unchanged; output temporaries, frame-job directories, and preparation snapshots are empty. The duplicated receipt at the run root and `evidence\issue836-r2-preparation-copy-failure-receipt.json` has SHA-256 `4c8f08ff3d5dee633a5f27570af2ea7259a9827bcb1081690217dc15d7b493f5`.

This is controlled generated-fixture evidence: the write error was injected, the sibling sentinel is not a valid MP4, and the Project is not an author-owned sample. It does not establish physical disk-exhaustion behavior, real-MP4 preservation, packaged-install acceptance, human Gate B, or approved full-export resource ceilings. R2 and AC11 remain PARTIAL; Issue #836 remains open.

## Frozen R2 Creator preparation-copy failure with valid MP4 preservation plan - v1.0.0

Frozen verifier source SHA: `8780c3f7112b20f186178415d92b45c8cb955b63` on `issue-816-dl01-formal-export-preparation`. This separate AC03 follow-up strengthens prior-output evidence with a fresh generated Issue #819 fixture and one controlled media-copy write error. The prior-output file is a valid six-frame H.264 MP4 generated by the verifier's resolved FFmpeg and checked with resolved FFprobe; it is not an author Project's prior export.

Expected: Creator retains the exact actionable PREPARATION_FAILED location/problem/next step and hides the injected raw error; no formal Job or commit begins for the failed request; the selected target remains absent; Project/editor/session/source media and the valid prior-output MP4 bytes remain unchanged; output/frame/preparation temporary state is empty. The receipt records FFprobe validity and the before/after MP4 hash.

Acceptance root: `D:\PandaStage-Acceptance\i836-r2-copy-failure-valid-mp4-v1`; isolated frame root: `D:\PandaStage-Acceptance\i836-r2-copy-failure-valid-mp4-v1\frame-jobs`. Both were confirmed absent before this plan. Run `node --check scripts/verify-issue819-dl02.cjs`, `pnpm lint`, and `pnpm build` once in that order. If any fails, stop. If all pass, invoke `pnpm exec electron scripts/verify-issue819-dl02.cjs` exactly once with `PANDA_STAGE_ISSUE836_R2_COPY_FAILURE=1`, `PANDA_STAGE_ISSUE836_R2_COPY_FAILURE_VALID_MP4=1`, `PANDA_STAGE_ISSUE819_ROOT` set to the acceptance root, `PANDA_STAGE_ISSUE836_FRAME_ROOT` set to the isolated frame root, `PANDA_STAGE_ISSUE836_SOURCE_SHA` set to the frozen SHA, and `PANDA_STAGE_ISSUE836_RUN_ID=i836-r2-copy-failure-valid-mp4-v1`. No retry or additional verifier is included; no unit/integration suite, Full CI, `verify:project`, or R3 run is part of this plan.

## R2 Creator preparation-copy failure with valid MP4 preservation result - v1.0.0

On frozen SHA `8780c3f7112b20f186178415d92b45c8cb955b63`, `node --check scripts/verify-issue819-dl02.cjs`, `pnpm lint`, and `pnpm build` each passed once (exit 0). Build included typecheck and emitted the existing empty-CSS-import and large-chunk warnings. The single planned Electron process exited 0. An extra PowerShell launch guard first exited before invoking Electron because its comparison expression was parsed incorrectly; no Electron process started in that attempt. The guard expression was corrected, and the planned Electron command then ran once; no verifier or Electron run was retried.

Windows Electron 43.1.1 run `i836-r2-copy-failure-valid-mp4-v1` completed at `2026-10-23T14:56:38.987Z` under `D:\PandaStage-Acceptance\i836-r2-copy-failure-valid-mp4-v1\run-2026-10-23T14-56-34-356Z-10428`. Resolved FFmpeg created the sibling prior-output file; FFprobe found MP4/H.264/yuv420p, 64×64, six frames, 0.25 seconds. Its 1,724 bytes and SHA-256 `28dacbd01c0184b180ce0313bb81b56ee8a88c2ad1a75dc87ddeb1fba52c967d` were unchanged after the injected copy failure, and the disk hash matches the receipt. This verifies preservation of a valid generated MP4 file; the file was not produced by a completed Panda Stage Export Job.

The receipt reports `AUTO=PASS`, `OWNER=NOT_ATTESTED`. Creator's captured task text and structured issue report location `镜头“Opening”的背景“Background”`, problem `素材副本无法安全写入临时准备目录。`, and next step `检查可用磁盘空间后重新检查；工程和已有输出未被修改。`; the task failed before formal Job creation, with zero formal Jobs/commits, and the selected target stayed absent. Project file SHA-256 `02e5bb64d54d59688f4d93ec5f7d295a39d4bfd5faf272fbaed71b7a4c90e546` is unchanged. Editor/session state and all four source asset hashes are unchanged. The receipt's output-temporary, frame-job-directory, and preparation-snapshot arrays are empty; the isolated frame root was not created.

Screenshot caveat: this run's `issue836-preparation-copy-failure-blocked.png` captured the preflight “checking Project shots and media” visual state even though the receipt's task text/status and issue fields had reached the failed terminal state. Treat this run's screenshot as non-terminal visual evidence. The separate v1.2.0 run's screenshot displays the same terminal failure copy; this run was not repeated to recapture an image.

Both receipt copies at the run root and `evidence\issue836-r2-preparation-copy-failure-receipt.json` have SHA-256 `cd14e3ac7a2fcf193c198b6e389be26c0e6f4862c27d831f6b090db0881e76f5`. This remains injected generated-fixture evidence, not physical disk exhaustion, author-project or packaged-install acceptance, human Gate B, or an approved full-export resource ceiling. R2 and AC03 remain PARTIAL; AC11 remains PARTIAL; full-export resource ceilings remain NOT_MEASURED.

## Frozen R4 AC09 focused DL-05 regression plan - v1.0.0

Frozen delivery HEAD: `6c1d351f197e394652191c828db9477e0787f25d` on `issue-816-dl01-formal-export-preparation`. AC09 remained PARTIAL because there was no final-head DL-05 cross-feature regression receipt. This one focused run reuses the generated three-Shot, 30-second DL-05 fixture to exercise the Creator export-task lifecycle, hide/restore, editing + Save + Preview during an active export, cancellation, old-content snapshot retry, current-content retry with newly added audio, subtitle/audio output comparison, no-clobber protection, Project/History identity, and cleanup. This is an R4 functional regression, not an R3 resource measurement or author-project run.

Acceptance root: `D:\PandaStage-Acceptance\i836-r4-dl05-regression-v1`; isolated frame root: `D:\PandaStage-Acceptance\i836-r4-dl05-regression-v1\frame-jobs`. Both were confirmed absent before this plan. Run `node --check scripts/verify-issue832-dl05.cjs`, `node --check scripts/verify-issue819-dl02.cjs`, `pnpm lint`, then `pnpm verify:issue832-dl05` exactly once, with only `PANDA_STAGE_ISSUE832_ROOT` set to the acceptance root and `PANDA_STAGE_ISSUE836_FRAME_ROOT` set to the isolated frame root. The package script runs `pnpm build` (including typecheck) before one Electron invocation. Stop on the first failure; no retry or additional verifier is included. No Full CI, `verify:project`, R3 measurement, or additional sample run is included.

## R4 AC09 focused DL-05 regression result - v1.0.0

On frozen HEAD `6c1d351f197e394652191c828db9477e0787f25d`, both planned `node --check` commands and `pnpm lint` passed once (exit 0). The build inside the sole `pnpm verify:issue832-dl05` command also passed (typecheck included; existing empty-CSS-import and large-chunk warnings). The Electron verifier exited 1 after a native Save As UI Automation timeout; no retry was made.

Windows Electron 43.1.1 run `d5076089-c05c-4152-8349-8d4b7f0ed206` started at `2026-10-23T15:06:53.435Z` and stopped at `2026-10-23T15:20:06.437Z` under `D:\PandaStage-Acceptance\i836-r4-dl05-regression-v1\d5076089-c05c-4152-8349-8d4b7f0ed206\run-2026-10-23T15-06-52-811Z-1196`. On the generated Issue #827 sample-1 fixture, the cancellation target remained unpublished before the verifier placed its expected 70-byte no-clobber marker. The original-content retry then completed all 720 frames and produced a 189,106-byte MP4. FFprobe recorded H.264 1920×1080 video with 720 frames and AAC audio; output SHA-256 is `8c307cb4ff37b8bd75018ca2bd43b41d29c761d02d812fae956ba18d4b8da13f`.

The verifier stopped when the subsequent current-content retry could not find the native Save As dialog (`Timed out waiting for the native Save As dialog`, owner PID 1196). The failure receipt records only two Save As selections and two formal starts (the cancelled attempt and completed original-content retry); no current-content retry Job started. The receipt is `AUTO=FAIL`, `OWNER=NOT_ATTESTED`, SHA-256 `c07a00ebaa3b7ae7308f5e866e6c60ad91293fb747f6f2a63a62915e89aa289c`. Its failure screenshot shows the preceding completed original-content task, not a terminal failure screen for the unstarted current-content retry. The on-disk Project contains the explicitly saved subtitle/audio edit; all ten source media files still match their fixture hashes.

Independent cleanup audit after process exit found zero frame-job files/directories, no file matching staging/partial/temp under the fixture Project, and no owned preparation snapshot for `08e214ee-5a4a-4423-924d-2be8c874bc32`. The failure run's output/evidence and generated Project were preserved. Console output also contained four `asset-preview-audio:read` “No handler registered” messages during startup; the failure receipt attributes the stop to Save As UI Automation, and no causal link is asserted. This partial generated-fixture evidence does not satisfy AC09; R4 and AC09 remain PARTIAL. It does not change the author-project, R3 resource-measurement, installer, or human Gate B gaps.

## R4 AC09 DL-05 harness follow-up result - v1.1.0 (2026-10-24)

The frozen source was `d80d729887ba1157ad7e92e42bd2b9a462457f1a`. The v1.1.0 plan above contains a transcription error in the full SHA (`d80d729d7b36e3dc0e59d908ca56540cfc046bdc`); its `d80d729` prefix is correct. Git HEAD and the run receipt agree on the actual SHA. Both planned Node syntax checks and `pnpm lint` passed once. The build/typecheck inside the single `pnpm verify:issue832-dl05` passed with the existing empty-CSS-import and large-chunk warnings. The one Electron invocation exited 1; there was no retry.

Windows Electron 43.1.1 run `730115ce-7646-4129-b162-d106316f3d18` started at `2026-10-23T15:27:53.123Z` and completed at `2026-10-23T22:42:31.378Z` under `D:\PandaStage-Acceptance\i836-r4-dl05-regression-v1.1\730115ce-7646-4129-b162-d106316f3d18\run-2026-10-23T15-27-52-499Z-5696`. The corrected helper started the initial cancelled attempt and then the original-content retry. The verifier failed in `captureIssue832EncodingState` while waiting up to 1,200,000 ms for that retry to enter `encoding`. The final recorded Main update was still `running` / `rendering`, at 398 of 720 frames, with no Main error or cleanup error. The failure screenshot likewise shows the original-content retry rendering at 55%. Thus the current-content seed and fresh-current-content retry were not reached; v1.1.0 does not establish AC09.

The failure receipt is `evidence\electron-failure.json`, SHA-256 `2a51c119c8cce146e0599679c8a191ab976e678b77647215a0830b937ca198d6`; the corresponding screenshot is `evidence\electron-failure.png`. Two Save As selections and two formal starts are recorded. The isolated frame directory contains 401 files after the failed run. The 70-byte cancellation-target marker remains present with SHA-256 `e6eae56da026ac9ea8a7925589ca02dbf2b9fdcd6b9e0d35dc9328fd3ea52706`; the no-clobber assertion was not reached. The final persisted Project SHA-256 is `839664017f59ee9b44277adc57431180d059a20d74e2155ea8a0b814eaaa7264`, differing from the receipt's initial Project hash because the verifier intentionally saved the subtitle/audio edit before starting the old-content retry. All ten fixture source-media files still match the hashes recorded in the receipt. The project root has only its assets directory, project.json, and the marker at top level; the partial frame files were left untouched. No preparation-snapshot cleanup claim is made.

Frame file timestamps show 350 generated frames between 15:28Z and 15:34Z, then later frames through 397 at 22:42Z; this gap is unexplained. A targeted Kernel-Power event query returned no matching sleep/resume events in that interval, so no environmental cause is asserted. Repeated startup logs reported four `asset-preview-audio:read` “No handler registered” messages; no causal relation to this render timeout is established.

This remains partial generated-fixture evidence. R4 and AC09 remain PARTIAL; author-project provenance, R3 resource measurements and ceilings, packaged-install acceptance, and human Gate B remain outstanding. The acceptance root was left intact and no cleanup or rerun was performed.

## R4 AC09 DL-05 system-awake follow-up result - v1.2.0 (2026-10-24)

Frozen source HEAD: `05a489a5810bdfe1d317a4bc3df658ee3b276780`. The single planned PowerShell invocation acquired a process-scoped ES_CONTINUOUS | ES_SYSTEM_REQUIRED request, ran `pnpm verify:issue832-dl05`, and restored the prior thread state in `finally`; no persistent power setting was changed. Build/typecheck passed with the existing empty-CSS-import and large-chunk warnings. The Electron verifier exited 1 in its first attempt; no retry occurred.

Windows Electron 43.1.1 run `fe255ea0-7fe8-4be7-b6da-fd74dc84f077` started at `2026-10-23T22:51:22.026Z` and completed at `2026-10-23T22:51:55.134Z` under `D:\PandaStage-Acceptance\i836-r4-dl05-regression-v1.2\fe255ea0-7fe8-4be7-b6da-fd74dc84f077\run-2026-10-23T22-51-21-400Z-13972`. The native Save As dialog selection succeeded, but no formal Main Job started. The terminal Creator task reported that the formal MP4 target or same-directory staging path exceeded Windows' 259-character limit and asked for a shallower NTFS folder or shorter filename. The selected path was 205 characters; the verifier did not record the exact derived staging path. The failure receipt records zero formal starts and no latest Main update.

Failure receipt: `evidence\electron-failure.json`, SHA-256 `a7ff926565a471f7fb576a4f8894ccadee2029afb1d5e4ac365e833b00ba8675`. The persisted Project hash matches the initial fixture hash `4515a184c14d9431a811098031a12a8412841649e8355980a9cbd7322e85eec3`; all ten source-media hashes match. The selected target is absent and the isolated frame root was not created. This is a fixture-path setup failure, not evidence that the corrected completed-task launch path works. AC09 remains PARTIAL. The fresh acceptance root is preserved.

## R4 AC09 short-root follow-up result - v1.3.0 (2026-10-24)

The frozen source was `0adb87a444954f49d4a3624b6218ff89089348e9`. The single planned `pnpm verify:issue832-dl05` invocation completed successfully; its build/typecheck passed with the existing empty-CSS-import and large-chunk warnings, and the Electron verifier exited 0. A process-scoped `ES_CONTINUOUS | ES_SYSTEM_REQUIRED` request was held for the invocation and restored in `finally`; no persistent power setting changed. No retry was made.

Windows Electron 43.1.1 run `6e9027d8-d2a7-48a4-8e68-adf07a679a44` started at `2026-10-23T22:54:12.251Z` and completed at `2026-10-23T23:19:42.921Z` under `D:\PandaStage-Acceptance\i836r4v13\6e9027d8-d2a7-48a4-8e68-adf07a679a44\run-2026-10-23T22-54-11-626Z-8992`. The acceptance receipt and its `evidence\acceptance-receipt.json` copy match; SHA-256 is `33a2ff4885a7ce06db767e45df3cbc2702e9e056e49190b14a0c9047bcab7a61`. Receipt status is `auto=PASS`, `FOLLOWUP_REVIEW_READY`, `ownerManual=DEFERRED_TO_DL07`, `techReview=PENDING`, and `multiShotAvAccepted=false`.

The generated Issue #827 sample-1 fixture is three shots, 30 seconds, 24 fps, with audio clip counts `[2,1,1]`; it is not an author project. Four formal Jobs had distinct IDs: the initial attempt cancelled at 3/720 frames without publishing; the original-content retry completed 720/720; the controlled current-content seed failed with the expected output-identity error and no cleanup error; and the fresh current-content retry completed 720/720. Hiding and reopening retained the same task with zero duplicate starts. Save during export persisted revision 2 with `dirty=false` and undo count 2; Preview playback completed. The pre-existing no-clobber sentinel was unchanged. All ten source-media hashes matched, and the saved Project SHA-256 was `d689d96a984b8b0fe046efbf5cc68c75bf5e3f0e4e51aa20051cc809c67100d7`.

The original-content MP4 is 189,106 bytes with SHA-256 `8c307cb4ff37b8bd75018ca2bd43b41d29c761d02d812fae956ba18d4b8da13f`; the current-content MP4 is 197,674 bytes with SHA-256 `959c1d09d24c129ebd3f322d45eef1d097c268b1993714664ac13451c850d65b`. Read-only FFprobe confirms both are 30.000-second H.264/yuv420p 1920x1080 videos with 720 frames at 24 fps and 30-second AAC audio. The current output differs at the edited subtitle frame (`changedPixels=19686`) and carries the newly added 1320 Hz audio tone at 7.5 seconds; the original output does not. Final cleanup arrays for output temporaries, frame-job directories, and snapshots are empty.

AC09 remains **PARTIAL**. Existing [`export-task-state.test.ts`](../../tests/unit/export-task-state.test.ts) covers ignoring updates from a previous Job/Attempt/snapshot and ignoring late progress after terminal states, and the renderer listener filters updates by the active Job ID. This v1.3 Electron run did not inject a previous task's late failure event while a new task was active. The run also covers only the generated DL-05 fixture, not the full DL-04/05 regression matrix or R3 scenarios. R4 remains **PARTIAL**; author-project provenance, R3 resource measurements/ceilings, packaged-install acceptance, and human Gate B remain outstanding.

## AC09 cross-task failure reducer regression - v1.3.1 (2026-10-24)

On test-source commit `d823a225ef840031e670ae28001b01066a26cce4`, [`export-task-state.test.ts`](../../tests/unit/export-task-state.test.ts) gained a focused case where a new Job is active and a late `failed` update from the previous Job arrives. `applyExportJobUpdate` returns the unchanged current task, preserving its active Job identity and state. No production code changed, and this is a separate unit regression; it does not rerun or alter the frozen v1.3.0 Electron plan.

Validation passed: `pnpm test:unit` (357 files, 2,689 tests), `pnpm typecheck`, `pnpm lint`, and `git diff --check`. This directly covers the cross-task failed-update reducer case. AC09 and R4 remain **PARTIAL** because the complete DL-04/05 regression set and R3 scenarios are still not repeated; this test does not provide author-Project, resource-measurement, packaged-install, or human Gate B evidence.

## Frozen AC03 R2 Creator media-preflight plan - v1.0.0 (before run)

Frozen source HEAD: `347c4aabf5731a0cbbfa4b69b1e363154751b398` on `issue-816-dl01-formal-export-preparation`. The focused verifier extension covers exactly two generated-fixture Creator UI failures: a missing image used as the first Shot background, and corrupt bytes for a used audio asset. Both run through Creator Export and native Save As. Each must retain `REQUIRED_MEDIA_UNAVAILABLE`, the exact Shot/media location, the actionable problem and next step, and must start no formal Main Job or commit, create no selected-target MP4, preserve the Project file and dirty editor/session fingerprint, preserve the SHA-256 of a valid sibling prior-output MP4, restore all source bytes exactly, and leave no export temporaries. The receipt records screenshots, source hashes, prior-output FFprobe facts, and per-case assertions.

Acceptance root: `D:\PandaStage-Acceptance\i836r2pf1`; isolated frame-job root: `D:\PandaStage-Acceptance\i836r2pf1\frame-jobs`. Both paths were confirmed absent before this plan was frozen. The run uses generated Issue #827 sample 1 (three Shots, 30 seconds); it is not an author Project. `node --check scripts/verify-issue819-dl02.cjs`, `git diff --check`, `pnpm lint`, and `pnpm build` passed before freezing. Build output retained the existing empty CSS import and large-chunk warnings.

Run once from the repository root with the following exact mode and source values. The package build already passed on this frozen source; this invokes one Electron verifier process against those built artifacts:

```powershell
$modeNames = @(
    'PANDA_STAGE_ISSUE819_ROOT',
    'PANDA_STAGE_ISSUE823_DL03',
    'PANDA_STAGE_ISSUE827_DL04',
    'PANDA_STAGE_ISSUE827_ROOT',
    'PANDA_STAGE_ISSUE827_SAMPLE',
    'PANDA_STAGE_ISSUE827_WRAPPER_COMMIT_SHA',
    'PANDA_STAGE_ISSUE827_WRAPPER_RUN_ID',
    'PANDA_STAGE_ISSUE832_DL05',
    'PANDA_STAGE_ISSUE832_ROOT',
    'PANDA_STAGE_ISSUE832_RUN_ID',
    'PANDA_STAGE_ISSUE832_SOURCE_SHA',
    'PANDA_STAGE_ISSUE834_FOLLOWUP',
    'PANDA_STAGE_ISSUE834_ROOT',
    'PANDA_STAGE_ISSUE834_RUN_ID',
    'PANDA_STAGE_ISSUE834_SOURCE_SHA',
    'PANDA_STAGE_ISSUE836_DL06_R0',
    'PANDA_STAGE_ISSUE836_FRAME_ROOT',
    'PANDA_STAGE_ISSUE836_R2_COMMIT_RACE',
    'PANDA_STAGE_ISSUE836_R2_COPY_FAILURE',
    'PANDA_STAGE_ISSUE836_R2_COPY_FAILURE_VALID_MP4',
    'PANDA_STAGE_ISSUE836_R2_MEDIA_PREFLIGHT',
    'PANDA_STAGE_ISSUE836_R2_PATH_BOUNDARY',
    'PANDA_STAGE_ISSUE836_R2_PATH_SUCCESS',
    'PANDA_STAGE_ISSUE836_RUN_ID',
    'PANDA_STAGE_ISSUE836_SOURCE_SHA'
)
foreach ($name in $modeNames) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
$env:PANDA_STAGE_ISSUE827_ROOT = 'D:\PandaStage-Acceptance\i836r2pf1'
$env:PANDA_STAGE_ISSUE827_SAMPLE = '1'
$env:PANDA_STAGE_ISSUE827_DL04 = '1'
$env:PANDA_STAGE_ISSUE836_FRAME_ROOT = 'D:\PandaStage-Acceptance\i836r2pf1\frame-jobs'
$env:PANDA_STAGE_ISSUE836_R2_MEDIA_PREFLIGHT = '1'
$env:PANDA_STAGE_ISSUE836_RUN_ID = 'i836-ac03-r2-media-preflight-v1.0.0'
$env:PANDA_STAGE_ISSUE836_SOURCE_SHA = '347c4aabf5731a0cbbfa4b69b1e363154751b398'
pnpm exec electron scripts/verify-issue819-dl02.cjs
exit $LASTEXITCODE
```

Stop at the first failure, preserve the acceptance root, and do not retry or run another verifier. A pass is limited to these two generated-fixture UI paths; it does not complete the missing permission, target, and other AC03 cases, establish R3 measurements, or provide author-Project, packaged-install, or human Gate B acceptance. AC03 and R2 remain **PARTIAL** pending broader required evidence.

## AC03 R2 Creator media-preflight result - v1.0.0 (2026-10-24)

Frozen source: `347c4aabf5731a0cbbfa4b69b1e363154751b398`. The single `pnpm exec electron scripts/verify-issue819-dl02.cjs` invocation exited 1 at the first case; no retry or additional verifier was run. Windows Electron 43.1.1 started at `2026-10-23T23:39:41.675Z` and completed at `2026-10-23T23:39:46.148Z`. Acceptance root: `D:\PandaStage-Acceptance\i836r2pf1\run-2026-10-23T23-39-41-059Z-11056`.

The Creator Save As dialog selected `issue836-r2-missing-background.mp4`. The task then entered `preparing`; `startFromCreatorUi` treated that intermediate state as an unexpected start and clicked Cancel before the async preflight could reach its expected terminal failure. The final task was `cancelled` with “export preparation cancelled,” with zero formal Main starts and no Main updates. Therefore this run did **not** establish missing-media preflight behavior, and the corrupt-audio case was not reached. This is a harness sequencing failure, not evidence of a product defect or of passing product behavior.

Failure receipt: `evidence\electron-failure.json`, SHA-256 `76df775c3301aedf5a325472a17369a8754a38fc7e39d629f49ccac6bef0df6e`. Screenshot: `evidence\issue836-r2-missing-background-blocked.png`, SHA-256 `ca1dbf653c1163dd574a8b1f99765bf3ed150ecf0ba085691a4c1dd53186ee74` (the same capture is also `electron-failure.png`). The persisted Project SHA-256 still matches its initial value `5915cdd6f89959f4496215d5708478e74d2eef0f9fcb8aa9a860f557ffbf1e99`; all ten source-media files were restored to the recorded hashes; the selected MP4 target is absent; and the isolated frame-job root was not created. The generated prior-output sentinel remains in the preserved project root, but this early assertion failure occurred before its post-case hash assertion, so this receipt does not establish that it remained unchanged.

The frozen plan's stop condition was honored. The acceptance root remains intact. AC03 and R2 remain **PARTIAL**; the full missing/corrupt/permission/target Creator matrix remains outstanding.

## Frozen AC03 R2 Creator media-preflight follow-up plan - v1.1.0 (before run)

Frozen source HEAD: `8610928993d237b58817451a05aaa0b6d3e615db` on `issue-816-dl01-formal-export-preparation`. The v1.0.0 run remains failed and preserved. Its receipt showed the helper cancelled the normal `preparing` state before async preflight returned. This separate follow-up changes only the verifier's expected-failure wait: `preparing` is now allowed to settle, while a formal Main Job or a running/completed/cancelled task remains an unexpected start that triggers the existing safety abort; a 30-second timeout also invokes the safety abort. The v1.1.0 run uses a new acceptance root and does not modify or reuse v1.0.0 artifacts.

Acceptance root: `D:\PandaStage-Acceptance\i836r2pf2`; isolated frame-job root: `D:\PandaStage-Acceptance\i836r2pf2\frame-jobs`. Both paths were confirmed absent before freezing this plan. The focused verifier syntax check, `git diff --check`, `pnpm lint`, and `pnpm build` passed on the frozen source; build output retained the existing empty CSS import and large-chunk warnings.

Run exactly once from the repository root. This uses generated Issue #827 sample 1 and checks the missing first-Shot background plus corrupt used-audio Creator preflight cases. It remains generated-fixture automated evidence, not an author Project or human Gate B acceptance.

```powershell
$modeNames = @(
    'PANDA_STAGE_ISSUE819_ROOT',
    'PANDA_STAGE_ISSUE823_DL03',
    'PANDA_STAGE_ISSUE827_DL04',
    'PANDA_STAGE_ISSUE827_ROOT',
    'PANDA_STAGE_ISSUE827_SAMPLE',
    'PANDA_STAGE_ISSUE827_WRAPPER_COMMIT_SHA',
    'PANDA_STAGE_ISSUE827_WRAPPER_RUN_ID',
    'PANDA_STAGE_ISSUE832_DL05',
    'PANDA_STAGE_ISSUE832_ROOT',
    'PANDA_STAGE_ISSUE832_RUN_ID',
    'PANDA_STAGE_ISSUE832_SOURCE_SHA',
    'PANDA_STAGE_ISSUE834_FOLLOWUP',
    'PANDA_STAGE_ISSUE834_ROOT',
    'PANDA_STAGE_ISSUE834_RUN_ID',
    'PANDA_STAGE_ISSUE834_SOURCE_SHA',
    'PANDA_STAGE_ISSUE836_DL06_R0',
    'PANDA_STAGE_ISSUE836_FRAME_ROOT',
    'PANDA_STAGE_ISSUE836_R2_COMMIT_RACE',
    'PANDA_STAGE_ISSUE836_R2_COPY_FAILURE',
    'PANDA_STAGE_ISSUE836_R2_COPY_FAILURE_VALID_MP4',
    'PANDA_STAGE_ISSUE836_R2_MEDIA_PREFLIGHT',
    'PANDA_STAGE_ISSUE836_R2_PATH_BOUNDARY',
    'PANDA_STAGE_ISSUE836_R2_PATH_SUCCESS',
    'PANDA_STAGE_ISSUE836_RUN_ID',
    'PANDA_STAGE_ISSUE836_SOURCE_SHA'
)
foreach ($name in $modeNames) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
$env:PANDA_STAGE_ISSUE827_ROOT = 'D:\PandaStage-Acceptance\i836r2pf2'
$env:PANDA_STAGE_ISSUE827_SAMPLE = '1'
$env:PANDA_STAGE_ISSUE827_DL04 = '1'
$env:PANDA_STAGE_ISSUE836_FRAME_ROOT = 'D:\PandaStage-Acceptance\i836r2pf2\frame-jobs'
$env:PANDA_STAGE_ISSUE836_R2_MEDIA_PREFLIGHT = '1'
$env:PANDA_STAGE_ISSUE836_RUN_ID = 'i836-ac03-r2-media-preflight-v1.1.0'
$env:PANDA_STAGE_ISSUE836_SOURCE_SHA = '8610928993d237b58817451a05aaa0b6d3e615db'
pnpm exec electron scripts/verify-issue819-dl02.cjs
exit $LASTEXITCODE
```

Stop at the first failure, preserve v1.1.0 artifacts, and do not retry this plan. A pass would cover only the two generated-fixture UI cases; permission, target failure, the full AC03 matrix, R3 measurement, author-Project provenance, packaged-install acceptance, and human Gate B remain outstanding. AC03 and R2 remain **PARTIAL** until all required evidence is complete.

## AC03 R2 Creator media-preflight follow-up result - v1.1.0 (2026-10-24)

Frozen source: `8610928993d237b58817451a05aaa0b6d3e615db`. The single `pnpm exec electron scripts/verify-issue819-dl02.cjs` invocation exited 0. Windows Electron 43.1.1 ran from `2026-10-23T23:45:23.407Z` to `2026-10-23T23:45:31.245Z` under `D:\PandaStage-Acceptance\i836r2pf2\run-2026-10-23T23-45-22-798Z-5224`. This was a fresh follow-up on the new root; v1.0.0's failed root and receipt remain untouched.

Both planned Creator cases reached terminal `failed` task states with `REQUIRED_MEDIA_UNAVAILABLE`, exact consumed-media location, the user-facing problem (“所需素材缺失、损坏，或内容与工程记录不一致。”), and next step (“重新导入这个素材，或修复工程中的资源引用后再检查。”):

- Missing `assets/bamboo-background.png`: `镜头“Opening”的背景“Background”`.
- Corrupt used audio `assets/dl03-bgm.wav`: `镜头“Opening”的音频片段“DL-03 BGM full Shot”`; the controlled invalid bytes had SHA-256 `ad142924f473edcac84692fc74982925fb84f96c759f91710550c2c97d73fffb`.

Neither case started a formal Main Job or commit. Both selected MP4 targets remained absent; both preserved the same valid prior-output sentinel at SHA-256 `28dacbd01c0184b180ce0313bb81b56ee8a88c2ad1a75dc87ddeb1fba52c967d`. Resolved FFprobe identified it as H.264/yuv420p, 64×64, six frames, 0.25 seconds. `project.json` remained SHA-256 `ca3d2ce8b691c3afa0cdfdefa6555680d70f0bc7c9116e3a1685174f820811a7`; all ten fixture source-media hashes were restored and independently matched the receipt. The dirty editor fingerprint, revision, selection, and History were unchanged. Both cleanup checks reported no output temporaries, frame-job directories, or preparation snapshots; the isolated frame root was not created.

Receipt: `evidence\issue836-r2-media-preflight-receipt.json`, SHA-256 `f5f83e814f2719107e883558a91f8cb3d319aa48630fbc19acc2b7f12c55a7a5`; both receipt copies match. The missing-background blocked screenshot is `evidence\issue836-r2-missing-background-blocked.png` (SHA-256 `7bf003c2843f0dae875c4adde715ffb4d6f1988146468627f213b0f28728dd9c`); the corrupt-audio blocked screenshot is `evidence\issue836-r2-corrupt-audio-blocked.png` (SHA-256 `e213e91640b47e527c749d106df23ba421e77f6f441ad52f4eb00f556d53babc`). Both show Creator's actionable terminal error. Receipt status is `auto=PASS`, `owner=NOT_ATTESTED`; this is generated-fixture UI evidence only.

AC03 and R2 remain **PARTIAL**. This closes the missing-background and corrupt-audio subcases only; permission failures, target failures, the complete AC03 matrix, R3 measurements, author-Project provenance, packaged-install acceptance, and human Gate B remain outstanding.

## Frozen AC03 R2 Creator output-folder permission plan - v1.0.0 (before run)

Frozen source HEAD: `5ae58840d740e7fe0e9840beaa99ef7108c9d791` on `issue-816-dl01-formal-export-preparation`. The implementation maps filesystem permission errors to actionable issues for the selected output folder, required-media reads, temporary media copies, and temporary preparation setup. This one Electron run checks the Creator Save As output-folder path only: a controlled `EACCES` is injected into Main's `ExportPreparationService.assertFormalOutputLocation` for the exact selected target. It exercises the real Creator task and visible error surface under a deterministic permission failure; it does **not** establish behavior under a real Windows ACL denial.

The test uses generated Issue #827 sample 1. It creates a valid six-frame H.264/yuv420p MP4 sentinel, attempts a distinct absent output target, and asserts the task identifies the output location and folder-write permission, gives the writable-folder next step, starts no formal Main Job or commit, leaves the target absent, and preserves the sentinel, Project bytes, editor/session fingerprint, and all source-media hashes. It also checks owned temporary cleanup. No user Project is opened or changed. R2 and AC03 remain **PARTIAL** after this single subcase; target races, other failure modes, the full AC03 matrix, R3 measurement, author-Project provenance, packaged-install acceptance, and human Gate B remain outstanding.

Acceptance root: `D:\PandaStage-Acceptance\i836r2pf3`; isolated frame-job root: `D:\PandaStage-Acceptance\i836r2pf3\frame-jobs`. Both paths were confirmed absent before freezing this plan. `node --check scripts/verify-issue819-dl02.cjs`, `git diff --check`, the focused export-preparation unit file (48 tests), `pnpm lint`, `pnpm test:integration` (38 files / 189 tests), and `pnpm build` (including typecheck) passed on this source. Build output contained the existing empty CSS import and large-chunk warnings.

Run exactly once from the repository root, after this plan is committed and pushed and the same two paths are reconfirmed absent. The command clears other acceptance modes, uses the generated sample-1 Creator fixture, and invokes the Electron verifier once:

```powershell
$modeNames = @(
    'PANDA_STAGE_ISSUE819_ROOT',
    'PANDA_STAGE_ISSUE823_DL03',
    'PANDA_STAGE_ISSUE827_DL04',
    'PANDA_STAGE_ISSUE827_ROOT',
    'PANDA_STAGE_ISSUE827_SAMPLE',
    'PANDA_STAGE_ISSUE827_WRAPPER_COMMIT_SHA',
    'PANDA_STAGE_ISSUE827_WRAPPER_RUN_ID',
    'PANDA_STAGE_ISSUE832_DL05',
    'PANDA_STAGE_ISSUE832_ROOT',
    'PANDA_STAGE_ISSUE832_RUN_ID',
    'PANDA_STAGE_ISSUE832_SOURCE_SHA',
    'PANDA_STAGE_ISSUE834_FOLLOWUP',
    'PANDA_STAGE_ISSUE834_ROOT',
    'PANDA_STAGE_ISSUE834_RUN_ID',
    'PANDA_STAGE_ISSUE834_SOURCE_SHA',
    'PANDA_STAGE_ISSUE836_DL06_R0',
    'PANDA_STAGE_ISSUE836_FRAME_ROOT',
    'PANDA_STAGE_ISSUE836_R2_COMMIT_RACE',
    'PANDA_STAGE_ISSUE836_R2_COPY_FAILURE',
    'PANDA_STAGE_ISSUE836_R2_COPY_FAILURE_VALID_MP4',
    'PANDA_STAGE_ISSUE836_R2_MEDIA_PREFLIGHT',
    'PANDA_STAGE_ISSUE836_R2_OUTPUT_PERMISSION',
    'PANDA_STAGE_ISSUE836_R2_PATH_BOUNDARY',
    'PANDA_STAGE_ISSUE836_R2_PATH_SUCCESS',
    'PANDA_STAGE_ISSUE836_RUN_ID',
    'PANDA_STAGE_ISSUE836_SOURCE_SHA'
)
foreach ($name in $modeNames) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
$env:PANDA_STAGE_ISSUE827_ROOT = 'D:\PandaStage-Acceptance\i836r2pf3'
$env:PANDA_STAGE_ISSUE827_SAMPLE = '1'
$env:PANDA_STAGE_ISSUE827_DL04 = '1'
$env:PANDA_STAGE_ISSUE836_FRAME_ROOT = 'D:\PandaStage-Acceptance\i836r2pf3\frame-jobs'
$env:PANDA_STAGE_ISSUE836_R2_OUTPUT_PERMISSION = '1'
$env:PANDA_STAGE_ISSUE836_RUN_ID = 'i836-ac03-r2-output-permission-v1.0.0'
$env:PANDA_STAGE_ISSUE836_SOURCE_SHA = '5ae58840d740e7fe0e9840beaa99ef7108c9d791'
pnpm exec electron scripts/verify-issue819-dl02.cjs
exit $LASTEXITCODE
```

Stop on the first failure and preserve all artifacts; do not retry or run another verifier under this plan. A pass establishes only the generated-fixture UI response to the injected output-folder `EACCES`. It does not establish real ACL denial, read denial in a user installation, or overall AC03 completion.

## AC03 R2 Creator output-folder permission result - v1.0.0 (2026-10-24)

The single planned `pnpm exec electron scripts/verify-issue819-dl02.cjs` invocation exited 0 on frozen verifier source `5ae58840d740e7fe0e9840beaa99ef7108c9d791`. Windows Electron 43.1.1 started at `2026-10-23T23:58:49.497Z` and completed at `2026-10-23T23:58:53.495Z`. Acceptance root: `D:\PandaStage-Acceptance\i836r2pf3\run-2026-10-23T23-58-49-497Z-7920`. This was the single planned run; there was no retry.

The controlled `EACCES` check ran exactly once for the selected target. Creator reached terminal `failed` and displayed `OUTPUT_LOCATION_UNSUPPORTED` at `输出位置`, with problem “所选文件夹没有创建 MP4 文件所需的写入权限。” and next step “检查文件夹的写入权限，或选择当前账户可写的本地 NTFS 文件夹后重试。” No formal Main Job or commit started. The selected target remained absent. The separate valid prior-output sentinel remained unchanged at SHA-256 `28dacbd01c0184b180ce0313bb81b56ee8a88c2ad1a75dc87ddeb1fba52c967d`; FFprobe identified a 1,724-byte H.264/yuv420p, 64×64, six-frame, 0.25-second MP4. The Project file remained SHA-256 `d5dd1b6711544ebe626b49ab376b5bb86855c530be04e135e3db173c111ac743`. The editor/session fingerprint remained the same (revision 1, dirty, same Shot selection, one undo entry, no redo), and all ten source-media hashes matched the pre-run values. The cleanup receipt lists no output temporaries, frame-job directories, or preparation snapshots.

Receipt: `issue836-r2-output-permission-receipt.json`, SHA-256 `a9ce6138e161f67ff9ce012ada4009d4fef1d4b7d1340ff123c521b53bd3cac6`; the evidence-root copy has the same hash. Save As screenshot: `issue836-r2-output-permission-save-as.png`, SHA-256 `bf3e2ec4134ea419d9d9d744b0277988a7507ace7ba0e8f87499d7f2f41c2de3`. Blocked Creator task screenshot: `issue836-r2-output-permission-blocked.png`, SHA-256 `32efa0001e5dc17634bbabd4069fc66ca5e3276b7ae7e3be6fdaeddbf14df0c8`; it shows the specific output-folder permission issue and recovery step. Receipt status is `auto=PASS`, `owner=NOT_ATTESTED`. This proves the generated-fixture UI response to injected `EACCES`; it does not prove behavior under an actual Windows ACL denial.

AC03 and R2 remain **PARTIAL**. This closes only the controlled Creator output-folder permission subcase. Real ACL behavior, target races, remaining AC03 cases, R3 measurements, author-Project provenance, packaged-install acceptance, and human Gate B remain outstanding. For pushed verifier source SHA `e5c0ebf590424dd66c37bcfacb1fb22039ce3404`, combined commit status was pending with zero status entries, GitHub check-runs returned zero, and `gh pr checks 817` reported no checks: `CI_NOT_REPORTED`.

## Frozen AC03 R2 Creator output-folder real NTFS ACL permission plan - v1.0.0 (before run)

Frozen source HEAD: `e1037804d0837ea263579a4cfc7c18b334df86ee` on `issue-816-dl01-formal-export-preparation`. The previous v1.0.0 controlled EACCES Creator case passed but did not exercise a Windows ACL. A disposable ACL check in the current Windows environment showed that `fs.access(W_OK)` still returns success for an explicitly denied folder while exclusive file creation returns `EPERM`; its temporary test folder was restored and removed. This follow-up therefore adds a Main-owned exclusive create/close/delete probe to output target capture. A focused unit case verifies successful selection leaves no probe file.

This single Electron run uses generated Issue #827 sample 1 and applies an explicit write-deny ACE only to a newly created subfolder under that generated Project. It uses the current account SID and opens Creator's Save As dialog at a target inside the denied subfolder. The verifier first confirms that exclusive file creation is denied, then drives the normal Creator/Main preflight. Expected: the Main write probe surfaces the located output-folder permission issue before any formal Job/commit; the target remains absent; the prior valid MP4, Project bytes, editor/session state, and source-media hashes remain unchanged. The `finally` path removes only the explicit deny ACE and confirms create/delete access is restored. The plan does not alter ACLs outside the generated child folder or use an author Project.

Acceptance root: `D:\PandaStage-Acceptance\i836r2pf4`; isolated frame-job root: `D:\PandaStage-Acceptance\i836r2pf4\frame-jobs`. Both were confirmed absent before freezing. On the frozen source, `node --check scripts/verify-issue819-dl02.cjs`, `git diff --check`, the focused export-preparation unit file (49 tests), `pnpm lint`, `pnpm test:integration` (38 files / 189 tests), and `pnpm build` (including typecheck) passed. Existing empty CSS import and large-chunk warnings remain. The disposable ACL check's observed `W_OK=allowed` / exclusive-create=`EPERM` result is the reason for the Main write probe.

Run exactly once after this plan is committed and pushed and both paths are reconfirmed absent. The ACL is applied only after fixture generation, and the verifier restores it in `finally`. If the Electron process is forcibly terminated before `finally`, preserve the root and remove only the explicit deny ACE from that run's generated ACL subfolder with the current SID before inspecting it; do not rerun this plan.

```powershell
$modeNames = @(
    'PANDA_STAGE_ISSUE819_ROOT',
    'PANDA_STAGE_ISSUE823_DL03',
    'PANDA_STAGE_ISSUE827_DL04',
    'PANDA_STAGE_ISSUE827_ROOT',
    'PANDA_STAGE_ISSUE827_SAMPLE',
    'PANDA_STAGE_ISSUE827_WRAPPER_COMMIT_SHA',
    'PANDA_STAGE_ISSUE827_WRAPPER_RUN_ID',
    'PANDA_STAGE_ISSUE832_DL05',
    'PANDA_STAGE_ISSUE832_ROOT',
    'PANDA_STAGE_ISSUE832_RUN_ID',
    'PANDA_STAGE_ISSUE832_SOURCE_SHA',
    'PANDA_STAGE_ISSUE834_FOLLOWUP',
    'PANDA_STAGE_ISSUE834_ROOT',
    'PANDA_STAGE_ISSUE834_RUN_ID',
    'PANDA_STAGE_ISSUE834_SOURCE_SHA',
    'PANDA_STAGE_ISSUE836_DL06_R0',
    'PANDA_STAGE_ISSUE836_FRAME_ROOT',
    'PANDA_STAGE_ISSUE836_R2_COMMIT_RACE',
    'PANDA_STAGE_ISSUE836_R2_COPY_FAILURE',
    'PANDA_STAGE_ISSUE836_R2_COPY_FAILURE_VALID_MP4',
    'PANDA_STAGE_ISSUE836_R2_MEDIA_PREFLIGHT',
    'PANDA_STAGE_ISSUE836_R2_OUTPUT_PERMISSION',
    'PANDA_STAGE_ISSUE836_R2_OUTPUT_PERMISSION_ACL',
    'PANDA_STAGE_ISSUE836_R2_PATH_BOUNDARY',
    'PANDA_STAGE_ISSUE836_R2_PATH_SUCCESS',
    'PANDA_STAGE_ISSUE836_RUN_ID',
    'PANDA_STAGE_ISSUE836_SOURCE_SHA'
)
foreach ($name in $modeNames) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
$env:PANDA_STAGE_ISSUE827_ROOT = 'D:\PandaStage-Acceptance\i836r2pf4'
$env:PANDA_STAGE_ISSUE827_SAMPLE = '1'
$env:PANDA_STAGE_ISSUE827_DL04 = '1'
$env:PANDA_STAGE_ISSUE836_FRAME_ROOT = 'D:\PandaStage-Acceptance\i836r2pf4\frame-jobs'
$env:PANDA_STAGE_ISSUE836_R2_OUTPUT_PERMISSION_ACL = '1'
$env:PANDA_STAGE_ISSUE836_RUN_ID = 'i836-ac03-r2-output-permission-real-acl-v1.0.0'
$env:PANDA_STAGE_ISSUE836_SOURCE_SHA = 'e1037804d0837ea263579a4cfc7c18b334df86ee'
pnpm exec electron scripts/verify-issue819-dl02.cjs
exit $LASTEXITCODE
```

Stop on the first failure and preserve the root; no retry or additional verifier is part of this plan. A pass covers one generated-fixture real ACL denial on this Windows account and application build. It does not complete AC03/R2, cover all ACL arrangements, or establish author-Project, packaged-install, R3 resource-ceiling, or human Gate B acceptance.

## AC03 R2 Creator output-folder real NTFS ACL permission result - v1.0.0 (2026-10-24)

The single planned `pnpm exec electron scripts/verify-issue819-dl02.cjs` invocation exited 1 on frozen verifier source `e1037804d0837ea263579a4cfc7c18b334df86ee`. Windows Electron 43.1.1 started at `2026-10-24T00:12:52.143Z` and completed at `2026-10-24T00:12:55.344Z`. Acceptance root: `D:\PandaStage-Acceptance\i836r2pf4\run-2026-10-24T00-12-52-143Z-5776`. No retry was made.

The verifier created the generated Project's ACL subfolder and the Save As dialog opened at the planned target path, but UI Automation failed while setting the filename: `ElementNotEnabledException` from the native Save As helper. The dialog was detected (PID 5776; bounds 243,0,626,771), but no selection result was recorded, so Main never received a target. The failure screenshot shows Creator still waiting at “正在选择保存位置…”. The failure receipt records zero formal Main starts and no latest export update. The MP4 target is absent; the valid prior-output sentinel remains SHA-256 `28dacbd01c0184b180ce0313bb81b56ee8a88c2ad1a75dc87ddeb1fba52c967d`. The current generated `project.json` SHA-256 is `76fe895f0f4b5fd51fb48e2d5f2779ae93b28082bb5e5028c8b205faa0535774`; because Save As never returned a selection, this run supplies no output-permission behavior evidence from Main or Creator's terminal error surface.

Post-run ACL inspection found only the folder's inherited Administrators, SYSTEM, CREATOR OWNER, and Users entries, with no explicit deny ACE. This confirms the verifier's `finally` block restored the generated folder's ACL. The acceptance root and failure artifacts are preserved.

Failure receipt: `evidence\electron-failure.json`, SHA-256 `cbb7bc2d907631ba50a18c5231bd677857546da4478219af0c5d5bf8427b3373`. Screenshot: `evidence\electron-failure.png`, SHA-256 `30c193a8c668d4d6b15b31c7945a18a39d12b3e422c8594dc611ece3b51a786c`. The v1.0.0 plan's stop condition was honored. This harness/UIA stop is inconclusive about the product's real-ACL behavior; AC03 and R2 remain **PARTIAL**. For pushed frozen source SHA `185411c0cdd02a6896c04a875676214378dfcd81`, commit status was pending with zero status entries, check-runs returned zero, and `gh pr checks 817` reported no checks: `CI_NOT_REPORTED`.

## Frozen AC03 R2 Creator output-folder real NTFS ACL permission plan - v1.1.0 (before run)

Frozen verifier source commit: `88d2cd88011defb93ab49907c2370cd5534fa87b` on `issue-816-dl01-formal-export-preparation`. The v1.0.0 run stopped before Save As selected a path: its deny ACL was active while the native dialog opened, and UI Automation reported `ElementNotEnabledException` while setting the filename. This v1.1.0 plan changes only that sequencing. The v1.0.0 acceptance root and evidence remain preserved.

Use a fresh generated Issue #827 sample 1 Project. Its new `issue836-r2-output-permission-acl` child folder remains writable while the native Save As dialog opens and UI Automation selects the exact planned MP4 path. Once `dialog.showSaveDialog` resolves, but before the selection callback returns the path to Main, the verifier applies an explicit NTFS write-deny ACE for the current account SID to that generated child folder. It confirms exclusive file creation fails with `EACCES` or `EPERM`, records that the ACL was applied after selection, then returns the exact path so Main's exclusive output write probe handles the real denial. Expected behavior: Creator reports the output-folder permission issue before any formal Job or commit; target remains absent; prior valid MP4, Project bytes, editor/session state, and source-media hashes remain unchanged. The `finally` path removes only this explicit deny ACE, verifies exclusive create/delete access is restored, and requires the generated ACL folder to be empty.

Acceptance root `D:\PandaStage-Acceptance\i836r2pf5` and isolated frame-job root `D:\PandaStage-Acceptance\i836r2pf5\frame-jobs` were confirmed absent before freezing. `node --check scripts/verify-issue819-dl02.cjs` and `git diff --check` passed for the verifier-only change. Production source is unchanged from the previously validated commit. Run exactly once after this plan is pushed and both paths are reconfirmed absent. Stop on the first failure and preserve all artifacts. If Electron is forcibly terminated before its `finally` restoration, preserve the run root and remove only the explicit deny ACE on that run's generated ACL child folder for the current SID before inspecting; do not retry.

~~~powershell
$modeNames = @(
    'PANDA_STAGE_ISSUE819_ROOT',
    'PANDA_STAGE_ISSUE823_DL03',
    'PANDA_STAGE_ISSUE827_DL04',
    'PANDA_STAGE_ISSUE827_ROOT',
    'PANDA_STAGE_ISSUE827_SAMPLE',
    'PANDA_STAGE_ISSUE827_WRAPPER_COMMIT_SHA',
    'PANDA_STAGE_ISSUE827_WRAPPER_RUN_ID',
    'PANDA_STAGE_ISSUE832_DL05',
    'PANDA_STAGE_ISSUE832_ROOT',
    'PANDA_STAGE_ISSUE832_RUN_ID',
    'PANDA_STAGE_ISSUE832_SOURCE_SHA',
    'PANDA_STAGE_ISSUE834_FOLLOWUP',
    'PANDA_STAGE_ISSUE834_ROOT',
    'PANDA_STAGE_ISSUE834_RUN_ID',
    'PANDA_STAGE_ISSUE834_SOURCE_SHA',
    'PANDA_STAGE_ISSUE836_DL06_R0',
    'PANDA_STAGE_ISSUE836_FRAME_ROOT',
    'PANDA_STAGE_ISSUE836_R2_COMMIT_RACE',
    'PANDA_STAGE_ISSUE836_R2_COPY_FAILURE',
    'PANDA_STAGE_ISSUE836_R2_COPY_FAILURE_VALID_MP4',
    'PANDA_STAGE_ISSUE836_R2_MEDIA_PREFLIGHT',
    'PANDA_STAGE_ISSUE836_R2_OUTPUT_PERMISSION',
    'PANDA_STAGE_ISSUE836_R2_OUTPUT_PERMISSION_ACL',
    'PANDA_STAGE_ISSUE836_R2_PATH_BOUNDARY',
    'PANDA_STAGE_ISSUE836_R2_PATH_SUCCESS',
    'PANDA_STAGE_ISSUE836_RUN_ID',
    'PANDA_STAGE_ISSUE836_SOURCE_SHA'
)
foreach ($name in $modeNames) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
$env:PANDA_STAGE_ISSUE827_ROOT = 'D:\PandaStage-Acceptance\i836r2pf5'
$env:PANDA_STAGE_ISSUE827_SAMPLE = '1'
$env:PANDA_STAGE_ISSUE827_DL04 = '1'
$env:PANDA_STAGE_ISSUE836_FRAME_ROOT = 'D:\PandaStage-Acceptance\i836r2pf5\frame-jobs'
$env:PANDA_STAGE_ISSUE836_R2_OUTPUT_PERMISSION_ACL = '1'
$env:PANDA_STAGE_ISSUE836_RUN_ID = 'i836-ac03-r2-output-permission-real-acl-v1.1.0'
$env:PANDA_STAGE_ISSUE836_SOURCE_SHA = '88d2cd88011defb93ab49907c2370cd5534fa87b'
pnpm exec electron scripts/verify-issue819-dl02.cjs
exit $LASTEXITCODE
~~~

A pass covers this single generated-fixture real ACL denial on the current Windows account and build. It does not complete AC03/R2, establish author-Project provenance or packaged-install behavior, measure R3 ceilings, or constitute human Gate B acceptance. AC03 and R2 remain PARTIAL pending their other cases and review.

## AC03 R2 Creator output-folder real NTFS ACL permission result - v1.1.0 (2026-10-24)

The single planned `pnpm exec electron scripts/verify-issue819-dl02.cjs` invocation exited 0 on frozen verifier source commit `88d2cd88011defb93ab49907c2370cd5534fa87b`. Windows Electron 43.1.1 ran under `D:\PandaStage-Acceptance\i836r2pf5\run-2026-10-24T00-20-01-689Z-724`; the receipt records `2026-10-24T00:20:02.331Z` to `2026-10-24T00:20:05.918Z`. This was the one planned run; there was no retry.

The native Save As dialog completed selection of the exact planned MP4 path while its generated folder was writable. After `showSaveDialog` returned, the verifier applied the current account's explicit NTFS write-deny ACE and confirmed exclusive file creation failed with `EPERM`; Main then reported `OUTPUT_LOCATION_UNSUPPORTED` for the output location. The verifier completed its assertions with zero formal Jobs and zero output commits. The target MP4 remained absent. The separate 1,724-byte prior-output sentinel remained unchanged at SHA-256 `28dacbd01c0184b180ce0313bb81b56ee8a88c2ad1a75dc87ddeb1fba52c967d`; FFprobe identifies it as H.264/yuv420p, 64x64, six frames, 0.25 seconds. The generated Project remained SHA-256 `60e46866b332a092dccca3139a0daa87f6245d442917fdb554604043a7801ecf`. The editor/session fingerprint remained unchanged (revision 1, dirty, same Shot, one undo entry, no redo); all ten source-media hashes matched.

The `finally` path restored the ACL and verified write access. Independent post-run `icacls` inspection showed only inherited Administrators, SYSTEM, CREATOR OWNER, and Users entries, with no explicit deny ACE. The generated ACL folder is empty. The receipt lists no output temporaries, frame-job directories, or preparation snapshots. The target remains absent and both receipt copies match.

Receipt SHA-256: `c54c326aa471a6b5845060f7c5032ad4361a8b9496d422c488f334880b4d8163`. Save As screenshot SHA-256: `432cc42dbafbe8d0d93c0faf6739f1233ee5bd7ffc72dc491bbd4db593f8ed45`. Blocked Creator task screenshot SHA-256: `91b6c4f2a4814ed5e6fec88eb59f944d65f9f748613f5100b582f09fb43b834b`; it shows the output-location write-permission issue and recovery step. Receipt status is `AUTO=PASS`, `OWNER=NOT_ATTESTED`. This is one generated-fixture real ACL case on this Windows account and build; it does not establish author-Project, packaged-install, R3 resource-ceiling, or human Gate B acceptance. AC03 and R2 remain **PARTIAL**.
