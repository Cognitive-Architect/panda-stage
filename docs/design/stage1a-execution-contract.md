# Panda Stage Stage 1A 执行合同

> Issue：#59 / #61 / #63
>
> 分支：`fix/m3-editor-shell`
>
> 本轮修订基线：`0652eda3cf0ac8ba2261b6631b9cef2b12ed36e4`
>
> 适用范围：Issue #55 的 Stage 1A
>
> 状态：1A-1～1A-5 已完成；Stage 1A 待人工验收

## 0. 冻结结论

Issue #59 统一了 Stage 1A 的范围、Controller 所有权、过渡挂载和白名单。
Issue #60 的复核又发现两个 HIGH 阻塞；Issue #61 在合同和 Gate 导航层将其关闭：

1. `.recovery-open-row` 在 `no-project` 与 `editor` 两态均有且只有一个明确来源；
2. 根页面继续禁止滚动，Day 19/21/22 Gate 同时支持当前 window 滚动和未来
   `LegacyWorkspace` 内部滚动。

当前合同与实施状态：

```text
1A-1 implementation = completed
1A-2 implementation = completed
1A-3 implementation = completed
1A-4 implementation = completed
1A-5 implementation = completed
Stage 1A implementation = completed / pending human acceptance

M3 = FAIL
PR #53 = Draft
PR #56 = Draft
Day 26~45 = frozen
```

没有新增顶层 Stage，也没有授权 Stage 1B、2、3、4。

## 1. 唯一范围

### 1.1 Stage 1A 允许

- `no-project | editor` 两个基础状态；
- StartScreen、固定 EditorShell、EditorTopBar；
- 打开项目、最近项目、editor 同窗口切换项目；
- debug / gateA 正交 flag；
- CSS Grid 与一个 `LegacyWorkspace` 过渡容器；
- recovery candidate 只在 editor 中显示；
- `ProjectSessionController` 由 EditorShell 唯一持有；
- 本合同白名单内测试与 Gate 兼容。

### 1.2 Stage 1A 禁止

- ProductPreviewOverlay、CloseConfirmDialog 新实现；
- 真正的新建项目、`project.createAt`、Renderer 拼接 projectRoot；
- Canvas / Left / Right / Bottom / History / ActionPreset 的正式迁移；
- 修复 CanvasStage / HistoryControls 现有双挂载；
- 修改 Store、Controller、IPC、domain evaluator 行为；
- Stage 1B、2、3、4 或 Day 26。

Stage 1A 的 NewProjectButton 必须禁用并标明后续阶段启用，不得调用 create API。

## 2. 最终组件树

```text
App
└─ EditorShell
   ├─ StagePreview                              [gateA 正交 overlay]
   ├─ StartScreen                              [no-project]
   │  ├─ NewProjectEntry
   │  ├─ ProjectOpenEntry                      [.recovery-open-row]
   │  └─ RecentProjectsPanel
   └─ EditorLayout                             [editor]
      ├─ EditorRecoveryRegion                  [.recovery-panel]
      │  ├─ EditorTopBar
      │  │  ├─ ProjectSwitchEntry              [.recovery-open-row]
      │  │  └─ SaveStatus                      [.recovery-status-row
      │  │                                      + .editor-save-button]
      │  └─ RecoveryCandidateBanner            [optional;
      │                                         .recovery-prompt;
      │                                         restore / ignore]
      └─ EditorBody
         ├─ LeftPlaceholder
         ├─ LegacyWorkspace                    [唯一旧树入口;
         │                                      data-testid=
         │                                      legacy-workspace-scroll]
         │  └─ existing legacy modules
         ├─ RightPlaceholder
         └─ BottomPlaceholder
```

`EditorRecoveryRegion` 是 `EditorShell.tsx` 中组合 TopBar 与可选 Banner 的 wrapper
markup，不新增文件，也不是新 Stage。

## 3. Controller 与 recovery 合同

### 3.1 唯一所有权

