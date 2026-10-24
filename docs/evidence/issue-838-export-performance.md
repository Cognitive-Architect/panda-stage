# Issue #838 — EXP-PERF-01 短片正式导出性能调查

**最新结论：`RESEARCH_PARTIAL`。** 经 Owner 在会话中重新授权并先通过安全预检后，一次正式导出测量成功。108 帧生成夹具从 UI 点击到完成为 **122.872 秒**；Main Export Job 为 **119.346 秒**。本次最明显耗时段是帧管线（**111.834 秒，占 Job 的 93.7%**）。尚未拆开 Canvas 绘制/PNG 编码/IPC/文件写入内部时间；取消和已有目标 no-clobber 分支也没有重测。因此只能锁定“帧管线”为首个优化调查对象，不能断言内部哪一段应被改造。

没有生产代码改动，也没有创建优化 Issue。报告、诊断器和本机验收材料分开存放；MP4 和生成工程没有上传 GitHub。

## 代码、样本与授权

- 测量源码 SHA：`c6c356f660001af694bb706cc7553974ff8d1cfc`（PR #817 当时 HEAD）；诊断工具在 `research/issue-838-export-performance` 分支，基于该 SHA。
- 样本来自生成的 Issue #827 sample 1，运行时调整为 3 个 Shot × 1,500 ms：4,500 ms、24 fps、108 帧、1920×1080，10 个素材、4 个音频片段/事件。不是用户工程或真实作品。
- 首次授权下的正式 Job 在 2026-10-24 05:31Z 启动后因诊断器作用域错误中止于 `preparing / 0 of 108`；没有重试。Owner 后续在会话中明确授权重新测量并要求先检查测量器。
- 预检命令 `node scripts/issue838-perf-diagnostic.cjs --preflight` 在研究分支和 c6 源码工作树各通过一次：动态生成的 verifier 语法检查通过、14 个计时钩子齐全、210 秒 Job 超时与取消、295 秒内部 STOP、300 秒外层子进程树止损均存在。预检确认 `formalJobStarted=false`、`electronSpawned=false`、`acceptanceRootCreated=false`。
- 正式命令：`pnpm exec node scripts/issue838-perf-diagnostic.cjs`，在已构建的 c6 工作树执行一次。Launcher 返回码 0、`timedOut=false`；没有再次运行。

## 成功测量回执

- Acceptance root：`D:\PandaStage-Acceptance\issue838-export-performance-2026-10-24T06-39-48-556Z-7428`
- Run ID：`run-2026-10-24T06-39-48-899Z-10084`
- 回执时间：`2026-10-24T06:41:54.616Z`；本机正式导出 MP4：`...\Panda Stage formal export.pandastage\issue838-formal-export.mp4`
- 正式 MP4：77,519 bytes，SHA256 `e136f5ff31b8286c91dc9dc3ae49fb9517327f9620e11a6bd256f0c066f686e1`。
- FFprobe：H.264 / yuv420p、1920×1080、24 fps、108 帧、4.5 秒；1 条 AAC / 48 kHz 音轨、4.5 秒；`ffprobeValid=true`。
- Preservation 回执：`projectUnchanged=true`、`assetsUnchanged=true`、`editorStatePreserved=true`、`outputInitiallyAbsent=true`。成功运行结束工程 `project.json` SHA256 为 `b054393641c22a4ad057c8765f3cab8138dc32c0c842a6d09b6e6064ab0524d8`。活动 Job / 子进程计数为 0；输出临时文件、帧任务目录、准备快照均为空，staging 已清理。
- 取消路径与已有 MP4 的 no-clobber 拒绝路径**没有**执行。首个失败运行回执中的 source project hash 与当时工程末值不一致仍未解释；成功重测是全新工程，测量器在该运行中逐字节比较导出前后工程并通过，不用成功运行倒推旧差异原因。

## 耗时拆账

所有时长为单次生成夹具的 wall time，不表示 p95 或真实创作项目的承诺。百分比以 `T_export_job` 为分母。FFmpeg 数字是 adapter 方法返回的整体 elapsed，并非进程 CPU 时间；probe 统计包含音频源和最终视频探测。

