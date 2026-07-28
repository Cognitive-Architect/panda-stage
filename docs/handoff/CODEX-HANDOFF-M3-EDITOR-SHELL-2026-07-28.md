# Codex 接管交接文档（Handoff）— M3 Editor Shell

> 仓库：`Cognitive-Architect/panda-stage`
> 分支：`fix/m3-editor-shell`（HEAD `f16dba26a17485c250bfa18858f79fbd0e918ad1`）
> 工作树：`D:/panda-stage/.worktrees/day25`
> 对应工单：Issue #55（M3 产品集成修复单）、Issue #57（本交接文档的产出单）
> 性质：**纯文档，不写 `src/` 生产代码、不 git commit/push**（由主理人统一提交）
> 来源：本文档所有 SHA / 路径 / 状态均由本人（software-architect，高见远）于 2026-07-28 在 worktree 内实跑 `git`/`gh` 命令并实读指定文件后独立核验，非照单全收。

---

## 0. 现场差异（TOP，优先声明）

> Issue #57 强制要求「独立核验，不照单全收；若与预期不一致，顶部单列现场差异，禁止静默修正」。

本人独立重跑结果 **与团队主理人先行核验的预期完全一致，未发现任何现场差异**。逐项核对如下：

| 核验项 | 预期 | 本人实跑结果 | 一致 |
|---|---|---|---|
| 分支 | `fix/m3-editor-shell` | `fix/m3-editor-shell` | ✅ |
| HEAD | `f16dba26a17485c250bfa18858f79fbd0e918ad1` | `f16dba26a17485c250bfa18858f79fbd0e918ad1` | ✅ |
| 工作树 | 干净 | `git status --short` 无输出 | ✅ |
| 父分支 | `feat/day-25-action-presets` @ `a907269ff4fb1ec072fea3a05b347caa1d867371` | 一致（`git diff feat/day-25-action-presets...HEAD` 可见） | ✅ |
| 相对父分支变更 | 7 文件 | 6 新增 + 1 修改（`vitest.config.ts`）共 7 文件 | ✅（见下注） |
| 仓库 | `Cognitive-Architect/panda-stage` | `origin = https://github.com/Cognitive-Architect/panda-stage.git` | ✅ |
| PR #56 | Draft，`fix/m3-editor-shell → feat/day-25-action-presets` | `state: DRAFT`，base 正确 | ✅ |
| PR #53 | Draft，`feat/day-25-action-presets → main` | `state: DRAFT`，base 正确 | ✅ |
| M3 状态 | FAIL | FAIL（未改） | ✅ |
| Day26~45 | 冻结 | 冻结 | ✅ |

**一处措辞澄清（非差异，仅计数口径）**：主理人通报「5 新增设计/脚本/契约/截图 + vitest.config.ts 微调」。本人 `git diff --name-status` 实测为 **6 个新增文件**（`docs/design/m3-editor-shell-design.md`、`docs/design/phase0a-baseline-report.md`、`docs/design/baseline-1366x768.png`、`scripts/baseline-preload-stub.cjs`、`scripts/capture-baseline-1366x768.cjs`、`tests/contract/dom-selectors.baseline.test.ts`）+ **1 个修改**（`vitest.config.ts`）= **7 文件**。「5」应为按类别（设计/脚本/契约/截图）的近似分组，实际新增为 6 个文件。总量与「7 文件变更」一致，无矛盾。

**结论：现场与预期一致，无差异需要修正。**

---

## 1. 一页接管摘要（≤30 行）

- **Panda Stage 是什么**：一个用 Electron + React + Konva 做的「共享渲染架构」动画短片制作工具，用户导入素材/角色，在时间轴上加动作预设，渲染生成视频。
- **当前在解决什么问题**：领域逻辑（Day 21–25：画布、图层、动作预设、撤销重做、保存重开）已全部写好并通过自动化，但**真实 Electron UI 是一张纵向堆叠的超长功能联调展板**，没有清晰的启动页、各模块在空间上分离、残留 Debug/DAY 标签、存在重复挂载——零代码用户无法顺畅走完「打开项目→选镜头→选图层→应用动作→撤销重做→保存重开」主路径。
- **为什么 M3 仍 FAIL**：Issue #55 是**真实 Electron 人工验收**后的产品集成缺陷（HIGH-001 = REAL UI MAIN PATH FAILED），不是环境问题。当前主干路径本身未成立。
- **当前所在阶段**：阶段 0A（基线 + 护栏，仅记录、不改生产代码）已完成并进入 Draft PR #56；阶段 1~4 未开始。
- **Codex 接手后唯一下一步**：完成独立接管审计并获主理人确认后，**仅执行 Issue #55 阶段 1**（状态机 + 外壳骨架 + 入口层 + 产品预览 + 保存/关闭）。
- **绝对不能做的事**：不改 `src/` 生产代码、不提前执行阶段 2/3/4、不做 ProductPreviewOverlay（阶段1已含？见第10章边界，本设计把预览放进阶段1）、不碰 Day26 时间轴、不把 M3 改 PASS、不把 PR #53/#56 转 Ready、不合并、不进 Day26、禁止用 `beforeunload` 替代 Electron 关闭合同、禁止只压缩 CSS 冒充信息架构修复、禁止新建第二套 Project/Selection/History 状态。

> 人话：发动机、座椅、轮子都造好了，但还没装成一辆能开的车。现在只许你先把「车门/方向盘/仪表盘」的框架和启动页搭出来，不许先去改发动机，更不许说车已经能开了。

---

## 2. Git 与 PR 拓扑

```text
main
└─ feat/day-25-action-presets   (HEAD a907269ff4fb1ec072fea3a05b347caa1d867371)
   └─ fix/m3-editor-shell       (HEAD f16dba26a17485c250bfa18858f79fbd0e918ad1)  ← 你现在在这里
```

| 分支 | 完整 HEAD SHA | Base | PR | 状态 | CI | 用途 | 正确合并顺序 |
|---|---|---|---|---|---|---|---|
| `main` | （未实跑，推断为 main 当前 HEAD）「推断」 | — | — | — | — | 正式发布主线 | 最后合入 |
| `feat/day-25-action-presets` | `a907269ff4fb1ec072fea3a05b347caa1d867371` | `main` | PR #53 | **Draft** | 末次 CI `30259335365` SUCCESS（含两次 PR SUCCESS） | 承载 Day 25 领域逻辑全部修复（Issue #52/#54） | 第 1 步：PR #53 先合入 `main` |
| `fix/m3-editor-shell` | `f16dba26a17485c250bfa18858f79fbd0e918ad1` | `feat/day-25-action-presets` | PR #56 | **Draft** | 末次 CI `30324231517` SUCCESS（pull_request，2026-07-28T02:50:07Z） | 承载 M3 Editor Shell 阶段 0A 基线（不改生产代码） | 第 2 步：PR #56 合入 `feat/day-25-action-presets` |

**铁律**：`fix/m3-editor-shell` **不得直接合入 `main`**。它必须先合入 `feat/day-25-action-presets`（经 PR #56），待 PR #53 先行合入 `main` 后，再由 `feat/day-25-action-presets` 整体合入 `main`。

**当前两者均保持 Draft，不得合并**；M3 FAIL、Day26~45 冻结期间不得推进合并。

> 人话：代码要像水流一样「功能分支 → 父分支 → 主干」逐级合并，不能直接从最底层的「M3 分支」灌进主干，否则会漏掉 Day 25 领域修复的把关。

---

## 3. 里程碑与项目状态

区分四类完成度：① 领域逻辑完成 ② 自动化（unit/integration/CI Gate）完成 ③ UI 产品集成完成 ④ 真人（真实 Electron）验收完成。

