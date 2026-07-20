# Day 06 测试回执

## 工单坐标

- 工单：B-06/45 — 隐藏窗口逐帧捕获、背压与临时目录
- 基线提交：`b51dc9ed02a43dea7da523ed66cb436b7f669184`
- 实施分支：`spike/day-06-frame-capture`
- 日期：2026-07-20

Day 05 的专项工单只交付了 AudioContext 预览，未实现 `DAILY_PLAN.md` 旧条目所述的隐藏窗口指定帧协议。Day 06 先补齐该协议，再在其上实现 Job、逐帧 PNG 捕获、异步写盘、背压和清理，没有沿用固定延时伪装渲染完成。

## 已交付

- `ExportService`：唯一 Job ID、运行状态、24 FPS 帧调度、取消、失败归一化；
- `FileSystemService`：Job 隔离目录、`wx` 异步写入、连续文件名检查与目录清理；
- 隐藏导出 Renderer：复用 `CanvasStage` / `StageRenderer`，从真实 Konva Canvas 生成 PNG；
- Main ↔ Preload ↔ Renderer 的加载、逐帧成功和逐帧失败 IPC；
- `MAX_PENDING_FRAMES = 3` 的待写队列上限；
- 3 秒 72 帧、5 秒 120 帧、连续两次导出和受控写盘失败验证；
- 帧时间、背压、并发拒绝、渲染失败、写盘失败和取消清理单元测试。

不在范围：FFmpeg、视频编码、音频 mux、正式导出 UI。

## 真实 Electron 结果

执行 `pnpm verify:day06`，由隐藏沙箱窗口真实渲染并经 Main Process 写盘：

| Job | 帧数 | 首尾文件 | 总字节 | 耗时 | 待写峰值 |
|---|---:|---|---:|---:|---:|
| 第一次 3 秒 | 72 | `frame_000000.png` → `frame_000071.png` | 51,939,473 | 143,048 ms | 1 |
| 第二次 3 秒 | 72 | `frame_000000.png` → `frame_000071.png` | 51,939,473 | 143,985 ms | 1 |
| 5 秒 | 120 | `frame_000000.png` → `frame_000119.png` | 89,815,409 | 192,989 ms | 1 |

三组目录均无缺号、无重复。两次 3 秒结果的首、中、尾帧 SHA-256 完全一致，说明同一输入可复现。抽查文件均具有 PNG 签名 `89504e470d0a1a0a`，IHDR 尺寸均为 1920×1080。

| 首帧 | 中间帧 | 尾帧 |
|---|---|---|
| ![frame 0](../evidence/day-06/frame_000000.png) | ![frame 36](../evidence/day-06/frame_000036.png) | ![frame 71](../evidence/day-06/frame_000071.png) |

完整机器结果见 [results.json](../evidence/day-06/results.json)。

## 资源与负面路径

- 两次连续 3 秒导出结束时 heap delta 分别为 -1,063,364 和 -1,752,104 字节；RSS delta 分别为 +6,365,184 和 -10,678,272 字节，没有观察到连续线性增长；
- 实际待写峰值为 1，低于硬上限 3；单元测试使用慢写盘运行 72/120 帧，确认峰值始终不超过 3；
- 第 4 帧注入受控写盘失败，错误包含 Job ID 与 `simulated controlled write failure`，半成品 Job 目录已删除；
- 单元测试另以“缺失素材”错误注入第 4 帧渲染失败，并覆盖取消清理以及活动 Job 存在时拒绝第二次并发调用；
- 成功验证结束后，脚本清理了三个成功 Job 目录并关闭所有 BrowserWindow。

一次早期验证被命令执行器的 5 分钟外层限制强制终止，因进程未获得清理机会，留下 `C:\Users\admin\AppData\Local\Temp\1\panda-stage\day06-verification-3568-1784519050778`。这是外部强杀残留，不是 ExportService 可捕获的失败路径；环境策略拒绝本轮主动递归删除该目录，已如实记录。

## 质量闸门

- `pnpm typecheck`：通过；
- `pnpm lint`：通过；
- `pnpm test:unit`：9 个测试文件、43 项测试全部通过；
- `pnpm build`：通过；Vite 仍有既存共享 chunk 超过 500 kB 的非阻断警告；
- `pnpm verify:day06`：通过，真实导出 72 + 72 + 120 帧；
- Prettier：N/A，仓库未安装 Prettier，也没有对应脚本；
- Renderer 文件系统静态检查：未发现 `node:fs` / `fs` / `child_process` 引用；写盘只位于 Main Process。

## 验收映射与债务

FUNC 4/4、CONST 4/4、NEG 4/4、UX 2/2、E2E 1/1、High 1/1 均有代码、单测或真实运行证据。

- `DEBT-PERF-B06-001`：无 DataURL 或全量缓存债务；但真实 PNG 编码吞吐偏慢，3 秒序列约 143 秒、5 秒序列约 193 秒，需要后续以这些结果为基线优化；
- `DEBT-TEST-B06-001`：无，真实隐藏窗口到磁盘链路已自动化；
- 回滚点：提交后可执行 `git revert <Day 06 result SHA>`。