| 指标 | 秒 | 占 Job | 说明 |
| --- | ---: | ---: | --- |
| `T_total_ui` | 122.872 | 102.95% | 从触发正式导出到 UI 显示完成，包含 Save As。 |
| `T_export_job` | 119.346 | 100% | Job 开始到成功提交/完成。 |
| `T_frame_pipeline` | 111.834 | 93.7% | 108 帧，约 1.036 秒/帧；含隐藏舞台帧准备/渲染、Canvas PNG、跨进程返回与写入，当前未拆子段。 |
| `T_video_encode` | 1.892 | 1.6% | FFmpeg PNG 序列编码 adapter elapsed。 |
| `T_audio_mux` | 0.257 | 0.2% | 音轨混合 adapter elapsed。 |
| `T_probe` | 0.675 | 0.6% | 6 次音频源 probe 与最终视频 probe 的 wall time 合计。 |
| `T_cleanup_commit` | 1.534 | 1.3% | Job 目录清理 0.012 秒；原子提交 1.522 秒。 |
| Job 未拆段残差 | 3.154 | 2.6% | Job 总时间减去上列已计时分段；包含其余准备/任务编排开销，不归给某一组件。 |
| `T_verifier_extra` | 0.402 | — | UI 完成后的回执、哈希与临时文件检查；其中独立 FFprobe 为 0.391 秒。 |

UI 与 Job 的差额近似 3.526 秒；启动至点击前另有 2.243 秒，不包含在 `T_total_ui`。嵌套/先后阶段不可把 UI、Job 和 verifier extra 相加。DL-06 的 16～17 分钟是外围多步骤验收总 wall，不是这次的纯导出耗时。

其它帧指标：PNG 临时序列共 7,516,280 bytes；`peakPendingWrites=1`。系统采样间隔 250 ms，共 492 个样本；主进程 RSS 峰值 186,863,616 bytes；最低空闲 RAM 6,750,027,776 bytes；FFmpeg 子进程峰值内存未测。

## 环境与输入 hash

- Windows Server 2022 Datacenter build `20348`；Electron `43.1.1`、Chromium `150.0.7871.114`、Node `24.18.0`；unpackaged。
- CPU：Intel Xeon Platinum，8 个逻辑处理器；RAM 16,624,439,296 bytes。GPU `UNKNOWN`，系统只报告 AspDod/AspIdd 虚拟显示适配器。
- FFmpeg：`N-92722-gf22fcd4483`（2018 build）。环境不是普通桌面或安装包验收。

本次 10 个生成素材在导出前后 SHA 均一致：

| 工程相对路径 | SHA256 |
| --- | --- |
| `assets/bamboo-background.png` | `452f993f60e04c524283268ce583504b3f67af24cdcc806ef5d31b311e052b53` |
| `assets/panda-neutral.png` | `760c03876668ae048b1ef96ea8dc9e94bc24f1c43deda8b7af4717bde2f41a7b` |
| `assets/panda-happy.png` | `f57f44b1de40bf98459d8a7f083d1a613de749d5e9956154f41db7315ff0516e` |
| `assets/panda-mouth-open.png` | `ba2180469683347ee65206f7b3e98cef8b19916c073b8c21ba69a7fa2b827a11` |
| `assets/dl03-dialogue.wav` | `ba35983703ba44b95c01d8ba9cfa5d5e7b14feea738cf78c68c84e19c8370112` |
| `assets/dl03-bgm.wav` | `f7727a14e757b0e2adc0b68bf6b3849b94aa859ae4fcfe64d83019fa4d2f6c70` |
| `assets/dl03-sfx-one.wav` | `124ee29f9e1c1fe4c1dce1cb61ee30614e87c9ced3c2cf5dc83ae56f5556bdc0` |
| `assets/dl03-sfx-two.wav` | `8f6596eed3aa27f5c0ee890d11de24fed9198c6287ce33716730c3c03c0efdf7` |
| `assets/dl04-sample-1-shot-2-background.png` | `342c9248b18bcc8f5af654d882457e367158abd089831705dbcb11c2f6a4fa77` |
| `assets/dl04-sample-1-shot-3-background.png` | `7dd7b9d3fe8904d1cf8bb910a00fb087ff42bb8fd7850d03468d94a732d06e95` |

## Bottleneck and candidate ranking

静态源码顺序是隐藏舞台渲染并回传 PNG bytes、Main 写 PNG 序列、FFmpeg 编码/混音、probe、清理与提交；参见 [ExportService](../../src/main/services/ExportService.ts)、[ExportRendererApp](../../src/export-renderer/ExportRendererApp.tsx)、[hidden-window-manager](../../src/main/windows/hidden-window-manager.ts)、[FileSystemService](../../src/main/services/FileSystemService.ts) 和 [FFmpegAdapter](../../src/main/services/FFmpegAdapter.ts)。本次实测支持“帧管线是第一耗时段”；并不支持帧管线内部某个子步骤是第一原因。

