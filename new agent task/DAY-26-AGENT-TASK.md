# Panda Stage Agent Task — Day 26

> **源工单编号**：R-26/45  
> **执行工单编号**：B-26/45  
> **标题**：Editor Workspace Completion + Timeline Shell  
> **角色**：Engineer  
> **模板**：ID-59 v3.0 通用增强版  
> **路线状态**：Day 26～45 Rebaseline v1  
> **派单基线**：`main@e4837e853fd6dceb11abf2a5cb009665e4cd29e3`  
> **核心范围声明**：Stage 3-B / ActionPreset / PR #177 不属于当前核心路线，不得作为本工单前置或顺手复活。

---

# 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Day 26 — Editor Workspace Completion + Timeline Shell
- **轰炸目标**：在当前正式 `EditorShell` / `BottomWorkspace` 架构上完成桌面工作区收口，并新增只负责当前镜头时间定位的 Timeline Shell，使用户能在真实 Windows Electron 中完成“选镜头 → 看画布/Inspector → 点击或拖动播放头 → 切镜头”的连续主路径。
- **任务性质**：功能开发 + UI 状态管理 + 时间坐标几何 + 工作区收口 + 真实产品验收
- **输入基线**：以本工单【模块2】完整技术背景为唯一开工基线；开工前重新记录实际分支与 HEAD，若 `main` 已前进，先确认前进内容不会改变本工单 owner / 路径 / 产品边界。
- **输出要求**：可执行 Timeline Shell + 可复现自动化验证 + 真实 Windows Electron 验收 + 显式债务声明 + `docs/test-receipts/DAY-26.md` 结构化收卷。
- **用户可见结果**：打开真实项目后，首屏能持续看到中央唯一画布、左侧资源导航、右侧 Inspector、底部工作区；用户能看到当前镜头时间尺与时间码，并能点击/拖动播放头定位当前镜头时间。

## 通用铁律

1. **数据诚实**：测试数、warning 数、PASS/FAIL、窗口尺寸、HEAD、文件数量只能来自真实命令或真实 Windows Electron 操作。
2. **零占位符**：不得提交“TODO 后补”“临时 Timeline”“假播放头”“先写死一个 5 秒镜头”等占位实现。
3. **自动化优先**：时间/像素换算、clamp、24 FPS 吸附、镜头切换规则必须能自动验证；自动化不能代替真人产品验收。
4. **最小必要复杂度**：Day 26 只做 Timeline Shell / Playhead，不借机建设通用动画系统、事件编辑器、关键帧或多轨 NLE。
5. **债务透明化**：缺失的 component test 基础设施、响应式限制、未覆盖浏览器能力等必须用 `DEBT-*` 记录，禁止用“后续优化”糊过去。
6. **当前生产 owner 优先**：不得照旧蓝图重新创建平行 `EditorShell`、平行 Canvas、平行 Inspector、平行资源 Dock。
7. **真人安全门优先**：自动化全绿但真实 Electron 主路径 FAIL，则 Day 26 = FAIL。

---

# 【模块2】输入基线（完整技术背景，零占位符）

## 2.1 Git 与路线坐标

| 输入项 | 当前已确认事实 | 开工验证命令 / 证据 | 状态 |
|---|---|---|---|
| Git 坐标 | 派单时 `main@e4837e853fd6dceb11abf2a5cb009665e4cd29e3`；该 HEAD 含 `new agent task/README.md` 初始化提交 | `git branch --show-current`；`git rev-parse HEAD`；`git log --oneline -n 5` | 必须重新记录 |
| 目标路线 | Day 26～45 Rebaseline v1；Stage 3-B / ActionPreset 已移出当前核心路线 | 本工单 + 当前事实面板 + Git 历史 | 必须 |
| 上一稳定产品能力 | Stage 3-A / Stage 3-C / Stage 4 已进入 main；当前编辑器已有正式 Canvas / Inspector / BottomWorkspace owner | 生产 import 图 + 现有回归测试 | 必须保留 |
| 禁止继承线 | PR #128/#163/#165/#177 均不得作为默认施工基线 | `git branch --show-current`；`git diff main...HEAD --name-only` | 硬边界 |

> **开工分支规则**：从开工时最新稳定 `main` 新建 Day 26 分支，不从任何 Stage 3-B 历史分支继续施工。

## 2.2 当前生产代码事实

### A. 顶层工作区 owner

**文件**：`src/renderer/shell/EditorShell.tsx`

- 当前相关区域：约 `850–930` 行为产品渲染主区；开工前用 `nl -ba src/renderer/shell/EditorShell.tsx | sed -n '840,940p'` 锁定实际行号。
- 已确认当前生产树在 editor 状态直接挂载：
  - `LeftWorkspace`
  - `CanvasWorkspace`
  - `RightInspector`
  - `BottomWorkspace`
