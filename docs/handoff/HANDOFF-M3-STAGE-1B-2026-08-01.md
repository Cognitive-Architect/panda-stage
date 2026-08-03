# 接管交接文档 — M3 Stage 1B（安全新建 / 产品预览 / 应用内关闭）

> 仓库：`Cognitive-Architect/panda-stage`
>
> 工作树：`D:/panda-stage/.worktrees/day25`
>
> 分支：`fix/m3-editor-shell`
>
> **Stage 1B 已验收源码基线**：`bb24c59c9e4809387379efb6a4a3d20fb9b80df9`
> —— 这是经过自动化门禁（CI 全绿）与真实 Windows Electron 人工验收（R1–R10 全 PASS）的**实现代码基线**。
>
> **本文档入库后的新 HEAD**：本文件通过一次 **docs-only 提交** 入库，该提交**仅新增本 Markdown 文件**，
> 不含任何源码 / 测试 / 配置改动。它会改变 `fix/m3-editor-shell` 的 HEAD 与 PR #56 的 `headRefOid`，
> 但**不改变已验收源码基线** —— `git diff bb24c59..HEAD` 的结果只有本文件一项。
>
> 授权来源：Issue #76（`feat(m3): authorize Stage 1B secure project creation, preview, and close flow`）
>
> 本版：Stage 1B 实现 + CI 全绿 + R1～R10 人工验收 PASS，等待主理人最终授权关闭 Issue #76

---

## 0. 接管结论（先读这一段）

```text
Stage 1B implementation      = completed
Stage 1B automated gates     = ALL GREEN
Stage 1B human acceptance    = PASS (R1-R10, R10 含 A/B/C)
Stage 1B 已验收源码基线      = bb24c59c9e4809387379efb6a4a3d20fb9b80df9
分支当前 HEAD                = 上述基线 + 一次 docs-only 提交（仅本文档，无源码改动）
Issue #76                    = OPEN（等待主理人最终授权后才可关闭）
PR #56                       = Open / Draft / 未合并
Issue #55                    = Open
M3                           = FAIL
Stage 2 / 3 / 4              = not started
Day 26–45                    = frozen
```

**两个 SHA 不要混淆**：

| 概念 | 值 | 含义 |
|------|-----|------|
| Stage 1B 已验收源码基线 | `bb24c59c9e4809387379efb6a4a3d20fb9b80df9` | 所有 CI 门禁与 R1–R10 人工验收所针对的实现代码状态；一切验收证据都锚定在此 SHA |
| 分支 / PR #56 当前 HEAD | docs-only 提交 SHA（本文档入库产生） | 仅比基线多出本 Markdown 文件；**不是**新的源码状态，也不代表任何实现变更 |

**接管者第一原则**：本分支已完成 Stage 1B 全部授权范围。**不要**在未获得新 Issue 授权的情况下继续做 Stage 2/3/4、Day 26、删除 LegacyWorkspace、收敛双挂载、修改 evaluator 领域语义或项目 schema。以上任何一项都属于越界。

---

## 1. Git 与 PR 拓扑

```text
fix/m3-editor-shell
        ├─ bb24c59  ← Stage 1B 已验收源码基线（CI 全绿 + R1–R10 人工验收 PASS）
        └─ docs-only 提交（仅本文档）  ← 分支当前 HEAD / PR #56 headRefOid
        → PR #56 (Draft, base = feat/day-25-action-presets)
feat/day-25-action-presets
        → PR #53 (Draft)
main
```

- **Stage 1B 已验收源码基线**：`bb24c59c9e4809387379efb6a4a3d20fb9b80df9`
- **分支当前 HEAD**：本文档的 docs-only 提交（其 SHA 即提交后 PR #56 的 `headRefOid`）
- Stage 1B 开工前基线：`50ef69686997825fc02a61455ef534fef7bcf4ad`
- 受控源码 / 测试 / 配置：全部已提交，`bb24c59` 之后**零源码改动**
- 校验方式：`git diff --name-only bb24c59..HEAD` 应**只返回** `docs/handoff/HANDOFF-M3-STAGE-1B-2026-08-01.md`。若返回其他文件，说明有人在验收基线之上追加了未授权改动，接管者必须先查清再动手。

---

## 2. Stage 1B 交付内容（4 个提交，线性叠加）

