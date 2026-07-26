# Panda Stage — Day 25 续做交接文档（RESUME）

> 生成时间：2026-07-27 04:32 (GMT+8)
> 适用场景：当前对话上下文已压缩/失效，需在新窗口/新会话中继续 Day 25 任务。
> 这份文档自包含，新窗口只需读它 + 看 worktree 实际文件即可接手，无需翻历史。

---

## 0. 一句话状态

**Day 25 代码主体已全部写完，typecheck=0、lint=0 已通过；但测试还差 9 个失败（迁移回填漏 `flipX` 字段）+ build 崩溃（vite exit 3221225794 待排查），全部代码尚未 `git commit`。下一步：修测试 → 排 build → 提交 → 派 QA 跑独立验证并定稿 `docs/test-receipts/M3.md`。**

---

## 1. 环境与路径骨架（新窗口必读）

| 项 | 值 |
|---|---|
| 真实 Day 24 主线 | `origin/main` @ `5ad69110f7141cbc969466c8179bf1709753a945`（PR #48 已合并，Gate A/M1/M2 PASS） |
| 用户原工作目录 | `D:\panda-stage`（当前在 `dev` 分支，M0.5 早期原型，**禁止触碰**） |
| Day 25 隔离 worktree | `D:\panda-stage\.worktrees\day25` |
| 功能分支（已存在） | `feat/day-25-action-presets`（指向 `5ad6911`，无新提交） |
| node 运行时 | `C:\Users\admin\.workbuddy\binaries\node\versions\22.22.2\node.exe` |
| pnpm（已装到受管 workspace） | `C:\Users\admin\.workbuddy\binaries\node\workspace\node_modules\pnpm\bin\pnpm.cjs` |
| 依赖 | worktree 内 `node_modules` 已装好（含 Electron），无需重装 |
| 设计文档 | `D:\panda-stage\.worktrees\day25\docs\system_design.md`（架构师产出，必读） |
| 原始工单 | `D:\panda-stage\.worktrees\handoff\agent task\DAY-25-AGENT-TASK.md` |
| 总接管手册 | `D:\panda-stage\.worktrees\handoff\HANDOFF_PANDA_STAGE.md` |

**新窗口启动命令（在隔离 worktree 内操作）：**
```bash
cd "D:/panda-stage/.worktrees/day25"
# 跑任意脚本都用这条 pnpm（本机 corepack 的 pnpm shim 已损坏，别用 corepack）
C:\Users\admin\.workbuddy\binaries\node\versions\22.22.2\node.exe C:/Users/admin/.workbuddy/binaries/node/workspace/node_modules/pnpm/bin/pnpm.cjs <args>
# 例：typecheck / lint / build / test:unit / test:integration
```

---

## 2. 已完成的阶段

1. **环境/分支就绪**：在真实 Day 24 主线上建了隔离 worktree（绕开了本机 MinGit 嵌套分支名 bug，见 §5）。`dev` 分支未动。
2. **架构审计完成**（文档 `docs/system_design.md`）：
   - ✅ `Shot.timelineEvents` 在 schema **v5 已存在 → 不升版本**，只补迁移回填；
   - ✅ 双链分叉对齐方案（RISK-EVENT-001）：在 `src/domain` 新增正式 evaluator 处理 7 类事件，编辑/预览/导出三处改指它，旧 `shared` evaluator 加 `@deprecated` 保留——**彻底不混用 `durationMs/endMs`**。
3. **代码实现（前序工程师 + 恢复工程师接力）**：8 类预设定义、纯函数事件工厂 `createPresetEvents`、validator（越界显式拒绝+中文原因）、History 接入（复用 `ProjectCommand`）、UI 面板 `ActionPresetPanel`/`PresetParameterForm`、`actionPresetStore` 均已落地。
4. **R1 硬伤已修复**：原 `src/renderer/App.tsx` 只是「共享渲染架构探针」外壳（只挂 `StagePreview`+导出探针），编辑 UI 没进运行应用。现 `App.tsx` 已挂载完整编辑外壳（行 167–178）：`CanvasStage` / `ShotManager` / `AssetLibrary` / `ActionPresetPanel` / `HistoryControls`，用户可在 UI 里「建镜头→放图层→选中→应用动作预设→撤销/重做」。

