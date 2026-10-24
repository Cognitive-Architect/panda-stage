# Issue #838 — EXP-PERF-01 短片正式导出路径调查

**结论：`RESEARCH_STOP`（一次正式导出尝试已启动，但诊断挂接在 Job 启动后失败）。** 没有 MP4，也没有有效的阶段耗时数据。此报告不支持任何“首要性能瓶颈”结论，不建议据此创建生产优化实施票。

## 范围与来源

- 测量源码 SHA：`c6c356f660001af694bb706cc7553974ff8d1cfc`（PR #817 当前 HEAD）。研究分支以该 SHA 为基点；无生产源码修改。
- 输入来源：生成的 Issue #827 sample 1；诊断运行时将 3 个 Shot 各设为 1,500 ms，24 fps，总时长 4,500 ms、108 帧，项目 1920×1080，4 个音频片段/事件，10 个工程素材。此为生成夹具，不代表真实创作项目。
- 正式 Job：`b7f7eaac-90a9-4c88-8666-ba95d34f52bb`，快照 revision 0；最后记录状态 `running / preparing / 0 of 108 frames`。
- 环境：Windows Server 2022 Datacenter `10.0.20348`；Electron `43.1.1`；unpackaged（`app.isPackaged=false`）；Intel Xeon Platinum，4 核/8 逻辑处理器，报告环境采样上限 2.5 GHz。GPU 证据为虚拟显示适配器 `AspDod controller` / `AspIdd controller`，实际 GPU/加速能力 `UNKNOWN`。FFmpeg 版本未知（未进入编码阶段）。这不是普通桌面或安装包验收。

## 实际尝试与止损

唯一进入 Creator UI 的测量运行：