| # | SHA | 类型 | 说明 | 回滚 |
|---|-----|------|------|------|
| 1 | `1428080` | feat | 安全新建项目 + `project.createAt` IPC | `git revert 1428080` |
| 2 | `090f6dc` | feat | ProductPreviewOverlay 产品预览浮层 | `git revert 090f6dc` |
| 3 | `fcf076f` | feat | 应用内关闭项目确认 + `verify:issue76` 门禁 | `git revert fcf076f` |
| 4 | `bb24c59` | fix(test) | 修正 create-flow IPC 断言的行尾脆弱性 | `git revert bb24c59` |

三个功能提交彼此独立、可分别回滚；整体回滚 3→2→1 即回到 `50ef696`，且**不改变** M3=FAIL / #55 Open / PR#56 Draft / Day26-45 冻结。

> 上表 4 个提交构成 **Stage 1B 已验收源码基线 `bb24c59`**。此后分支上还有一个 **docs-only 提交**（仅新增本文档），它不属于 Stage 1B 源码交付，也不参与上述回滚链；单独 revert 它只会删掉本文档。

### Commit 1 — 安全新建项目（`1428080`）

生产文件：
```
src/shared/ipc/channels.ts                      PROJECT_CREATE_AT: 'project:create-at'
src/shared/project-api.ts                       ProjectCreateAtRequestSchema (.strict)
src/preload/index.ts                            project.createAt（双向 zod 校验）
src/renderer/global.d.ts                        createAt 类型声明
src/main/services/PathService.ts                新增 dirname() 辅助方法
src/main/services/ProjectService.ts             新增 createAt() + resolveNewProjectRoot()
src/main/ipc/register-project-ipc-handlers.ts   PROJECT_CREATE_AT handler
src/renderer/shell/projectCreateFlow.ts         (新) 渲染进程创建流程与校验
src/renderer/shell/NewProjectDialog.tsx         (新) 新建项目对话框
src/renderer/shell/NewProjectEntry.tsx          启用入口（原为 disabled 占位）
src/renderer/shell/StartScreen.tsx              接线
src/renderer/shell/EditorShell.tsx              唯一 Session owner 接线
src/renderer/styles.css                         样式
```

**契约（不可破坏）**：
```ts
// src/shared/project-api.ts:154
ProjectCreateAtRequestSchema = z.object({
  parentDirectory: FileSystemPathSchema,
  projectName: ProjectNameSchema,
  metadata: ProjectCreateMetadataSchema,
}).strict()
```
```ts
// src/main/services/ProjectService.ts:185
async createAt(rawParentDirectory, rawProjectName, rawMetadata) {
  return this.create(
    this.resolveNewProjectRoot(rawParentDirectory, rawProjectName),
    rawMetadata,
  );
}
```
- Renderer **只**提交 `parentDirectory` / `projectName` / `metadata`，**绝不**拼接最终 `projectRoot`
- Main 用 `pathService.join(parentDirectory, projectName + '.pandastage')` 生成 root，并做 basename / dirname 容器化校验（`resolveNewProjectRoot`，:400-441）
- 落盘复用既有 `ProjectService.create(root, metadata)`（createProjectTree + 原子写 `project.json`，EEXIST → `PROJECT_ALREADY_EXISTS`）
- 渲染进程侧校验：Windows 非法字符 / 保留名 / 路径分隔符 / 结尾点与空格 / 长度；错误码 → 中文文案

### Commit 2 — 产品预览浮层（`090f6dc`）

```
src/renderer/shell/ProductPreviewOverlay.tsx    (新) 浮层
src/renderer/shell/productPreviewModel.ts       (新) 本地播放时间态
src/renderer/shell/EditorTopBar.tsx             启用入口
src/renderer/shell/EditorShell.tsx              挂载
```

**契约（不可破坏）**：复用正式 `evaluateShotAtTime` / `evaluateSubtitleAtTime` / `CanvasStage` → `StageRenderer` → `buildStageRenderModel`，素材走 `window.pandaStage.assets.readThumbnail`。播放时间态**仅**存在于组件内 state / rAF，**不写** Project、**不改** revision / Dirty / Selection / History。`StagePreview.tsx`（PROBE fixtures + gateA）**未被修改**。

### Commit 3 — 应用内关闭项目（`fcf076f`）

```
src/renderer/shell/CloseConfirmDialog.tsx                 (新) 三分支确认框
src/renderer/shell/closeProjectFlow.ts                    (新) 流程与中文文案
src/renderer/features/recovery/ProjectSessionController.ts 仅新增 closeProject()
src/renderer/shell/EditorTopBar.tsx                       关闭项目入口
src/renderer/shell/EditorShell.tsx                        接线
scripts/verify-issue76.cjs                                (新) Electron 门禁
package.json / .github/workflows/ci.yml                   verify:issue76
```

