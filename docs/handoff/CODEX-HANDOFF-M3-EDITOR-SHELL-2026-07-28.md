# Codex 接管交接文档 — M3 Editor Shell

> 仓库：`Cognitive-Architect/panda-stage`
> 分支：`fix/m3-editor-shell`
> 基线 HEAD：`5ed72a8e696884e0f769dda52d3858a1db0bd417`
> 当前施工合同：`docs/design/stage1a-execution-contract.md`
> 本版：Issue #59 合同统一版；仅文档，不含生产代码

## 0. 现场差异与文档优先级

Issue #58 的只读审计结论为 BLOCKED，发现五个 Stage 1A 合同阻塞：

1. 1A / 1B 范围冲突；
2. recovery candidate 放在会消失的 StartScreen；
3. Controller 所有者不唯一；
4. 缺少 LegacyWorkspace 过渡挂载；
5. 文件白名单与测试 DoD 冲突。

Issue #59 已在文档层统一这些阻塞。Stage 1A 实施优先级：

```text
stage1a-execution-contract.md
→ m3-editor-shell-design.md v1.2
→ 本 Handoff
```

若未来三者再出现冲突，停止编码并报告，不得自行选择。

## 1. 一页接管摘要

- Panda Stage 是 Electron + React + Konva 的本地 2D 动画短片编辑器。
- Day 21～25 领域逻辑与 CI 候选已完成，真实 UI 产品集成仍失败。
- 当前页面是纵向功能展板，不是连续 Editor Shell。
- M3 = FAIL；PR #53 / #56 = Draft；Day 26～45 frozen。
- 阶段 0A 已完成；Stage 1A 尚未开始。
- Issue #59 只统一施工合同，没有修改任何 `src/`。
- 下一步不是立即编码，而是等待主理人复核并重新执行 1A 开工审计。

## 2. Git 与 PR 拓扑

```text
fix/m3-editor-shell
        ↓ PR #56 (Draft)
feat/day-25-action-presets
        ↓ PR #53 (Draft)
main
```

- PR #56 必须先于 PR #53；
- `fix/m3-editor-shell` 不得直接合入 main；
- 两个 PR 当前都不得转 Ready 或合并；
- 当前动态 HEAD / CI 以 `git` / `gh` 实跑结果为准，不再在正文硬编码为
  “永远最新”。

## 3. 里程碑状态

| 范围 | 状态 |
|---|---|
| M1 | PASS |
| M2 | PASS |
| Day 21～25 领域逻辑 | 候选完成 |
| Day 25 产品集成 | FAIL |
| M3 | FAIL |
| Stage 0A | 完成 |
| Stage 1A | 未开始 |
| Day 26～45 | 冻结 |

完成 Stage 1A 也不等于 M3 PASS。

## 4. Issue / PR 地图

- Issue #54：Closed / Completed。
- Issue #55：M3 Editor Shell，Open。
- Issue #57：原 Handoff 产出，Open。
- Issue #58：只读接管审计；结论 BLOCKED。
- Issue #59：统一 Stage 1A 施工合同；只允许三份文档。
- PR #53：Day 25 上层 Draft。
- PR #56：M3 Editor Shell Draft，本合同随该 PR 更新。

## 5. 为什么需要 Editor Shell

真实 Electron 验收已确认：

- 没有清晰 StartScreen；
- 未打开项目时显示大量不可操作模块；
- 页面需纵向长滚动；
- 画布、素材、镜头、角色、动作、History 彼此分离；
- 默认 UI 存在工程探针与 DAY 标签；
- CanvasStage、HistoryControls 重复挂载；
- 无法连续走通无代码制作主路径。

问题位于 UI 集成层，不要求重写 Day 25 领域逻辑。

## 6. 已完成的阶段 0A

阶段 0A 已交付：

- `docs/design/m3-editor-shell-design.md`；
- `docs/design/phase0a-baseline-report.md`；
- `docs/design/baseline-1366x768.png`；
- `tests/contract/dom-selectors.baseline.test.ts`；
- baseline capture 脚本；
- PR #56 CI 基线。

已知且未修：

```text
CanvasStage = 2
HistoryControls = 2
```

## 7. 权威设计合同

### 基础状态

```text
no-project = editorProjectStore snapshot 为 null
editor     = snapshot 非空
```

debug / gateA 是正交 flag，不写 Project。

### Stage 1A 唯一范围