| 里程碑 | ①领域逻辑 | ②自动化 | ③UI产品集成 | ④真人验收 | 结论 |
|---|---|---|---|---|---|
| **Gate A**（音画同步 CI 证据） | 完成 | CI 不跑（需打包产物 `release/win-unpacked/Panda Stage.exe`，阶段0A 未构建） | — | — | 本环境**未断言**（env-limited，非 FAIL）；正式结论以 GitHub Actions 打包运行为准「推断」 |
| **M1** | 完成 | `verify-m1` node 通过 | 完成 | 完成 | PASS |
| **M2** | 完成 | 经 Day 13/14/16 等 Gate 覆盖 | 完成 | 完成 | PASS（Day 20·M2 gate 已绿） |
| **Day 21~25**（画布/图层/动作预设/历史/Day25 集成） | **完成**（含 Issue #52 修复：overlap/时间语义/ID唯一性/build脚本） | unit 472/0、integration 84/1（1 例 env timeout）、day13/14/16/17/18/19/20/21/22/23/24 均 PASS | **部分**：功能模块各自可渲染，但**未集成进连续 Editor Shell** | **未通过**：真实 UI 主路径不成立（见第5章） | 领域/自动化**完成**；产品集成**FAIL**；真人验收**FAIL** |
| **M3**（产品集成） | 不适用（非领域问题） | 不适用 | **FAIL** | **FAIL** | **M3 = FAIL**（REAL UI MAIN PATH FAILED） |
| **Day 26~45**（时间轴/编辑） | 未开始 | 未开始 | 未开始 | 未开始 | **冻结**（M3 PASS 前禁止启动） |

**禁止用语**：不得用「基本完成」「差不多了」「大体可用」掩盖上表 ③/④ 的未验证项。当前唯一确定的事实是：**Day 25 领域逻辑与自动化候选完成，但 UI 产品集成与真人验收均为 FAIL，M3 = FAIL。**

> 人话：发动机台架测试（自动化）全过，但整车路试（真人开起来走完流程）没过——所以车不能算造好。

---

## 4. Issue / PR 地图

| # | 目标 | 状态 | 已完成 | 剩余 | 是否允许关闭/合并 |
|---|---|---|---|---|---|
| **Issue #52** | Day 25 合并前修复（overlap 检测 / 未来事件提前生效 / 事件 ID 唯一性 / build 脚本 / M3 结论对齐） | 已随 PR #53 解决，关联关闭条件：CI + 真人验收 | 5 项修复全部落地，M3 结论改 FAIL，冻结 Day26~45 | 真人验收（依赖 M3 Editor Shell 修复后才可能完成） | **保持 Open**，待 M3 真人验收通过后一并关闭 |
| **Issue #54** | Day 17 资产元数据 Gate 偶发失败调查与稳定性修复 | Open | 根因分两类（FS 延迟类走 `RUNNER_TEMP`；abort 竞态类 mock 复刻守卫）已修复，同一 tree 字节级一致证明纯环境 flake | CI runner 环境无法本地复现，需 GitHub Actions 持续观察 | **保持 Open**（按 PR #53 明文「Issue #54：保持 Open」） |
| **Issue #55** | M3 产品集成修复单：用真实 Editor Shell 替代纵向堆叠展板，恢复无代码主路径 | **Open**（本 Handoff 的服务对象） | 设计文档 v1.1a 已核准；阶段 0A 基线完成 | 阶段 1~4 实现 + 真人 M3 验收 | **不得关闭**，直至真人 M3 验收 PASS |
| **PR #53** | `feat/day-25-action-presets → main`，Day 25 领域修复 | **Draft** | 全部 5 项修复 + CI 连续两次 SUCCESS | 合并前需 CI + 真实 UI 验收；当前 M3 FAIL | **保持 Draft，不得合并，不转 Ready** |
| **PR #56** | `fix/m3-editor-shell → feat/day-25-action-presets`，阶段 0A 基线 | **Draft** | 7 文件（6 新增 + 1 修改），CI `30324231517` SUCCESS | 阶段 0A 仅基线，后续阶段另起 | **保持 Draft，不得合并，不转 Ready** |

**GitHub 状态 vs 旧文档标注**：`gh pr view 53` 的 body 注明「本 PR 保持 Draft，CI 与真实 UI 验收均完成前不得合并、不进入 Day 26」；`gh pr view 56` body 注明「不将上述结果伪装为完整全绿……M3 仍 FAIL……本 PR 保持 Draft，不合并」。两者与 Issue #57、Issue #55 的冻结约定**一致，未发现冲突**。

> 人话：两张 PR 都还挂着「草稿」牌子，谁都不许私自合；两个 Issue（#52/#54）也先别关，得等真人在真实软件里走通主路径再说。

---

## 5. 为什么需要 Editor Shell 重构

以下结论来自 **Issue #55 真实 Electron 人工验收记录**（`gh issue view 55`），非自动化推断：

- **纵向堆叠**：`App.tsx` 把动作预设、历史、镜头管理、画布、图层操作、素材库、角色管理、最近项目、恢复入口、导出探针按纵向顺序堆在同一长页面（见 `App.tsx:165-228` 的 `day25-action-shell` / `day25-editor-shell` / `export-probe` section）。
- **无清晰 Start Screen**：未打开项目时，先看到大量不可操作的编辑模块（画布显示 "No shot selected"、历史显示 "0 可撤销"，见 `baseline-1366x768.png` 与 `App.tsx:138-163`）。用户没有「新建/打开/最近项目」的清晰入口层级。
- **各模块空间分离**：镜头/素材/角色/画布/图层属性/动作预设彼此分离，必须反复滚动；动作预设远离当前图层与画布上下文（见 `ActionPresetPanel` 挂在 `App.tsx:166` 顶部，CanvasStage 在 `App.tsx:171`）。
- **残留 Debug / DAY 标签**：`AssetLibrary`「Day 18」、`CharacterManager`「Day 19」、`ShotManager`「Day 20 · M2 gate」、`CanvasStage`「Day 21」、`LayerPositionPanel`「Day 22」、图层面板「Day 23」、`StagePreview`「Day 05」badge；测试安全 IPC 按钮、完整导出探针默认可见（`App.tsx:146-228`）。
- **重复挂载**：`CanvasStage` 当前 2 处（App + ProjectRecoveryPanel）、`HistoryControls` 当前 2 处（App + CanvasStage），双订阅写同一 Store（详见第 9/14 章）。
- **无法形成连续无代码制作主路径**：真实用户无法顺畅完成「打开项目 → 选镜头 → 选图层 → 应用动作 → 撤销/重做 → 保存重开」。

**核心强调**：当前主要问题在 **UI 集成层（信息架构 / 布局 / 入口 / 隔离）**，**不是要求重写 Day 25 领域逻辑**。动作应用命令链 `createPresetEvents → validatePresetApplication → applyPresetEvents → updateProject`、求值器、Store 均保持不变（Issue #55 明文）。

> 人话：不是发动机坏了要重造，是仪表盘、座椅、车门没装到正确位置，导致人坐进去不会开。修的是「装配方式」，不是「零件」。

---

## 6. 已完成的阶段 0A

阶段 0A = **基线记录 + 非生产护栏**，不改任何 `src/` 生产代码，不制造必然失败的 CI。

**7 个产物文件**（相对父分支 `feat/day-25-action-presets`）：

| 文件 | 状态 | 说明 |
|---|---|---|
| `docs/design/m3-editor-shell-design.md` | 新增 | 设计包 v1.1a（553 行）：架构合同、状态机、迁移表、Gate 兼容、实施切片阶段 0A~4、风险、白名单、v1.1a 附录 |
| `docs/design/phase0a-baseline-report.md` | 新增 | 阶段 0A 证据报告（213 行）：双挂载计数 CanvasStage=2/HistoryControls=2、截图方法、测试计数 |
| `docs/design/baseline-1366x768.png` | 新增 | 1366×768 基线截图（约 220 KB，真实 UI，经 PNG 头校验 1366×768） |
| `scripts/capture-baseline-1366x768.cjs` | 新增 | 无显示 Electron 截图脚本（offscreen + preload stub + 原尺寸 capturePage，未用 resize） |
| `scripts/baseline-preload-stub.cjs` | 新增 | 截图专用无害 preload stub，暴露 `window.pandaStage` 代理 |
| `tests/contract/dom-selectors.baseline.test.ts` | 新增 | 源码级选择器契约测试（5 个 it 块，仅断言当前已存在的历史 Gate 白名单选择器） |
| `vitest.config.ts` | 修改 | 良性：unit `include` 追加 `'tests/contract/**/*.test.ts'` |

**PR #56 最新 CI**（实跑 `gh run list --branch fix/m3-editor-shell -L 5`）：

