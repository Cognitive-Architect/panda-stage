# Panda Stage Stage 1A 执行合同

> Issue：#59
> 分支：`fix/m3-editor-shell`
> 状态：施工合同；本文件本身不授权编码
> 基线：`5ed72a8e696884e0f769dda52d3858a1db0bd417`
> 适用范围：Issue #55 的 Stage 1A
> 权威性：Stage 1A 实施时，本文件优先于旧版设计中的历史描述

## 0. 结论与冻结状态

Stage 1A 的五个合同阻塞在本文中统一为一套可执行规则：

1. Stage 1A / 1B 范围唯一；
2. recovery candidate 只在 `editor` 中展示；
3. `ProjectSessionController` 由 `EditorShell` 唯一持有；
4. 旧模块由一个 `LegacyWorkspace` 过渡承载；
5. 生产文件和测试文件白名单与 DoD 一致。

当前仍然是：

```text
M3 = FAIL
PR #53 = Draft
PR #56 = Draft
Day 26~45 = frozen
Stage 1A = not started
```

完成本合同不代表已实现 Editor Shell，也不代表 M3 PASS。

## 1. 唯一 Stage 1A / 1B 口径

### 1.1 Stage 1A 允许

```text
- no-project | editor 两个基础状态
- StartScreen
- EditorShell 固定骨架
- EditorTopBar
- debug / gateA 正交 flag 接口
- CSS Grid 布局
- LegacyWorkspace 过渡容器
- 打开项目 / 最近项目正式接通
- recovery candidate 在 editor 内展示
- ProjectSessionController 提升为 EditorShell 唯一所有者
- 旧 Gate 选择器兼容与 Stage 1A 测试
```

### 1.2 Stage 1A 禁止

```text
- ProductPreviewOverlay
- CloseConfirmDialog 新实现
- project.createAt IPC
- Renderer 拼接 Windows projectRoot
- 调用旧 project.create 完成真正创建
- Canvas / LeftWorkspace 正式迁移
- History / Inspector / ActionPreset 正式迁移
- DebugWorkspace 正式迁移
- 修复 CanvasStage / HistoryControls 双挂载
- 修改 Store / domain evaluator / IPC / Controller 行为
- Day 26 时间轴
```

`EditorTopBar` 的预览按钮在 1A 只是禁用占位，标明“后续阶段启用”。

### 1.3 Stage 1B（需再次明确授权）

```text
- ProductPreviewOverlay
- CloseConfirmDialog
- 完整新建项目 UX
- project.createAt IPC
- Main 使用 Node path.join 生成 projectRoot
- 内部继续复用 ProjectService.create
```

Stage 1A 的 NewProjectButton 必须禁用或仅显示“后续阶段启用”，不得调用
`window.pandaStage.project.create`。

## 2. 最终组件树

```text
App
└─ EditorShell
   ├─ StagePreview                           [gateA 正交 overlay；既有能力]
   ├─ StartScreen                           [no-project]
   │  └─ NewProjectEntry
   │     ├─ NewProjectButton                [disabled / 后续阶段启用]
   │     ├─ ProjectOpenEntry                [.recovery-open-row]
   │     └─ RecentProjectsPanel
   │
   └─ EditorLayout                          [editor]
      ├─ EditorTopBar
      │  └─ SaveStatus                      [.recovery-status-row
      │                                      + .editor-save-button]
      ├─ RecoveryCandidateBanner            [optional]
      │                                      [.recovery-panel
      │                                       + .recovery-prompt
      │                                       + Day 13 compatibility controls]
      ├─ EditorBody
      │  ├─ LeftPlaceholder                 [临时]
      │  ├─ LegacyWorkspace                 [临时；唯一入口]
      │  │  ├─ 旧 ActionPresetPanel
      │  │  ├─ 旧 HistoryControls
      │  │  ├─ 旧 CanvasStage
      │  │  └─ ProjectRecoveryPanel
      │  │     ├─ RecentProjectsPanel
      │  │     ├─ AssetLibrary
      │  │     ├─ CharacterManager
      │  │     ├─ ShotManager
      │  │     └─ 旧 CanvasStage
      │  └─ RightPlaceholder                [临时]
      └─ BottomPlaceholder                  [临时]
```

### 2.1 节点合同

