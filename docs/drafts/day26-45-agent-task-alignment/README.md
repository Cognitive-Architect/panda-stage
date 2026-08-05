# Day 26～45 Agent Task × PR #75 对齐草稿

> **文档状态**：Issue #106 审阅草稿，不覆盖 `agent task/` 下的正式工单。
>
> **执行状态（2026-08-05）**：PR #75 仍为 Draft；其基线明确 M3 在真实 Electron 验收正式记录前保持 FAIL。Day 26～45 继续冻结，本目录不构成开工、Gate PASS 或排期变更。

## 1. PR #75 与 Agent Task 的关系

PR #75 提供 Day 26～45 的前端信息架构、组件唯一 Owner、状态边界、视觉系统与真实 Electron 验收合同；原 `agent task/DAY-26-AGENT-TASK.md`～`DAY-45-AGENT-TASK.md` 仍提供每一天的唯一业务目标、依赖、质量门禁、刀刃表、红线与收卷格式。

本目录把两者合成可审阅草稿：每份文件保留原工单的业务合同与完整验收结构，再插入一段仅与当天直接相关的“PR #75 对齐补丁”；原工单中的概念路径按蓝图映射到真实仓库路径，Markdown 换行只做等价规范化。它不把 #75 全文复制二十遍，也不把后台/domain 任务强行做成 UI 改版。

上游来源：