- `CompactProjectBar` 已作为顶部产品入口的一部分存在。
- **结论**：Day 26 不得重新造第二个 Editor root；只能在当前 owner 图上收口。

### B. 底部正式 owner

**文件**：`src/renderer/shell/BottomWorkspace.tsx`

- 当前相关区域：`1–17`。
- 当前只挂载 `HistoryControls`。
- **结论**：Day 26 的 Timeline 必须进入这个正式底部 owner；不得挂回旧纵向页面，也不得另起平行底部根。

### C. 中央 Canvas owner

**文件**：`src/renderer/shell/CanvasWorkspace.tsx`

- 当前相关区域：`1–18`。
- 当前直接挂载唯一生产 `CanvasStage`；注释已明确 History 归 `BottomWorkspace`。
- **结论**：Day 26 不迁移、不复制 Canvas；只验证其在新增 Timeline 后仍保持唯一生产实例和可用空间。

### D. 左侧资源工作区

**文件**：`src/renderer/shell/LeftWorkspace.tsx`

- 当前相关区域：`1–42`。
- 当前正式使用 `ResourceActivityDock`，同时仍带 `ProjectRecoveryPanel` 与 `LegacyCompatibilityActivity` 辅助内容。

**文件**：`src/renderer/shell/ResourceActivityDock.tsx`

- 当前相关区域：`1–235`；开工前用 `nl -ba ... | sed -n '1,260p'` 锁定。
- 已确认 `shots / assets / characters` 三个 Activity 互斥显示，并已经分别复用 `ShotManager / AssetLibrary / CharacterManager`。
- 已有窄窗口 drawer 行为。
- **结论**：原工单“把镜头/素材/角色迁进左 Dock”已基本完成，本轮禁止重复实现；只做回归与必要收口。

### E. 右侧 Inspector owner

**文件**：`src/renderer/shell/RightInspector.tsx`

- 当前相关区域：`1–137`。
- 当前直接订阅 `editorProjectStore / shotStore / selectionStore`，正式承载背景、变换、排序能力。
- **结论**：RightInspector 已是正式 owner；Day 26 不迁 ActionPreset 进来，不创建第二套 Inspector。

### F. 镜头选择与 duration 事实

**文件**：`src/renderer/stores/shotStore.ts`

- 当前相关区域：`1–146`。
- 已确认：
  - `getCurrentShotId()` 提供当前镜头身份；
  - `select(shotId)` 切当前镜头；
  - `setDuration(shotId, durationMs)` 属于项目修改，会进入 `EditorProjectStore`；
  - 项目切换会重新协调 current shot。
- **结论**：Timeline 只读取当前镜头与 `durationMs`；拖动播放头不能调用 `setDuration`，不能通过 `EditorProjectStore.updateProject` 写项目。

### G. 项目账本

**文件**：`src/renderer/stores/EditorProjectStore.ts`

- 当前文件存在且为项目 snapshot / dirty / revision / History 账本。
- **Day 26 硬规则**：播放头、Timeline zoom、scroll、底部高度/折叠属于 UI/Preview 状态，不得进入这里的项目 mutation 路径。

### H. Timeline 当前缺口

派单前对 `main` 进行仓库搜索，`timeline / playhead / TimelineDock / TimelineShell` 未发现当前生产实现。

- **结论**：Day 26 允许在现有 renderer feature 结构下新增正式 Timeline feature；禁止从 Stage 3-B 分支搬入实现。

## 2.3 默认变更范围

### 允许修改 / 新增

1. `src/renderer/shell/BottomWorkspace.tsx`
2. `src/renderer/styles.css` 中现有 `.editor-layout` / `.editor-body` / `.bottom-workspace` / 相关响应式规则；开工前用 `grep -n` 锁定实际区段
3. `src/renderer/features/timeline/TimelineDock.tsx`（新增，底部 Timeline 唯一产品 surface）
4. `src/renderer/features/timeline/timeGeometry.ts`（新增，时间↔像素、clamp、帧吸附纯函数）
5. `src/renderer/features/timeline/timelineUiStore.ts`（新增，仅 UI/Preview session 状态；若实现证明确实不需要独立 store，可省略并在收卷记录 DECISION）
6. `tests/unit/*timeline*`（新增/扩展纯函数与状态边界测试）
7. `tests/integration/editor-shell-layout.test.ts`（扩展现有工作区/cardinality/布局合同）
8. 与 Timeline 真实行为直接相关的 integration test（如现有测试结构不足，可新增独立文件）
9. `docs/test-receipts/DAY-26.md`