| 候选假设 | 判定 | 证据 / 风险 / 最小验证与回退 |
| --- | --- | --- |
| 重绘、静态帧缓存或跳过无变化画面 | `UNPROVEN` | 没有测重复画面比例。若未来先证明相邻帧重复率高，才用同工程 A/B；逐帧画面不等即回退，重点保护字幕、口型、运镜与镜头边界。 |
| Canvas PNG 与 Renderer/Main 传递 | `LIKELY`（仅 aggregate frame pipeline） | 111.834 秒/93.7% 使帧管线成为首要方向；Canvas、传递与准备/写入未分别计时。收益不能细分。先增加内存聚合子计时，再选单一子段 A/B；不得先换 rawvideo/GPU 通路。 |
| PNG 序列写盘再读盘 | `UNPROVEN` | 共 7.52 MB、pending writes 峰值 1；没有独立写入/读取耗时。若未来 A/B，需保持帧顺序，核对视觉/音频及清理，失败回滚原 PNG 路径。 |
| FFmpeg 编码参数/线程/硬件 | `NOT_WORTH_NOW`（这份样本） | 编码 1.892 秒、混音 0.257 秒，远低于帧管线；不支持先投入编码优化。GPU 加速能力未知。 |
| 验收器外围步骤 | `NOT_WORTH_NOW`（产品路径） | 本次 UI 完成后的外围只有 0.402 秒；不能用 DL-06 16～17 分钟聚合 wall 推断产品导出慢。 |

## 下一步建议（未创建 Issue）

建议标题：**Perf｜正式导出帧管线子阶段计时与低风险优化验证**。边界先只记录隐藏舞台 ready/render、Canvas `toBlob`、Renderer/Main 返回与 Main `writeFrame` 的累计 wall time；每帧只累加内存计数，完成后写一条汇总，不逐帧同步落日志。首要目标是找出 111.834 秒内部的最大一段，当前没有足够证据选择具体性能改造。

验收建议：同一 4.5 秒 / 108 帧工程与硬件做基线和单变量 A/B；报告分段秒数及 run-to-run variance；FFprobe 核对分辨率/FPS/帧数/时长/音轨；逐帧视觉结果、音频轨和工程/素材不变；no-clobber、取消与临时清理回归通过。若分段改造未在重复测量中稳定改善，或有任一画面/音频/文件保护回归，则回退。此为方案，不是本次已执行测试，也没有授权优化施工。

复现步骤：在 Windows checkout 安装依赖并构建后，先执行 `pnpm exec node scripts/issue838-perf-diagnostic.cjs --preflight`，再执行 `pnpm exec node scripts/issue838-perf-diagnostic.cjs`。前者不启动 Electron/Job；后者是有副作用的正式单次测量入口，必须单独获准，且保留 210/295/300 秒止损。当前重测只运行了一次。

本机运行回执及截图：`D:\PandaStage-Acceptance\issue838-export-performance-2026-10-24T06-39-48-556Z-7428\run-2026-10-24T06-39-48-899Z-10084\evidence\`；包括 JSON 计时回执、FFprobe JSON、Save As / progress / completed 截图。媒体、工程及截图没有上传。

## DoD 状态

- [x] AC01：来源、样本、资产 SHA、源码 SHA、环境已记录。
- [x] AC02：成功正式 UI 导出，区分 UI、Job 和外围时间；DL-06 外层 wall 未混作 Job。
- [x] AC03：主阶段秒数可核对；PNG/Canvas/IPC/write 子段未测，并提供了最小补充计时方案。
- [ ] AC04：工程、素材、编辑器状态、输出和 cleanup 通过；取消及已有目标 no-clobber 分支未重测。
- [x] AC05：帧管线作为实测首要耗时段，候选按证据/收益/风险/验证排序；没有无证据速度承诺。
- [x] AC06：Markdown 报告、后续票提纲和成功执行过的诊断命令已记录。
- [x] AC07：无生产改动；未跑 Full CI、`pnpm verify:project` 或 DL-06/30 秒矩阵；未改 #836 / PR #817。

**最新回执：** `RESEARCH_PARTIAL`；`OWNER_GO_TO_OPTIMIZE=NOT_GRANTED`；PR #817 `NO_PRODUCTION_CHANGE`；DL-06 / DL-07 `UNCHANGED`。Issue 保持开放，等 Owner 接受部分结果并决定是否创建后续票。