```text
- StartScreen
- EditorShell / EditorTopBar
- no-project | editor
- debug / gateA flag 接口
- CSS Grid
- LegacyWorkspace
- open / recent
- editor RecoveryCandidateBanner
- EditorShell 唯一 ProjectSessionController
- Stage 1A tests / Gate 兼容
```

### Stage 1A 禁止

```text
- ProductPreviewOverlay
- CloseConfirmDialog 新实现
- project.createAt
- Renderer projectRoot 拼接
- 旧 project.create 真实创建
- 阶段 2/3/4 正式迁移
- 双挂载修复
- Day 26
```

### Stage 1B

只有再次授权后才允许：

- ProductPreviewOverlay；
- CloseConfirmDialog；
- 完整新建 UX；
- `project.createAt`；
- Main `path.join` 生成 projectRoot 并复用 `ProjectService.create`。

## 8. Store 与生命周期归属

| 状态 / 对象 | 唯一来源 | 所有者 / 规则 |
|---|---|---|
| Project / revision | `editorProjectStore` | 不复制；视图切换不 open/clear |
| selectedShotId | `shotStore` | 不复制 |
| selectedLayerId | `selectionStore` | 不复制 |
| History | `editorProjectStore.history` | Stage 1A 保持双挂载基线，不新增 |
| Action Preset | `actionPresetStore` | 命令链不变 |
| Canvas viewport | `canvasViewportStore` | 不复制 |
| Session snapshot | `ProjectSessionController` | `EditorShell` 唯一所有者 |
| recovery candidate | session snapshot | editor Banner 展示 |
| debug / gateA | shell local flag | 不写 Project |
| LegacyWorkspace | shell layout | `EditorShell` 唯一挂载 |

StartScreen、Banner、LegacyWorkspace 和改造后的 `ProjectRecoveryPanel` 均不得
自行 new Controller。

## 9. 关键代码地图

### Stage 1A 允许修改

- `src/renderer/App.tsx`：改为组合 `EditorShell`，不得平行再挂旧树。
- `src/renderer/styles.css`：固定 Grid、根 overflow、legacy 内滚动。
- `src/renderer/features/recovery/ProjectRecoveryPanel.tsx`：只移除 Controller
  私有所有权并收敛为 legacy presenter；editor 中继续承载 RecentProjectsPanel，
  但 callbacks 来自 EditorShell 的唯一 Controller。
- 执行合同列出的 7 个 `src/renderer/shell/*` 新文件。

### Stage 1A 禁止修改

- Store；
- `ProjectSessionController` 行为；
- domain evaluator；
- preload / Main / project-api / ProjectService；
- Canvas / History / ActionPreset 业务组件；
- Gate 脚本（原则上只运行）。

## 10. 阶段实施计划

### Stage 1A

1. 1A-1：Shell 状态与 Controller 唯一所有权；
2. 1A-2：StartScreen + open / recent；
3. 1A-3：editor RecoveryCandidateBanner；
4. 1A-4：EditorTopBar + save；
5. 1A-5：Grid + LegacyWorkspace。

每个切片必须独立测试、提交、回滚；不得一口气施工。

### Stage 1B

预览、关闭确认、完整新建 UX、`project.createAt`。需再次授权。

### Stage 2 / 3 / 4

- Stage 2：Left / Canvas 正式迁移并收敛 CanvasStage；
- Stage 3：Right / Bottom 正式迁移并收敛 History，删除 LegacyWorkspace；
- Stage 4：Debug 正式隔离与全量回归。

## 11. Stage 1A 精确任务单

### 生产文件白名单

```text
src/renderer/App.tsx
src/renderer/styles.css
src/renderer/features/recovery/ProjectRecoveryPanel.tsx
src/renderer/shell/EditorShell.tsx
src/renderer/shell/StartScreen.tsx
src/renderer/shell/EditorTopBar.tsx
src/renderer/shell/NewProjectEntry.tsx
src/renderer/shell/LegacyWorkspace.tsx
src/renderer/shell/RecoveryCandidateBanner.tsx
src/renderer/shell/useDebugFlag.ts
```

### 测试白名单

```text
tests/contract/dom-selectors.baseline.test.ts
tests/unit/editor-shell-state.test.ts
tests/unit/editor-shell-controller.test.ts
tests/unit/project-session-controller.test.ts          （仅需时）
tests/integration/editor-shell-project-session.test.ts
tests/integration/editor-shell-layout.test.ts
```

这些路径与当前 Vitest 的真实目录/include 一致。