### 条件修改

- `src/renderer/shell/EditorShell.tsx`：仅当 Timeline 所需上下文无法通过现有 store owner 安全读取时修改；必须说明为什么不能由 `BottomWorkspace` / Timeline feature 自己消费现有状态。
- `src/renderer/shell/LeftWorkspace.tsx`、`ResourceActivityDock.tsx`、`RightInspector.tsx`、`CanvasWorkspace.tsx`：原则上只做 Day 26 必需的布局/可用性收口，不得重写已稳定业务。

### 明确禁止修改 / 复活

- PR #177 或任何 Stage 3-B successor 分支代码
- ActionPreset UI / ActionPreset workflow
- 通用 TimelineEvent 编辑器
- 动作事件 clip、关键帧、曲线、多轨 NLE
- 通用动画 evaluator / sequential composition
- 为兼容旧 Gate 创建第二份 `CanvasStage` / `HistoryControls` / `RightInspector` / Timeline
- 将播放头写入 `project.json`、History、dirty/revision mutation
- 用隐藏 DOM / `display:none` 留旧副本过测试
- 用根页面滚动容纳新增 Timeline

## 2.4 目标结果

Day 26 完成时必须同时成立：

1. 当前工作区仍由一个正式 `EditorShell` 驱动。
2. 中央只有一个生产 `CanvasStage`。
3. `BottomWorkspace` 同时承载现有 History 与一个 Timeline 产品 surface，布局关系可理解。
4. Timeline 显示当前镜头 `0 → durationMs` 时间范围与 `mm:ss.mmm` timecode。
5. 点击 ruler 可 seek；拖动 playhead 可连续 seek。
6. seek 永远 clamp 在 `[0, durationMs]`。
7. 24 FPS snap 由集中纯函数实现；内部结果保持整数毫秒。
8. zoom / 横向 scroll 只改变显示映射，不改变真实时间。
9. 切换镜头后 Timeline 读取新镜头 duration，并按本工单规则将 playhead 重置为 `0 ms`。
10. 所有 Timeline UI 操作不改变 `projectSnapshot.dirty`、revision、History 长度或 `project.json`。
11. 1366×768 真实 Electron 可连续完成主路径；800×560 仍能访问镜头、Canvas、Inspector 和 Timeline 展开/折叠，不依赖根页面业务滚动。

## 2.5 时间合同

- 项目时间继续使用整数毫秒。
- FPS = 24。
- 帧吸附统一集中在 `timeGeometry.ts`；禁止组件内散落不同公式。
- 推荐语义：以整数 frame index 为离散基准，时间值通过统一函数换算并四舍五入为整数毫秒，最终 clamp 到镜头 duration。
- `timeToPx` / `pxToTime` 只负责显示几何，不修改项目模型。
- Timeline viewport 宽度/zoom 变化后，同一 `currentTimeMs` 必须仍代表同一真实时间。

## 2.6 当前测试工具链事实

当前 `package.json` 已确认存在：

```text
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm dev
```

当前依赖中存在 Vitest，但未确认已安装 React Testing Library / Playwright；**不得把不存在的 component/E2E 工具写成“已具备”**。

当前仓库已存在：

- `tests/integration/editor-shell-layout.test.ts`
- `tests/integration/editor-shell-project-session.test.ts`
- `tests/integration/history-lifecycle.test.ts`
- 既有 Day 13～24 与多个 Issue verifier

### 派单时测试状态

**UNVERIFIED AT TASK AUTHORING**：本工单只确认命令存在，没有替 Engineer 声称当前 HEAD 已执行并通过这些命令。

