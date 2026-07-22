# Panda Stage（熊猫片场）

Panda Stage 是一款面向个人创作者的 Windows 桌面纸片人动画工具。项目计划让用户通过透明角色图片、背景、对白、音频和简单动作，制作并导出短动画。

当前分支已完成 **Day 08：单 WAV 延迟与 AAC 合成探针**。Main Process 可将 Day 07 的静音 H.264 视频与仓库自制 WAV 按整数 `startMs` 合成为 H.264 + AAC MP4，并用 ffprobe、`silencedetect` 和 Chromium 完整播放验证双流、声音起点与结尾；仍不包含多轨混音、正式导出 UI 或安装包 sidecar。

## 技术栈

- Electron
- React
- TypeScript
- Vite
- Konva / react-konva
- Vitest
- ESLint
- pnpm

## 领域数据基线

`src/shared/domain/` 提供：

- `ProjectSchema`、`AssetSchema`、`LayerSchema`、`ShotSchema`；
- 当前仅包含 move 的 `TimelineEventSchema`；
- 纯函数 `evaluateShotAtTime()`；
- 固定 `schemaVersion=1`、`1920×1080`、`24 FPS`；
- 整数毫秒时间字段；
- `anchor: "center"` 明确的图层中心坐标语义；
- 项目内相对素材路径和跨引用校验。

领域模型不依赖 React、DOM、Electron 或 Konva，可在 Node.js 环境直接执行单元测试。

## 环境要求

- Windows 10/11
- Node.js `>=22.12.0 <25`
- pnpm 10（版本由 `packageManager` 字段固定）

若本机尚未启用 pnpm，可运行：

```powershell
corepack enable
corepack install
```

## 本地启动

```powershell
pnpm install
pnpm dev
```

`pnpm dev` 会同时启动 Vite 开发服务器和 Electron。预览初始位于 0 秒停止态；点击播放后，三秒提示音、角色移动和字幕都读取 AudioContext 时间。暂停会冻结画面并释放当前音源，停止和重播会恢复 0 秒状态。点击“测试安全 IPC”返回 `pong` 表示 IPC 正常。

## 质量检查

```powershell
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm verify:day03
pnpm verify:day04
pnpm verify:day05
pnpm verify:day06
pnpm verify:day07
pnpm verify:day08
```

生产构建输出：

- Renderer：`dist/renderer/`
- Electron Main / Preload：`dist-electron/`

## 目录结构

```text
src/
├── main/       # Electron Main Process、IPC handler 与窗口管理
├── preload/    # 主窗口和隐藏窗口的白名单桥
├── export-renderer/ # 隐藏导出 Renderer 入口
├── renderer/   # 主窗口 React Renderer 与共享舞台
└── shared/     # 领域模型、IPC 数据合同和共享舞台模型
```

## 共享舞台架构

- `src/shared/probe/` 定义经过 Schema 校验的固定探针项目；
- `evaluateShotAtTime()` 是唯一的移动坐标求值入口；
- `src/shared/stage/` 将求值快照转换成渲染模型，并对缺失素材返回可读错误；
- `CanvasStage` 只负责等比显示，Konva 画布始终保持 1920×1080 逻辑坐标；
- `StageRenderer` 只消费已求值图层，不自行计算时间轴或动作；
- 主窗口 `StagePreview` 和隐藏窗口 `ExportRendererApp` 直接复用同一个 `CanvasStage` 与 `StageRenderer`。

## 帧导出架构

- `ExportService` 在 Main Process 中创建唯一 Job，并按 `floor(frameIndex / 24 * 1000)` 调度帧；
- 隐藏 Renderer 在共享舞台真实绘制完成后，将 Canvas 编码为 PNG `Uint8Array` 回传；
- `FileSystemService` 只在 Main Process 中异步写入 `frame_000000.png` 形式的文件；
- `MAX_PENDING_FRAMES = 3` 限制待写队列，失败或取消会删除整个 Job 临时目录；
- Day 09 由每个 Job 唯一的 `AbortController` 统一停止隐藏渲染、阻止新写入、等待在途写入收敛，并终止该 Job 当前持有的 FFmpeg 子进程；
- 临时目录在 Windows 文件占用时最多重试 3 次、每次间隔 75ms；失败会返回包含 Job ID 和处理建议的错误，不会静默忽略；
- 3 秒和 5 秒探针分别产生 72 帧与 120 帧，真实验证结果见 [Day 06 回执](./docs/test-receipts/DAY-06.md)。

