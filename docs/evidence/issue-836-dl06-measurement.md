# Issue #836 DL-06 measurement plan

Version: **1.0.1 — frozen before R3 measurement runs**
Plan date: **2026-10-23**
R3 status before runs: **PLANNED / NOT_ATTESTED**

## Evidence availability

The available acceptance-project inventory did not contain two distinct, author-authorized real Projects with three Shots and a total duration near 30 seconds. The checked candidate projects were prior issue fixtures: one was five Shots / 15 seconds and the others were one Shot / 3 seconds. They do not satisfy the requested R3 sample shape or provenance, so this plan uses generated probes only and will remain **PARTIAL / NOT_ATTESTED**.

The probes use the existing Issue #827 fixture generator based on `demo-project/project-v1.example.json`:

- Sample 1: three Shots of 10,003 ms, 9,997 ms, and 10,000 ms.
- Sample 2: three Shots of 9,000 ms, 11,000 ms, and 10,000 ms.
- Both total 30,000 ms at 24 fps (720 expected output frames) and use generated fixture media. They are not real user Projects.

## Frozen run plan

1. Build the unpackaged Windows Electron app with `pnpm build` on the final measured commit.
2. Run `powershell -NoProfile -File scripts/measure-issue836-dl06-r3.ps1` once. The runner starts four fresh Electron processes in this order: sample 1 cold-process, sample 1 warm-followup, sample 2 cold-process, sample 2 warm-followup.
3. “Cold” means a fresh Electron process and generated fixture root; Windows caches are not flushed. “Warm” means an immediate repeat of the same generated sample definition in a fresh Electron process; system caches may remain warm. These runs do not form a controlled OS cold-cache benchmark.
4. The runner samples each Electron process-tree PID every 500 ms and records per-PID peak working-set and private bytes, process sample counts, root PID, and elapsed wall time. It does not estimate p95 or substitute missing samples with zero.
5. Each existing Issue #827 verifier receipt supplies the actual Project hash, FFprobe dimensions/frame count/duration, output byte count and SHA-256, source media hashes, and temporary cleanup evidence. The runner stores its own process-memory summary and a hash of each verifier receipt.
6. Evidence is written under `D:\PandaStage-Acceptance\issue836-dl06-r3\`. No user Project is copied, changed, or used by the run.

### Pre-run capture addendum (v1.0.1)

Before launching the first export process, the runner records the logical-volume filesystem/capacity/free-space inventory, physical-disk model/interface/capacity, Windows system DPI plus current-user DPI registry values, Electron version, and the resolved FFmpeg/FFprobe executable paths, first version lines, and binary SHA-256 hashes. It records the exact commit SHA and the frozen 500 ms target interval. During each run it records observed maximum sampling interval, sample count, sampled concurrent process-tree count, per-PID memory peaks, and approximate frame-job/frozen-media/output-staging bytes. The monitor samples filesystem sizes and process state from the same Windows host; sub-interval peaks and very short-lived child processes may be missed.

The verifier does not expose per-stage timestamps, renderer pending-write-queue peak, or the exact post-task resource-release duration in its receipt. Those fields remain **NOT_MEASURED**; frame-file count is recorded separately and is not substituted for the pending-write queue. The probes do not run cancellation on the two generated 30-second samples; cancellation/release claims remain limited to the existing focused R0/R4 evidence.

## Interpretation and stop conditions

- A run is technically passing only if the verifier exits successfully, its receipt records a 30-second 24 fps export with 720 frames, the output has a recorded SHA-256 and nonzero byte count, the source Project hash is unchanged, and output/frame/preparation temporary cleanup passes.
- Preserve and report a failed run as failed; do not replace missing measurements with zero or claim a benchmark pass.
- The build is unpackaged Electron. This plan does not verify an installer, packaged resources, human audiovisual acceptance, Gate B, owner acceptance, DL-07, or the DL-07 GO decision.
- Regardless of generated-probe results, R3 remains **PARTIAL / NOT_ATTESTED** until qualifying real-project evidence and the required human/packaged acceptance exist.

The versioned capability profile is in [export-support-matrix.md](../export-support-matrix.md). The run command and current project fixtures are checked against the repository before execution.