- [PR #75：Day 26～45 UX、视觉系统与 post-MVP workflow](https://github.com/Cognitive-Architect/panda-stage/pull/75)
- [前端与交互技术实施蓝图](../../design/day26-45-ux-implementation-blueprint.md)
- [Panda Stage 视觉设计规范](../../design/DESIGN.md)
- [正式 Agent Task 索引](../../../agent%20task/README.md)

## 2. 修改原则

1. **业务合同不动。** 不改页首唯一目标、依赖、原质量闸门、刀刃表、红线或 Gate 结论逻辑。
2. **只补当天相关内容。** UI Day 补落位、Owner、状态和可视验收；domain/Main Day 只补消费边界。
3. **一个能力一个生产实例。** 正式目标树不保留 LegacyWorkspace、第二 Canvas/History/Timeline/ExportDialog 或平行 UI 根。
4. **状态分层。** 项目内容才进入 ProjectSchema/History/dirty；选择、播放头、Dock、窗口、预览和 job 进度留在 UI/app/task 状态。
5. **滚动有 Owner。** 根页面不承担业务滚动；NavigationDock、InspectorDock 与 TimelineViewport 在各自边界内滚动。
6. **视觉复用。** 只使用 `DESIGN.md` 的 Token、组件状态、响应式、焦点与非颜色信号，不创造竞争设计系统。
7. **真实桌面验收。** UI/E2E 通过真实 Electron 操作，不能直接改 Store/JSON、隐藏旧 DOM 或只用静态渲染冒充。
8. **冻结优先。** M3、Gate B、Gate C 的停止条件不因草稿而改变。
9. **证据可追踪。** 每份草稿用 Roadmap Evidence Index 反向列出本日覆盖的 A1～A22 编号；没有直接覆盖时也明确写明。
10. **工具链真实。** 当前 Prettier 为 N/A；格式证据使用已安装的 ESLint 与 `git diff --check`，不得临时下载未锁版本冒充质量门。

## 3. 逐日修改摘要

| Day | 对齐深度 | 正式落位 / Owner | 本次新增摘要 |
|---:|---|---|---|
| 26 | 重点映射 / UI 基础设施 | EditorShell 五区工作区；TimelineShell 落入底部 TimelineDock | 长页面退场、Day 26 runtime component 层、单一生产实例与响应式/滚动/dirty 硬验收 |
| 27 | 轻度架构边界 | domain evaluator；仅由 Timeline clip、Inspector inline error、StatusBar 摘要消费 | 保持纯 domain，不新建调试页；候选拖动与合法提交、共享 evaluator、非颜色冲突提示 |
| 28 | 重点映射 / UI 功能 | Dialogue Track + TimelineToolbar/轨道空状态 + Inspector + 唯一 Stage | 对白落入 Timeline/Inspector，字幕在单一 Stage；草稿、dirty、History 与降级验收 |
| 29 | 重点映射 / UI 状态机 | TopBar + TimelineToolbar + 同一 CanvasWorkspace + StatusBar | 预览入口/控制/状态归位，单一 Stage 与 AudioContext，PreviewStore 不污染项目 |
| 30 | 整合验收 / Gate B | 正式 EditorShell 全链路，不新增功能区域 | 把无代码闭环与固定工作区、cardinality、根无滚动和 UX 摩擦指标绑定 |
| 31 | 轻度架构边界 / 导出入口 | Main/domain validator + 唯一 ExportDialog 的配置/校验状态 | 不可变快照仍属 Main/domain；Dialog 只消费结构化问题与定位动作，不伪造进度 |
| 32 | 轻度架构边界 / 后台调度 | Main export scheduler；唯一 ExportDialog 只消费节流进度 | 不新增工作区 UI；进度来自已写帧、Snapshot 隔离、主窗口响应与任务冲突提示 |
| 33 | 轻度架构边界 / 后台编码 | Main audio mix/FFmpeg；唯一 ExportDialog 只展示 encoding 阶段 | 不做混音台；用户看到阶段与可读错误，技术日志保留且脱敏 |
| 34 | 重点映射 / Export UX | 唯一 ExportDialog + Main job/log/cleanup；StatusBar 仅作摘要 | 单一状态驱动 Dialog、取消幂等、错误与恢复、焦点/aria、窄窗真实 Electron |
| 35 | 整合验收 / Gate C | 正式 ExportDialog + 主窗口 + Main export pipeline | 在原生产导出证据上增加 Dialog 全状态、响应性、键盘、窄窗与单调进度 |
| 36 | 整合映射 / 首次使用 | StartScreen + Main demo-copy service；编辑器仍使用正式工作区 | StartScreen 三块结构、可跳过 Checklist、app settings 边界与安装目录只读验证 |
| 37 | 整合验收 / 自动护栏 | 既有 runtime component 层 + Playwright Electron E2E | 固化 cardinality/scroll/dirty/draft/dialog，并加入性能预算、五档视觉矩阵与 150% DPI |
| 38 | 整合验收 / Windows 窗口 | Electron window owner + app settings；不新增产品区域 | 窗口状态不污染项目，最小尺寸/DPI/多显示器/只读安装目录在打包应用实测 |
| 39 | 整合验收 / 文档 | 用户指南、开发/架构文档与许可清单；描述正式工作区 | 按任务而非组件编排文档，写真实实现与区域/状态边界，拒绝把蓝图冒充完成 |
| 40 | 整合验收 / RC1 冻结 | 同一正式 EditorShell 与安装包；不再调整布局或视觉 | RC 证据绑定同一 commit/package，仅 P0 可改；复核可达性、状态与 cardinality |
| 41 | 整合验收 / Sample A | 真实 RC1 正式工作区；只记录生产摩擦，不另建测试 UI | 在真实样片中记录导航/披露/反馈/错误/草稿/精度/性能/无障碍净损耗 |
| 42 | 整合验收 / 证据驱动 P0 | 按现有唯一 Owner 修复，不重做 Design System | 只修 Sample A 前三 P0；每项补 Owner、状态/dirty、响应式与真实 Electron 回归 |
| 43 | 整合验收 / Sample B 对比 | 同一最新 RC 正式工作区；保持样片复杂度与测量口径 | 同口径比较导航、操作数、对白耗时、返工、恢复与等待，拆分修复/熟练度贡献 |
| 44 | 整合验收 / UI 恢复 | StatusBar / Recovery Banner / 唯一 ExportDialog；Main service 负责故障与清理 | 故障后 busy/dirty/选择/时间轴可恢复，Banner 不遮挡，订阅/Dialog/Toast 不增长 |
| 45 | 整合验收 / 最终决策 | 证据汇总文档；不新增产品 UI 或生产能力 | 用真实生产与 UX 证据给唯一结论，最多三个后续目标，不以页面/组件数量证明价值 |

所有 Day 都需要修改，但修改强度不同：Day 27、31～33 仅补架构/消费边界；Day 26、28、29、34 做重点 UI 映射；Day 30、35～45 主要补整合与真实 Electron 验收。

## 4. 仍需主理人决定

| ID | 决策点 | 草稿默认 | 影响 |
|---|---|---|---|
| D-106-01 | PR #75 尚未合并时，本草稿 PR 的合并顺序 | 作为 #75 的 stacked Draft PR，先审内容，待 #75 基线稳定后再决定合并 | 避免在目标分支复制整份 #75 diff |
| D-106-02 | 通用事件参数编辑、改时长/删除与拖动提交的最终 Day Owner | Day 26 做能力预检；参数/冲突语义由 Day 27/28 补齐，缺口建阻塞 Issue | 直接影响 Day 30 Gate B |
| D-106-03 | 项目预览自然结束后的播放头位置 | 默认回到 `editing@0` 并恢复 handles | 影响 PreviewStore、焦点与测试 |
| D-106-04 | Export 校验“定位”是关闭还是最小化 Dialog | 必须能选中对象并打开正确 Inspector；具体呈现待实现切片决定 | 影响焦点恢复与窄窗体验 |
| D-106-05 | First-run Checklist 的 app-settings 持久化键与重置入口 | 不进 ProjectSchema；从帮助入口可重新打开 | 影响 Day 36/37 |
| D-106-06 | Sample A/B 的标准窗口、DPI 与机器记录模板 | 至少固定版本、窗口、DPI、硬件和录像时钟 | 影响 Day 41/43 对比可信度 |

## 5. 审阅检查表

- [ ] 每份草稿的页首唯一目标与原工单逐字一致。
- [ ] 每份草稿仍包含原依赖、质量闸门、刀刃表、红线和收卷格式。
- [ ] UI Day 明确正式区域、唯一 Owner、项目/UI/后台状态边界与真实 Electron 验收。
- [ ] domain/Main Day 没有新增平行用户页面或第二套 UI Owner。
- [ ] 每份草稿包含本日 A1～A22 Roadmap Evidence Index。
- [ ] 概念路径已映射到 `src/renderer/*`、`src/main/*`、`src/shared/*` 与 `ROADMAP.md`，没有新建平行架构。
- [ ] 原 `agent task/` 文件没有变更。
- [ ] 文档没有宣称 PR #75 已合并、M3 已 PASS 或 Day 26 已开工。
- [ ] 本变更只包含文档；无生产代码、测试或 CI 变更。

## 6. 变更范围声明

本目录新增 1 份 README 与 20 份草稿。**没有修改生产代码、测试、CI、ProjectSchema，也没有覆盖正式 Agent Task。**
