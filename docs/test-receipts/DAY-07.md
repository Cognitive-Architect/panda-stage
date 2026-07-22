# Day 07 测试回执

## 工单坐标

- 工单：B-07/45 — FFmpegAdapter + 静音 H.264 MP4 编码
- 基线提交：`78a4d482581e1d95147398a57681743c5df1d48d`
- 实施分支：`spike/day-07-ffmpeg-video`
- 日期：2026-07-20

专项 `DAY-07-AGENT-TASK.md` 将唯一目标限定为静音 MP4，并明确禁止音频合成，因此它覆盖 `DAILY_PLAN.md` Day 7 中较宽的音频描述。本轮没有实现 AAC、音频 mux、sidecar 打包或正式 UI。

## 实现结果

- Main-only `FFmpegAdapter`，使用可执行路径和参数数组调用 `spawn`；
- 开发期显式路径、环境变量和 PATH 发现策略；
- FFmpeg 版本与 `libx264` 能力检测；
- 连续 PNG 序列和输出目录预检；
- 固定 24 FPS、H.264、yuv420p、静音 MP4 编码；
- 退出码、signal、stdout、stderr 与 AbortSignal 取消处理；
- 简短中文用户错误与独立技术 diagnostics；
- ffprobe JSON 解析和 codec/pix_fmt/尺寸/FPS/帧数/时长/音轨严格断言；
- 可重复执行的真实 Electron 验证器。

## 真实媒体结果

`pnpm verify:day07` 在含空格的工具、帧目录和输出路径中完成了以下链路：

```text
隐藏 StageRenderer → 72 张真实 PNG → FFmpeg libx264 → MP4 → ffprobe → Chromium 播放
```

| 项目 | 真实结果 |
|---|---|
| 输入 | 72 帧，`frame_000000.png` → `frame_000071.png` |
| 帧渲染耗时 | 143,049 ms |
| 视频编码耗时 | 2,017 ms |
| 输出大小 | 119,597 bytes |
| SHA-256 | `9af20958e0753708cd6e739756700515d393a64ce82a975e113447d2efc67bef` |
| codec | H.264 (`h264`, High profile) |
| pixel format | `yuv420p` |
| 尺寸 | 1920×1080 |
| 帧率 | 24/1 FPS |
| 帧数 | 72 |
| 时长 | 3.000000 秒 |
| 音轨 | 无 |

Chromium 实际加载视频后报告 1920×1080、3 秒并成功播放/暂停。证据：

- [静音 MP4](../evidence/day-07/probe-silent.mp4)
- [播放中间画面](../evidence/day-07/probe-playback-midpoint.png)
- [ffprobe 验收字段与负面路径结果](../evidence/day-07/results.json)

## 真实执行参数

回执中的路径已脱敏，实际以每个参数独立传入：

```text
-y -hide_banner -loglevel info
-framerate 24 -start_number 0
-i <verification-root>\frame jobs\<job-id>\frame_%06d.png
-frames:v 72 -an -c:v libx264 -pix_fmt yuv420p -r 24
-movflags +faststart
<verification-root>\encoded output with spaces\panda stage silent probe.mp4
```

## 负面路径

- 不存在的 FFmpeg：`EXECUTABLE_NOT_FOUND`，提示配置开发环境路径；
- 缺少 `frame_000036.png`：`FRAME_SEQUENCE_INVALID`，编码前终止；
- 输出父路径是文件：`OUTPUT_NOT_WRITABLE`，编码前终止；
- mock 进程退出码 17：Promise reject，用户消息不包含技术 stderr，diagnostics 保留 stderr；
- AbortSignal + `SIGTERM`：映射为 `PROCESS_CANCELLED`；
- ffprobe 参数不匹配：映射为 `PROBE_MISMATCH`。

## 自动化质量闸门

- `pnpm typecheck`：通过；
- `pnpm lint`：通过；
- `pnpm test:unit`：11 个测试文件、54 项测试通过；
- `pnpm build`：通过；Vite 既有共享 chunk 大小警告仍为非阻断项；
- `pnpm verify:day07`：通过；
- `pnpm dev`：Vite、TypeScript watch、主窗口和隐藏窗口启动成功；24 秒烟测后精确结束本 worktree 进程，无残留；
- Prettier：N/A，仓库未安装 Prettier，也没有对应脚本；
- 静态架构检查：`spawn` 仅位于 Main Process；无 `exec`、`execSync`、`shell:true`；Renderer 无 `child_process`。

