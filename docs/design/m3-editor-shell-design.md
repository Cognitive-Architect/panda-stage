# M3 编辑器外壳设计包 — Issue #55 / #59

> 版本：v1.2（2026-07-28）
> 分支：`fix/m3-editor-shell`
> 当前阶段：阶段 0A 已完成；Stage 1A 未开始
> 施工合同：`docs/design/stage1a-execution-contract.md`

## 0. v1.2 修订结论

Issue #58 发现旧 v1.1a 在 Stage 1 范围、recovery candidate 归属、
Controller 生命周期、过渡挂载和测试白名单上存在冲突。Issue #59 将其统一。

Stage 1A 实施时，以下文件共同构成权威输入：

1. `docs/design/stage1a-execution-contract.md`（最具体，优先级最高）；
2. 本设计包 v1.2；
3. `docs/handoff/CODEX-HANDOFF-M3-EDITOR-SHELL-2026-07-28.md`。

三者的 Stage 1A / 1B 边界必须保持一致。

## 1. 项目问题与目标

当前领域逻辑和自动化候选已经具备，但真实 Electron UI 仍是纵向功能展板：

- 未打开项目时没有清晰入口；
- 画布、镜头、素材、角色、动作、History 空间分离；
- 默认界面残留 Debug / DAY 探针；
- editing CanvasStage 和 HistoryControls 均双挂载；
- 用户无法连续完成无代码主路径。

M3 因真实 UI 主路径失败而保持 FAIL。当前目标是分阶段建立 Editor Shell，
不是重写 Day 25 领域逻辑。

## 2. 不可破坏的架构合同

- Project / revision：唯一来源 `editorProjectStore`；
- selectedShotId：唯一来源 `shotStore`；
- selectedLayerId：唯一来源 `selectionStore`；
- History：唯一来源 `editorProjectStore.history`；
- Action Preset：保持
  `createPresetEvents → validatePresetApplication → applyPresetEvents → updateProject`；
- Canvas viewport：继续使用 `canvasViewportStore`；
- 正式预览/导出使用 `src/domain/evaluate-shot-at-time.ts`；
- 禁止新增对 `src/shared/domain/evaluate-shot-at-time.ts` 的 production 调用；
- debug / gateA 是正交 flag，不写入 Project；
- Tab、折叠、布局切换不得调用 `editorProjectStore.open/clear`；
- Windows `×` 继续使用 Main 的 `UnsavedCloseGuard` + 原生 Electron dialog；
- 禁止用 `beforeunload` 替代正式关闭合同。

## 3. 页面状态

| 基础态 | 判定 | UI |
|---|---|---|
| `no-project` | `editorProjectStore.getSnapshot() === null` | StartScreen |
| `editor` | snapshot 非空 | EditorLayout |

`debug` 与 `gateA` 是 overlay/flag，不是第三基础态。

打开项目的既有顺序保持：

```text
open → track → detect → store.open → 返回 session snapshot
```

因此 recovery candidate 的正式归属是 editor 中的
`RecoveryCandidateBanner`，不再属于 StartScreen。

## 4. Stage 1A 最终组件树

```text
App
└─ EditorShell                         [唯一 Controller 所有者]
   ├─ StagePreview                     [gateA 正交 overlay]
   ├─ StartScreen                      [no-project]
   │  └─ NewProjectEntry
   │     ├─ NewProjectButton           [disabled]
   │     ├─ ProjectOpenEntry           [.recovery-open-row]
   │     └─ RecentProjectsPanel
   └─ EditorLayout                     [editor]
      ├─ EditorTopBar
      ├─ RecoveryCandidateBanner       [optional]
      ├─ LeftPlaceholder
      ├─ LegacyWorkspace               [唯一旧树入口，内部滚动]
      ├─ RightPlaceholder
      └─ BottomPlaceholder
```

详细节点读写、生命周期和删除阶段见执行合同第 2、3、4、6 节。

## 5. ProjectSessionController 决策

`ProjectSessionController` 的唯一所有者是 `EditorShell`。

