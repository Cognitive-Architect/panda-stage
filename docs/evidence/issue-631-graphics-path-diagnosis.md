# Issue #631 — S09-F07 graphics-path diagnosis

Roadmap: #626. Finding ledger: #625 / S09-F07. Previous R02 diagnosis: #629. Rejected R03 repair: #630. Delivery: Draft PR #628, branch `issue-627-s09-r01`.

## Decision

**ENVIRONMENT-BOUND / PRODUCT DECISION REQUIRED.** On this Windows virtual-display host, Electron/Chromium selected ANGLE D3D11 WARP and a software display compositor. The approximately 100 ms frame cost is measured inside the GPU process's `VizCompositorThread`, predominantly `SoftwareRenderer::DoDrawQuad`, **after** compositor-frame submission and **before** software swap. A 16-fold reduction in Stage canvas backing pixels did not improve cadence. This is strong evidence against a narrow Stage pixel-fill repair in this environment, but it does not prove that every machine will behave this way or identify a product-approved quality policy.

Next single action: repeat the same Scene A plus graphics-status/trace capture on a Windows machine with an actual hardware-accelerated display, keeping the Stage at 1920×1080. Compare `gpu_compositing`, `rasterization`, `ANGLE` identity, `DirectRenderer::DrawFrame`, and rAF/commit cadence. If hardware compositing removes the delay, the owner must decide whether to set a supported graphics-environment requirement or separately authorize a Preview-quality policy. If it does not, open a bounded repair ticket against the measured display-compositor pattern. Do not implement either product choice under #631.

## Starting state and environment

- Live PR #628 head at start and again before handoff: `67df04dc6896cc5d550ac019ad4366b8c19c0805` (Draft/Open). Starting branch: `issue-627-s09-r01`. Final diagnostic SHA: recorded in the Issue/PR handoff comment after commit.
- Windows Server 2022 Datacenter, version 10.0.20348; `AspDod controller` 18.4.50.343 and `AspIdd controller` 15.56.58.728 reported by `Win32_VideoController`. This identifies the observed display environment, not a proven unique driver defect.
- Electron 43.1.1 / Chromium 150.0.7871.114. Visible/focused Electron window: 1600×1000 outer, 1586×938 inner, device scale 1.5; Stage canvas CSS width about 1370.7 px. Each diagnostic run used an isolated Electron process/user-data directory on the same host. The process was restarted between ratios to avoid state carryover; therefore this is not a within-process A/B.
- Runtime `app.isHardwareAccelerationEnabled()` returned `true`, but this indicates the acceleration setting, **not** successful hardware execution. `app.getAppMetrics()` contained a separate GPU process; `app.getGPUInfo('complete')` reported `displayType=ANGLE_D3D11_WARP`, `glImplementationParts=(gl=egl-angle,angle=d3d11-warp)`, `glRenderer=ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 ...)`, and active `Microsoft Basic Render Driver` (`vendorId=5140`, `deviceId=140`, driver 10.0.20348.2849). `inProcessGpu=false`, Skia backend `GaneshGL`.
- `app.getGPUFeatureStatus()` reported `gpu_compositing=disabled_software`, `rasterization=disabled_software`, `2d_canvas=unavailable_software`, `webgl=unavailable_software`, and `multiple_raster_threads=enabled_on`. GPU status was updated before capture. The selected graphics-switch allowlist (`disable-gpu`, `disable-software-rasterizer`, `use-angle`, `use-gl`, `enable-unsafe-swiftshader`, `enable-features`, `disable-features`) was empty in Main. No production graphics switch was changed. All four runs reported the same WARP/feature state.

## Controlled Scene A results

The R02 synthetic project was reused: background, one ordinary image, one Position move of 1100 logical pixels over 5 seconds in a 6-second Shot, no composite Character cache. Only a diagnostic sink altered Konva's **scene backing pixel ratio**; the logical 1920×1080 Stage, CSS size, window, movement, timing semantics, visibility and readiness stayed the same. No hidden-canvas control was used here. `ready=true` in every run, idle/paused rAF median 15.6 ms, with zero hidden/unfocused playback callbacks and zero elapsed-time clamps.

| Scene backing | Pixels vs baseline | rAF median / p95 | Stage commit median / p95 | Raw run |
| --- | ---: | ---: | ---: | --- |
| 1920×1080 | 1× | 101.2 / 109.4 ms | 102.2 / 110.8 ms | `D:\PandaStage-Acceptance\issue631-RBOxVo` |
| 960×540 | ¼× | 103.8 / 112.9 ms | 103.9 / 112.2 ms | `D:\PandaStage-Acceptance\issue631-2O6ED3` |
| 480×270 | ¹⁄₁₆× | 99.7 / 110.4 ms | 100.2 / 112.4 ms | `D:\PandaStage-Acceptance\issue631-E5ANbn` |
| 480×270 trace repeat | ¹⁄₁₆× | 103.8 / 114.5 ms | 104.1 / 115.0 ms | `D:\PandaStage-Acceptance\issue631-skHaHo` |

The R02 reference was rAF 99.7/106.3 ms and commit 100.0/105.8 ms. The small differences among isolated runs are not a decreasing pixel-count curve. This demotes Stage backing-pixel fill/bandwidth as the dominant cause here; it does not show which other window surfaces contribute to each software-composited frame.

## Bounded trace and delay boundary

Electron `contentTracing` recorded only Scene A playback, with categories for renderer scheduling, `cc`, `gpu`, `viz`, DevTools timeline, Blink and frame scheduler. Trace buffer cap: 64 MiB; reported usage about 3.5% and 3.4% in the two traces. Raw traces are in the external acceptance folders above, not committed. Analysis command: `node scripts/analyze-issue631-trace.cjs <trace-scene-A.json>`. Timings below are trace medians / p95; nested slices must **not** be summed as independent work.