| run id | event | 结论 | 时间 |
|---|---|---|---|
| `30324231517` | pull_request | **success** | 2026-07-28T02:50:07Z |
| `30324228807` | push | success | 2026-07-28T02:50:04Z |
| `30323950439` | pull_request | failure（已被 `53c7625` 修复） | 2026-07-28T02:44:07Z |
| `30323947656` | push | failure（已被 `53c7625` 修复） | 2026-07-28T02:44:04Z |
| `30320161781` | pull_request | success | 2026-07-28T01:24:34Z |

**阶段 0A 提交历史**（实跑 `git log --oneline -15`）：

- `f16dba2` test(m3): drop empty editor-shell contract block (fixes CI TS6133) ← 当前 HEAD
- `53c7625` test(m3): phase 0A baseline fix — offscreen 1366x768 capture, drop old shell contracts
- `b3da4a9` test(m3): lock editor shell phase 0A baseline（阶段 0A 首次基线提交，基于 `a907269`）
- `a907269` (origin/feat/day-25-action-presets) 系统性将测试临时目录路由到 `RUNNER_TEMP`（阶段 0A 的父基线，CI 两次连续 PR SUCCESS）

**尚未修复事实（如实记录，未修复）**：

```text
CanvasStage = 2   （App.tsx:171  +  ProjectRecoveryPanel.tsx:206）
HistoryControls = 2   （App.tsx:167  +  CanvasStage.tsx:420）
```

本人已实读上述 4 处源码，确认双挂载真实存在（见第 9/14 章）。修复随阶段 2/3 收敛，阶段 0A 只记录不修复。

> 人话：阶段 0A 相当于「开工前先拍现场照片、立警示牌、量好尺寸」，没有动任何砖瓦；照片里清楚地看到画布和编辑历史被挂了两次（重复渲染），这是后面要修的已知问题。

---

## 7. 权威设计合同

依据 `docs/design/m3-editor-shell-design.md` v1.1a + `phase0a-baseline-report.md` + Issue #55 提炼。

**状态机（B 章）**：

- 基础态仅两种：`no-project`（启动 / `editorProjectStore` 无 snapshot）与 `editor`（`getSnapshot()` 非空）。
- `debug`（顶端 Debug 开关或 `?debug=1`）与 `gateA`（`?gateA=1`）是**正交 flag / overlay**，不是第三主态，不替换 `editor`。
- `no-project → editor`：打开或新建项目成功（`editorProjectStore.open` 产生 snapshot）。
- `editor → no-project`：显式返回启动页（经确认流程后 `editorProjectStore.clear`）。
- `editor` 内部 Tab 切换/折叠/分栏调整：**不重置 revision、不重挂载写 Store 组件**。

**组件树（A 章，仅列关键节点）**：

- `StartScreen`（仅 `no-project`）：`NewProjectEntry`（新建项目 / 打开项目 / 最近项目 / 崩溃恢复 四项）。
- `EditorTopBar`（editor）：项目名 / 保存态 / 保存按钮 + Ctrl+S / Debug 开关 / 预览按钮。
- `LeftWorkspace`（Tabs，条件卸载）：Shots / Assets / Characters。
- `CanvasWorkspace`：唯一挂载 `CanvasStage`（editing）。
- `RightInspector`：图层属性 + 动作预设。
- `BottomWorkspace`：唯一挂载 `HistoryControls`。
- `ProductPreviewOverlay`（editor 内只读 overlay）：播放/暂停/重播/关闭，**不写 editor Store**。
- `DebugWorkspace`（门控 `?debug=1`）：测试安全 IPC / 完整导出探针 / Store 自检面板。
- `StagePreview`（门控 `?gateA=1 || ?debug=1`）：Gate A 证据用，独立于 editor snapshot。

**单一 Store 来源（铁律）**：全局只有一个正式打开的 Project（`EditorProjectStore`）、一个 `selectedShotId`（`ShotStore`）、一个 `selectedLayerId`（`selectionStore`）、一套 History（`editorProjectStore.history`）。**禁止新建第二套 Project / Selection / History 状态**（见第 8 章矩阵）。

**`projectRoot` 拼接层级**：`projectRoot` 由**调用方（renderer）**在 Main/IPC 层拼接为 `<位置>/<名称>.pandastage`，再传给 `ProjectService.create(projectRoot, {name})`；`ProjectService.resolveProjectRoot` 要求以 `.pandastage` 结尾，否则抛 `INVALID_PROJECT_ROOT`（`ProjectService.ts:365-382`、`shared/project-api.ts:27-32`）。

**Windows 窗口关闭合同**：主进程 `window.on('close')` + `UnsavedCloseGuard.handleWindowClose` 已存在（`main/index.ts:72`），dirty 时 `preventDefault()` 并经 `UnsavedCloseController.prompt` 用**原生 Electron `dialog.showMessageBox`** 弹「保存 / 不保存 / 取消」（`main/index.ts:278-289`）；保存失败保持窗口打开（`reportSaveFailure`，`main/index.ts:308-313`）。**现状未用** `beforeunload`。

**应用内「返回启动页 / 关闭项目」**：使用 Renderer 端 `CloseConfirmDialog`（保存并退出 / 不保存退出 / 取消），dirty 下必须走确认流程，**禁止**未经确认直接 `editorProjectStore.clear()`（`design` H.9 / 附录 4）。

> 人话：软件只有「没打开项目」和「打开项目在编辑」两种大状态；Debug 和测试开关是浮在上面的小面板，关掉它不影响编辑。关窗口时系统会先问你要不要保存——这个问询是正规的合同，不许用网页的「离开提示」偷换。

---

## 8. Store 与状态归属矩阵

> 所有写操作经下方 Store；**严禁**在组件内 `useState` 保存可被其他面板共享的 Project/Shot/Layer 选择或 revision。

| 状态 | 当前 Store / 文件 | 谁能读 | 谁能写 | 重构时禁止发生 |
|---|---|---|---|---|
| **Project（单一真相源）** | `EditorProjectStore`（`stores/EditorProjectStore.ts`，`editorProjectStore`） | 全部组件 | `open/updateProject/restore/markSaved/applyAsset*` | **禁止新建第二套 Project 状态**；不得复制快照到本地 `useState` |
| **revision** | 同上（`getSnapshot().revision`） | 全部 | 任何 `updateProject/apply*` 自增 | Tab/折叠/导航**不得**调用 `open`/`clear`（会归零，破坏 Day16 Gate，H.4） |
| **selectedShotId（当前镜头）** | `ShotStore`（`shotStore.ts`） | 左栏/画布/右栏 | `select()/create()/remove()`；`reconcileSelection` 保证存在性 | **禁止新建第二套 Selection 状态**；Tab 切换不得丢失（H.3） |
| **selectedLayerId（当前图层）** | `LayerSelectionStore`（`selectionStore.ts`） | 画布/图层属性/动作预设 | `select()/clear()`（背景层置空） | 同上；背景/锁定层选择须正确清空 |
| **History（撤销/重做）** | `HistoryStore`（经 `editorProjectStore.history` 导出 `historyStore`） | `HistoryControls` | `editorProjectStore.undo/redo` | **禁止新建第二套 History 状态**；快捷键单点注册于 `EditorShell`（H.1） |
| **Action Preset（应用）** | `ActionPresetStore`（`actionPresetStore.ts`，无状态桥接） | `ActionPresetPanel` | 经 `createPresetEvents→validate→apply→updateProject` | 命令链不得改（Issue #55 明文） |
| **Canvas viewport（Fit/50%/Actual）** | `CanvasViewportStore`（`canvasViewportStore.ts`） | `CanvasStage`/`CanvasViewport` | `setMode()/recordStagePoint()/reset()` | 默认 `fit`；中央列 `min-width:0` 防横向滚动 |
| **Product Preview 本地时间态** | 仅 `ProductPreviewOverlay` 本地 `useState`（预览时间 `t`） | 该 overlay | `play/pause/replay/close` | **不写**任何上面 Store；关闭即丢弃本地态（F.5/H.8） |
| **Debug / Gate-A flags** | `EditorShell` 解析 `location.search`（非 Store，局部 `useState`/常量） | `EditorShell` 及门控子组件 | 仅 URL 参数 + Debug 开关 | 不作为第三主态；不得影响 editor 数据 |