- StartScreen、Banner、LegacyWorkspace 不得自行 new Controller；
- `ProjectRecoveryPanel` 在 Stage 1A 最小改造后不再私有持有 Controller；
- EditorShell 保存唯一 session snapshot；
- candidate 在 `store.open` 后随 snapshot 回到 EditorShell，再由 editor Banner 展示；
- restore / ignore 回写同一个 Controller snapshot；
- 只有 EditorShell 最终卸载时调用 `dispose()`；
- 不重复 track / stop / autosave update。

不修改 `ProjectSessionController` 本身的行为。

现有 Day 13 Gate 在 candidate 出现后仍查询完整旧 recovery panel。Stage 1A
的 editor Banner 因此临时保留 `.recovery-panel`、`#recovery-heading`、
`.clean-state`、`.recovery-open-row`、`.recovery-prompt`、
“Open and check recovery”和“Save recovered project”；这些控件复用
EditorShell 的唯一 Controller / save callback。StartScreen 此时已卸载，
所以不会产生第二份打开入口或 recovery state。

## 6. LegacyWorkspace 决策

Stage 1A 不进行正式模块迁移。`LegacyWorkspace` 只作为过渡容器：

- 是旧模块树唯一入口；
- 承载当前 ActionPreset、History、Canvas 与 presenter 化后的
  `ProjectRecoveryPanel` 旧模块；
- `ProjectRecoveryPanel` 在 editor 中继续承载 RecentProjectsPanel，并使用
  EditorShell 传入的 recent callback；它不再自行持有 Controller；
- 内部滚动，Shell 根不滚动；
- 旧 Gate 目标默认可见，不用 `display:none`；
- 不复制第二棵旧树；
- Stage 2/3 再逐项迁出，Stage 3 完成后删除。

Stage 1A 数量允许保持：

```text
CanvasStage = 2
HistoryControls = 2
ActionPresetPanel = 1
```

但不得新增第三处 CanvasStage / HistoryControls。

## 7. Stage 1A / 1B / 后续阶段

### Stage 0A — 已完成

- 设计、基线报告、1366×768 截图；
- 现有选择器 contract；
- 记录双挂载，不修复；
- PR #56 保持 Draft。

### Stage 1A — 本次统一的唯一范围

- no-project / editor；
- StartScreen；
- EditorShell / EditorTopBar；
- debug/gateA flag 接口；
- CSS Grid；
- LegacyWorkspace；
- open / recent；
- editor RecoveryCandidateBanner；
- Controller 唯一所有权；
- Stage 1A tests / Gate 兼容。

禁止 ProductPreviewOverlay、CloseConfirmDialog、真实新建项目、
`project.createAt`、Renderer `projectRoot` 拼接、阶段 2/3/4 和 Day 26。

### Stage 1B — 需再次授权

- ProductPreviewOverlay；
- CloseConfirmDialog；
- 完整新建项目 UX；
- `project.createAt`；
- Main 用 Node `path.join` 生成
  `<parentDirectory>/<projectName>.pandastage`；
- 内部复用 `ProjectService.create`。

### Stage 2

- LeftWorkspace / Tabs；
- CanvasWorkspace；
- CanvasStage 收敛为 1；
- Fit 与 Gate 导航。

### Stage 3

- RightInspector / ActionPreset；
- BottomWorkspace / History；
- HistoryControls 收敛为 1；
- 删除 LegacyWorkspace。

### Stage 4

- DebugWorkspace；
- ping / export probe / DAY 标签正式隔离；
- 全量 Gate 与真人 M3 前置回归。

Day 26 时间轴在 M3 PASS 前继续冻结。

## 8. Stage 1A 文件白名单

### 生产文件

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

`ProjectRecoveryPanel.tsx` 只允许移除 Controller 私有所有权并收敛为 legacy
内容 presenter，不允许修双挂载或改业务 Store。

### 测试文件

```text
tests/contract/dom-selectors.baseline.test.ts
tests/unit/editor-shell-state.test.ts
tests/unit/editor-shell-controller.test.ts
tests/unit/project-session-controller.test.ts          （仅需时）
tests/integration/editor-shell-project-session.test.ts
tests/integration/editor-shell-layout.test.ts
```