```text
ProjectSessionController owner = EditorShell
```

只有 EditorShell 可以构造、保存 snapshot、调用 switchProject /
switchRecentProject，并在 shell 最终卸载时 dispose。StartScreen、TopBar、Banner、
LegacyWorkspace 和改造后的 ProjectRecoveryPanel 只能接收同一组 callbacks。

保持现有顺序不变：

```text
project.open
→ autosave.track
→ recovery.detect
→ old autosave.stop（切换项目时）
→ editorProjectStore.open
→ 返回 trackedProjectRoot / recoveryCandidate
→ EditorShell 更新 session snapshot
→ editor
```

restore / ignore 只清除同一 session snapshot 中的 candidate；不得建立第二份
recovery state，也不得延迟 `store.open()`。

### 3.2 `.recovery-open-row` 唯一归属

这是运行时不变量：

| 基础状态 | 唯一来源 | candidate 为 null 的影响 |
|---|---|---|
| `no-project` | StartScreen / ProjectOpenEntry | 无；入口仍存在 |
| `editor` | EditorTopBar / ProjectSwitchEntry | 无；切换入口仍存在 |

- 任一时刻 `.recovery-open-row` 数量必须等于 1；
- RecoveryCandidateBanner 只拥有 candidate 状态、restore、ignore 和
  `.recovery-prompt`，绝不拥有唯一打开/切换入口；
- candidate 出现或消失不得增删 editor 的 ProjectSwitchEntry；
- Day 20 / Day 24 的同窗口第二项目切换继续复用 EditorShell 的同一
  `switchProject` callback；
- StartScreen 与 EditorLayout 互斥，禁止隐藏 DOM 冒充唯一性。

### 3.3 Day 13 兼容外壳

Day 13 在 candidate 出现后从 `.recovery-panel` 查询：

```text
#recovery-heading
.clean-state
.recovery-open-row input + Open and check recovery
.recovery-prompt
Save recovered project
```

editor 态由 `EditorRecoveryRegion.recovery-panel` 包住 TopBar 和可选 Banner：

- TopBar 提供 heading、clean/dirty、永久 ProjectSwitchEntry、save status；
- Banner 只提供 prompt、candidate details、restore / ignore；
- candidate 非空时，Day 13 在同一 panel 内仍能读到完整合同；
- candidate 为空时，TopBar 和 ProjectSwitchEntry 不消失；
- 所有控件默认可见，不得使用 `display:none`。

## 4. LegacyWorkspace 与滚动合同

LegacyWorkspace 是 editor 态旧模块树的唯一入口。它只挂载一次，不复制旧树，
内部 `overflow-y:auto`，根保持不可滚动：

```tsx
<div
  className="legacy-workspace"
  data-testid="legacy-workspace-scroll"
>
```

```css
html, body, #root {
  height: 100%;
  margin: 0;
  overflow: hidden;
}

.editor-shell {
  height: 100vh;
  overflow: hidden;
}

.legacy-workspace {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
```

ProjectRecoveryPanel 只允许移除 Controller 私有所有权、已迁到 StartScreen /
EditorTopBar 的打开入口、已迁到 Banner 的 candidate UI 和已迁到 TopBar 的
save UI。RecentProjectsPanel 继续存在于 editor，callbacks 来自唯一 Controller。
不得借机修复双挂载或改变业务行为。

数量基线：

```text
ProjectSessionController owner = 1
LegacyWorkspace = 1
ActionPresetPanel = 1
CanvasStage = 2
HistoryControls = 2
```

## 5. Gate 与选择器合同

### 5.1 选择器来源

- StartScreen：`.recovery-panel`、`#recovery-heading`、
  `.recovery-open-row`、`.recent-projects-panel`；
- EditorRecoveryRegion：`.recovery-panel`、`.recovery-heading-row`；
- EditorTopBar：`#recovery-heading`、`.clean-state/.dirty-state`、
  `.recovery-open-row`、`Open and check recovery`、
  `.recovery-status-row`、`.editor-save-button`、`Save recovered project`；