**铁律落实**：第二套 Project / Selection / History 状态 = 0。组件只通过上面 Store 读写；`CanvasStage`/`ActionPresetPanel`/`HistoryControls` 不持有可共享的「当前镜头/图层/project」本地副本（均从 `shotStore`/`selectionStore` 派生）。产品预览临时时间态严格本地化，绝不回写 editor Store。

> 人话：整个软件只有一个「当前项目」「当前镜头」「当前图层」「撤销栈」。重构时只能搬动这些状态的「展示位置」，绝不能偷偷再建一份副本——否则两处会互相打架。

---

## 9. 关键代码地图

> 实读路径 `src/`（worktree `fix/m3-editor-shell`）。每项列：当前职责 / 已知问题 / 预计修改阶段 / Codex 当前阶段是否允许修改。当前阶段 = 阶段 0A 已完成、阶段 1 未开始，**全部 `src/` 当前禁止修改**。

### 9.1 `src/renderer/App.tsx`
- **职责**：应用根组件。挂载整个纵向堆叠编辑外壳；`?demo=1` 时若 snapshot 为空则自动 `editorProjectStore.open` 示例项目（`App.tsx:37-51`，CI 启动路径不传）；`?gateA=1` 监听 Gate A 预览请求（`App.tsx:54-85`）；内联测试安全 IPC 按钮（`App.tsx:146-162`）、完整导出探针（`App.tsx:177-228`）、`<StagePreview>`（`App.tsx:175`）。
- **已知问题**：纵向堆叠所有模块；`App.tsx:167` 渲染 `<HistoryControls/>`、`App.tsx:171` 渲染 `<CanvasStage/>`——**双挂载之源**；`day25-action-shell`/`day25-editor-shell` 旧壳 className（契约测试已不再断言）；内联 IPC/导出探针应迁入 `DebugWorkspace`。
- **预计修改阶段**：阶段1（精简为挂载 `EditorShell` + 保留 `?demo=1`/`?gateA=1`）、阶段2（移除 `day25-editor-shell` 中的 `CanvasStage`）、阶段3（移除 `day25-action-shell` 中的 `ActionPresetPanel`/`HistoryControls`）、阶段4（移除内联 ping/export-probe）。
- **当前是否允许修改**：❌ 否（阶段1前禁止改 `src/`）。

### 9.2 `src/renderer/features/recovery/ProjectRecoveryPanel.tsx`
- **职责**：崩溃恢复面板。含 `RecentProjectsPanel`/`AssetLibrary`/`CharacterManager`/`ShotManager`/`CanvasStage` 挂载、`.recovery-open-row` 打开入口（line 217）、`.recovery-status-row` 保存状态（line 264）、恢复候选 restore/ignore、`saveRecoveredProject`；实例化 `ProjectSessionController`（autosave/recovery 跟踪，`useEffect` 卸载时 `dispose`）。
- **已知问题**：`ProjectRecoveryPanel.tsx:206` 渲染第二个 `<CanvasStage/>`——**双挂载之源**（与 App 合计 CanvasStage=2）；`gateA=1` 时 `return null`（line 84）；其内 `.recovery-open-row`/`.recovery-status-row` 是 Gate 依赖选择器，必须保留。
- **预计修改阶段**：阶段2（拆分，停止内嵌 `CanvasStage`）、阶段4（删除本文件，子功能迁 `StartScreen`/`EditorTopBar`/`DebugWorkspace`）。
- **当前是否允许修改**：❌ 否。

### 9.3 `src/renderer/features/canvas/CanvasStage.tsx`
- **职责**：编辑画布（带 `data-testid="project-canvas-stage"`）。使用 `buildEditorStageRenderModel`（**正确非 deprecated** 求值器）；`CanvasViewport` 的 `ResizeObserver` 做 Fit；图层拖拽/选择/变换（`SelectableLayer`/`LayerTransformer`/`layerStore`）；空状态 / 缺失背景提示；订阅 `editorProjectStore`/`shotStore`/`canvasViewportStore`/`selectionStore`/`layerStore`。
- **已知问题**：`CanvasStage.tsx:420` 渲染第三个 `<HistoryControls/>`（与 `App.tsx:167` 双挂载，HistoryControls=2）；内嵌 `LayerTransformPanel`/`LayerOrderControls`/`HistoryControls` 应迁出；应整体收敛为 `CanvasWorkspace` 唯一挂载点。
- **预计修改阶段**：阶段2（移出 `HistoryControls`/`LayerTransformPanel`/`LayerOrderControls`，唯一挂载于 `CanvasWorkspace`）、阶段3（确认已无内嵌 `HistoryControls`）。
- **当前是否允许修改**：❌ 否。

### 9.4 `src/renderer/features/editor/HistoryControls.tsx`
- **职责**：编辑历史控件（`data-testid="history-controls"`）。撤销/重做按钮 + 状态输出；使用 `useHistoryShortcuts`（`HistoryControls.tsx:42` 内部注册 `window.addEventListener('keydown')`）。
- **已知问题**：`useHistoryShortcuts` 在组件内注册 `window.keydown`，**双挂载导致 Ctrl+Z 可能触发两次**（H.1）。需将快捷键注册上提到 `EditorShell` 单点。
- **预计修改阶段**：阶段3（唯一挂载于 `BottomWorkspace`；快捷键注册上提到 `EditorShell`）。
- **当前是否允许修改**：❌ 否。

### 9.5 `src/renderer/features/actions/ActionPresetPanel.tsx`
- **职责**：动作预设面板（`data-testid="action-preset-panel"`）。8 类预设按钮（左入场/右入场/移动到/放大强调/抖动/表情切换/淡入/淡出）；按选择/背景/锁定动态禁用；`PresetParameterForm` 参数表单；经 `actionPresetStore.apply`。
- **已知问题**：当前挂在 `App.tsx:166` 顶部 `day25-action-shell`，**远离画布/图层上下文**，用户需长距离滚动才能从画布到动作预设（Issue #55 明确列为缺陷）。
- **预计修改阶段**：阶段3（迁入 `RightInspector`，紧邻画布与图层属性）。
- **当前是否允许修改**：❌ 否。

### 9.6 `src/renderer/stores/EditorProjectStore.ts`
- **职责**：全局唯一 Project 真相源。`open/updateProject/restore/clear/getSnapshot/undo/redo/markSaved/applyAssetImport/Metadata/Delete`；`revision` 自增；导出 `historyStore = editorProjectStore.history`（line 340）。
- **已知问题**：`clear()`（line 302）会归零 revision 并丢弃修改——重构时**未经确认不得调用**（H.9）；导航/Tab 切换不得调用 `open`/`clear`（H.4）。
- **预计修改阶段**：**保持不变**（仅消费方调用约定调整）；禁止新建第二套 Project 状态。
- **当前是否允许修改**：❌ 否（禁止改领域逻辑/Store）。

### 9.7 `src/renderer/stores/shotStore.ts`
- **职责**：`selectedShotId` 管理。构造函数订阅 `editorProjectStore` 做 `reconcileSelection`（保证镜头存在性，line 123）；`create/remove/duplicate/rename/setDuration/move` 均经 `editorProjectStore.updateProject`。
- **已知问题**：无重大已知问题；是 `selectedShotId` 唯一来源，重构必须复用。
- **预计修改阶段**：保持不变。
- **当前是否允许修改**：❌ 否（禁止新建第二套 Selection 状态）。

### 9.8 `src/renderer/stores/selectionStore.ts`
- **职责**：`selectedLayerId` 管理（`LayerSelectionStore`）。订阅 editor + shot 变化做 `reconcileSelection`（背景层置空，line 70）；`select()/clear()`。
- **已知问题**：无重大已知问题。
- **预计修改阶段**：保持不变。
- **当前是否允许修改**：❌ 否。

### 9.9 `src/renderer/features/actions/actionPresetStore.ts`
- **职责**：动作预设桥接 store（无状态）。读 `shotStore`/`selectionStore`，经 `createPresetEvents → validatePresetApplication → applyPresetEvents → editorProjectStore.updateProject` 写回；校验未打开项目/无镜头/无图层/背景/锁定（line 30-54）。
- **已知问题**：无；命令链保持不动（Issue #55 明文要求）。
- **预计修改阶段**：保持不变。
- **当前是否允许修改**：❌ 否。