| 节点 | 挂载条件 | 读取来源 | 写业务状态 | 临时性 / 后续 |
|---|---|---|---|---|
| `EditorShell` | 始终 | `editorProjectStore`、session snapshot、URL flags | 仅通过现有 Controller / save API | 长期根节点 |
| `StagePreview` | `gateA`（现有 probe 合同） | Gate A probe | 否 | Stage 4 再做正式 Debug 隔离 |
| `StartScreen` | snapshot 为 `null` | shell callbacks | 打开成功时由 Controller 写 store | editor 后卸载 |
| `NewProjectEntry` | no-project | shell callbacks、最近项目 API | 不直接写 Store | Stage 1B 增强新建 |
| `EditorTopBar` | editor | Project snapshot | 仅现有 `saveCurrentProject` | 长期 |
| `RecoveryCandidateBanner` | editor 且 candidate 非空 | session snapshot | restore 经 store；ignore 经 recovery API | 长期入口，样式可后续调整 |
| `LegacyWorkspace` | editor | 旧组件现有 Store | 旧组件按原合同写入 | Stage 2/3 逐项清空，Stage 3 删除 |
| Placeholders | editor | 无 | 否 | Stage 2/3 替换 |

## 3. ProjectSessionController 唯一所有权

### 3.1 唯一所有者

```text
ProjectSessionController owner = EditorShell
```

只有 `EditorShell` 可以：

- `new ProjectSessionController(...)`；
- 保存 session snapshot；
- 调用 `switchProject` / `switchRecentProject`；
- 在 shell 最终卸载时调用 `dispose()`；
- 向子组件传递 recovery candidate 和 restore / ignore callbacks。

以下组件不得创建 Controller：

- `StartScreen`；
- `NewProjectEntry`；
- `RecoveryCandidateBanner`；
- `LegacyWorkspace`；
- Stage 1A 改造后的 `ProjectRecoveryPanel`。

### 3.2 打开与 recovery 顺序

保持现有 `ProjectSessionController.switchWith` 行为不变：

```text
project.open
→ autosave.track
→ recovery.detect
→ old autosave.stop（切换项目时）
→ editorProjectStore.open
→ 返回 { trackedProjectRoot, recoveryCandidate }
→ EditorShell 更新 session snapshot
→ 基础态成为 editor
→ candidate 非空时挂载 RecoveryCandidateBanner
```

不得为了把 candidate 留在 StartScreen 而延迟或重写 `store.open()`。

### 3.3 restore / ignore

- restore：
  1. Banner 调现有 `window.pandaStage.recovery.restore`；
  2. 成功后调用唯一 `editorProjectStore.restore`；
  3. 调 Controller 的 `clearRecoveryCandidate()`；
  4. 更新 shell session snapshot，Banner 消失。
- ignore：
  1. Banner 调现有 `window.pandaStage.recovery.ignore`；
  2. 成功后调用 Controller 的 `clearRecoveryCandidate()`；
  3. 更新 shell session snapshot，Banner 消失。
- 两条路径都不得创建第二份 recovery state。

### 3.4 Day 13 兼容外壳

现有 `verify-day13.cjs` 在项目打开、candidate 已出现后，仍从
`.recovery-panel` 查询以下旧合同：

```text
#recovery-heading = Crash recovery
.clean-state = Clean
.recovery-open-row input + Open and check recovery
.recovery-prompt
Save recovered project
```

因此 Stage 1A 的 `RecoveryCandidateBanner` 必须临时承接上述兼容控件：

- 打开控件复用 `EditorShell` 的同一个 `switchProject` callback；
- Save recovered project 复用 EditorTopBar 的同一个保存 callback；
- clean/dirty 读取同一个 editor snapshot；
- candidate 仍只来自唯一 session snapshot；
- StartScreen 已在 editor 态卸载，所以 `.recovery-open-row` 和
  `.recovery-panel` 在任一时刻仍只有一份；
- 兼容控件默认可见，不得用 `display:none` 欺骗 Gate。

这只是 Stage 1A Gate 兼容，不把 recovery candidate 重新归属 StartScreen，
也不授权修改 Day 13 Gate。

### 3.5 autosave 生命周期

- Controller 成功 track 后，由 `EditorShell` 的现有 snapshot effect 调用
  `window.pandaStage.autosave.update`。
- 组件切换、StartScreen 卸载、LegacyWorkspace 滚动均不得调用 `dispose()`。
- 只有 `EditorShell` 最终卸载才 `dispose()`。
- Stage 1A 改造后的 `ProjectRecoveryPanel` 不再注册 autosave error/update/stop
  生命周期。

## 4. LegacyWorkspace 过渡合同

### 4.1 唯一入口

`LegacyWorkspace` 是 editor 态旧模块树的唯一入口。`App.tsx` 不再平行挂载
ActionPreset、History、Canvas 或 `ProjectRecoveryPanel`。

`LegacyWorkspace`：