开工第一阶段必须真实执行并记录：

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --check
```

如果开工基线本身失败，先记录 baseline failure；不得把历史失败算成本轮新增，也不得带着无法解释的基线失败继续堆 Timeline。

## 2.7 文档同步

必须新建或更新：

- `docs/test-receipts/DAY-26.md`

回执至少包含：

- 开工 HEAD / 收卷 HEAD
- 实际变更文件
- 时间合同与 snap 规则
- 自动化命令 + 输出摘要
- 真实 Windows Electron 操作步骤
- 1366×768 与 800×560 结果
- dirty / History / revision 不变证据
- PASS / FAIL
- 债务
- 下一步唯一动作

## 2.8 历史债务 / 相关回归点

1. Stage 3-B 已证明“临时草稿/目标身份/预览状态混写”能造成跨目标 mutation；Day 26 的 Timeline UI 状态必须与项目 mutation 明确隔离。
2. Stage 3-B 已证明 CI 全绿不能替代真实 Windows Electron 主路径。
3. `LegacyCompatibilityActivity` 仍存在于左侧辅助内容；本日不以“顺手清掉所有历史兼容层”为目标，除非它直接阻塞 Day 26 主路径。
4. `styles.css` 体积较大；本日不得借 Timeline 顺手发起全量 Design System 重写。

## 2.9 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 正式 EditorShell / CanvasWorkspace / RightInspector / ResourceActivityDock / BottomWorkspace 已存在；BottomWorkspace 当前只有 History；main 未发现 Timeline/Playhead 产品实现 |
| 待确认问题 | 1）Timeline 当前时间状态用独立 store 还是局部 + shot subscription 最简单；2）BottomWorkspace 的折叠/高度是否本日必须持久化；3）现有 CSS 在 800×560 加入 Timeline 后最小可用高度如何分配 |
| 预期输出 | 一个不碰项目数据、不依赖 ActionPreset、可真人操作的 Timeline Shell 与明确的 UI 状态 owner |
| 停止条件 | 上述 3 个问题均通过源码 + 实现证据收敛，且无需改变 ActionPreset / TimelineEvent / evaluator 语义即可完成目标；若需要改变这些语义，触发 ARCH-001 停止 |

---

# 【模块3】工单矩阵（通用高压版）

## B-26/45｜Engineer｜Editor Workspace Completion + Timeline Shell

### 3.1 基础信息

- **工单编号**：B-26/45
- **角色**：Engineer
- **目标**：在现有正式工作区 owner 上加入安全的镜头时间轴外壳与播放头，不修改项目模型，不复活动作系统。
- **输入**：模块2的 Git 坐标、生产 owner 图、shotStore duration/current-shot 合同、BottomWorkspace 当前状态、现有测试命令。
- **依赖关系**：只依赖最新稳定 main；不依赖 M3 原定义 PASS，不依赖 Stage 3-B，不依赖 PR #177。

### 3.2 输出交付物

#### 变更文件

**核心预期**：

- `src/renderer/shell/BottomWorkspace.tsx`
- `src/renderer/features/timeline/TimelineDock.tsx`
- `src/renderer/features/timeline/timeGeometry.ts`
- `src/renderer/styles.css`
- Timeline unit test
- `tests/integration/editor-shell-layout.test.ts` 及必要的 Timeline integration test
- `docs/test-receipts/DAY-26.md`

`timelineUiStore.ts` 仅在确有独立外部状态 owner 必要时新增；是否新增必须作为 `DECISION-B26-STATE-OWNER` 写入收卷。

#### 核心修改点

1. `BottomWorkspace` 从“只有 History”扩展为“History + Timeline”的正式底部区域。
2. Timeline 使用当前 `shotStore` + `EditorProjectStore` snapshot 派生当前镜头与 duration。
3. 建立 `currentTimeMs`、zoom、scroll 等非项目状态 owner。
4. 建立 `timeToPx / pxToTime / clampTime / snapToFrame` 等集中纯函数。
5. 建立 ruler/timecode/playhead/click seek/drag seek/zoom/scroll 的最小 UI。
6. 切镜头时 current time 归零，不残留上一镜头时间。
7. 维持 Canvas / Inspector / History / Resource Activity 的现有唯一 owner。

#### 必须包含

- 时间范围 `[0, durationMs]` 的边界验证
- 24 FPS 帧吸附验证
- 0ms / 中间帧 / 末帧 / duration 非整帧边界验证
- 切镜头 reset 验证
- zoom/scroll 不改时间验证
- dirty/revision/History 不变验证
- 1366×768 真人主路径
- 800×560 最小可用性验证
- 根页面无业务滚动证据

#### 禁止包含

- ActionPreset panel / Apply / Replay 工作流
- TimelineEvent clip authoring
- 关键帧、多轨、对白轨、音频轨
- 通用动作组合 evaluator
- PR #177 cherry-pick / 复制代码
- fake duration / fake project / hardcoded current shot 作为生产逻辑
- `setTimeout` 模拟时间轴功能
- 用 CSS 隐藏第二份组件
- 为通过测试直接改 Store/JSON 绕过真实 UI

#### 交付证明

必须提供：

```bash
git branch --show-current
git rev-parse HEAD
git diff --name-only
git diff --stat
git diff --check
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

并提供真实 Windows Electron：

- 1366×768 操作记录/截图/录像
- 800×560 操作记录/截图
- dirty / revision / History 前后值证据
- 镜头切换前后 currentTime / duration 证据

### 3.3 规模与复杂度观察