- RecoveryCandidateBanner：`.recovery-prompt`、candidate details、
  restore、ignore；
- LegacyWorkspace：`[data-testid="legacy-workspace-scroll"]` 以及既有
  `.recent-projects-panel`、`.asset-library`、`.character-manager`、
  `.shot-manager`、`.project-canvas` 和既有 data-testid。

### 5.2 Day 19/21/22 双路径导航

Issue #61 只授权修改 `scripts/verify-day19.cjs`、
`scripts/verify-day21.cjs`、`scripts/verify-day22.cjs` 的滚动导航：

```text
若 [data-testid="legacy-workspace-scroll"] 存在
→ 滚动该 nested container
否则
→ 使用当前旧 UI 的 window.scrollTo fallback
→ 等待字体和两帧布局稳定
→ 断言目标矩形与活动 viewport 相交
→ 继续原业务断言
```

Day 19 还保留原有目标顶部偏移断言。三个脚本均不得放宽业务断言、增加 skip、
吞异常、恢复根滚动或操作隐藏 DOM。Day 13/14/16 不修改。

## 6. Stage 1A 精确白名单

以下表格直接构成当前 Stage 1A 施工授权；不得以旧 Issue、聊天记录或历史 commit
替代。

### 6.1 Production 白名单

| 文件 | 类型 | Stage 1A 允许做什么 | Stage 1A 禁止做什么 |
|---|---|---|---|
| `src/renderer/App.tsx` | 修改 | 只挂 `EditorShell`；保留并下传现有 gate/probe 输入 | 新挂第二套旧模块；修改 IPC/Store 行为 |
| `src/renderer/styles.css` | 修改 | Grid、根 overflow、LegacyWorkspace 内滚动、Stage 1A 选择器样式 | 用压缩旧长页冒充信息架构修复 |
| `src/renderer/features/recovery/ProjectRecoveryPanel.tsx` | 最小修改 | 移除私有 Controller owner；收敛为 legacy presenter；接受 props | 修改 Controller/Store 行为；修双挂载 |
| `src/renderer/shell/EditorShell.tsx` | 新增 | 基础状态、唯一 Controller owner、session snapshot、flags、组合入口 | 创建第二套 Project/History/Selection 状态 |
| `src/renderer/shell/StartScreen.tsx` | 新增 | `no-project` 入口组合 | 展示 recovery candidate |
| `src/renderer/shell/EditorTopBar.tsx` | 新增 | 项目名、save 状态、editor 常驻 project switch、flags、preview 禁用占位 | 实现 ProductPreview / CloseConfirm |
| `src/renderer/shell/NewProjectEntry.tsx` | 新增 | open、recent、真实新建禁用占位 | 调用 `project.create` / `project.createAt` |
| `src/renderer/shell/LegacyWorkspace.tsx` | 新增 | 旧模块树唯一临时入口与内部滚动 | 正式迁移或复制第二棵旧树 |
| `src/renderer/shell/RecoveryCandidateBanner.tsx` | 新增 | editor candidate、restore、ignore、Day 13 recovery 兼容 UI | 自建 Controller；第二份 candidate 状态；承担 project switch 唯一入口 |
| `src/renderer/shell/useDebugFlag.ts` | 新增 | 解析 `debug` / `gateA` 正交 flags | 写入 Project Store |

硬规则：

```text
除上述文件外，Stage 1A 不得修改其他 src/ 文件。
若实施必须越界，立即停止并新开授权 Issue。
```

### 6.2 Test 白名单

