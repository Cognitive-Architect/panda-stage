# Panda Stage 架构说明

## 进程边界

```text
Main Process
  ├─ ExportService：Job 状态、唯一 AbortController、24 FPS 调度、背压与统一清理
  ├─ FileSystemService：独立临时目录和异步 PNG 写盘
  ├─ HiddenWindowManager：隐藏窗口生命周期与请求/响应关联
  └─ FFmpegAdapter：版本/编码器检查、H.264 编码、AAC 合成与 ffprobe
          │ 经过白名单 Preload + Zod 校验的 IPC
          ▼
Hidden Export Renderer（sandbox）
  └─ CanvasStage → StageRenderer → Konva Canvas → PNG Uint8Array
```

主窗口和隐藏导出窗口都复用 `CanvasStage`、`StageRenderer`、领域 evaluator、探针项目及字幕 evaluator。Renderer 不访问 `fs`、`path` 或子进程；只有 Main Process 的 `FileSystemService` 写盘。

## 确定性帧协议

- 固定 24 FPS，帧数为 `ceil(durationMs * 24 / 1000)`；
- 每帧时间为 `floor(frameIndex / 24 * 1000)`，使用整数毫秒；
- 文件名固定为 `frame_000000.png` 形式，宽度为 6 位；
- 每个 Job 使用 UUID，并写入独立的临时目录；
- Main 逐帧发出请求；Renderer 在共享舞台完成真实绘制后的下一次 animation frame 才编码 Canvas；
- Renderer 回传 PNG `Uint8Array`，不生成全量 DataURL，也不直接落盘。

IPC 响应同时校验发送窗口、Job ID、帧序号与时间，迟到或错配响应不会被另一个 Job 接收。帧请求使用 15 秒 watchdog；watchdog 是故障边界，不作为渲染完成依据。

## 背压与清理

`MAX_PENDING_FRAMES = 3` 限制尚未完成的异步写盘任务。渲染保持逐帧请求，写盘可与后续渲染重叠；队列达到上限时，调度器先等待任一写任务完成，不会把整个序列的 PNG Buffer 堆入内存。

帧探针成功后目录保留给调用方消费，并可通过 `cleanupJob()` 显式释放；完整探针在编码和合成结束后自动删除帧目录。渲染失败、写盘失败或取消时，服务停止接收新帧、等待已发出的写任务收敛，再删除整个 Job 目录并返回包含 Job ID 与下一步操作的错误。Windows 目录删除使用 3 次有限重试、间隔 75ms；重复清理不存在的目录是安全的。服务同时拒绝第二个并发导出 Job。

## Day 09 统一取消状态机

每个完整导出 Job 只创建一个 `AbortController`，状态从 `running` 进入 `cancelling`，最终只能落到 `cancelled`、`failed` 或 `completed`。同一 signal 传入视频编码、音频探测、音频合成和最终 ffprobe；`NodeProcessRunner` 只对绑定该 signal 的子进程句柄调用 `child.kill('SIGTERM')`，不使用 `taskkill`、进程名扫描或系统级终止。

正式输出采用第二层 Job staging：Schema 在创建 Job 前拒绝非 `.mp4` 路径，文件系统在准备隐藏窗口和帧目录前检查正式目标与 overwrite 规则。AAC mux 写入正式输出同目录、带 Job ID 和 UUID 的 `.mp4` staging，ffprobe 也只读取该 staging。probe 成功后先清理帧目录、再次检查取消，再同步进入 `committing` point-of-no-return；此后 `cancelJob()` 返回 `false`，由同目录 rename 提交正式输出。mux、probe、取消或提交失败只清理本轮 staging，不预删或提前替换已有正式文件。

隐藏 Renderer 收到 `export:cancel-render` 后清空当前帧和待加载状态；已开始的 `canvas.toBlob()` 即使迟到完成，也不会回传已取消 Job。Main 的写队列不再接收新帧，并在 `finally` 清理前等待最多 3 个在途写入完成。完整 Job 无论成功、失败或取消都会释放隐藏窗口；取消后 Main UI 从 Job update 收到 `cancelled/finished`，重新启用开始按钮。

完整探针依次执行 `preparing → rendering/writing → encoding → muxing/probe → cleaning → committing → finished`。项目目录先在 Main Process 以 Node 路径 API 验证可读，音频和输出路径始终作为独立参数传递。真实 Windows 验证覆盖中文、空格和 emoji 路径，并证明真实 mux 取消后旧正式文件哈希不变、staging 为 0，详见 Day 09 回执。

## 视频编码边界

`FFmpegAdapter` 只在 Main Process 使用 `spawn(executable, args)` 启动外部进程，固定 `shell:false`。它在编码前验证输入、输出目录、FFmpeg 版本及所需编码器，编码后通过 ffprobe 验证真实媒体流。Renderer 和 Preload 不暴露任何子进程能力。

Day 07 输出固定为静音 H.264/yuv420p MP4；Day 08 在同一 Adapter 内先用 ffprobe 验证单条 WAV 的声道数，再将整数 `startMs` 重复为逐声道 `adelay` 列表，视频流保持 H.264，音频编码为 AAC。当前不实现多轨 `amix`、sidecar 打包或正式导出 UI。外部工具路径来自显式配置或开发期环境变量，仓库不包含二进制。

## 当前性能观察

真实 72 帧探针中，1920×1080 Canvas PNG 捕获约 143 秒，FFmpeg H.264 编码约 2.0 秒。当前主要瓶颈仍是帧捕获而非视频编码，后续优化必须保持共享 Renderer 和确定性时间轴不变。