**契约（不可破坏）**：
```ts
type CloseProjectChoice = 'save-and-close' | 'close-without-saving' | 'cancel';
```
- 应用内关闭走 `ProjectSessionController.closeProject()`（`api.stop` → `store.clear()` → 重置 snapshot）
- **不碰**原生 `UnsavedCloseGuard` / `UnsavedCloseController` / `window.close`；Windows 窗口 `×` 仍走原生 Guard
- 保存失败保护：任何失败分支项目**保持打开**（`closeProjectSaveFailureMessage` / `CLOSE_PROJECT_STALE_SAVE_MESSAGE`）
- `closeProject()` 重置 snapshot 是必需的：否则"关闭 A → 重开 A"会 stop 刚追踪的 A session，破坏原生 Guard

---

## 3. 四项主理人裁定（接管者需知悉，勿擅自推翻）

| # | 裁定 | 理由 |
|---|------|------|
| ① | 授权 `ProjectSessionController.closeProject()` **增量新增**（非重写） | 不加则原生 × Guard 在"关闭后重开"场景静默失效 |
| ② | 授权 `ci.yml` 新增 `pnpm verify:issue76` 步骤 | 仿 `verify:issue73` 先例，保证回归可持续 |
| ③ | `chooseDirectory` 复用既有 `projectRoot` 字段承载 parentDirectory | 零新增 IPC |
| ④ | 应用内"不保存关闭"**保留** recovery 文件 | 无 discard IPC 暴露；UI 已用 `CLOSE_PROJECT_RECOVERY_NOTICE` 明示，与原生 discard 清理语义的差异属预期 |

---

## 4. 质量门禁

必跑命令（**Windows 下务必前缀 `unset ELECTRON_RUN_AS_NODE`**）：

```bash
cd D:/panda-stage/.worktrees/day25
unset ELECTRON_RUN_AS_NODE && npx --yes pnpm@10.13.1 typecheck
unset ELECTRON_RUN_AS_NODE && npx --yes pnpm@10.13.1 lint
unset ELECTRON_RUN_AS_NODE && npx --yes pnpm@10.13.1 test:unit
unset ELECTRON_RUN_AS_NODE && npx --yes pnpm@10.13.1 test:integration
unset ELECTRON_RUN_AS_NODE && npx --yes pnpm@10.13.1 build
unset ELECTRON_RUN_AS_NODE && npx --yes pnpm@10.13.1 verify:issue76
```

本地结果（**已验收源码基线 `bb24c59`**）：typecheck ✅ / lint ✅ / unit **82 文件 569 用例** ✅ / integration **21 文件 121 用例** ✅ / build ✅ / verify:issue76 ✅

GitHub CI（PR #56 `quality`）：run `30683531536`（8m24s）与 `30683532990`（6m41s）**双跑 pass**，成功步骤覆盖：
Typecheck / Lint / Unit / Integration / Build / Day 13 / Day 14 / M1 / Day 16 / Day 17 / Day 18 / Day 19 / Day 20 / Day 21 / Day 22 / Day 23 / Day 24 / Issue 73 / **Issue 76 Stage 1B create / preview / close gate**

本文档的 docs-only 提交会再次触发 PR #56 的 `quality` 工作流。由于该提交不含任何源码 / 测试 / 配置改动，其 CI 结果应与 `bb24c59` 完全一致；若出现失败，属于基础设施抖动而非 Stage 1B 实现回归，请先重跑再排查。

---

## 5. 人工验收结果（真实 Windows Electron，全部 PASS）

| # | 验收项 | 结果 |
|---|--------|------|
| R1 | StartScreen 新建项目入口可点击 | PASS |
| R2 | 父目录选择器取消无报错无脏状态 | PASS |
| R3 | 合法名称创建并自动进入 editor | PASS |
| R4 | 重名 / 非法名称中文错误且不覆盖 | PASS |
| R5 | 完整重启后新项目出现在最近项目并可打开 | PASS |
| R6 | 产品预览播放 / 暂停 / 重播 / 关闭，项目状态不变 | PASS |
| R7 | Dirty 关闭 → 取消，留在 editor | PASS |
| R8 | Dirty 关闭 → 不保存，返回 StartScreen 且磁盘不变 | PASS |
| R9 | Dirty 关闭 → 保存并关闭，重开修改存在 | PASS |
| R10-A | 原生 × → 取消 | PASS |
| R10-B | 原生 × → 不保存 | PASS |
| R10-C | 原生 × → 保存并退出 | PASS |

