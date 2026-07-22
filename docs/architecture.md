# Panda Stage 架构说明

## 进程边界

```text
Main Process
  ├─ ExportService：Job 状态、24 FPS 调度、背压与统一清理
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

成功后目录保留给调用方消费，并可通过 `cleanupJob()` 显式释放。渲染失败、写盘失败或取消时，服务等待已发出的写任务收敛，再删除整个 Job 目录并返回包含 Job ID 的错误。服务同时拒绝第二个并发导出 Job。

## 视频编码边界

`FFmpegAdapter` 只在 Main Process 使用 `spawn(executable, args)` 启动外部进程，固定 `shell:false`。它在编码前验证输入、输出目录、FFmpeg 版本及所需编码器，编码后通过 ffprobe 验证真实媒体流。Renderer 和 Preload 不暴露任何子进程能力。

Day 07 输出固定为静音 H.264/yuv420p MP4；Day 08 在同一 Adapter 内先用 ffprobe 验证单条 WAV 的声道数，再将整数 `startMs` 重复为逐声道 `adelay` 列表，视频流保持 H.264，音频编码为 AAC。当前不实现多轨 `amix`、sidecar 打包或正式导出 UI。外部工具路径来自显式配置或开发期环境变量，仓库不包含二进制。

## 当前性能观察

真实 72 帧探针中，1920×1080 Canvas PNG 捕获约 143 秒，FFmpeg H.264 编码约 2.0 秒。当前主要瓶颈仍是帧捕获而非视频编码，后续优化必须保持共享 Renderer 和确定性时间轴不变。