| Trace event / process and thread | 1920×1080 | 480×270 repeat | Meaning |
| --- | ---: | ---: | --- |
| Capture span | 6.46 s | 6.40 s | Covers the roughly 5.4 s playback interval |
| Renderer `CrRendererMain` rAF callback execution | 0.56 / 0.74 ms | 0.57 / 0.73 ms | JS callback is short |
| Renderer `CrRendererMain` `ProxyMain::BeginMainFrame` | 15.64 / 17.88 ms | 10.73 / 12.43 ms | Main frame work is below the 100 ms cadence |
| Renderer `Compositor` `ProxyImpl::ScheduledActionDraw` | 0.68 / 0.93 ms | 0.70 / 0.94 ms | Local compositor draw is short |
| Renderer worker `RasterTask` | 0.13 / 0.20 ms each | 0.12 / 0.20 ms each | 433 / 417 short tasks, not a 100 ms task |
| Submit → receive compositor frame (async, unique pairs) | 0.67 / 0.82 ms | 0.69 ms median | Submission/IPC is not the baseline bottleneck |
| GPU `VizCompositorThread` `DirectRenderer::DrawFrame` | 99.97 / 107.57 ms | 103.16 / 111.20 ms | Dominant measured boundary |
| GPU `VizCompositorThread` `SoftwareRenderer::DoDrawQuad` total **within each DrawFrame** | 92.73 / 100.06 ms | 95.97 / 103.49 ms | About 172 software quad draws per frame in both traces |
| Start draw → swap start (async, unique pairs) | 100.03 / 107.66 ms | 103.19 / 111.24 ms | Slow interval is after submission and before swap |
| GPU `SoftwareRenderer::SwapBuffers` | 0.02 / 0.03 ms | 0.02 / 0.03 ms | Chromium software swap call is short; not a scanout measurement |
| Swap end → Chromium presentation feedback (async, unique pairs) | 0.14 / 0.17 ms | 0.14 ms median | Feedback arrives promptly after swap in this trace |
| Renderer `ProxyMain::BeginMainFrame` start interval | 101.27 / 109.35 ms | 103.82 / 114.55 ms | Matches rAF cadence and GPU draw duration |

The 1920 trace ran 2026-09-27 01:26:04.482–01:26:10.940 UTC; the 480 trace ran 01:32:18.355–01:32:24.756 UTC. `SubmitCompositorFrameToPresentationCompositorFrame` was about 101.22 ms median at 1920, consistent with the draw/swap interval. Chromium emitted two `Swap throttled` instants in the baseline trace (`pending_swaps=1`, `max_pending_swaps=1`), but these isolated events do not explain every frame. The GPU software draw thread was occupied for almost the whole slow interval while renderer callbacks and raster tasks were short. The strongest inference is that rAF/BeginFrame cadence is back-pressured by graphics display work, **not** an independent 100 ms JavaScript timer clamp. The trace does not provide a complete causal scheduler-flow proof for every rAF callback.

The trace exposes Chromium's software swap and presentation-feedback markers, but **not a directly timed DXGI/OS physical present or display scanout**. Do not label the 0.14 ms feedback interval as physical present latency. The narrowest defensible substage is GPU-process Viz software quad drawing before swap, not an unmeasured hardware-present wait.

## Competing explanations and limits

1. **Renderer JS, Position evaluation, React/Konva synchronous draw, or renderer raster workers** rank lower: the trace's rAF callback and local compositor/raster slices are short; the R02 Scene A probe measured `evaluateShot` ~0 ms, `stageRenderModel` ~0 ms and `konvaDrawScene` ~0.3 ms median. No composite cache exists in Scene A. The separate Position-only composite-cache waste remains real but outside #631.
2. **Stage backing-pixel fill** ranks lower: a 16-fold reduction did not lower cadence or the ~172 quads / ~93–96 ms software-quad work per frame. The visible Stage and surrounding UI are still composed at the same CSS/window dimensions, so this does not rule out all pixel-dependent work elsewhere.
3. **Independent rAF throttling or a long physical-present wait** rank lower but are not absolutely excluded: paused rAF is ~15.6 ms, the GPU draw interval matches active rAF, and swap/presentation feedback is short. Actual OS scanout and a per-frame scheduler dependency chain are unmeasured.

Virtual-display contribution is **supported as an environment association** (AspDod/AspIdd plus WARP, software compositor, software quad cost), **not proven as a unique causal defect**. A hardware-accelerated Windows comparison is the next discriminating experiment. No production Preview quality, Position semantics, renderer ownership, or readiness contract was changed. The diagnostic helper defaults to pixel ratio 1 without an explicit external probe; no user-facing profiler or GPU launch flag was added.

## Validation and handoff

Diagnostic helpers retained: optional Scene A graphics/trace mode in `scripts/diagnose-issue629.cjs`, trace analyzer in `scripts/analyze-issue631-trace.cjs`, and externally gated scene pixel-ratio probe. Raw synthetic projects, profiles, status and traces remain under `D:\PandaStage-Acceptance\issue631-*`, outside the repository. The synthetic project never writes an existing user project.

Targeted checks and normal automatic CI status are recorded in the PR handoff comment after commit. No manual Full CI, `verify:project`, historical sweeps, production GPU flags, quality reduction, or composite-cache fix were performed. Human physical-display comparison remains unverified; PR #628 stays Draft and Issue #631 remains open for owner acceptance.
