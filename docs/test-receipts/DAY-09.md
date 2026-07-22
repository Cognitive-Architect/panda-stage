# Day 09 测试回执：Unicode 路径、统一取消与资源清理

## 提交坐标

- 工单：B-09/45
- 分支：`spike/day-09-path-cancel-cleanup`
- 基线 SHA：`1d6a0ac329c42f49b08d4cdb8e21d0ba48083e0d`
- 结果 SHA：本回执所在提交（最终完整 SHA 见交付报告）
- 日期：2026-07-22（Windows，Asia/Shanghai）

## 实现结果

- `ExportService` 为每个 Job 创建唯一 `AbortController`，并统一驱动隐藏渲染、写入背压、H.264 编码、AAC 合成和 ffprobe；状态包含 `cancelling/cancelled` 及各流水线阶段。
- 隐藏 Renderer 收到匹配 Job 的取消消息后清空当前请求，并抑制已取消 Job 的迟到 PNG；完整 Job 结束后释放隐藏窗口。
- 写队列取消后停止新增任务，等待最多 3 个在途写入释放，再进入清理。
- `NodeProcessRunner` 记录真实 child 句柄；AbortSignal 只终止绑定该 signal 的当前子进程，不扫描进程名、不使用 shell 或系统级全局终止。
- `FileSystemService` 使用 Node 路径 API，并在 Windows 占用错误时最多重试 3 次、间隔 75ms；重复清理安全，最终失败会保留 Job ID、原因和下一步建议。
- Main UI 新增完整探针路径输入、开始/取消按钮和 Job 状态；IPC 使用严格 Schema 与发送窗口校验。
- pre-PR 修复基线：`05343ce26639f93660ad2a75625c53f1b16af07f`。完整导出新增同目录 Job staging：mux/probe 均不接触正式路径，probe 成功后才进入不可取消的 `committing` rename。
- `outputPath` 在创建 Job 前按大小写不敏感规则限制为 `.mp4`；overwrite=false 且目标存在时，在隐藏窗口、帧目录和媒体进程之前拒绝。

## 真实 Windows 路径

公开证据对用户名和随机运行目录脱敏，但保留了实际路径结构：

```text
<os-temp>\panda stage day 09 中文 空格 🐼\<run-id>\项目 源文件 🎬\探针 项目 🐼.json
<os-temp>\panda stage day 09 中文 空格 🐼\<run-id>\输出 成片 🐼\恢复 导出成功 🐼.mp4
```

项目 JSON 以 UTF-8 写入并读回 `熊猫片场 Day 09`；最终 MP4 在同一 Unicode/空格/emoji 树中生成并通过 ffprobe 与 Chromium 播放。

## 连续 5 次开始→取消

| 次数 | 阶段 | 耗时 | 被终止媒体 PID | 进程/窗口/帧目录/staging/写入残留 | 无关 sentinel |
|---:|---|---:|---:|---|---|
| 1 | rendering | 369ms | — | 0 / 0 / 0 / 0 / 0 | 存活 |
| 2 | rendering | 312ms | — | 0 / 0 / 0 / 0 / 0 | 存活 |
| 3 | writing | 10ms | — | 0 / 0 / 0 / 0 / 0 | 存活 |
| 4 | encoding | 257ms | 9468 | 0 / 0 / 0 / 0 / 0 | 存活 |
| 5 | muxing | 2543ms | 9312 | 0 / 0 / 0 / 0 / 0 | 存活 |

每次错误均包含对应 Job ID，以及“已完成资源清理；可以立即重新导出”的用户操作建议。编码和 mux 取消使用真实 FFmpeg 进程；独立 sentinel 在全部取消期间保持运行，证明未影响无关进程。

第 5 轮在正式路径预写旧内容后，于真实 mux 进程 PID 9312 运行时取消。取消前后正式文件 SHA-256 均为 `658a3d13d3e20eaef672cf51b6a6ca8fa39f4e73c7351f04e092054e7d48dcf8`，Job staging 与 Adapter 内层 staging 均为 0；证明取消没有替换用户旧文件。