### 9.10 `src/renderer/stage/StageRenderer.tsx`
- **职责**：非交互 Konva 渲染器（`data-testid="stage-renderer"`）。消费 `buildStageRenderModel`（`shared/stage` 契约）；编辑画布与 Gate-A Probe **共用**；只读 `project`/`evaluatedShot`，不写 Store。
- **已知问题**：无；产品预览与 Gate-A Probe 应共用同一正确求值器（规避 Day23 deprecated，H.7/H.8）。
- **预计修改阶段**：阶段1（产品预览复用）、Gate-A 保持。
- **当前是否允许修改**：❌ 否。

### 9.11 `src/domain/evaluate-shot-at-time.ts`
- **职责**：**正确（正式）求值器**。支持全部 7 类事件（move/scale/opacity/shake/expression/flip/visibility）+ 表达式解析；`if (timeMs < event.startMs) continue;` 保证未来事件不提前生效（line 147，Issue #52 修复）；时间语义正确（开始=基态、进行中插值、结束=最终态、两连续事件间不回跳）。
- **已知问题**：无（这是正确版本）；Day23 教训要求编辑/预览路径只用此版本。
- **预计修改阶段**：保持不变（禁止改领域逻辑）。
- **当前是否允许修改**：❌ 否（禁止改领域逻辑）。

### 9.12 `src/shared/domain/evaluate-shot-at-time.ts`
- **职责**：`@deprecated` 旧 move-only 求值器（仅 move 事件）。仅供 legacy probe/history 测试；文件头注释明确「Do not introduce new callers」。
- **已知问题**：仅 move，时间语义不全；Day23 误用会导致动作提前/回跳。
- **预计修改阶段**：**禁止**被 `features/**` 与 `StagePreview` 重新 import（ESLint/注释约束）；将来删除。
- **当前是否允许修改**：❌ 否。

### 9.13 `src/preload/index.ts`
- **职责**：`contextBridge.exposeInMainWorld('pandaStage', ...)` 暴露全部 IPC（project.{create,open,save}、recentProjects、autosave、recovery、assets、export）；所有请求经 Zod schema 校验。
- **已知问题**：无；新建项目真实通道 `window.pandaStage.project.create` 已存在（阶段1 `NewProjectEntry` 复用）。
- **预计修改阶段**：保持不变（阶段1 复用既有 IPC，不改 preload）。
- **当前是否允许修改**：❌ 否。

### 9.14 `src/main/index.ts`
- **职责**：主进程入口。注册全部 IPC handler；`window.on('close', e => guard.handleWindowClose(e))`（`main/index.ts:72`）；`UnsavedCloseController.prompt` 用原生 `dialog.showMessageBox` 弹 save/discard/cancel（`main/index.ts:278-289`）；保存失败 `reportSaveFailure` 保持窗口打开（`main/index.ts:308-313`）。
- **已知问题**：正式 Electron close 合同已存在，**未用** `beforeunload`；必须保留，禁止降级为 `beforeunload`（v1.1a 附录4）。
- **预计修改阶段**：保持不变（close 合同是铁律，设计只引用不改动）。
- **当前是否允许修改**：❌ 否（禁止改领域逻辑/Store/Gate 断言；close 合同是铁律）。

### 9.15 `src/main/services/ProjectService.ts`
- **职责**：项目 CRUD/保存。`resolveProjectRoot` 要求以 `.pandastage` 结尾（否则 `INVALID_PROJECT_ROOT`，line 365-382）；`create` 由调用方提供 `projectRoot`；`mapError` 映射 `ProjectServiceError.code`（PROJECT_ALREADY_EXISTS / INVALID_PROJECT_ROOT / OPEN_FAILED 等，line 403-463）。
- **已知问题**：无；`projectRoot` 由 renderer 拼接为 `<位置>/<名称>.pandastage`（v1.1a 附录3）。
- **预计修改阶段**：保持不变。
- **当前是否允许修改**：❌ 否。

### 9.16 `src/shared/project-api.ts`
- **职责**：项目 IPC 契约。`ProjectCreateRequestSchema = {projectRoot, metadata:{name}}`、`ProjectOpenRequestSchema`、`ProjectSaveRequestSchema`、`ProjectOperationResponseSchema`、`ProjectErrorCode` 枚举。
- **已知问题**：无。
- **预计修改阶段**：保持不变。
- **当前是否允许修改**：❌ 否。

> 人话：上面 16 个文件就是这台机器的「零件清单+各自毛病+打算哪步修+现在能不能动」。统一口径：**现在一个都不许改**，等阶段1拿到授权再说。

---

## 10. 阶段实施计划

> 每阶段可单独回滚；每阶段结束均须保证 `typecheck/lint/test:unit/test:integration/build` 不红，且已覆盖 Gate 不红（design G 章）。

### 阶段 0A — 基线 + 护栏（已完成，不改生产代码）
- 冻结已核准架构基线；记录 Gate 全绿、DOM 层级、双挂载数量（CanvasStage=2/HistoryControls=2）、1366×768 基线截图。
- **铁律**：不制造必然失败的 CI——不提前断言尚未实现的组件/选择器，不提前要求数量 `=== 1`。
- 产出：设计文档 v1.1a、`phase0a-baseline-report.md`、基线截图、契约测试、截图脚本，进入 Draft PR #56。

### 阶段 1 — 状态机 + 外壳骨架 + 入口层 + 产品预览 + 保存/关闭
- 修改/新增：`App.tsx`（精简为挂载 `EditorShell` + 保留 `?demo=1`/`?gateA=1`）、`styles.css`（E.1 网格 + 根 `overflow:hidden`）、新增 `shell/EditorShell.tsx`、`shell/StartScreen.tsx`、`shell/EditorTopBar.tsx`、`shell/NewProjectEntry.tsx`、`shell/ProductPreviewOverlay.tsx`、`shell/CloseConfirmDialog.tsx`、`shell/useDebugFlag.ts`。
- 动作：落地 B 状态机与 E 网格；NewProjectEntry 四项接线（新建→`project.create`+`switchProject`、打开→`switchProject`、最近→`RecentProjectsPanel`、崩溃恢复横幅）；产品预览 overlay（只读，复用 `evaluateShotAtTime`+`StageRenderer`，不写 Store）；保存/关闭合同（保存按钮+Ctrl+S→`saveCurrentProject`；dirty 弹 `CloseConfirmDialog`，禁止直接 `clear`）。
- 回滚点：`git stash` 新 shell 文件 + 还原 `App.tsx`/`styles.css`。

### 阶段 2 — 左栏接入 + 画布唯一挂载 + Fit + Gate 导航
- 修改/新增：`shell/LeftWorkspace.tsx`（Shots/Assets/Characters 三 Tab，带 `data-workspace-tab`）、`shell/CanvasWorkspace.tsx`、`ProjectRecoveryPanel.tsx`（拆分，停止内嵌 `CanvasStage`）、`CanvasStage.tsx`（移出 `HistoryControls`/`LayerTransformPanel`/`LayerOrderControls`）、`App.tsx`（移除 `day25-editor-shell` 中的 `CanvasStage`）。
- 固化 `CanvasStage`(editing) DOM 数量 `=== 1` 断言（双挂载收敛）。

### 阶段 3 — 右栏属性与动作区 + 底栏 History 唯一挂载
- 修改/新增：`shell/RightInspector.tsx`、`shell/BottomWorkspace.tsx`、`ActionPresetPanel.tsx`（迁入右栏）、`CanvasStage.tsx`（确认无内嵌 `HistoryControls`）、`App.tsx`（移除 `day25-action-shell` 中的 `ActionPresetPanel`/`HistoryControls`）。
- `HistoryControls` 唯一挂载于底栏；`useHistoryShortcuts` 注册上提到 `EditorShell`；固化 `HistoryControls`/`ActionPresetPanel` `=== 1` 断言。

### 阶段 4 — Debug 隔离 + 全量回归
- 修改/新增：`shell/DebugWorkspace.tsx`、`FeatureEyebrow.tsx`、`StagePreview.tsx`（门控 `gateA||debug`）、`ProjectRecoveryPanel.tsx`（删除）、`App.tsx`（移除内联 ping/export-probe）、`styles.css`（`[data-debug]` 隐藏 DAY 标签）。
- 全量 Gate + Gate A 回归；验证调试面板默认隐藏。