**R10-C 端到端证据**：镜头名改为 `R10C_保存退出_重启后应存在`、时长 `4567ms` → 应用显示"有未保存的更改" → 点窗口右上角 × → 正常弹出"保存并退出 / 不保存 / 取消" → 选"保存并退出"应用成功关闭 → 重启并打开 `Stage1B_R3_合法新建.pandastage` → 镜头名仍为 `R10C_保存退出_重启后应存在`、时长仍为 `4567ms` → 可正常编辑，无白屏 / 崩溃 / 英文错误 / 异常 Recovery 提示 → 正式状态显示"暂无未保存更改"。

---

## 6. 白名单外改动说明（如实披露）

相对架构师 Phase A 锁定的 15 个生产文件，实际多出 2 个，均为 `createAt` 的必要附属改动、纯新增、不改既有行为：

| 文件 | 改动 | 性质 |
|------|------|------|
| `src/main/services/PathService.ts` | 新增 `dirname()` | 纯新增方法，供 `resolveNewProjectRoot` 做容器化校验 |
| `src/renderer/global.d.ts` | 新增 `createAt` 类型声明 | typecheck 必需，无运行时行为 |

禁止路径扫描（`git diff --name-only 50ef696 HEAD` 对照 `src/domain/`、`EditorProjectStore`、`AutosaveService`、`UnsavedCloseController`、`unsaved-close-guard`、`ProjectSchema`、`src/main/index.ts`、`src/renderer/App.tsx`）→ **NO_FORBIDDEN_PATHS**。`ProjectSchema` 未改动。

---

## 7. 绝对禁止（未获新授权前）

- 将 M3 改为 PASS；关闭 Issue #55；将 PR #56 转 Ready 或合并；合并 PR #53
- Stage 2 左栏 / Canvas 正式迁移；Stage 3 Inspector / Action / History 迁移；Stage 4 Debug 隔离
- 删除 LegacyWorkspace；收敛 CanvasStage / HistoryControls 双挂载
- 进入 Day 26～45；修改 evaluator 领域语义；修改项目 schema
- 修改 `StagePreview.tsx`（PROBE fixtures + gateA）
- 重写 `ProjectSessionController`；创建第二套 Project / Selection / History Store

---

## 8. 当前唯一下一步

```text
等待主理人最终授权后，方可按 Issue #76 第十章条件关闭 Issue #76。
关闭前提已满足 1-6 项，仅差第 7 项"主理人明确回复 Stage 1B 人工验收通过"的最终授权动作。
关闭 Issue #76 不等于 M3 PASS，也不解冻 Stage 2/3/4 与 Day 26-45。
```

---

## 9. 环境陷阱（务必知悉，已多次踩中）

1. **`ELECTRON_RUN_AS_NODE=1`** 会让 Electron 以纯 Node 启动并崩溃。所有 pnpm 命令必须前缀 `unset ELECTRON_RUN_AS_NODE`。
2. **`gh --body-file` 在本沙箱失效**：`gh` 的 Windows 二进制无法打开由 Bash 工具写入的文件路径（含 `/tmp` 与 `/d/panda-stage`）。改用字符串参数：`gh pr edit 56 --body "$(cat file)"`。
3. **`/tmp` 文件在后台任务之间可能消失**，优先用工作区路径或命令替换。
4. **无显示沙箱内 Electron 会干净退出（exit code 0）**：`Hidden window ready` 后主进程自行退出，`concurrently --kill-others` 随之拆掉 vite/tsc，日志表现为 `ELIFECYCLE exit 1`。这不是代码 bug。真实实机验收必须在有显示器的 Windows 桌面上 `pnpm dev`。

---

## 10. 关键文件索引

```
授权文档          GitHub Issue #76
Phase A 审计      Issue #76 首条 comment
人工验收证据      Issue #76 证据收口 comment（2026-08-01）
PR 描述           PR #56（含 Stage 1B delivery / local validation / human acceptance 段）
Stage 1A 交接     docs/handoff/CODEX-HANDOFF-M3-EDITOR-SHELL-2026-07-28.md
本文档            docs/handoff/HANDOFF-M3-STAGE-1B-2026-08-01.md
Electron 门禁     scripts/verify-issue76.cjs
```