---

## 3. 当前代码 / 门禁状态（实测，2026-07-27 04:09）

| 检查 | 结果 | 说明 |
|---|---|---|
| `typecheck` (`tsc --noEmit` + electron tsc) | ✅ **0 错误** | 源码 + 测试全过 |
| `lint` (`eslint .`) | ✅ **exit 0** | 无报错 |
| `test:unit` (`pnpm test:unit`) | ❌ **9 failed / 425 passed (434)** | 失败全在 `tests/unit/domain/migrations/project-migration.test.ts:194` |
| `build` (`pnpm build`) | ❌ **崩溃** | `vite build` 退出码 `3221225794`（Windows 内存/崩溃码），`build:renderer` 阶段挂，`build:electron` 未跑到 |
| `test:integration` | ⚠️ **未跑** | 恢复工程师只跑了 unit，需新窗口补跑 |
| `git commit` | ❌ **未提交** | HEAD 仍为 `5ad6911`，所有改动在 working tree（已 modified / untracked） |

**两个未决尾巴的精确定位：**

- **测试 9 失败根因**：`project-migration.test.ts:194` 调 `migrateProject` → 内部 `ProjectSchema.parse(input)` 抛
  `Invalid input: expected boolean, received undefined`（字段 `flipX`）。说明 T01 迁移回填只补了 `timelineEvents:[]`，但旧 v1/v2 fixture 还缺 `flipX`（及其他 v5 必需布尔字段），被严格 `ProjectSchema` 拒绝。
  **修复方向（二选一或组合）**：
  ① 在 `src/domain/models/project.ts` 的 `addBackgroundIdentity`（V1/V2 路径）与 V3/V4 映射分支，除 `timelineEvents:[]` 外，再补 `flipX:false` / 其他 v5 必需字段（先对照 `ProjectSchema` / `LayerSchema` 的必需布尔字段清单）；
  ② 修正测试 fixture，使其本身符合 v5 严格 schema（但若 fixture 意在模拟「旧文件缺字段」，则应以①为主，fixture 只负责缺 `timelineEvents`）。
  **先读** `src/domain/models/project.ts` 的迁移分支 + `src/domain/models/layer.ts` 的 `flipX` 定义，确认缺哪些字段再补。

- **build 崩溃根因**：`vite build` 退出码 `3221225794`。typecheck 已过，故大概率不是 TS 错误，可能是本机 OOM / Electron 打包资源问题 / 某 chunk 过大。
  **排查步骤**：① 单独跑 `pnpm build:renderer` 看 vite 真实报错；② 若报内存不足，加 `NODE_OPTIONS=--max-old-space-size=4096`；③ 确认是否真有代码问题（如循环依赖、超大静态资源）。**注意**：build 对 M3 回执非硬性前置（M3 是逻辑/功能验证，靠 typecheck + unit + integration），但如工单要求 build 绿，则需修复。先确认是环境还是代码。

---

## 4. 剩余任务清单（新窗口按序推进）

> 建议新窗口用软件公司 SOP：工程师修测试/build → 提交 → QA 独立验证 + 定稿 M3.md。
> 工程师 prompt 务必**精简**（前序工程师因 prompt 过长触发 `400 input length too long` 失败）。

**T-A 修迁移测试（工程师，约 30 min）**
- 读 `src/domain/models/project.ts`（迁移分支）+ `src/domain/models/layer.ts`，确认 v5 必需字段（尤其 `flipX` 及 flip 相关）；
- 在迁移回填处补齐缺失字段（维持 v5，不 bump 版本）；
- 跑 `pnpm test:unit`，目标 0 fail。