## 来源、债务与风险

- 实际临时开发工具来源与许可证见 [FFmpeg 开发期集成](../ffmpeg.md)；仓库未新增二进制；
- `DEBT-ENV-B07-001`：无 Gate 阻塞；但临时 FFmpeg 版本较旧，Day 08 sidecar 必须选择当前构建并重新做许可/打包验证；
- `DEBT-TEST-B07-001`：无，正常、路径空格、三条真实失败路径、异常退出、取消和媒体参数均有证据；
- 主要性能风险仍是 PNG 捕获约 143 秒，FFmpeg 编码仅约 2.0 秒；
- 回滚方式：`git revert <Day 07 最终提交 SHA>`。

## 2026-07-22 pre-PR 修复回执

- FFmpeg 编码进程非 0 退出或被 `AbortSignal` 取消后，会删除本次可能留下的 `outputPath` 半成品；成功输出保持不变；
- 半成品清理失败不会替换原始编码错误，附加错误保留在 `diagnostics.cleanupError`；
- `EncodePngSequenceRequestSchema` 仅接受 `.mp4` 输出路径，扩展名匹配忽略大小写；
- 新增测试覆盖失败清理、取消清理、成功保留、清理失败诊断、`output.mp4`、`output.MP4` 与 `output.mkv`。

验证结果：

- `pnpm typecheck`：通过；
- `pnpm lint`：通过；
- `pnpm test:unit`：11 个测试文件、58 项测试通过，其中 FFmpegAdapter 定向测试 14 项通过；
- `pnpm build`：通过；Vite 既有共享 chunk 大小警告仍为非阻断项；
- `pnpm verify:day03`：通过；隐藏窗口关闭后剩余窗口数为 0；
- `pnpm verify:day04`：通过；共享帧 SHA-256 匹配，逻辑尺寸 1920×1080；
- `pnpm verify:day05`：通过；预览播放、暂停、继续、重播与结束状态均符合预期；
- `$env:DAY06_FAILURE_ONLY='1'; pnpm verify:day06`：通过；模拟失败后的部分帧目录已清理；
- `pnpm verify:day07`：本次未重跑。修复未改变 FFmpeg 参数数组、编码参数或真实媒体链路，依任务说明沿用上方已有真实媒体证据。

## 2026-07-22 pre-PR Fix-01 修复回执

上一补丁直接清理正式 `outputPath`，在目标文件调用前已存在时存在误删风险。本轮已将该行为替换为同目录 UUID 临时 MP4 提交方案：

- FFmpeg 仅写临时 `.mp4`；成功且文件非空后才 rename 到正式路径；
- `overwrite=false` + 已有正式输出会在启动 FFmpeg 前明确拒绝，旧文件内容保持不变；
- 编码失败或取消只清理本轮临时文件，不触碰已有正式输出；
- `overwrite=true` 成功时替换正式文件；首次输出也能正常提交；
- 清理失败仍保留原始编码错误，并写入 `diagnostics.cleanupError`；
- 同目录 rename 的 Windows 文件占用、网络文件系统原子性和断电持久性限制已记录在 `docs/ffmpeg.md`。

验证结果：

- `pnpm typecheck`：通过；
- `pnpm lint`：通过；
- `pnpm test:unit`：11 个测试文件、61 项测试通过，其中 FFmpegAdapter 定向测试 17 项通过；
- `pnpm build`：通过；Vite 既有共享 chunk 大小警告仍为非阻断项；
- `pnpm verify:day03`：通过；隐藏窗口关闭后剩余窗口数为 0；
- `pnpm verify:day04`：通过；共享帧 SHA-256 匹配，逻辑尺寸 1920×1080；
- `pnpm verify:day05`：通过；预览播放、暂停、继续、重播与结束状态均符合预期；
- `$env:DAY06_FAILURE_ONLY='1'; pnpm verify:day06`：通过；模拟失败后的部分帧目录已清理；
- `pnpm verify:day07`：本轮未重跑。编码参数、ffprobe 和媒体内容链路未变，依任务说明沿用上方真实媒体证据。