- 时间几何必须集中在纯函数模块，不让 px/ms/frame 公式散落 JSX。
- Timeline UI 组件可以拆小，但禁止为了“看起来架构高级”提前建设 track/plugin/event abstraction。
- `EditorShell.tsx` 当前已较大；Day 26 若需要向其中继续塞大量 Timeline 状态，优先证明 owner 设计是否错误。
- 若新增状态机明显跨越 shot identity / pointer drag / zoom / preview session 多维度，必须声明复杂度来源；不要复制 Stage 3-B 那种“当前 selection 到处被重新读取”的隐式身份模式。
- 任何明显 >50 行的单函数需在收卷解释为何保持单函数更清晰；这不是行数红线。

### 3.4 自动化质量闸门（强制）

| 闸门 | 要求 | 验证命令 / 证据 | 不通过后果 |
|---|---|---|---|
| BUILD | TypeScript + Renderer + Electron build 通过 | `pnpm build` | 返工 |
| FMT | 仓库当前未确认存在 Prettier script；格式不得伪报 | `git diff --check`；若开工确认无 formatter，则记录 `N/A + repo 未配置独立 formatter` | 返工或诚实 N/A |
| LINT | 无新增 lint error；warning 需真实声明 | `pnpm lint` | 返工或债务声明 |
| TEST | 时间几何、状态边界、工作区回归通过 | `pnpm test:unit` + `pnpm test:integration` | 返工 |
| ARCH | 单一 Canvas / History / Timeline owner；UI state 不污染项目 | import/diff 检查 + integration 证据 | 返工 |
| REAL | 真实 Electron 主路径可用；不得用 fake DOM/JSON 代替 | `pnpm dev` + 真人操作证据 | 返工 |
| DOC | DAY-26 回执与实际行为一致 | `git diff -- docs/test-receipts/DAY-26.md` | 返工或 DEBT-DOC |

---

# 【模块3-A】刀刃表（16项，强制命令化）

| 类别 | 检查点ID | 检查目标 | 验证命令 / 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 当前镜头 ruler / timecode 显示真实 `durationMs` | Timeline unit/integration + 真实项目截图 | [ ] |
| FUNC | FUNC-002 | 点击 ruler 与拖 playhead 能 seek，且 clamp 到 `[0,durationMs]` | `pnpm test:unit` + Electron 操作 | [ ] |
| FUNC | FUNC-003 | 24 FPS snap 稳定，0/中间/末尾/非整帧 duration 有明确结果 | `pnpm test:unit` 中 timeGeometry 用例 | [ ] |
| FUNC | FUNC-004 | 切镜头后 duration 更新、playhead=0、无上一镜头旧时间 | integration + Electron A→B→A | [ ] |
| CONST | CONST-001 | 生产树保持 Canvas=1、History=1、Timeline=1 | `git grep` / existing layout test + DOM/receipt | [ ] |
| CONST | CONST-002 | seek/zoom/scroll 不改 dirty/revision/History/project | store snapshot 前后断言 + Electron evidence | [ ] |
| CONST | CONST-003 | 未引入 ActionPreset/#177/通用 evaluator | `git diff --name-only` + `git diff` + `git log --oneline main..HEAD` | [ ] |
| CONST | CONST-004 | Timeline 只进入正式 BottomWorkspace，根页面不靠业务滚动 | layout integration + 1366/800 Electron screenshot | [ ] |
| NEG | NEG-001 | 负时间、超 duration、极端 px 输入均安全 clamp | `pnpm test:unit` | [ ] |
| NEG | NEG-002 | duration=0 / 无当前镜头时不崩溃、不产生假时间 | unit/integration + Electron 空状态 | [ ] |
| NEG | NEG-003 | zoom/resize/scroll 后同一 currentTime 语义不漂移 | geometry tests + resize Electron evidence | [ ] |
| NEG | NEG-004 | 现有镜头/素材/角色/Inspector/History 主路径无回归 | `pnpm test:integration` + Electron smoke | [ ] |
| UX | UX-001 | 1366×768 首屏能完成“镜头→画布→Inspector→Timeline seek” | 真实 Electron 操作记录 | [ ] |
| UX | UX-002 | 800×560 仍能选镜头、看 Canvas、访问 Inspector、折叠/展开 Timeline，不依赖根滚动 | 真实 Electron 操作记录 | [ ] |
| E2E | E2E-001 | 打开真实项目→选 A→seek→切 B→seek→回 A，全程 UI 状态与项目账本边界正确 | 真实 Electron + 状态证据 | [ ] |
| High | HIGH-001 | 自动化全绿后再做真人安全门；任一真人主路径 FAIL 均不得判 Day PASS | CI/本地命令摘要 + human receipt | [ ] |

### 刀刃表铁律