**T-B 排查 build 崩溃（工程师）**
- 单独 `pnpm build:renderer` 拿真实错误；按需加内存上限或修代码；
- 若确认是本机环境问题且无法在 CI 复现，在 M3.md 标注「build 未在本环境验证，原因：…」，**不要伪造 PASS**。

**T-C 跑集成测试（工程师/QA）**
- `pnpm test:integration`：覆盖 `tests/integration/action-preset-history.test.ts`（应用→undo→redo→序列化重开不丢事件）；
- 有失败则修。

**T-D 提交（工程师，门禁全绿后）**
- 在 worktree 内 `git add -A && git commit -m "feat(day25): action presets + validated event generation + M3 gate"`；
- **不要 push**（远程未连）。

**T-E QA 独立验收 + M3 回执（QA 严过关）**
- 独立读代码 + 跑 `typecheck`/`lint`/`build`/`test:unit`/`test:integration`；
- 按工单模块5 格式定稿 `docs/test-receipts/M3.md`：结论**仅 PASS / FAIL**，任何未验证项按 FAIL；
- 覆盖 8 类预设生成、整数 ms、唯一 ID、逻辑坐标、History undo/redo、保存重开、未选/locked/越界/失效表情拒绝；
- 失败则另建 `docs/decisions/M3-FAILURE-REPORT.md`，结论 FAIL 会冻结 Day 26–45；
- 真人 GUI 手动操作若无法在本环境验证，明确标「未验证」并说明。

---

## 5. 本仓库已知坑（新窗口必看，避免重蹈覆辙）

1. **本机 MinGit（git 2.54）对嵌套分支名静默失败**：`git branch feat/day-25-...` 不报错但也不建分支；`worktree add <SHA>` 会落成 unborn 分支。已用「建本地 base 分支 `day25base`@origin/main → `git worktree add <dir> day25base` → 手动 `mkdir .git/refs/heads/feat && printf <sha> > .git/refs/heads/feat/day-25-action-presets` → `git checkout feat/day-25-action-presets`」绕开。**分支已建好，新窗口不要重建。**
2. **工程师 Agent prompt 过长会 `400 input length too long`**：派工程师时 prompt 要精简，附关键文件路径与精确错误，不要贴大段设计文档全文。
3. **本机 corepack 的 pnpm shim 损坏**：用 §1 给的绝对路径 pnpm，别用 `corepack pnpm` / 裸 `pnpm`。
4. **AI Agent 跑命令会把日志 `> file` 写进仓库根**（如 `g_*.txt`/`tc_*.txt`/`.bin/`）：已清理。新窗口若再出现，提交前务必 `rm -f g_*.txt tc_*.txt && rm -rf .bin` 清理，避免误提交。

---

## 6. 关键文件索引（worktree 内绝对路径）

**新增源文件**
- `D:\panda-stage\.worktrees\day25\src\domain\evaluate-shot-at-time.ts`（正式 7 类 evaluator，替代旧 shared 版）
- `D:\panda-stage\.worktrees\day25\src\domain\actions\ActionPreset.ts`（8 类预设数据驱动定义）
- `D:\panda-stage\.worktrees\day25\src\domain\actions\createPresetEvents.ts`（纯函数事件工厂）
- `D:\panda-stage\.worktrees\day25\src\domain\actions\applyPresetEvents.ts`（追加事件返回新 Project）
- `D:\panda-stage\.worktrees\day25\src\domain\validators\timelineEventValidator.ts`（越界/失效显式拒绝）
- `D:\panda-stage\.worktrees\day25\src\renderer\features\actions\actionPresetStore.ts`（桥接 store → History）
- `D:\panda-stage\.worktrees\day25\src\renderer\features\actions\ActionPresetPanel.tsx`（UI 面板）
- `D:\panda-stage\.worktrees\day25\src\renderer\features\actions\PresetParameterForm.tsx`（参数表单）