- 只挂载一次；
- 原样承载旧业务模块；
- 可以搬运 App 中现有的局部 probe UI / 局部 React state，但不得改变 IPC
  或业务行为；
- 自己内部 `overflow-y:auto`；
- 不用 `display:none` 隐藏 Gate 目标；
- 不复制第二棵旧模块树。

### 4.2 ProjectRecoveryPanel 最小改造

Stage 1A 允许对 `ProjectRecoveryPanel.tsx` 做且只做：

- 移除其 `ProjectSessionController` 私有创建和销毁；
- 移除已迁到 StartScreen 的 `.recovery-open-row` 打开入口；
- 保留 editor 中的 `RecentProjectsPanel`，但 open/recent 回调必须来自
  `EditorShell` 的同一个 Controller；StartScreen 与 editor 互斥，因此两处
  RecentProjectsPanel 不会同时挂载；
- 移除已迁到 Banner 的 recovery candidate UI；
- 移除已迁到 EditorTopBar 的 save status UI；
- 保留 RecentProjectsPanel、AssetLibrary、CharacterManager、ShotManager 和
  其内现有 CanvasStage；
- 接受来自 `EditorShell` / `LegacyWorkspace` 的只读或回调 props；
- 保持旧业务组件实现不变。

不得借机修复其 CanvasStage 挂载。

### 4.3 Stage 1A 数量基线

```text
CanvasStage = 2
HistoryControls = 2
ActionPresetPanel = 1
LegacyWorkspace = 1
ProjectSessionController owner = 1
```

Stage 1A 不要求 CanvasStage / HistoryControls 收敛为 1，但禁止出现第三处挂载。

## 5. Gate 与选择器迁移

### 5.1 默认可见选择器

- StartScreen：
  - `.recovery-panel`
  - `#recovery-heading`
  - `.recovery-open-row`
  - `.recent-projects-panel`
- EditorTopBar：
  - `.recovery-status-row`
  - `.clean-state` / `.dirty-state`
  - `.editor-save-button`
  - session 状态 `output`（打开/最近项目成功后仍含 `Project opened`）
- RecoveryCandidateBanner：
  - `.recovery-panel`
  - `#recovery-heading`
  - `.recovery-heading-row`
  - `.clean-state` / `.dirty-state`
  - `.recovery-open-row`（仅 candidate Banner 挂载时；StartScreen 已卸载）
  - `.recovery-prompt`
  - `Open and check recovery`
  - `Save recovered project`
- LegacyWorkspace：
  - `.recent-projects-panel`（editor 中继续可见，满足 Day 14）
  - `.asset-library`
  - `.character-manager`
  - `.shot-manager`
  - `.project-canvas`
  - `[data-testid="project-canvas-stage"]`
  - `[data-testid="project-canvas-viewport"]`
  - `[data-testid="history-controls"]`
  - `[data-testid="action-preset-panel"]`

Day 13 在打开后查询整套旧 recovery panel，因此 editor Banner 必须复用
上述选择器、按钮文案和同一回调。Day 14、22、23、24 使用的
`.recovery-status-row` 必须位于 editor 顶栏并保持可点击。

### 5.2 Gate 脚本

Stage 1A 原则上不得修改：

```text
scripts/verify-day13.cjs
scripts/verify-day14.cjs
scripts/verify-day16.cjs
```

若实现发现必须修改 Gate 导航或断言，立即停止并重新授权；不得放宽断言、
增加 skip 或操作隐藏 DOM。

## 6. 状态与生命周期表

| 状态 / 对象 | 唯一来源 | 生命周期所有者 | Stage 1A 行为 |
|---|---|---|---|
| Project / revision | `editorProjectStore` | 既有 Store | open 后进入 editor；视图切换不 open/clear |
| Session snapshot | `ProjectSessionController` | `EditorShell` | 保存 tracked root / candidate |
| recovery candidate | session snapshot | `EditorShell` | editor Banner 展示 |
| selectedShotId | `shotStore` | 既有 Store | 不迁移、不复制 |
| selectedLayerId | `selectionStore` | 既有 Store | 不迁移、不复制 |
| History | `historyStore` | 既有 Store | 仍双挂载基线，不新增 |
| Action Preset | `actionPresetStore` | 既有 Store | 命令链不变 |
| Canvas viewport | `canvasViewportStore` | 既有 Store | 不迁移、不复制 |
| debug / gateA | shell local flag | `EditorShell` | 不写 Project |
| LegacyWorkspace | shell local layout | `EditorShell` | 临时承载旧树 |

## 7. 精确文件与测试白名单

### 7.1 生产文件