### 挂载合同

```text
ProjectSessionController owner = 1
LegacyWorkspace = 1
CanvasStage = 2（允许保持，不得变 3）
HistoryControls = 2（允许保持，不得变 3）
ActionPresetPanel = 1
```

### recovery 合同

`switchProject` 保持现有 open→track→detect→store.open 顺序。candidate 返回后
基础态已为 editor，因此由 `RecoveryCandidateBanner` 展示；不得放回 StartScreen。

Day 13 Gate 在 candidate 出现后仍读取完整旧 recovery panel。因此 Banner
临时保留 `.recovery-panel`、`#recovery-heading`、`.clean-state`、
`.recovery-open-row`、`.recovery-prompt`、旧打开按钮和
“Save recovered project”；所有动作复用 EditorShell 的唯一 Controller /
save callback。StartScreen 此时已卸载，不会形成第二份入口或 recovery state。

### 新建项目合同

Stage 1A 的新建按钮禁用并标“后续阶段启用”。不得调用 `project.create`，
不得引入 `project.createAt`，不得在 Renderer 拼路径。

完整切片 DoD、回滚点、停止条件见执行合同第 9、11 节。

## 12. Gate 与 DOM 兼容

- Day 13：
  - StartScreen 保留初始 `.recovery-panel/.recovery-open-row`；
  - editor Banner 保留 Day 13 要求的完整旧 panel 兼容控件；
  - 两者按 no-project/editor 互斥，不同时挂载。
- Day 14：
  - StartScreen 保留 recent；
  - 打开后 LegacyWorkspace 中仍有 recent panel；
  - EditorTopBar 保留 `.recovery-status-row`，其 output 继续承载
    `Project opened` 等 session 状态。
- Day 16：
  - open 后 `.asset-library` 位于可见 LegacyWorkspace。
- Day 18～24：
  - 旧模块继续默认可见；
  - 不用 `display:none` 欺骗 Gate。
- Gate A：
  - StagePreview 作为正交 overlay 保持现有证据合同。

`.recovery-status-row` 与 `.editor-save-button` 必须共存。

## 13. 测试与命令

Stage 1A 必须运行：

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm verify:day13
pnpm verify:day14
pnpm verify:day16
```

推送后 GitHub Actions 必须继续通过既有 Day 13～24 Gate。本地结果、CI
结果、真人 Electron 验收不得混写。

## 14. 已知坑与事故

1. CanvasStage 双挂载：未修，Stage 1A 不新增第三处。
2. HistoryControls 双挂载：未修，Stage 1A 不新增第三处。
3. Day 20 ShotManager 双挂载曾导致 DOM 翻倍和复制 Gate 回归。
4. deprecated shared evaluator 禁止进入 production 新调用。
5. 连续预设边界回跳根因在 `createPresetEvents` 静态基态，已通过
   startMs 正式求值修复。
6. 未来事件提前生效由正式 evaluator 的 future-event `continue` 修复。
7. 两个时间问题必须分开记录。
8. Controller 重复所有权会造成重复 track/stop/autosave，Stage 1A 必须避免。
9. candidate 在 store.open 后出现，因此只能在 editor 展示。
10. 禁止用 `beforeunload` 替代 Main close 合同。

## 15. Codex 再次开工审计步骤

1. 读取 `stage1a-execution-contract.md`；
2. 读取本 Handoff 与设计 v1.2；
3. 核验分支、HEAD、PR、CI、工作树；
4. 核验白名单文件与测试路径；
5. 核验五个阻塞是否仍一致；
6. 输出新的只读开工审计；
7. 获主理人明确授权后才开始 1A-1。

Issue #59 完成后不得自动开始编码。

## 16. 真人 M3 验收

Stage 1A 实机只检查：

```text
启动
→ no-project StartScreen
→ 打开项目
→ 固定 EditorShell
→ candidate 在 editor 展示
→ TopBar 状态正确
→ 旧模块在 LegacyWorkspace 可见
→ 根不再无限纵向滚动
```

完整 M3 14 步主路径仍需后续阶段完成后由用户本人执行。Stage 1A 通过仍然：

```text
M3 = FAIL
PR = Draft
Day 26~45 = frozen
```

## 17. 当前唯一下一步

```text
Codex 完成 Issue #59 三份文档的提交、推送与 CI 核验后停止；
等待主理人复核，并等待新的明确指令重新执行 Stage 1A 开工审计。
```