- 命令：在 `D:\panda-issue816-dl01` 执行 `pnpm exec node scripts/issue838-perf-diagnostic.cjs`。
- acceptance root：`D:\PandaStage-Acceptance\issue838-export-performance-2026-10-24T05-31-01-223Z-9484`。
- fixture run：`run-2026-10-24T05-31-01-552Z-14584`；工程：`Panda Stage formal export.pandastage`。
- Electron 启动 `2026-10-24T05:31:02.154Z`；Save As 选择 `issue838-formal-export.mp4` 于 `05:31:03.794Z`；失败回执写于 `05:31:07.359Z`。
- Main 回执记录了上述 Job ID 和 `preparing / 0 / 108`。诊断挂接在 `startFormalExport()` 返回后引用了作用域外的 `jobStartedAt`，抛出 `ReferenceError`，导致自动化中止。失败堆栈、Job 更新、保存对话框和截图在本机 `...\run-2026-10-24T05-31-01-552Z-14584\evidence\`。launcher receipt 为 `STOP_OR_PARTIAL`，没有性能测量 receipt。
- 从保存对话框选择至失败记录相隔约 3.565 秒，Electron 启动至失败记录约 5.205 秒；它们都不是“点击至完成”，不能记作 `T_total_ui`。shell 命令约 7.1 秒也包含 pnpm/启动过程，不能当作导出或验收耗时。
- 另一次较早的夹具准备在 UI 前被既有 DL-04 30 秒断言拒绝，并额外生成了 `D:\PandaStage-Acceptance\issue838-export-performance-2026-10-24T05-29-23-846Z-8740`。该运行没有正式 Job；保留其目录，不纳入性能样本。
- 失败后未发现匹配本次路径的 Electron/FFmpeg 进程；工程目录没有输出 MP4、帧任务目录或帧临时文件。任务清理是否完整没有回执，不能据此声称 cleanup 阶段成功。没有执行取消测试或现有目标 no-clobber 测试。
- 输出原先不存在；失败后 MP4 仍不存在，因此无输出大小、SHA 或 FFprobe 结果。

## 耗时拆账

| 指标 | 结果 | 解释 |
| --- | --- | --- |
| `T_total_ui` | `NOT_MEASURED` | 运行失败，没有完成状态；只有上述非完成事件时间戳。 |
| `T_export_job` | `NOT_MEASURED` | Main Job 已开始，但没有 job 起止计时或 commit。 |
| `T_frame_pipeline` | `NOT_MEASURED` | 最后更新为 `preparing`，0/108 帧完成；不能把它写成 0 ms。 |
| Canvas / PNG / IPC / 帧写盘 | `NOT_MEASURED` | 没有进入帧渲染，子段计时不可用。 |
| `T_video_encode` | `NOT_MEASURED` | 编码未开始；FFmpeg 版本亦未知。 |
| `T_audio_mux` | `NOT_MEASURED` | 音频混合未开始。 |
| `T_probe` | `NOT_MEASURED` | 正式视频探测未开始。 |
| `T_cleanup_commit` | `NOT_MEASURED` | 没有提交；清理阶段状态未持久化。 |
| `T_verifier_extra` | `NOT_MEASURED` | 没有完成验收流程；约 7.1 秒 shell wall 不是这个分段。 |

DL-06 报告的 16～17 分钟是包含 Electron 启动、Save As、重开、取消、no-clobber、故障注入和 FFprobe 等步骤的外层验收 wall time；它不能说明一次正式 Export Job 耗时 16～17 分钟。

## 输入完整性与残留

- 10 个素材文件的当前 SHA256 均与失败回执的 `source.media` 记录一致；下表保留可复核值。
- 工程 `project.json` 的回执记录 SHA256 为 `01f6365aed6a679939906170faf1df4a7346202c1b727efbee78bf084aba01e2`；结束时读取到 11,834 bytes、SHA256 `f79b24cf660b9c0a5ed5fb5dae41520bc1b7f122774d60b37572c0ef3205f7f4`。两值不一致，差异发生时间与原因未确定；因此工程未变更判据为 `INCONCLUSIVE`，不宣称工程保持原样。素材 hash 一致只证明这 10 个文件的字节一致。

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

## 静态路径事实与待测假设

静态源码显示正式路径按时间表顺序请求隐藏窗口渲染帧、等待 renderer 回传 PNG bytes、将 PNG 写入帧任务目录，再调用 FFmpeg 编码；含音频时还会混音，随后 probe、清理并提交。`renderFrames` 已返回 elapsed、字节数、并发写入与内存指标；FFmpeg encode/mux 返回 elapsed。probe 没有相同形式的 elapsed 结果。静态路径不能证明其中任何一步是实际瓶颈。

代码参考：[ExportService](../../src/main/services/ExportService.ts)、[ExportRendererApp](../../src/export-renderer/ExportRendererApp.tsx)、[hidden-window-manager](../../src/main/windows/hidden-window-manager.ts)、[FileSystemService](../../src/main/services/FileSystemService.ts)、[FFmpegAdapter](../../src/main/services/FFmpegAdapter.ts)。

下表顺序是**下一次获批诊断的测量优先级**，不是性能可能性排名；未测前没有证据支持任何一项为第一瓶颈。

| 测量优先级 / 假设 | 状态 | 证据与可能收益场景 | 风险、最小 A/B 与回退 |
| --- | --- | --- | --- |
| 1. Canvas PNG 压缩与 Renderer/Main 传递 | `UNPROVEN` | 源码有 `canvas.toBlob('image/png')`、bytes 回传；没有分段耗时。若长于逐帧等待/磁盘部分，优化可能缩短高分辨率、多帧场景。收益未量化。 | 风险是帧错配、画面字节变化、IPC 峰值内存。获批后同工程先记录 renderer 编码、回传 wall；只对该段做 A/B，逐帧比对与回退到原 PNG 路径。 |
| 2. PNG 序列落盘再由 FFmpeg 读取 | `UNPROVEN` | 代码写临时 PNG 序列后编码器读取；没有临时字节数或 I/O 时间。若磁盘吞吐为主成本，才值得试其它传递方式。 | 风险是顺序、取消、磁盘占用和清理。以相同 108 帧工程测写盘/编码读取；验证输出帧与音频一致、失败后目录清理，再决定保留或回退。 |
| 3. FFmpeg 编码设置、线程或硬件路径 | `UNPROVEN` | 源码有 encode elapsed 结果，但此 Job 未进入编码；FFmpeg 版本/硬件支持未知。 | 风险包括 H.264 兼容、画质/文件大小、色彩和音画同步。只在编码段被证实占主导后做单变量 A/B；逐帧图像与音频/probe 门槛不通过即回退。 |
| 4. 重绘、静态帧缓存或跳过无变化画面 | `UNPROVEN` | 当前 `renderFrames` 按全局时间表逐帧请求；本次 0 帧，未证明重复帧比例或缓存收益。 | 容易破坏字幕、口型、运镜和跨镜头状态。先由帧序列统计重复画面，不动渲染逻辑；未来若试验失败，完整恢复逐帧渲染。 |
| 5. 导出 Job 之外的验收外围耗时 | `NOT_WORTH_NOW`（暂不做产品优化） | DL-06 外层 16～17 分钟含多种验收动作，不能归因于用户正式导出；本次 `T_verifier_extra` 未测。 | 先把 UI/Job/验收时间分开记录。只有发现用户可感知的等待来自产品流程，才讨论产品改动；自动验收脚本耗时单独处理。 |

## 后续建议与验收边界

本 Issue 的一次正式 Job 尝试已用尽，依止损规则本票不再重跑。建议**暂不创建生产优化实施票**；如 Owner 需要，另行授权一个新的单次测量任务，先修正并审阅诊断脚本，再在相同 4.5 秒 / 108 帧工程采集 UI、Job、帧管线、encode、mux、probe、cleanup/commit 和外围验收各段。确认实际主成本后再只选一项优化。

未来任何优化 A/B 至少固定工程、分辨率、FPS、资产与音频输入；校验 108 帧顺序和画面、音频/时长/FFprobe、既有 no-clobber 与取消清理行为，并保留旧路径可回滚。这个门槛是提案，不是本次已执行的测试。

本分支保留诊断 runner `scripts/issue838-perf-diagnostic.cjs` 与片段 `scripts/issue838-perf-runtime.fragments`。失败运行使用的是 `jobStartedAt` 作用域修正前版本；仓库副本已把 `const` 改成 `var`，只做过 `node --check`，**修正后没有运行，也不是本次实际运行字节级复现**。命令只供未来 Owner 新授权后审阅使用，不要据此重跑本 Issue。验收原始日志、失败回执和截图留在上述本机 acceptance root，没有将工程、截图或媒体上传到 GitHub。

## DoD 状态

- [x] AC01：生成夹具、3 个镜头、4.5 秒 / 108 帧、10 个素材 hash、代码 SHA 与可观测环境已记录；GPU 明确为未知。
- [x] AC02：有一次正式 Job 启动后 STOP 的证据；UI / Job / 外围时间没有混记，未知值使用 `NOT_MEASURED`。
- [ ] AC03：分段耗时未取得，无法逐段核对；报告列明各缺项和最小后续计时建议。
- [ ] AC04：无正常 MP4 / FFprobe，且工程 SHA 不一致；项目保存状态无法证明，未运行 no-clobber / 取消。
- [ ] AC05：没有测得第一瓶颈，不能据此按收益作优化排名或承诺提速。
- [ ] AC06：报告和静态检查脚本已存档，但有效测量与可运行命令尚未验证，未提供生产实施票。
- [x] AC07：未改生产代码、未跑 Full CI / `pnpm verify:project` / DL-06 重测、未动 #836 / PR #817；本 Issue 正文记录 `RESEARCH_STOP`。

**结论回执：** `RESEARCH_STOP`；`OWNER_GO_TO_OPTIMIZE=NOT_GRANTED`；PR #817 `NO_PRODUCTION_CHANGE`；DL-06 / DL-07 `UNCHANGED`。Issue 保持开放，等待 Owner 决定是否另行授权新测量。