**修改源文件**
- `src/domain/index.ts`（导出 evaluator）、`src/domain/models/project.ts`（迁移回填）、`src/domain/models/shot.ts`
- `src/shared/domain/evaluate-shot-at-time.ts`（加 `@deprecated`）、`src/shared/probe/probe-project.ts`（事件改 `startMs/endMs`）
- `src/renderer/App.tsx`（**挂载编辑外壳**，修复 R1）、`src/renderer/stage/{CanvasStage,StagePreview,StageRenderer}.tsx`、`src/shared/stage/render-model.ts`、`src/export-renderer/ExportRendererApp.tsx`

**测试文件**
- `tests/unit/domain/evaluate-shot-at-time.test.ts`、`tests/unit/domain/actions/createPresetEvents.test.ts`、`tests/unit/domain/validators/timelineEventValidator.test.ts`
- `tests/unit/migrations/project-migration.test.ts`（**当前 9 失败在这**）
- `tests/unit/features/actions/actionPresetStore.test.ts`、`tests/unit/stage-render-model.test.ts`
- `tests/integration/action-preset-history.test.ts`

**文档**
- `docs/system_design.md`、`docs/class-diagram.mermaid`、`docs/sequence-diagram.mermaid`
- `docs/test-receipts/M3.md`（骨架，结论占位，待 QA 定稿）

---

## 7. Day 25 合同铁律（实现/验收不可违反）

1. 预设只生成 `TimelineEvent`，**绝不直接操作 DOM/Konva 制造动画**；
2. 所有时间整数 ms；事件不得越界无提示（越界 = 拒绝 + 中文原因，禁止静默 clamp）；
3. 所有操作走 History（`ProjectCommand`），可撤销重做；
4. 未选 / locked / 失效引用必须禁用或拒绝，且不产生 revision/history；
5. M3 结论只能 PASS/FAIL，未验证项按 FAIL；FAIL 冻结 Day 26–45；
6. 不升 schema 版本（除非发现确有必要，走完整迁移链）；
7. 同 layer/同属性重叠事件本日仅**检测+拒绝**，登记 `DEBT-CONFLICT-B25-001`，叠加语义留 Day27。

---

## 8. 新窗口「继续」prompt 草稿（可直接发给工程师 Agent）

> 你是 Panda Stage 工程师，在 `D:\panda-stage\.worktrees\day25`（分支 `feat/day-25-action-presets`，已存在，勿重建）收尾 Day 25。代码已实现，typecheck=0/lint=0 已通过，但 `test:unit` 有 9 个失败、`build` 崩溃，均未提交。
> 工具链：`C:\Users\admin\.workbuddy\binaries\node\versions\22.22.2\node.exe C:/Users/admin/.workbuddy/binaries/node/workspace/node_modules/pnpm/bin/pnpm.cjs <args>`。
> 任务（只修门禁，不重写逻辑）：
> 1) 修 `tests/unit/domain/migrations/project-migration.test.ts:194` 的 `flipX` 报错——在 `src/domain/models/project.ts` 迁移分支补 v5 必需字段（先对照 `ProjectSchema`/`LayerSchema` 确认缺哪些，尤其 `flipX`）；
> 2) 单独跑 `pnpm build:renderer` 拿 vite 真实报错并修复 build 崩溃（exit 3221225794）；
> 3) 跑 `pnpm test:unit` + `pnpm test:integration` 全绿；
> 4) `git add -A && git commit`（勿 push）。
> 报告：commit SHA、test 结果、build 结果、任何遗留债务。保持 prompt 精简，勿贴大段文档。

---

*本文件与 worktree 内代码、设计文档、测试共同构成 Day 25 续做所需的全部上下文。新窗口读完即可接手，无需翻历史对话。*
