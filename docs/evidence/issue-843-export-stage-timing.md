# Issue #843 — 正式导出帧管线分段计时

**状态：`RESEARCH_PARTIAL`。** 唯一一次 4.5 秒 / 108 帧正式导出成功，主问题已定位到隐藏舞台的 rAF 等待；`writeFrame` 与后续帧渲染的实际重叠量没有直接记录，因此保留为 `NOT_MEASURED`。本报告不证明后台节流的因果关系，也不授权优化施工。

## 执行回执

- Owner 在会话中明确授权诊断施工和最多一次正式采样。
- 测量源码 SHA：`c6c356f660001af694bb706cc7553974ff8d1cfc`，与采样时 PR #817 HEAD 相同。
- 诊断工具提交：[b9a2e9ba8d177fdadc21ef2b7977408f998b1a2e](https://github.com/Cognitive-Architect/panda-stage/commit/b9a2e9ba8d177fdadc21ef2b7977408f998b1a2e)。运行器和片段文件 blob SHA 分别为 `6dd6dd168d50094a6c8f884e9a9b74970b939b88`、`6a92422f09a13af4fe582cedf658e315dccfaee4`。
- 预检：`node scripts/issue843-perf-diagnostic.cjs --preflight` → `PREFLIGHT_PASS`。动态 runner 语法、20 个计时/止损钩子、10 个源码插桩钩子、临时 TypeScript 转译、Electron / FFmpeg / FFprobe 文件可用性均通过；未启动 Electron、Job 或创建验收目录。
- 构建：`node scripts/issue843-perf-diagnostic.cjs --prepare-build` → `DIAGNOSTIC_BUILD_PASS`。此命令内部执行 `pnpm build`（含 `pnpm typecheck`），确认 Main 和 Renderer 构建产物包含插桩；4 个临时源码文件均逐字节还原。未运行测试、Full CI 或全量 verifier。
- 唯一正式命令：`node scripts/issue843-perf-diagnostic.cjs`。Launcher `COMPLETED`，退出码 0，未触发 210 秒 Job abort、295 秒内部 STOP 或 300 秒进程树硬止损。
- Run ID：`run-2026-10-24T08-19-51-171Z-15824`；Job ID：`0dbf332b-c8be-4118-a058-a504ef3e7c6c`；验收根目录：`D:\PandaStage-Acceptance\issue843-export-performance-2026-10-24T08-19-50-770Z-11544`。完整本机回执保存在该目录下的 `run-...\evidence\issue843-export-performance-receipt.json`；MP4 和生成工程未提交或上传。
- 可审阅逐帧指标：[紧凑 JSON](issue-843-export-stage-timing.json)。诊断器：[runner](../../scripts/issue843-perf-diagnostic.cjs)、[runtime fragments](../../scripts/issue843-perf-runtime.fragments)。

## 样本和环境

采样使用生成的 Issue #827 sample 1，3 个 Shot 各 1,500 ms，含 4 个音频事件；总长 4,500 ms、1920×1080、24 fps、108 帧、10 个素材。10 个输入素材的 SHA256 与 #838 样本完全一致。当前 `project.json` SHA256 为 `ab153ad57a0791b02df8d31852b2a9c3f2979f4287e034410776cf61ee223cc7`，#838 的为 `b054393641c22a4ad057c8765f3cab8138dc32c0c842a6d09b6e6064ab0524d8`，因此两次是可比的生成样本，不是同一个工程字节副本。两次 MP4 SHA256 恰好相同：`e136f5ff31b8286c91dc9dc3ae49fb9517327f9620e11a6bd256f0c066f686e1`。

环境为 Windows Server 2022 build `20348`、Electron `43.1.1`、Chromium `150.0.7871.114`、Node `24.18.0`、Intel Xeon Platinum / 8 个逻辑处理器、约 16.6 GB RAM。GPU 状态未知，系统只报告 AspDod/AspIdd 虚拟显示适配器。采样开始时另有一个 #839 verifier 和一个 Panda Stage 开发应用在运行；本次没有停止或控制它们，故将并行进程记为环境限制。

隐藏窗口观测：`BrowserWindow.isVisible() = false`，`webContents.getBackgroundThrottling() = true`；当前 `HiddenWindowManager` 没有显式传入 `backgroundThrottling` 选项。Renderer 的 `document.visibilityState = visible` 且 `document.hidden = false`。这些值均按实际观测记录，没有切换可见性或节流设置。

## 计时结果

所有逐帧时长均有 `jobId + frameIndex` 键，108 个 Main 请求、Renderer 记录、`writeFrame` 和写槽等待一一对应；无重号、漏号或额外帧。PNG 字节数在 Renderer、Main 写入记录和 `renderFrames` 汇总间一致。统计的 p95 只描述这一次运行。

| 子段 | 帧数 | 总和 | 均值 | 中位数 | p95 | 最大值 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 请求到 Stage ready | 108 | 0.106 s | 0.981 ms | 0.9 ms | 1.6 ms | 4.3 ms |
| rAF 安排到回调 | 108 | 105.840 s | 980.004 ms | 980 ms | 981.4 ms | 988.2 ms |
| Stage ready + rAF | 108 | 105.946 s | 980.985 ms | 980.9 ms | 982.4 ms | 989 ms |
| Canvas `toBlob` 回调 | 108 | 4.865 s | 45.048 ms | 17.4 ms | 18.5 ms | 1,010.8 ms |
| `blob.arrayBuffer()` | 108 | 0.0585 s | 0.542 ms | 0.5 ms | 1.2 ms | 2.2 ms |
| Main 请求到 Renderer 回复 | 108 | 110.989 s | 1,027.675 ms | 999.749 ms | 1,005.225 ms | 2,011.254 ms |
| IPC/派发残差估计 | 108 | 0.105 s | 0.976 ms | 0.743 ms | 0.937 ms | 25.254 ms |
| Main `writeFrame` | 108 | 0.0785 s | 0.727 ms | 0.688 ms | 0.89 ms | 1.808 ms |
| 写槽等待 | 108 | 0.00050 s | 0.005 ms | 0.004 ms | 0.006 ms | 0.045 ms |

`T_renderFrames` wall time 为 **111.829 s**，108 帧平均约 **1.036 s/帧**。rAF 等待和 `T_renderFrames` 的比例约 94.65%；Stage ready 加 rAF 约占 94.74%。这是分段和总 wall 的对照比例；Main 往返包含 Renderer 的 ready、rAF、PNG 阶段，不能把嵌套段再加到 Main 往返或总 wall 上。

首帧及每个 Shot 的首帧需单独看：3 帧 `toBlob` 回调分别约 **1,010.8 / 1,010.7 / 1,010.0 ms**；其余 105 帧 `toBlob` 中位数 17.4 ms、p95 18.0 ms、最大 23.3 ms。三个特殊帧的 Main 往返约 1.99–2.01 s，rAF 等待仍约 973–978 ms。该观察提示 Shot 首帧存在另一处约 1 秒的 PNG 回调长尾，但它不是本样本的最大累计项。

计时解释和未知项：

- `T_stage_ready` 是 Renderer 收到请求到 `StageRenderer` ready 的本进程时长；rAF 是同一 Renderer `performance.now()` 下的 schedule→callback 时长。
- `T_main_request_to_reply` 在 Main 单调时钟内计时；Renderer 局部时长从请求回调收到到调用 `frameReady` 前计时。残差是两段**持续时间**之差，代表 IPC / 派发 / 序列化 / 校验 / 排队的合并估计，**不是纯 IPC 拷贝耗时**。没有跨进程相减绝对时间戳。
- `toBlob` 回调耗时包含浏览器调度和 PNG 编码，不等于单独的 Canvas 绘制耗时；纯绘制时间为 `NOT_MEASURED`。
- `writeFrame` 的累计和 union 都是 78.506 ms，写入调用之间的重叠为 0，`peakConcurrentWrites=1`、`peakPendingWrites=1`。写操作与后续帧渲染之间的实际时间重叠没有共同区间记录，为 `NOT_MEASURED`；不能将写盘总和作为串行开销加到 `T_renderFrames`。
- `T_renderFrames` 减去 108 个 Main 往返时长约为 0.840 s，是同一 Main 时钟下的未分配余量；Project 载入/派发、循环开销及末尾等待没有再分别拆分，不能把余量归给某一个组件。

## 结论、完整性与范围

**后台节流假设：`SUPPORTED`（相关性支持，因果未证明）。** 108 帧 rAF 的中位数约 980 ms、p95 981.4 ms，且窗口不可见、Electron getter 报告 background throttling 为 true；这与约 1 秒/帧的帧管线表现相符。文档可见状态仍是 `visible`，并且没有执行单变量开关对照，因此不能写成“节流导致了该耗时”。唯一建议的后续方向是：在另行授权的隔离样本中，只改变 `backgroundThrottling` 做对照并保持其他条件不变；本票不改开关、不创建优化实施票。

完整性检查通过：MP4 为 H.264 / yuv420p、1920×1080、24 fps、108 帧、4.5 秒，另有 1 条 AAC / 48 kHz / 4.5 秒音轨；`ffprobeValid=true`。输出最初不存在，Project 文件与 10 个素材导出前后未变，revision、dirty、undo/redo 状态未变。Job 与外部进程计数为 0，帧任务目录、输出临时文件和准备快照为空，staging 已清理。

取消分支与已有目标 no-clobber 拒绝分支按 Issue 范围没有重跑；本次只验证新目标原先不存在并成功提交。没有进行人工视听验收，也没有据此宣称它通过。PR #817 仍为 DRAFT/UNMERGED；#838、#836 和 DL-07 未改动。

因此状态为 **`RESEARCH_PARTIAL`**：Stage/rAF、PNG、Main 往返、残差、写盘时长和队列均有完整 108 帧数据，输出完整性通过；写盘与后续 Renderer 帧请求的实际重叠仍未测。`OWNER_GO_TO_OPTIMIZE=NOT_GRANTED`。
