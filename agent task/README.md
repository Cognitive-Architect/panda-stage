# Panda Stage Agent Tasks — 45 日派单索引

> 目录：`agent task/`  
> 生成日期：2026-07-19  
> 来源：`DAILY_PLAN_PANDA_STAGE.md` v1.0 + ID-59 v3.0 集群式开发派单模板 + 完整派单示例  
> 仓库规划基线：`65264bee2b3962602f67a00c9675825e641dbce3`

## 使用规则

1. 严格按 Day 01 → Day 45 顺序执行；Gate / 回执未通过不得跳日。
2. 每份文档都是自包含派单，不依赖“见上文”补全关键背景。
3. 执行前必须拉取最新 `main` 并记录真实 SHA；文档中的规划基线只用于追溯生成来源。
4. 每天只创建一个分支、完成一个主目标、提交一份测试回执。
5. 任何未验证项必须保持未完成状态；不能用“理论可行”顶替运行证据。

## 45 日任务

| Day | 任务 | Agent 角色 | 建议分支 | 文档 |
|---:|---|---|---|---|
| 01 | 建立可运行、可测试、可构建的仓库 | Engineer | `chore/day-01-scaffold` | [DAY-01-repository-scaffold.md](./DAY-01-repository-scaffold.md) |
| 02 | 建立领域常量和最小项目模型 | Engineer | `feat/day-02-domain-models` | [DAY-02-domain-models.md](./DAY-02-domain-models.md) |
| 03 | 打通主窗口、Preload 与隐藏窗口 IPC | Engineer | `spike/day-03-hidden-window-ipc` | [DAY-03-hidden-window-ipc.md](./DAY-03-hidden-window-ipc.md) |
| 04 | 建立共享 StageRenderer 和静态探针画面 | Engineer | `spike/day-04-shared-stage-renderer` | [DAY-04-shared-stage-renderer.md](./DAY-04-shared-stage-renderer.md) |
| 05 | 加入移动、字幕和音频预览 | Engineer | `spike/day-05-preview-probe` | [DAY-05-preview-probe.md](./DAY-05-preview-probe.md) |
| 06 | 隐藏窗口逐帧捕获与临时目录 | Engineer | `spike/day-06-frame-capture` | [DAY-06-frame-capture.md](./DAY-06-frame-capture.md) |
| 07 | FFmpeg 编码静音 H.264 MP4 | Engineer | `spike/day-07-ffmpeg-video` | [DAY-07-ffmpeg-video.md](./DAY-07-ffmpeg-video.md) |
| 08 | 音频合成与同步验证 | Engineer | `spike/day-08-audio-mux` | [DAY-08-audio-mux.md](./DAY-08-audio-mux.md) |
| 09 | 中文路径、取消与彻底清理 | Engineer | `spike/day-09-path-cancel-cleanup` | [DAY-09-unicode-cancel-cleanup.md](./DAY-09-unicode-cancel-cleanup.md) |
| 10 | 打包探针、三次复现与 Gate A | Architect | `chore/day-10-gate-a` | [DAY-10-gate-a-packaged-probe.md](./DAY-10-gate-a-packaged-probe.md) |
| 11 | 完整 Project Schema v1 与迁移框架 | Engineer | `feat/day-11-project-schema-v1` | [DAY-11-project-schema-v1.md](./DAY-11-project-schema-v1.md) |
| 12 | 新建、打开与原子保存 | Engineer | `feat/day-12-project-lifecycle` | [DAY-12-project-lifecycle.md](./DAY-12-project-lifecycle.md) |
| 13 | 自动保存与崩溃恢复 | Engineer | `feat/day-13-autosave-recovery` | [DAY-13-autosave-recovery.md](./DAY-13-autosave-recovery.md) |
| 14 | 最近项目、未保存提醒与路径回归 | Engineer | `feat/day-14-recent-projects` | [DAY-14-recent-projects.md](./DAY-14-recent-projects.md) |
| 15 | M1 集成回归与文档闭环 | Architect | `chore/day-15-m1-gate` | [DAY-15-m1-gate.md](./DAY-15-m1-gate.md) |
| 16 | 素材导入服务与重复检测 | Engineer | `feat/day-16-asset-import` | [DAY-16-asset-import.md](./DAY-16-asset-import.md) |
| 17 | 缩略图与音频元数据 | Engineer | `feat/day-17-asset-metadata` | [DAY-17-asset-metadata.md](./DAY-17-asset-metadata.md) |
| 18 | 素材库 UI 与引用删除保护 | Engineer | `feat/day-18-asset-library-ui` | [DAY-18-asset-library-ui.md](./DAY-18-asset-library-ui.md) |
| 19 | 角色定义与表情管理 | Engineer | `feat/day-19-character-definitions` | [DAY-19-character-definitions.md](./DAY-19-character-definitions.md) |
| 20 | 镜头 CRUD、排序和 M2 Gate | Architect | `feat/day-20-shot-management` | [DAY-20-shot-management-m2-gate.md](./DAY-20-shot-management-m2-gate.md) |
| 21 | 1920×1080 画布、背景和窗口适配 | Engineer | `feat/day-21-canvas-stage` | [DAY-21-canvas-stage.md](./DAY-21-canvas-stage.md) |
| 22 | 拖入、选中和移动图层 | Engineer | `feat/day-22-layer-placement` | [DAY-22-layer-placement.md](./DAY-22-layer-placement.md) |
| 23 | 缩放、旋转、翻转、层级和删除 | Engineer | `feat/day-23-layer-transform` | [DAY-23-layer-transform.md](./DAY-23-layer-transform.md) |
| 24 | 命令式撤销与重做 | Engineer | `feat/day-24-history` | [DAY-24-history-undo-redo.md](./DAY-24-history-undo-redo.md) |
| 25 | 动作预设与 M3 Gate | Architect | `feat/day-25-action-presets` | [DAY-25-action-presets-m3-gate.md](./DAY-25-action-presets-m3-gate.md) |
| 26 | 轻量时间轴外壳和播放头 | Engineer | `feat/day-26-timeline-shell` | [DAY-26-timeline-shell.md](./DAY-26-timeline-shell.md) |
| 27 | 完整求值器、插值与冲突规则 | Engineer | `feat/day-27-timeline-evaluator` | [DAY-27-timeline-evaluator.md](./DAY-27-timeline-evaluator.md) |
| 28 | 对白、字幕、音频片段和嘴巴开合 | Engineer | `feat/day-28-dialogue-subtitle-audio` | [DAY-28-dialogue-subtitle-audio.md](./DAY-28-dialogue-subtitle-audio.md) |
| 29 | 播放控制与多镜头连续预览 | Engineer | `feat/day-29-project-preview` | [DAY-29-project-preview.md](./DAY-29-project-preview.md) |
| 30 | Gate B：无代码完成 30 秒内部 Alpha | Architect | `chore/day-30-gate-b` | [DAY-30-gate-b-internal-alpha.md](./DAY-30-gate-b-internal-alpha.md) |
| 31 | 导出快照、完整性校验与总帧数 | Engineer | `feat/day-31-export-snapshot` | [DAY-31-export-snapshot.md](./DAY-31-export-snapshot.md) |
| 32 | 多镜头隐藏窗口调度与背压 | Engineer | `feat/day-32-export-scheduler` | [DAY-32-export-scheduler.md](./DAY-32-export-scheduler.md) |
| 33 | 多音轨延迟、混音与最终封装 | Engineer | `feat/day-33-audio-mix` | [DAY-33-audio-mix.md](./DAY-33-audio-mix.md) |
| 34 | 导出进度、取消、错误恢复与日志 | Engineer | `feat/day-34-export-ux` | [DAY-34-export-ux.md](./DAY-34-export-ux.md) |
| 35 | Gate C：30 秒 MP4、一致性与重复导出 | Architect | `chore/day-35-gate-c` | [DAY-35-gate-c-production-export.md](./DAY-35-gate-c-production-export.md) |
| 36 | 无版权演示项目与首次使用引导 | Engineer | `feat/day-36-demo-project` | [DAY-36-demo-project-onboarding.md](./DAY-36-demo-project-onboarding.md) |
| 37 | 补齐 unit、integration 与 Playwright E2E | Engineer | `test/day-37-regression-suite` | [DAY-37-regression-suite.md](./DAY-37-regression-suite.md) |
| 38 | Windows 打包与干净环境测试 | Engineer | `build/day-38-windows-package` | [DAY-38-windows-package.md](./DAY-38-windows-package.md) |
| 39 | 用户文档、开发文档和第三方许可 | Engineer | `docs/day-39-release-docs` | [DAY-39-release-docs.md](./DAY-39-release-docs.md) |
| 40 | Release Candidate 冒烟与冻结 | Architect | `release/day-40-rc1` | [DAY-40-rc1-release.md](./DAY-40-rc1-release.md) |
| 41 | 真实样片 A 与摩擦日志 | Engineer | `validation/day-41-sample-a` | [DAY-41-sample-a-validation.md](./DAY-41-sample-a-validation.md) |
| 42 | 只修样片 A 的前三个 P0 阻塞 | Engineer | `fix/day-42-top-production-blockers` | [DAY-42-top-production-blockers.md](./DAY-42-top-production-blockers.md) |
| 43 | 真实样片 B 与效率对比 | Engineer | `validation/day-43-sample-b` | [DAY-43-sample-b-validation.md](./DAY-43-sample-b-validation.md) |
| 44 | 韧性、重复导出与异常恢复测试 | Engineer | `test/day-44-resilience` | [DAY-44-resilience-testing.md](./DAY-44-resilience-testing.md) |
| 45 | Go / No-Go 决策与下一阶段 Backlog | Architect | `docs/day-45-go-no-go` | [DAY-45-go-no-go-decision.md](./DAY-45-go-no-go-decision.md) |

## Gate 顺序

- Gate A：Day 10 — 打包探针、三次复现与底层技术路线判定
- M1 Gate：Day 15 — 项目生命周期、保存与恢复
- M2 Gate：Day 20 — 素材、角色、镜头管理
- M3 Gate：Day 25 — 画布编辑与动作预设
- Gate B：Day 30 — 无代码完成 30 秒内部 Alpha
- Gate C：Day 35 — 确定性 30 秒 MP4 导出
- RC1：Day 40 — Windows Release Candidate
- Go / No-Go：Day 45 — 证据化继续、内部使用或暂停决策

## 收卷位置

- 每日回执：`docs/test-receipts/`
- Gate 回执：`docs/test-receipts/GATE-*.md`
- 验证样片：`docs/validation/` 与 `artifacts/validation/`
- 技术决策：`docs/decisions/`

> 这套派单的终点不是“代码看起来很多”，而是两个真实 30 秒样片都能在不改代码的情况下完成、预览与导出一致，并据此作出唯一的 Go / No-Go 决策。