| 文件 | 修改类型 | 允许做什么 | 禁止做什么 |
|---|---|---|---|
| `src/renderer/App.tsx` | 修改 | 只挂 `EditorShell`；保留/下传既有 gate/probe 输入 | 直接再挂一套旧模块；改 IPC |
| `src/renderer/styles.css` | 修改 | Grid、根 overflow、内部滚动、Stage 1A 选择器样式 | 仅压缩旧长页冒充重构 |
| `src/renderer/features/recovery/ProjectRecoveryPanel.tsx` | 最小修改 | 去 Controller 私有所有权；收敛为 legacy 内容 presenter | 改 Controller/Store 行为；修双挂载 |
| `src/renderer/shell/EditorShell.tsx` | 新增 | 状态、唯一 Controller、session、flags、组合布局 | 第二套 Project/History/Selection |
| `src/renderer/shell/StartScreen.tsx` | 新增 | no-project 入口组合 | 展示 recovery candidate |
| `src/renderer/shell/EditorTopBar.tsx` | 新增 | 项目名、save 状态/按钮、flags、preview 占位 | ProductPreview / CloseConfirm |
| `src/renderer/shell/NewProjectEntry.tsx` | 新增 | open、recent、新建禁用占位 | `project.create` / `createAt` |
| `src/renderer/shell/LegacyWorkspace.tsx` | 新增 | 唯一旧树入口与内部滚动 | 正式迁移/复制旧树 |
| `src/renderer/shell/RecoveryCandidateBanner.tsx` | 新增 | editor candidate、restore、ignore | 自建 Controller / 第二份 candidate |
| `src/renderer/shell/useDebugFlag.ts` | 新增 | 解析 debug/gateA | 写 Project |

除上表外，不得修改任何 `src/` 文件。

### 7.2 测试文件

仓库当前 Vitest 配置真实包含：

```text
tests/unit/**/*.test.ts
tests/contract/**/*.test.ts
tests/integration/**/*.test.ts
```

Stage 1A 白名单：

| 文件 | 修改类型 | 目的 |
|---|---|---|
| `tests/contract/dom-selectors.baseline.test.ts` | 修改 | 新旧选择器与来源组件合同 |
| `tests/unit/editor-shell-state.test.ts` | 新增 | no-project/editor、flags、禁止 create |
| `tests/unit/editor-shell-controller.test.ts` | 新增 | Controller 唯一所有权与 dispose 生命周期 |
| `tests/unit/project-session-controller.test.ts` | 修改（仅需时） | candidate 返回顺序的既有行为回归 |
| `tests/integration/editor-shell-project-session.test.ts` | 新增 | open→editor→Banner、restore/ignore |
| `tests/integration/editor-shell-layout.test.ts` | 新增 | LegacyWorkspace 唯一、挂载数量、布局合同 |

测试仍运行在 Node 环境；不得在 Stage 1A 安装 jsdom 或新测试框架。需要 DOM
数量的合同可以沿用源码级 contract 或用现有 Electron Gate 证明，不得伪称
Node 测试已完成真实浏览器布局验收。

### 7.3 Gate 脚本

原则上全部只运行、不修改。若必须改，停止并另行授权。

## 8. Stage 1A 必须新增的测试

- no-project 只组合 StartScreen；
- open 成功后 store 非空并进入 editor；
- candidate 随 Controller 返回后在 editor Banner 可见；
- candidate Banner 保留 Day 13 旧 panel 的标题、Clean、打开、保存与
  restore/ignore 兼容合同；
- Controller 构造点只有 `EditorShell` 一个；
- shell 卸载才 dispose，StartScreen/LegacyWorkspace 卸载不 stop session；
- LegacyWorkspace 只有一个入口；
- 旧关键选择器来源未减少；
- editing CanvasStage 不超过基线 2；
- HistoryControls 不超过基线 2；
- `.recovery-open-row` 继续可用；
- `.recovery-status-row` 与 `.editor-save-button` 共存；
- 新 shell 选择器存在；
- CSS 合同包含根 `overflow:hidden` 和 legacy 内部滚动；
- debug / gateA 不调用 `editorProjectStore.updateProject`；
- Stage 1A 不调用 `project.create`，且不存在 `project.createAt`。

## 9. 1A-1～1A-5 实施切片

### 1A-1：Shell 状态与 Controller 所有权

- 修改：`App.tsx`、`ProjectRecoveryPanel.tsx`。
- 新增：`EditorShell.tsx`、controller/state 测试。
- 完成标准：
  - `EditorShell` 是唯一 Controller 构造点；
  - snapshot null/non-null 对应 no-project/editor；
  - 不改变 Controller 实现。