| 文件 | 类型 | 目的 |
|---|---|---|
| `tests/contract/dom-selectors.baseline.test.ts` | 修改 | 新旧选择器及唯一来源合同 |
| `tests/unit/editor-shell-state.test.ts` | 新增 | `no-project/editor`、flags、禁止 create |
| `tests/unit/editor-shell-controller.test.ts` | 新增 | Controller 唯一 owner、autosave/dispose 生命周期 |
| `tests/unit/project-session-controller.test.ts` | 修改（仅需时） | candidate 返回顺序既有行为回归，不改实现 |
| `tests/integration/editor-shell-project-session.test.ts` | 新增 | open → editor → candidate Banner → restore/ignore |
| `tests/integration/editor-shell-layout.test.ts` | 新增 | LegacyWorkspace 唯一、基线挂载数量、布局源码合同 |

这些路径分别匹配当前 `tests/contract/**/*.test.ts`、
`tests/unit/**/*.test.ts` 与 `tests/integration/**/*.test.ts` Vitest include。
Stage 1A 不安装 jsdom 或新测试框架；Node 测试不得冒充真实 Electron 布局验收。

硬规则：

```text
除上述测试文件外，Stage 1A 不得修改其他测试文件。
若必须越界，立即停止并新开授权 Issue。
```

### 6.3 Gate 脚本

Gate 脚本原则上只运行、不修改。Issue #61 已授权并完成的 Day 19/21/22 双路径
滚动合同保持不变；Stage 1A 实施不得再次调整其业务断言。若仍需修改任何 Gate，
立即停止并新开授权 Issue。

## 7. 测试与验收

Stage 1A 新增测试必须覆盖：

- 两态分别且始终只有一个 `.recovery-open-row`；
- editor candidate null/non-null 都保留 TopBar ProjectSwitchEntry；
- Banner 不拥有打开入口，只负责 restore / ignore；
- Day 13 editor recovery region 的组合兼容；
- Day 20/24 同窗口切换第二项目；
- LegacyWorkspace 唯一且包含 `data-testid="legacy-workspace-scroll"`；
- 根 overflow hidden、legacy 内部滚动；
- Controller owner = 1，旧挂载数量不增加；
- debug/gateA 不写 Project，Stage 1A 不调用 create API。

Issue #61 必须真实运行：