## 视频编码架构

- `FFmpegAdapter` 只在 Main Process 使用 `spawn` 参数数组，不经过 shell；
- 开发期通过 `PANDA_STAGE_FFMPEG_PATH` 和 `PANDA_STAGE_FFPROBE_PATH` 配置工具；
- 编码前检查版本、`libx264`、连续帧和输出目录，编码后以 ffprobe 验证媒体流；
- 单 WAV 合成先读取并校验声道数，再为每个声道重复数据中的整数 `startMs` 构造 `adelay`；视频流直接复制、音频编码为 AAC，不拉伸音频；
- 完整导出只接受大小写不敏感的 `.mp4`；正式目标存在检查在渲染前完成，AAC 先写入同目录 Job staging，probe 成功且未取消后才以 rename 提交正式文件；
- 进入最终 `committing` point-of-no-return 后不再接受取消，避免返回 cancelled 但磁盘已提交新文件；
- 三次真实合成的声音起点均为 0.400646 秒，完整音频把容器时长延长到 3.4 秒；
- 用户错误与技术 diagnostics 分离，支持 AbortSignal 取消；
- 完整探针已在中文、空格和 emoji 项目/输出路径下验证，连续 5 次取消后可立即重新导出；
- 配置、来源和许可证见 [FFmpeg 文档](./docs/ffmpeg.md)，真实结果见 [Day 07 回执](./docs/test-receipts/DAY-07.md)、[Day 08 回执](./docs/test-receipts/DAY-08.md)与 [Day 09 回执](./docs/test-receipts/DAY-09.md)。

## 预览时钟架构

- `PreviewPlaybackEngine` 管理播放状态和唯一活动音源；
- `WebAudioRuntime` 解码 WAV，并以 `AudioContext.currentTime` 作为主时钟；
- `usePreviewController` 只用 `requestAnimationFrame` 采样音频时钟，不使用视觉帧时间累计；
- `evaluateShotAtTime()` 和 `evaluateSubtitleAtTime()` 消费同一个整数毫秒时间；
- 暂停、停止、重播和卸载都会停止并断开旧 `AudioBufferSourceNode`。

## IPC 架构

- 所有通道名集中定义在 `src/shared/ipc/channels.ts`；
- 请求和响应均由 `src/shared/ipc/contracts.ts` 中的严格 Zod Schema 校验；
- 主窗口暴露白名单化的 ping、完整探针 start/cancel 和只读 Job 状态订阅；
- 隐藏窗口只暴露 ready、加载探针、逐帧请求、逐帧结果和按 Job ID 取消 API；
- Main Process 校验消息来源窗口，并在退出前注销 handler、关闭隐藏窗口；
- 完整通道与状态约束见 [IPC 协议](./docs/ipc.md)。
- 两个 Preload 均构建为独立的沙箱兼容 bundle，不向 Renderer 暴露 Node.js。

## 安全基线

Electron 窗口固定使用：

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`

Renderer 不直接访问 Node.js、文件系统或子进程。后续跨进程能力必须通过受控 Preload API 和经过运行时校验的 IPC 实现。

实施与验证记录：

- [Day 03：安全 IPC](./docs/day-03-results.md)
- [Day 04：共享舞台渲染](./docs/day-04-results.md)
- [Day 05：AudioContext 音画同步预览](./docs/day-05-results.md)
- [Day 06：隐藏窗口逐帧捕获](./docs/test-receipts/DAY-06.md)
- [Day 07：静音 H.264 MP4 编码](./docs/test-receipts/DAY-07.md)
- [Day 08：单 WAV 延迟与 AAC 合成](./docs/test-receipts/DAY-08.md)

## 开发计划

- [ROADMAP.md](./ROADMAP.md)：产品范围、架构原则和里程碑
- [DAILY_PLAN.md](./DAILY_PLAN.md)：45 个开发日计划
- [agent task](./agent%20task/README.md)：逐日 Agent 工单

GitHub：<https://github.com/Cognitive-Architect/panda-stage>