## 取消后恢复导出

- 真实共享 Canvas 捕获：72 帧，143053ms；完整流水线 146152ms。
- 输出：187040 bytes，SHA-256 `41ae598f10b9b83f8f2f9fa60075a640bf196790cefa459c73407e9ec0cda400`。
- 视频：H.264、yuv420p、1920×1080、24 FPS、72 帧、3.0s。
- 音频：AAC、48kHz、mono、3.4s；首个非静音点 0.400646s；容器 3.4s。
- Chromium：1920×1080、非静音、时长 3.4s，可解码并截图。
- UI：收到 `cancelled/finished` 后取消按钮禁用、路径完整时开始按钮重新启用。
- 完成后：活动 Job 0、媒体进程 0、隐藏窗口 0、帧目录 0、最终输出 staging 0、在途写入 0。

结构化证据位于 `docs/evidence/day-09/results.json`，媒体与截图位于同目录。

## 刀刃表收卷

| ID | 结果 | 权威证据 |
|---|---|---|
| FUNC-001 / FUNC-002 | 通过 | Unicode 项目读回、MP4 + ffprobe |
| FUNC-003 | 通过 | 第 1、2 次真实隐藏渲染取消 |
| FUNC-004 | 通过 | 第 4 次编码与第 5 次 mux 的真实 FFmpeg PID 取消 |
| CONST-001 | 通过 | 每 Job 唯一 AbortController，单元测试验证 encode/mux signal 同一对象 |
| CONST-002 | 通过 | 重复取消、重复目录清理单元测试 |
| CONST-003 | 通过 | 精确 child 句柄；sentinel 全程存活 |
| CONST-004 | 通过 | `spawn(executable, args)`、`shell:false` 静态审查 |
| NEG-001 / NEG-002 / NEG-003 | 通过 | 五轮进程、窗口、帧目录、最终 staging、写入计数均为 0 |
| NEG-004 | 通过 | 受控清理失败测试包含 Job ID、占用原因和下一步 |
| UX-001 / UX-002 | 通过 | UI 状态验证；取消错误含 Job ID 与恢复建议 |
| E2E-001 | 通过 | 真实 mux 取消保护旧文件后，立即完成 72 帧带声导出 |
| HIGH-001 | 通过 | 无 `taskkill`/进程名终止；sentinel 存活；最终全资源为 0 |

## 质量门禁

- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test:unit`：13 个测试文件、94 项测试通过。
- `pnpm build`：通过；仅保留既有 Vite 大 chunk 警告。
- `pnpm verify:day09`：通过；包含构建、5 次取消、真实 mux 旧文件保护、staging 清理、恢复导出、ffprobe、Chromium 和资源计数。
- `pnpm exec prettier --check .`：N/A；仓库未安装 Prettier、未配置 Prettier 脚本或配置文件，格式由 ESLint 与 TypeScript 门禁约束。

## 关键决策与债务

- DECISION-001：唯一取消源是 Main 的 Job 级 `AbortController`；IPC 只传播该动作，不创建第二套状态。
- DECISION-002：Windows 使用 Node 当前 child 句柄的 `kill('SIGTERM')`；不引入 `taskkill`。真实 PID 已终止，无平台规避。
- DECISION-003：目录清理依赖 `fs.rm` 的 3 次有限重试、75ms 间隔；清理失败升级为 `failed`，不静默吞掉。
- DECISION-004：正式输出只由通过 probe 的同目录 Job staging rename 提交；`committing` 阶段是明确 point-of-no-return，取消返回 false。
- DEBT-PLATFORM-B09-001：无。
- DEBT-TEST-B09-001：无。

不在范围：暂停/恢复、多 Job 队列、并发导出、多轨音频。