```bash
pnpm verify:day19
pnpm verify:day21
pnpm verify:day22
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

推送后必须等待 PR #56 的 Day 13～24 GitHub Actions 成功。

## 8. 1A-1～1A-5 合同状态

### 1A-1：Shell 状态与 Controller 所有权 — completed

正式名称：

```text
Shell state boundary and single ProjectSessionController ownership
```

#### 1A-1 精确文件范围

生产文件：

```text
src/renderer/App.tsx
src/renderer/features/recovery/ProjectRecoveryPanel.tsx
src/renderer/shell/EditorShell.tsx
```

测试文件：

```text
tests/unit/editor-shell-state.test.ts
tests/unit/editor-shell-controller.test.ts
tests/integration/editor-shell-project-session.test.ts
```

`tests/unit/project-session-controller.test.ts` 仅在补充既有行为回归时允许修改，
且不得修改 `ProjectSessionController` 生产实现。

#### 1A-1 只允许完成

- 建立 EditorShell 基础边界；
- 建立 `no-project / editor` 基础判定；
- EditorShell 成为唯一 `ProjectSessionController` 构造点和生命周期 owner；
- 将 autosave update / onError / dispose 生命周期提升到 EditorShell；
- ProjectRecoveryPanel 移除私有 Controller 构造/销毁并改为最小 props presenter；
- 保持现有 open / recent / save / restore / ignore API 行为不变；
- 增加 state / owner / dispose / session 回归测试。

1A-1 的过渡渲染仍保留当前可启动、可操作的 Electron UI 和 recovery selector。
App 只组合 EditorShell；EditorShell 在本切片内继续挂载当前旧表面与
ProjectRecoveryPanel presenter。打开、recent、save、restore、ignore 控件只改为
接收 shell 的 session/callback props，不迁移到尚未实现的后续组件。

#### 1A-1 明确禁止

- StartScreen 完整 UI、NewProjectEntry；
- RecoveryCandidateBanner、EditorTopBar；
- Grid / LegacyWorkspace 或 CSS 布局重构；
- ProductPreviewOverlay、CloseConfirmDialog、`project.createAt`；
- 修改 ProjectSessionController、Store 或 IPC 行为；
- 修复 CanvasStage / HistoryControls 双挂载；
- 实施 1A-2～1A-5、Stage 1B～4 或 Day 26。

#### 1A-1 完成标准

- [ ] `EditorShell` 是唯一 Controller 构造点；
- [ ] `ProjectRecoveryPanel` 不再 `new ProjectSessionController`；
- [ ] Controller 行为与公开 API 未改；
- [ ] `no-project / editor` 基础状态可独立测试；
- [ ] autosave update / onError / dispose 生命周期由 EditorShell 单一管理；
- [ ] StartScreen / Banner / TopBar / Grid 尚未实现；
- [ ] typecheck、lint、unit、integration、build、当前 Electron UI 与既有关键
      Gate 保持可用；
- [ ] 不依赖 1A-2～1A-5 才能编译、启动或恢复运行。

#### 1A-1 独立提交与回滚合同

```text
1A-1 必须作为单一独立 commit 提交。
建议 commit message：
refactor(m3): establish editor shell session ownership
```

1. 该单一 commit 必须独立通过 typecheck、lint、unit、integration、build，
   能启动当前 Electron UI，并运行既有关键 Gate；
2. 不允许依赖 1A-2～1A-5 才保持编译或启动；
3. 回滚只允许 revert 该单一 commit；
4. 回滚后必须精确恢复到 Issue #61 后的基线；
5. 回滚不得撤销或破坏 Day 19/21/22 nested-scroll Gate 合同；
6. 回滚不得改变 PR #56 Draft、M3 FAIL 或 Day 26～45 frozen 状态。

立即停止条件：

- 需要修改 ProjectSessionController 生产实现；
- 需要修改 Store / IPC；
- 需要提前实现 1A-2～1A-5；
- 需要白名单外文件；
- 单独完成后无法编译、启动或通过基础 Gate；
- 无法用单一 commit 安全回滚。

### 1A-2：StartScreen + 入口 — completed

StartScreen 拥有 no-project 唯一 ProjectOpenEntry；open / recent 使用 shell
callbacks；NewProjectButton 禁用。

### 1A-3：RecoveryCandidateBanner — completed

Banner 只在 editor candidate 非空时出现，只拥有 prompt、restore、ignore；
它不拥有 `.recovery-open-row`，也不建立第二份 candidate state。

### 1A-4：EditorTopBar — completed

TopBar 在 editor 态永久拥有 ProjectSwitchEntry、clean/dirty、save status；
candidate null 不移除切换入口；Day 20/24 同窗口切换保持可用。

### 1A-5：Grid + LegacyWorkspace — completed

根 overflow hidden；唯一 LegacyWorkspace 内滚动并声明
`data-testid="legacy-workspace-scroll"`；Day 19/21/22 使用已迁移的双路径导航。

每个切片仍须独立实现、测试、提交和回滚。需要改 Store / Controller / IPC、
双挂载、Stage 1B/2/3/4 或 Day 26 时必须停止并重新授权。

## 9. 文档修订防回归规则

1. 局部 Issue 只能增量修改目标合同，不得删除其他已验收章节；
2. 精简内容前必须做语义等价检查；
3. production whitelist、test whitelist、slice DoD、rollback contract
   属于不可省略章节；
4. 禁止仅引用旧 Issue、聊天记录或历史 commit 作为当前施工授权；
5. 若本轮只修 selector / Gate 导航，不得覆盖文件白名单或回滚合同；
6. 每次修订后必须 grep 并通读核验上述四类章节仍存在。

## 10. 当前唯一下一步

Stage 1A 实现已完成，等待真实 Windows Electron 人工验收与主理人后续授权。
Stage 1B～4 与 Day 26 仍未开始；M3 仍为 FAIL。