1. 每项都必须链接真实命令输出或真实 Windows Electron 证据。
2. “代码看起来没问题”“理论上不会 dirty”均不算证据。
3. 不适用项必须写 `N/A + 原因`；不得留空后直接 PASS。
4. 同一命令覆盖多项时，在 DAY-26 回执写清覆盖关系。

---

# 【模块3-B】地狱红线（10项）

1. **零占位符违规**：生产 Timeline 出现假数据、固定 5 秒、硬编码 shotId、TODO owner → 返工。
2. **验证造假**：未运行命令却写 PASS；未真人操作却写 Electron PASS → 返工。
3. **构建失败仍交付**：`pnpm build` FAIL 仍声称 Day 完成 → 返工。
4. **测试缺失伪完成**：time/px/snap/clamp 或项目状态边界没有真实测试/证据 → 返工。
5. **假实现**：setTimeout 模拟、mock 成功返回进入生产、假播放头、不读真实 shot duration → 返工。
6. **架构违规**：新增第二 Canvas/History/Inspector/Timeline root，或 UI 状态写入 ProjectSchema/History → 返工。
7. **债务不申报**：新增 warning、响应式破损、测试设施缺失但不记录 → 返工。
8. **范围失控**：擅自复活 ActionPreset、PR #177、动作 clip/evaluator、对白/音频轨 → 立即停止并返工。
9. **Git 历史不完整**：force-push/reset 抹历史、整包 cherry-pick 旧实验线、覆盖既有用户工作 → 返工。
10. **未知伪装确定性**：状态 owner 或 800×560 布局尚未验证，却凭静态阅读宣布闭环 → 返工。

---

# 【模块4】P4 自测轻量检查表 v3.0

| 检查点 | 自检问题 | 覆盖情况 | 相关用例ID / 命令 | 备注 |
|---|---|---|---|---|
| 核心功能用例（CF） | ruler/timecode/playhead/seek/snap/shot switch 是否各有标准路径？ | [ ] | FUNC-001～004 | |
| 约束与回归用例（RG） | 单一 owner、UI/project 边界、旧稳定工作区是否覆盖？ | [ ] | CONST-001～004 | |
| 负面路径用例（NG） | 越界、0 duration、无 shot、resize/zoom 是否覆盖？ | [ ] | NEG-001～004 | |
| 用户体验用例（UX） | 1366×768 与 800×560 是否真人可用？ | [ ] | UX-001～002 | |
| 端到端关键路径（E2E） | A→seek→B→seek→A 是否完整走过？ | [ ] | E2E-001 | |
| 高风险场景（High） | CI 绿后是否仍执行真人安全门？ | [ ] | HIGH-001 | |
| 字段完整性 | 回执是否记录前置/预期/实际/风险？ | [ ] | `docs/test-receipts/DAY-26.md` | |
| 需求映射 | 每条验证是否能回到本工单目标？ | [ ] | 刀刃表 | |
| 自测执行 | 是否真实运行全部适用命令并启动 Electron？ | [ ] | 质量闸门命令 | |
| 范围边界与债务 | 未覆盖项是否显式写 DEBT / N/A？ | [ ] | debt ledger | |

---

# 【模块5】收卷格式（强制结构）

```markdown
## ✅ Panda Stage Day 26 / B-26/45 完成并提交

### 提交信息
- 开工 HEAD: `<真实 SHA>`
- 收卷 HEAD: `<真实 SHA>`
- Commit: `feat(timeline): ...`
- 分支: `<真实分支>`
- 变更文件: `<git diff --name-only 实际输出>`

### 本轮目标与实际结果
- 目标: 在正式 BottomWorkspace 中加入安全 Timeline Shell / Playhead，并保持现有工作区唯一 owner 与项目状态边界。
- 实际完成: [真实已完成项]
- 未完成/不在范围: [真实列出]

### 关键决策记录
- DECISION-B26-STATE-OWNER: [currentTime/zoom/scroll owner] - [为什么]
- DECISION-B26-SNAP: [24 FPS 整数毫秒换算规则] - [为什么]
- DECISION-B26-LAYOUT: [BottomWorkspace / 小窗口行为] - [为什么]

### 自动化质量检查报告
```bash
[BASELINE] git branch --show-current
[真实输出]

[BASELINE] git rev-parse HEAD
[真实输出]

[TYPE] pnpm typecheck
[真实输出摘要]

[FMT] git diff --check
[真实输出摘要]

[LINT] pnpm lint
[真实输出摘要]

[UNIT] pnpm test:unit
[真实输出摘要]

[INTEGRATION] pnpm test:integration
[真实输出摘要]