这些路径符合当前 Vitest 的真实 include：
`tests/unit/**/*.test.ts`、`tests/contract/**/*.test.ts`、
`tests/integration/**/*.test.ts`。

Gate 脚本原则上只运行、不修改。

## 9. Gate 兼容矩阵

| Gate | Stage 1A 保留入口/区域 | 关键选择器 |
|---|---|---|
| Day 13 | StartScreen 打开；editor Banner 恢复并承接旧 panel 兼容控件 | `.recovery-open-row`、`.recovery-panel`、`.clean-state`、`.recovery-prompt` |
| Day 14 | StartScreen 与 editor Legacy 都有 recent；EditorTopBar session/save 状态 | `.recent-projects-panel`、`.recovery-status-row` |
| Day 16 | StartScreen 打开；LegacyWorkspace assets | `.recovery-open-row`、`.asset-library` |
| Day 18/19 | LegacyWorkspace | `.asset-library`、`.character-manager` |
| Day 20 | LegacyWorkspace | `.shot-manager` |
| Day 21～23 | LegacyWorkspace | `.project-canvas`、layer controls |
| Day 24 | LegacyWorkspace + TopBar | `[data-testid="history-controls"]`、`.recovery-status-row` |
| Gate A | orthogonal StagePreview | `preview-panel`、`stage-renderer` |

Stage 1A 不修改 Gate 断言，不操作隐藏 DOM。

## 10. Grid 规格

```css
html, body, #root {
  height: 100%;
  margin: 0;
  overflow: hidden;
}

.editor-shell {
  height: 100vh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
}

.editor-body {
  display: grid;
  grid-template-columns: 264px minmax(0, 1fr) 300px;
  min-width: 0;
  min-height: 0;
}

.legacy-workspace {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
```

1366×768 下中央区域仍可容纳约 800×450 的 16:9 Fit 舞台。Stage 1A
只要求根不无限纵向滚动，旧模块允许在 LegacyWorkspace 内部滚动。

## 11. 测试与验收

必须运行：

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

推送后 GitHub Actions 必须继续通过既有 Day 13～24 Gate。

结构性验收：

- StartScreen 仅 no-project；
- candidate 位于 editor Banner；
- Controller owner = 1；
- LegacyWorkspace = 1；
- CanvasStage 不超过 2；
- HistoryControls 不超过 2；
- 旧选择器未减少；
- 根无整页无限滚动；
- 未实现 1B / 2 / 3 / 4 内容。

Stage 1A 实机通过仍不得将 M3 改为 PASS。

## 12. 实施切片与停止条件

精确的 1A-1～1A-5 文件、测试、完成标准、回滚点和停止条件以
`stage1a-execution-contract.md` 第 9、11 节为准。

全局停止条件：

- 需要改 Store / Controller / IPC / evaluator 行为；
- 需要第二套业务或 recovery 状态；
- 需要实现 1B 或阶段 2/3/4；
- 需要修双挂载或进入 Day 26；
- 需要放宽/跳过 Gate；
- 质量命令出现无法在当前切片定位的失败。

## 13. 历史事故口径

- Day 20 ShotManager 双挂载曾使 DOM 数量翻倍并导致复制 Gate 回归；
- 当前 CanvasStage / HistoryControls 双挂载属于同类结构风险，Stage 1A
  仅保持基线、不新增；
- 未来事件提前生效由正式 evaluator 的
  `if (timeMs < event.startMs) continue` 修复；
- 连续预设边界回跳的根因是 `createPresetEvents` 使用静态 Layer 基态，
  修复是在 `startMs` 调用正式 `evaluateShotAtTime` 获取真实状态；
- 两个时间问题不得混写；
- 禁止 production 路径重新使用 deprecated shared evaluator；
- 禁止用 `beforeunload` 替代 Electron close 合同。

## 14. 当前唯一下一步

```text
完成 Issue #59 文档提交并等待 PR #56 CI SUCCESS；
随后停止，等待主理人复核并明确要求重新执行 Stage 1A 开工审计。
```