**Codex 当前初始授权范围（明确）**：

```text
接管审计完成并获主理人确认后，只执行阶段 1。
```

**当前禁止提前执行**：阶段 2（Canvas/LeftWorkspace 正式迁移）、阶段 3（History/Inspector/ActionPreset 正式迁移）、阶段 4（Debug 探针迁移）、`ProductPreviewOverlay`（注：设计把产品预览列入阶段 1 动作范围，但须以「只读、不写 Store、不引入时间轴」为边界；任何超出此边界的预览增强均视为阶段2+，禁止）、Day 26 时间轴（底栏仅预留占位，不实现）。

> 人话：阶段1=搭框架+启动页+保存关闭+只读预览；阶段2=把画布和左栏接进框架并修掉画布双挂载；阶段3=把右边属性和历史接进来并修掉历史双挂载；阶段4=把调试按钮藏起来。你现在只被授权干阶段1。

---

## 11. 阶段 1 精确任务单（可执行 DoD）

> 将设计文档 G 章阶段 1 转工程清单。所有选择器/文件路径以第 9 章与 design 附录为准。

**允许修改文件**：
- `src/renderer/App.tsx`（精简为挂载 `EditorShell` + 保留 `?demo=1`/`?gateA=1` 逻辑）
- `src/renderer/styles.css`（E.1 网格 + 根 `overflow:hidden` + 各栏 `overflow-y:auto` + 中央 `min-width:0`）

**预计新增文件**（位于 `src/renderer/shell/`）：
- `EditorShell.tsx`（状态机 + 路由 + History 快捷键单点注册 + `?debug`/`?gateA` 解析）
- `StartScreen.tsx`（仅 `no-project` 渲染）
- `EditorTopBar.tsx`（项目名/保存态/保存按钮/Ctrl+S/Debug 开关/预览按钮）
- `NewProjectEntry.tsx`（新建/打开/最近/崩溃恢复 四项；唯一 `.recovery-open-row` 位于此处 `ProjectOpenEntry` 子节点）
- `ProductPreviewOverlay.tsx`（只读 overlay；复用 `evaluateShotAtTime`+`StageRenderer`；不写 Store；无镜头时禁用）
- `CloseConfirmDialog.tsx`（保存并退出/不保存退出/取消）
- `useDebugFlag.ts`（解析 `location.search` 的 `debug`/`gateA`）

**必须保留的选择器**（来自白名单，阶段1不得删除/改名）：
- `.recovery-open-row`（input + button）、`.recovery-prompt`、`.recovery-panel`、`.recovery-heading`
- `.clean-state`、`.dirty-state`
- `.recent-projects-panel`、`.recent-projects-list`、`.recent-project-path`
- `.asset-library`、`.character-manager`、`.shot-manager`、`.project-canvas`
- `[data-testid="project-canvas-stage"]`、`[data-testid="project-canvas-viewport"]`、`[data-testid="history-controls"]`、`[data-testid="layer-transform-panel"]`、`[data-testid="layer-order-controls"]`、`[data-testid="canvas-empty-guidance"]`、`[data-testid="canvas-background-warning"]`
- `[data-testid="action-preset-panel"]`
- `.recovery-status-row`（保留于 `EditorTopBar` 保存区，与新增 `.editor-save-button` 共存，不得移除/弱化）

**必须新增的选择器**（随阶段1实现一并提交契约测试，不得提前在阶段0A断言）：
- `.new-project-entry`、`.new-project-button`、`.open-project-button`
- `.editor-save-button`、`[data-testid="editor-preview-button"]`、`.close-confirm-dialog`
- `[data-testid="product-preview-overlay"]`、`.product-preview-transport`、`.product-preview-close`
- （左栏 Tab `[data-workspace-tab="shots|assets|characters"]` 属阶段2，阶段1**不**引入）

**必须运行的测试（本地 + 提交前）**：
- `pnpm typecheck`、`pnpm lint`
- `pnpm test:unit`（含 `tests/contract/dom-selectors.baseline.test.ts` 5 项）
- `pnpm test:integration`
- `pnpm build`
- 逐个体跑 `verify-day13/14/16`（确认阶段1后恢复入口仍经 `.recovery-open-row` 打开，未破坏）
- Gate A 以 GitHub Actions 打包运行为准「推断」

**每步完成标准**：
1. `EditorShell` 渲染测试通过：no-project 显示入口；open 后显示顶/左/中/右/底；根无整页纵向滚动。
2. `StartScreen`/`NewProjectEntry` 四项可触发对应 IPC（`project.create`/`switchProject`/`switchRecentProject`/恢复横幅），失败显示中文错误（`ProjectServiceError.code` 映射，见设计附录3）。
3. 产品预览 overlay 存在且只读：断言其**不触发** `editorProjectStore.updateProject`、不修改 `revision`、无镜头时按钮禁用。
4. 保存/关闭确认对话框在 dirty 时出现；`Ctrl+S` 与保存按钮均经 `saveCurrentProject`；dirty 返回启动页/关闭弹 `CloseConfirmDialog`，**禁止**直接 `clear`。
5. `verify-day16` 仍经 `.recovery-open-row` 打开项目，未破坏 Day16 Gate。
6. 唯一挂载集成测试（阶段0A 延续）：断言当前已存在的 `project-canvas-stage`/`history-controls`/`action-preset-panel` 在阶段1后**数量不减少、选择器仍可见**（注：阶段1 不强制 `===1`，该断言随阶段2/3 落地）。

**回滚点**：`git stash` 全部新增 `shell/*` 文件 + 还原 `App.tsx`/`styles.css` 至 `f16dba2` 状态。

**停止条件（出现即停，汇报主理人）**：
- 任何 `src/` 改动导致 `typecheck/lint/test:unit/test:integration/build` 红且 5 分钟无法定位；
- 发现需要改动 `EditorProjectStore`/`shotStore`/`selectionStore`/`actionPresetStore` 状态归属才能落地（违反「禁止第二套状态」铁律）；
- 发现需要改动 `src/domain/evaluate-shot-at-time.ts` 或复用 `src/shared/domain/evaluate-shot-at-time.ts`（违反 Day23 铁律）；
- 发现需要改动 `src/main/index.ts` close 合同或引入 `beforeunload`；
- 发现需要改动 `ProjectService`/`project-api` 契约；
- 发现需要开始 Day26 时间轴或 ProductPreviewOverlay 超出只读边界（播放头/轨道/关键帧）。

> 人话：阶段1 的验收清单就像装修的「隐蔽工程验收表」——框架立起来、启动页能开项目、预览能看但不许改数据、关窗会问你要不要保存、老旧 Gate 测试不能红。任何一项卡住或发现要动发动机，立刻停工上报。

---

## 12. Gate 与 DOM 兼容矩阵

> 所有 `verify-day{13,14,16,18,19,20,21,22,23,24}` 均先经 `.recovery-open-row` 打开项目（design 事实 #4/#10）。下表列出依赖 UI 区域、关键选择器、重构后导航方式、可能影响阶段、如何避免操作隐藏 DOM。