[BUILD] pnpm build
[真实输出摘要]
```

### 真实 Windows Electron 验收
- 环境: Windows / Electron / 窗口尺寸 / DPI
- 1366×768: [PASS/FAIL + 步骤 + 证据]
- 800×560: [PASS/FAIL + 步骤 + 证据]
- A→B→A 镜头切换: [PASS/FAIL]
- dirty/revision/History 前后: [真实值]
- root scroll: [真实观测]

### 刀刃表摘要
| 类别 | 覆盖数 | 关键证据 |
|:---|:---:|:---|
| FUNC | X/4 | |
| CONST | X/4 | |
| NEG | X/4 | |
| UX | X/2 | |
| E2E | X/1 | |
| High | X/1 | |

### P4 检查表摘要
| 检查点 | 状态 | 备注 |
|:---|:---:|:---|
| CF | [ ] | |
| RG | [ ] | |
| NG | [ ] | |
| UX | [ ] | |
| E2E | [ ] | |
| High | [ ] | |

### 规模与复杂度说明
- 关键函数/模块: [真实名称]
- 是否存在复杂度例外: [无 / 有]
- 若有: [必要性]

### 债务声明
- DEBT-COMPLEXITY-B26: [无 / 描述]
- DEBT-TEST-B26: [无 / 描述]
- DEBT-DOC-B26: [无 / 描述]
- DEBT-SCOPE-B26: [无 / 描述]
- DEBT-PERF-B26: [无 / 描述]

### 风险与回滚点
- 主要风险: Timeline UI 状态与项目状态串线，或底部新增区域挤压现有可用工作区。
- 回滚方式: 使用普通 `git revert <Day26 commit>` 回退，不 reset / force-push 抹历史。

### Day 结论
- `PASS`：全部强制闸门 + 真实 Electron 主路径通过，允许提出 Day 27 派单。
- `FAIL`：任一关键 gate / human acceptance 失败，不开始 Day 27 功能开发。

### 下一步唯一动作
- [只写一条]
```

---

# 【模块6】技术熔断预案（非时间熔断）

| 熔断ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| ARCH-001 | 完成 Timeline Shell 需要修改 ActionPreset、通用 TimelineEvent/evaluator、Stage 3-B 语义，或必须创建第二套 owner | 立即停止实现，保留证据，提交主理人裁决 | 缩回 Day 26 或拆后续工单 |
| QUALITY-001 | typecheck/lint/unit/integration/build 出现本轮引入且无法一次性解释的小问题以外的持续失败 | 停止继续堆 UI，先修质量基线 | 返工 |
| COMPLEXITY-001 | 连续 2 次返工仍因必要 pointer/time/state 复杂度无法保持简单 owner | 允许带 `DEBT-COMPLEXITY-B26`，但必须说明复杂度来源与后续清偿点 | 有条件交付，不自动 PASS |
| TEST-001 | 当前仓库测试基础设施无法覆盖真实 DOM pointer 行为 | 降级为纯函数/integration + 可复现实测，声明 `DEBT-TEST-B26`；不得伪造 component test | 有条件交付，真人证据加重 |
| PERF-001 | 拖动播放头明显卡顿、Canvas 重绘异常、资源占用随拖动持续增长 | 停止扩展 zoom/视觉效果，优先定位回退 | 返工 |
| HUMAN-001 | 自动化全绿但真实 Windows Electron 1366×768 或 800×560 核心路径 FAIL | Day 26 直接 FAIL，不得拿 CI 覆盖真人结果 | 止损 |

## 复杂度熔断条款

- 初始标准：一个清楚的 Timeline UI owner + 一个纯时间几何层 + 最小 shell 接入。
- 不允许首次实现就建立 event bus / plugin system / track registry / timeline engine。
- 若复杂度确有必要，必须指出是 pointer interaction、时间几何、响应式还是现有接口约束导致，而不是一句“Timeline 本来就复杂”。
- `DEBT-COMPLEXITY` 只能记录必要复杂度，不能成为继续扩大范围的许可证。

---

# 【模块7】派单口令（Day 26 定制版）

启动饱和攻击集群，执行 **Panda Stage Day 26：Editor Workspace Completion + Timeline Shell**！

## 技术背景

- 开工基于当时最新稳定 `main`；派单时坐标为 `e4837e853fd6dceb11abf2a5cb009665e4cd29e3`。
- 当前正式产品树已存在 `EditorShell → LeftWorkspace / CanvasWorkspace / RightInspector / BottomWorkspace`。
- `CanvasWorkspace` 已是唯一生产 Canvas owner。
- `RightInspector` 已是正式属性 owner。
- `ResourceActivityDock` 已承载 shots/assets/characters 互斥活动。
- `BottomWorkspace` 当前只承载 History，是本日 Timeline 的正式接入口。
- `shotStore` 提供 current shot 与项目 duration mutation；Timeline 只能读取 shot/duration，播放头不得修改项目。
- 当前 main 未发现 Timeline/Playhead 产品实现。
- Stage 3-B / ActionPreset 已止损，不属于本路线。

