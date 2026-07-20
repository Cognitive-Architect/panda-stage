# Panda Stage 架构说明

## 进程边界

```text
Main Process
  ├─ ExportService：Job 状态、24 FPS 调度、背压与统一清理
  ├─ FileSystemService：独立临时目录和异步 PNG 写盘
  └─ HiddenWindowManager：隐藏窗口生命周期与请求/响应关联
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

## 当前范围

Day 06 只建立真实 PNG 帧序列边界，不包括 FFmpeg、视频编码、音频 mux 或正式导出 UI。真实验证表明 1920×1080 Canvas PNG 编码吞吐仍偏慢，后续编码链路应以现有 `elapsedMs`、队列峰值和内存指标为基线优化。
