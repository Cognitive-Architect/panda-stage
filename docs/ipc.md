# Panda Stage IPC 协议

## 信任边界

所有通道集中在 `src/shared/ipc/channels.ts`，所有跨进程 payload 使用严格 Zod Schema。Main Process 对每次消息核对发送者的 `webContents.id`：主窗口只能调用主窗口 API，隐藏 Renderer 只能回传本窗口的加载和帧结果。Preload 只暴露白名单函数，不提供 `fs`、`path` 或 `child_process`。

## 主窗口导出 API

| 通道 | 方向 | 作用 |
|---|---|---|
| `export:start-probe` | Main Renderer → Main | 提交项目目录、WAV、MP4 输出路径及固定探针参数；立即返回 Job ID |
| `export:cancel-job` | Main Renderer → Main | 携带 Job ID，只取消当前匹配 Job；返回是否接受及当前状态 |
| `export:job-update` | Main → Main Renderer | 推送状态、阶段、帧进度和用户可读错误 |

主窗口通过 `window.pandaStage.export.startProbe()`、`cancel()` 和 `onUpdate()` 使用这些通道。开始请求不暴露任意命令；路径在 Main 中通过 Node 路径 API 处理。第二个并发 Job 会被拒绝，并返回当前 Job ID。

## 隐藏 Renderer API

| 通道 | 方向 | 作用 |
|---|---|---|
| `export:load-probe` / `export:probe-loaded` | 双向 | 加载并确认唯一 Job |
| `export:render-frame` / `export:frame-ready` | 双向 | 以 Job ID、帧号和整数毫秒关联单帧 |
| `export:frame-failed` | Hidden → Main | 返回同一帧的可读失败原因 |
| `export:cancel-render` | Main → Hidden | 清空匹配 Job 的待加载/活动帧，抑制迟到结果 |

取消不是 Renderer 自行决定的第二套 token。唯一事实源是 Main 中该 Job 的 `AbortController`；隐藏取消消息只是同一取消动作在 Renderer 边界的传播。Main 同时拒绝 pending promise，使调度循环立刻离开等待。

## 状态合同

Job 状态为 `running → cancelling → cancelled`，或从 `running` 进入 `completed/failed`。阶段为 `preparing`、`rendering`、`writing`、`encoding`、`muxing`、`cleaning`、`finished`。清理结束前不会发布最终 `cancelled`；若清理失败，最终状态为 `failed`，错误包含 Job ID、占用原因和重试建议。