- 回滚点：仅回滚本切片新增 shell 与 presenter 化改动。
- 停止条件：需要修改 Controller / Store 行为。

### 1A-2：StartScreen + 入口

- 新增：`StartScreen.tsx`、`NewProjectEntry.tsx`。
- 修改：契约测试。
- 完成标准：
  - `.recovery-open-row` 唯一；
  - open / recent 使用 EditorShell callbacks；
  - NewProjectButton 禁用且不调用任何 create API。
- 回滚点：移除入口组件并恢复 1A-1 shell。
- 停止条件：需要真实新建项目或 Renderer 路径拼接。

### 1A-3：RecoveryCandidateBanner

- 新增：`RecoveryCandidateBanner.tsx`。
- 修改：session integration test、契约测试。
- 完成标准：
  - candidate 仅在 editor 展示；
  - 保留 Day 13 要求的 `.recovery-panel/.recovery-prompt`、打开和保存兼容控件；
  - restore / ignore 清除同一 session snapshot。
- 回滚点：移除 Banner，不更改 Controller。
- 停止条件：需要延迟 `store.open` 或第二份 recovery state。

### 1A-4：EditorTopBar

- 新增：`EditorTopBar.tsx`。
- 修改：状态/契约测试。
- 完成标准：
  - 项目名、clean/dirty 正确；
  - `.recovery-status-row` 与 `.editor-save-button` 共存；
  - Ctrl+S/按钮复用 `saveCurrentProject`；
  - preview 仅禁用占位；
  - 不实现 CloseConfirmDialog。
- 回滚点：移除 TopBar，保留前三个切片。
- 停止条件：需要实现预览或应用内关闭确认。

### 1A-5：Grid + LegacyWorkspace

- 新增：`LegacyWorkspace.tsx`。
- 修改：`App.tsx`、`styles.css`、layout integration/contract test。
- 完成标准：
  - 固定顶/左/中/右/底骨架；
  - 根 `overflow:hidden`；
  - LegacyWorkspace 内部滚动且只挂一次；
  - 旧模块默认可见；
  - CanvasStage/HistoryControls 不超过基线数量；
  - 1366×768 实机无根级无限纵向滚动。
- 回滚点：回滚 Grid/LegacyWorkspace，恢复 1A-4。
- 停止条件：需要正式阶段 2/3 迁移或隐藏 Gate DOM。

## 10. 自动化与实机验收

### 10.1 自动化

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

推送后 GitHub Actions 必须继续执行并通过既有 Day 13～24 Gate。CI 才是
完整云端结果的权威证据。

### 10.2 结构性验收

- [ ] StartScreen 仅在 no-project 显示；
- [ ] editor 不显示 StartScreen；
- [ ] candidate 在 editor Banner 显示；
- [ ] Controller 只有一个所有者；
- [ ] LegacyWorkspace 只有一个；
- [ ] 根页面不依赖整页纵向滚动；
- [ ] 旧模块默认可见；
- [ ] 旧 Gate 选择器未减少；
- [ ] CanvasStage 不新增第三挂载；
- [ ] HistoryControls 不新增第三挂载；
- [ ] 未实现 ProductPreviewOverlay；
- [ ] 未实现 CloseConfirmDialog；
- [ ] 未实现 `project.createAt`；
- [ ] 未进入阶段 2/3/4。

### 10.3 实机验收

```text
启动应用
→ 无项目时看到 StartScreen
→ 打开项目
→ 进入固定 EditorShell
→ candidate 如存在则在 editor 显示
→ 顶栏状态正确
→ 旧功能仍可在 LegacyWorkspace 找到
→ 页面根不再无限向下滚动
```

Stage 1A 实机通过仍不得将 M3 改为 PASS。

## 11. 全局停止条件

出现任一情况立即停止：

- 需要修改 Store、Controller、IPC、ProjectService 或 evaluator 行为；
- 需要第二套 Project / Selection / History / recovery state；
- 需要实现 ProductPreviewOverlay、CloseConfirmDialog、真实新建项目或
  `project.createAt`；
- 需要 Renderer 拼接 Windows `projectRoot`；
- 需要正式迁移 Canvas / LeftWorkspace / History / Inspector /
  ActionPreset / DebugWorkspace；
- 需要修复双挂载或开始 Day 26；
- 需要修改 Gate 断言、skip 测试或操作 `display:none` DOM；
- 任一质量命令红且无法在当前切片内定位。

## 12. Codex 下一步

```text
等待主理人复核 Issue #59 的三份文档与 CI。
只有收到新的明确授权后，才重新执行 Stage 1A 开工审计；
审计通过后才允许开始 1A-1。
```