| Gate | 依赖 UI 区域 | 关键选择器（须保留） | 重构后导航方式 | 可能影响阶段 | 如何避免操作隐藏 DOM |
|---|---|---|---|---|---|
| **Day 13** | 恢复入口 | `.recovery-panel`/`.recovery-open-row`/`.recovery-prompt`/`.recovery-heading` | 默认 `StartScreen` 内的 `NewProjectEntry` → `ProjectOpenEntry`（唯一 `.recovery-open-row`） | 阶段1（入口层） | 入口选择器保留在默认 UI，不得迁 `?debug=1` |
| **Day 14** | 恢复状态 | `.recovery-status-row`/`output`、`.clean-state`/`.dirty-state` | 同上 + `EditorTopBar` 保存区保留 `.recovery-status-row` | 阶段1（顶栏） | `.recovery-status-row` 与新增 `.editor-save-button` **共存**，不得移除/弱化（附录6） |
| **Day 16** | 资产导入（open 由 recovery row 独占） | `.recovery-open-row`/`.asset-library` | 同上 | 阶段1 | `open` 只在入口调用一次；导航不得 `clear`/`open`（H.4） |
| **Day 17** | 资产元数据（node 脚本，env 依赖） | （无 DOM 强依赖） | 不变 | 不受影响 | 仅 CI 环境变量相关 |
| **Day 18** | Assets 标签 | `.asset-library`/`.asset-grid`/`.asset-card`/`.asset-category-tabs` | 打开后 `click('[data-workspace-tab="assets"]')` | 阶段2 | Gate 脚本加导航点击，不得操作 `display:none` 隐藏节点（F.4） |
| **Day 19** | Assets→Characters 标签 | `.asset-import-heading`/`.character-manager` | 先 assets 再 characters Tab | 阶段2 | 同上 |
| **Day 20** | Shots 标签（默认） | `.shot-manager`/`.shot-create-form` | 默认 Shots Tab 激活 | 阶段2 | 切换项目后草稿重置为「镜头 1」（跨项目重挂载 key=projectRoot） |
| **Day 21** | 画布 + Shots 标签 | `.project-canvas`/`[data-testid="project-canvas-stage"]`/`[data-testid="project-canvas-viewport"]`/`.shot-manager-heading span` | 画布常驻 + 默认 Shots | 阶段2 | 中央列 `min-width:0` 防横向滚动 |
| **Day 22** | 画布 + Assets 拖拽源 + 右栏 | `.project-canvas`/`[data-testid="layer-transform-panel"]`/`.asset-category-tabs`/`.recovery-status-row button` | 拖拽前切 assets Tab | 阶段2/3 | 右栏图层属性常驻（非 Tab），与左栏 Tab 条件卸载不冲突 |
| **Day 23** | 画布 + Assets 角色素材 + 右栏 | `.project-canvas`/`[data-testid="layer-transform-panel"]`/`[data-layer-order-controls]`/`.recovery-status-row button` | 拖角色素材前切 assets Tab | 阶段2/3 | 同上 |
| **Day 24** | 画布 + 右栏 + 底栏 History | `[data-testid="history-controls"]`/`[data-testid="layer-transform-panel"]`/`[data-testid="layer-order-controls"]`/`.recovery-status-row button` | 均常驻 | 阶段3 | 底栏 History 唯一挂载；切换项目后 history 清空 |
| **Gate A** | `StagePreview`（仅 `?gateA=1`） | `[data-testid="preview-panel"]`/`[data-testid="stage-renderer"]`/`[data-testid="stage-viewport"]`/`dataset.gatePreviewReady` | 经 `?gateA=1` 自动挂载，独立于 editor snapshot | 阶段4（门控） | Gate A 不查询 `project-canvas` 等编辑选择器，StagePreview 可安全门控 |

**白名单选择器（务必在默认 UI 保留）**：
```text
.recovery-open-row
.recovery-status-row
.editor-save-button
[data-testid="project-canvas-stage"]
[data-testid="project-canvas-viewport"]
[data-testid="canvas-logical-stage"]
[data-testid="history-controls"]
[data-testid="action-preset-panel"]
```
（完整白名单另见 design 附录「Gate 选择器保留白名单」，含 `.recovery-panel`/`.clean-state`/`.dirty-state`/`.asset-library`/`.character-manager`/`.shot-manager`/`.project-canvas` 等。）

**铁律**：Gate 可增加导航动作（点击 `data-workspace-tab`），但**不得放宽断言、不得操作隐藏 DOM**（F.4）。Tab 采用**条件卸载**（unmount 非激活标签），不是 `display:none` 隐藏挂载。

> 人话：这些自动化测试像「质检探头」，各自盯着界面的某个按钮或区域。重构时你不能把探头盯的按钮藏起来或改名，否则质检会误报失败；如果新布局把某个面板挪到另一个标签页，就让探头先「点一下那个标签」再检查，而不是偷偷改探头的合格标准。

---

## 13. 测试与命令

**Codex 可直接复制执行的命令**（在 `D:/panda-stage/.worktrees/day25` 内，使用 pnpm）：

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

**权威结果分层说明**（禁止混淆）：

| 层级 | 说明 | 能否当事实 |
|---|---|---|
| **本地沙箱**（本机 `pnpm test:*`） | 可能受无显示环境、缺 CI 环境变量（`PANDA_STAGE_FFMPEG_PATH`/`FFPROBE_PATH`）、AV 扫描临时盘超时影响 | ❌ 本地偶发失败**不得**写成「已确认回归」；本地全绿**不得**自动等同 CI 全绿 |
| **GitHub Actions**（PR workflow） | 权威结果。本分支末次 `30324231517` SUCCESS；父分支 `a907269` 两次连续 PR SUCCESS | ✅ 以 GitHub Actions 为准 |
| **真实 Electron 人工验收** | M3 唯一最终判定。当前未通过（HIGH-001 REAL UI MAIN PATH FAILED） | ✅ 真人验收前 M3=FAIL |

**当前可引用的测试数字（注明时间与来源）**：
- unit：`472 passed / 0 failed`（74 测试文件），来源 `phase0a-baseline-report.md` §4.2 与 PR #56 body，时间 2026-07-28 阶段0A。
- integration：`84 passed / 1 failed`（17 测试文件），唯一失败 `asset-metadata-revision-safety` 缩略图超时 5000ms（沙箱时序慢，非代码回归），来源同上 §4.3。
- Gate 19 项：`14 PASS / 5 FAIL`（day03/04/06/07/08/09 为无显示/缺 CI 环境变量所致，非代码回归）+ `gate-a` 因阶段0A 不构建发行包而未断言（env-limited）。来源同上 §4.1。
- Day 13/14/16/17/18/19/20/21/22/23/24 + m1 + issue47：除环境相关项外均 PASS。

**禁止**：把环境限制（无显示、缺 env、AV 超时）写成代码 PASS；把本地偶发失败写成已确认回归；跳过任何既有 Gate 来适配新布局。

> 人话：本机跑测试可能因为「没显示器/没装某个工具」而报错，这不代表代码真有 bug；真正算数的成绩单是 GitHub 云端 CI，而最终判卷人是真人在真实软件里走一遍主路径。

---

## 14. 已知坑与历史事故

> 每项含：症状 / 根因 / 已修未修 / 防复发 / 证据来源。

1. **CanvasStage 双挂载**
   - 症状：两个 1920×1080 Konva Stage + 两份 `selectionStore`/`canvasViewportStore` 订阅，交互双写/双渲染。
   - 根因：`features/canvas/CanvasStage.tsx` 被 `App.tsx:171` 与 `ProjectRecoveryPanel.tsx:206` 同时渲染。
   - 已修/未修：**未修**（阶段0A 仅记录；CanvasStage=2）。
   - 防复发：组件树保证唯一（仅 `CanvasWorkspace` 一处）；集成测试断言 `===1`（随阶段2落地）。
   - 证据：`phase0a-baseline-report.md` §5；本人实读 `App.tsx:171`/`ProjectRecoveryPanel.tsx:206`。

2. **HistoryControls 双挂载**
   - 症状：两份 `historyStore` 订阅；`useHistoryShortcuts` 双注册 → Ctrl+Z 可能触发两次。
   - 根因：`App.tsx:167` 与 `CanvasStage.tsx:420` 同时渲染；`useHistoryShortcuts` 在 `HistoryControls` 内注册 `window.keydown`（`HistoryControls.tsx:42`）。
   - 已修/未修：**未修**（HistoryControls=2）。
   - 防复发：仅 `BottomWorkspace` 一处挂载；快捷键注册上提到 `EditorShell` 单点。
   - 证据：`phase0a-baseline-report.md` §5；本人实读 `App.tsx:167`/`CanvasStage.tsx:420`/`HistoryControls.tsx:42`。

3. **Day 20 重复挂载导致镜头复制 Gate 回归**
   - 症状：Day 20 复制失败 Gate 回归。
   - 根因：`App.tsx` 编辑外壳中冗余的 `<ShotManager>` 双挂载。
   - 已修/未修：**已修**（`2142003 fix(day25): Issue #54 Day20 根因 — 移除 App.tsx 编辑外壳中冗余的 <ShotManager> 双挂载`）。
   - 防复发：单挂载契约（组件树唯一）。
   - 证据：`git log` 提交 `2142003`。