## 关键约束

- Timeline 只做 ruler / timecode / playhead / seek / 24FPS snap / zoom / horizontal scroll。
- UI/Preview state 不进入 ProjectSchema / History / dirty / revision mutation。
- 保持 Canvas=1、History=1、Timeline=1；不得隐藏第二套组件。
- 不复活 PR #177，不做 ActionPreset，不做动作 clip/evaluator。
- 真实 Windows Electron 主路径是最终 Gate。

## 质量红线

- 10 项地狱红线全部生效。
- 16 项刀刃表必须有命令/证据。
- 不用代码量、文件数、测试数量代替产品可用性。
- 不存在的测试工具写 `N/A + 原因 + 替代证据`，不得临时编造“已具备”。

## 工单矩阵

- `B-26/45 Engineer`：完成唯一 Day 26 工单；本日不拆多 Agent 并行修改共享工作区 owner，避免多人同时改 Shell/Timeline 状态造成冲突。

## 验收铁律

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --check
```

然后必须启动真实 Windows Electron，完成 1366×768 与 800×560 人工验收。

## 收卷要求

- 必须生成 `docs/test-receipts/DAY-26.md`。
- 必须附实际命令输出摘要、刀刃表、P4、自测、债务和真人证据。
- 结论只能 `PASS` 或 `FAIL`。
- FAIL 时下一步只能处理 Day 26 阻塞，不得开始 Day 27。

Ouroboros 闭环启动，**B-26/45**，执行！ ☝️🐍♾️🔥

---

# 【模块8】通用验证命令库（本工单实际技术栈）

## Git / 基线

```bash
git branch --show-current
git rev-parse HEAD
git log --oneline -n 5
git status --short
git diff --name-only
git diff --stat
git diff --check
```

## 当前 owner / 路径核对

```bash
nl -ba src/renderer/shell/EditorShell.tsx | sed -n '840,940p'
nl -ba src/renderer/shell/BottomWorkspace.tsx
nl -ba src/renderer/shell/CanvasWorkspace.tsx
nl -ba src/renderer/shell/LeftWorkspace.tsx
nl -ba src/renderer/shell/ResourceActivityDock.tsx | sed -n '1,260p'
nl -ba src/renderer/shell/RightInspector.tsx | sed -n '1,180p'
nl -ba src/renderer/stores/shotStore.ts | sed -n '1,180p'
grep -n "editor-layout\|editor-body\|bottom-workspace\|left-workspace\|right-inspector" src/renderer/styles.css
```

## 禁止范围反查

```bash
git diff --name-only main...HEAD
git diff main...HEAD -- src/renderer/features/actions src/domain/actions
```

若第二条出现本工单新增 ActionPreset / 动作语义变更，必须解释；默认应为空。

## TS / JS 质量闸门

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --check
```

## 开发与真人验收

```bash
pnpm dev
```

真实 Windows Electron 测试数据继续优先放：

```text
D:\PandaStage-Acceptance\
```

若本轮不可避免向 C 盘写入大型测试数据，必须在 DAY-26 回执报告路径、用途与体积。

---

# 最终 DoD

- [ ] 开工 Git 坐标真实记录
- [ ] 当前 owner/import 图已复核，未建平行架构
- [ ] Timeline Shell 已进入正式 BottomWorkspace
- [ ] ruler/timecode/playhead/seek/snap/zoom/scroll 工作
- [ ] 24 FPS + 整数毫秒合同有自动化证据
- [ ] 镜头切换 reset 规则通过
- [ ] Canvas=1 / History=1 / Timeline=1
- [ ] UI Timeline state 不设置 dirty、不进 History、不改 project
- [ ] 未复活 Stage 3-B / ActionPreset / PR #177
- [ ] `pnpm typecheck` PASS
- [ ] `pnpm lint` PASS 或 warning 诚实声明
- [ ] `pnpm test:unit` PASS
- [ ] `pnpm test:integration` PASS
- [ ] `pnpm build` PASS
- [ ] `git diff --check` PASS
- [ ] 1366×768 真实 Electron 主路径 PASS
- [ ] 800×560 真实 Electron 最小可用性 PASS
- [ ] 16 项刀刃表完成
- [ ] P4 检查完成
- [ ] DAY-26 回执完整
- [ ] 债务透明记录
- [ ] Day 结论为 PASS 后才允许提出 Day 27