4. **Day 23 误用 deprecated evaluator**
   - 症状：动作时间语义错误（提前/回跳）。
   - 根因：编辑/预览路径 import `src/shared/domain/evaluate-shot-at-time.ts`（`@deprecated` move-only）。
   - 已修/未修：**已修**（`d1fb8b9 fix(day25): Issue #54 Day23 根因 — verify-issue47 改用正式 evaluateShotAtTime (src/domain)`）。
   - 防复发：编辑画布只用 `buildEditorStageRenderModel`；产品预览/StagePreview 用 `src/domain/evaluateShotAtTime`；ESLint/注释禁止 `features/**` 与 `StagePreview` import shared 版本。
   - 证据：`design` H.7/H.8；`git log` `d1fb8b9`。

5. **连续预设 from/to 静态基态导致边界回跳**
   - 症状：两连续事件之间图层回跳到静态基态。
   - 根因：连续预设用静态 `from`/`to` 基态而非基于前事件结束态。
   - 已修/未修：**已修**（Issue #53 时间语义修复，evaluator 正确版 `src/domain/evaluate-shot-at-time.ts` 已正确处理 `rawProgress=1` 应用最终态）。
   - 防复发：evaluator 时间语义测试覆盖「两连续事件之间不回跳」。
   - 证据：`gh pr view 53` body；`evaluate-shot-at-time.ts:141-157`。

6. **未来事件提前生效**
   - 症状：事件在 `startMs` 前就用 `from` 覆盖基态。
   - 根因：evaluator 未跳过未来事件。
   - 已修/未修：**已修**（`evaluate-shot-at-time.ts:147` `if (timeMs < event.startMs) continue;`）。
   - 防复发：evaluator 测试覆盖「开始前=基态」。
   - 证据：同上 + `gh pr view 53`。

7. **Day 17 Windows runner 临时目录 / abort 竞态**
   - 症状：`run 30251740818`(push SUCCESS) 与 `run 30251743631`(pull_request Day17 FAIL) 结果不一致；`asset-metadata-revision-safety` 超时。
   - 根因：两类——(a) 测试临时目录落在被 AV 扫描的 `C:` 系统盘超时；(b) mock 缺 `signal?.aborted` 守卫导致 abort 竞态。
   - 已修/未修：**已修**（`a907269` 路由 20 个测试到 `RUNNER_TEMP`；`19ce4bd` abort 竞态确定性修复；同 tree 字节级一致证明纯环境 flake）。
   - 防复发：临时目录用 `process.env.RUNNER_TEMP ?? os.tmpdir()`；mock 复刻生产守卫。
   - 证据：`gh pr view 53` body；`git log` `a907269`/`19ce4bd`。

8. **pnpm shim 环境问题**
   - 症状：本机 corepack pnpm shim 损坏导致 build 脚本失败。
   - 根因：环境 pnpm shim 损坏，非代码问题。
   - 已修/未修：**已修**（恢复 `build` 脚本为 `pnpm typecheck && pnpm build:renderer && pnpm build:electron`，本地用绝对路径 pnpm 验证）。
   - 防复发：CI 用规范 pnpm；本地用绝对路径。
   - 证据：`gh pr view 53` body（`build` 脚本恢复）。

9. **禁止用 `beforeunload` 替代 Electron 关闭合同**
   - 症状/根因：若用临时 `beforeunload` 替代正式 `window.on('close')` 合同，会丢失 save/discard/cancel 语义与保存失败保持窗口打开的行为。
   - 已修/未修：现状已用正式合同（`main/index.ts:72` + 原生 dialog），**未用** `beforeunload`。
   - 防复发：v1.1a 附录4 明文禁止降级为 `beforeunload`。
   - 证据：本人实读 `main/index.ts:72,278-313`；design v1.1a 附录4。

10. **禁止只压缩 CSS 冒充信息架构修复**
    - 症状/根因：仅把长页面「看起来更紧凑」却不改变信息架构（无 Start Screen、模块仍分离），M3 主路径依旧不成立。
    - 已修/未修：N/A（预防项）。
    - 防复发：Issue #55 禁止事项明文；M3 PASS 条件含「用户无需在多个纵向 Demo 区之间滚动寻找功能」。
    - 证据：Issue #55 禁止事项。

> 人话：这些是前人踩过的坑——同一个画布被挂了两次会双写、快捷键被注册两次会撤销两次、用错旧版计算器会让动画时间错乱、关窗口的确认框不许用网页临时方案偷换。每条都附了「怎么不再踩」的护栏。

---

## 15. Codex 首次接管步骤（顺序 1~11）

1. **读取本 Handoff**（`docs/handoff/CODEX-HANDOFF-M3-EDITOR-SHELL-2026-07-28.md`）。
2. **读取 Issue #55**（`gh issue view 55`，理解 M3 产品集成修复单与禁止事项）。
3. **读取设计文档 v1.1a**（`docs/design/m3-editor-shell-design.md`）。
4. **读取阶段 0A 报告**（`docs/design/phase0a-baseline-report.md`）。
5. **读取 Draft PR #56**（`gh pr view 56`，确认范围=阶段0A基线、src 零改动、CI 状态）。
6. **读取 Draft PR #53**（`gh pr view 53`，理解 Day25 领域修复与冻结约束）。
7. **核对 Git / PR / CI**：重跑 `git branch --show-current`、`git rev-parse HEAD`、`git status --short`、`git diff feat/day-25-action-presets...HEAD --name-status`、`gh pr view 56/53`、`gh run list --branch fix/m3-editor-shell -L 5`（本文档第0章已核验，可参照）。
8. **检查工作树干净**：确认无 `src/` 变更（`git status --short` 应为空）。
9. **不改代码，先输出接管审计**：书面列出「现场与预期是否一致 / 双挂载计数 / 阶段0A交付物 / 下一步建议」。
10. **发现不一致时停止并汇报**：若发现 SHA、文件、CI、双挂载计数与本文档/Issue 不符，**立即停手**，在文档顶部单列「现场差异」并上报主理人，禁止静默修正。
11. **获主理人确认后才执行阶段 1**：在确认「接管审计无差异」且主理人明确授权后，方可开始第 11 章阶段 1 任务单；之前任何 `src/` 改动均禁止。

> 人话：先读完所有图纸和这本交接手册，自己动手核对现场，确认「工地和说明书对得上」并且拿到工头（主理人）开工许可，才许动第一块砖。

---

## 16. 真人 M3 验收（14 步真实主路径）

> 在真实 Windows Electron 中由用户本人执行。自动化（CI/Gate）全绿只是门槛，**真人验收才是 M3 最终判定**。

```text
1.  启动应用
2.  新建或打开项目
3.  创建 / 选择镜头
4.  导入素材
5.  创建角色并配置至少两个表情
6.  将角色加入当前镜头
7.  在画布选择角色图层
8.  应用至少三类动作预设（8 类抽查：左入场/右入场/移动到/放大强调/抖动/表情切换/淡入/淡出 均须能从右栏触发）
9.  在预览中确认动作按时间生效，无提前生效、无边界回跳
10. 撤销并重做
11. 保存项目
12. 关闭应用
13. 再次启动并重开项目
14. 确认镜头、图层和动作事件均保留
```

**明确**：
```text
真人验收前：M3 = FAIL
PR 不得合并
Day 26~45 冻结
```

任意主路径步骤无法完成 → `M3 = FAIL`、`Day 26~45` 继续冻结、`docs/test-receipts/M3.md` 以真实证据更新。

> 人话：最终的考试就是真人在真实软件里，从开机到保存重开走完这一整套动画制作流程，并且确认动作按时间播放、撤销重做有效、关掉再开数据还在。任何一步卡住，M3 就还是不及格。

---

## 17. 当前唯一下一步

Codex 独立审计 Handoff 与仓库现场；确认无差异后，仅执行 Issue #55 阶段 1。

---

> 文档完。本文件由 software-architect（高见远）于 2026-07-28 在 worktree `D:/panda-stage/.worktrees/day25` 内，基于实跑 `git`/`gh` 命令与实读指定源码后独立撰写，未修改任何 `src/` 生产代码，未执行 git 提交（由主理人统一提交）。所有 SHA 为完整 SHA，所有文件路径经实读确认存在，测试数字注明时间与来源，推断项已标注「推断」，未验证项已标注「未验证」。
