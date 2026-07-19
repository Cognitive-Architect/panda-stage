# Panda Stage Agent Task — Day 21

> **工单编号**：B-21/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 21  
> **分支建议**：`feat/day-21-canvas-stage`  
> **任务类型**：功能开发 + 坐标系统 + 视图适配  
> **唯一目标**：建立固定 1920×1080 逻辑画布与响应式视口，使窗口缩放只影响显示比例，不改变任何项目坐标。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Fixed Logical Canvas + Responsive Viewport
- **轰炸目标**：实现固定逻辑尺寸、适应窗口、实际大小、背景铺满、背景不可误选、中心参考线与画布外区域样式。
- **任务性质**：功能开发 + 坐标契约 + UI 基础设施
- **输入基线**：M2 Gate 必须 PASS；镜头、素材、角色数据可持久化；Day 4 的共享 `StageRenderer` 可作为渲染基础。
- **输出要求**：1920×1080 逻辑坐标稳定 + 视口缩放正确 + 点击映射正确 + 自动化闸门 + 16 项刀刃表 + 结构化收卷。
- **通用铁律**：
  1. M2 Gate 非 PASS 时停止，不得继续堆画布 UI。
  2. 画布逻辑尺寸永远为 1920×1080，窗口大小不能改项目数据。
  3. 视口缩放只属于 UI 状态，不得写入 `project.json`。
  4. 背景属于镜头背景，不得被普通点击误选。
  5. 坐标换算必须集中到纯函数，禁止组件内到处手算。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| Gate 前置 | `docs/test-receipts/M2.md` 结论为 PASS | 读取 Gate 文档 | 必须 |
| 当前能力 | StageRenderer、Shot、背景素材、Layer schema 已存在 | `git grep -n "StageRenderer\|ShotSchema\|LayerSchema\|background" -- src shared tests` | 必须 |
| 目标范围 | CanvasStage、viewport store、坐标换算、背景层、中心线、组件测试与回执 | `git diff --name-only` | 必须 |
| 目标结果 | 960,540 始终是中心；窗口变化不改 layer 数据；背景无拉伸；空镜头有引导；fit 模式点击映射正确 | unit/component/manual evidence | 必须 |
| 技术约束 | 逻辑尺寸固定；等比缩放；letterbox 居中；视图矩阵和逆矩阵可测试；StageRenderer 不写项目状态 | 代码与测试 | 必须 |
| 风险边界 | 不做图层拖入；不做 Transformer；不做撤销；不做时间轴 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + M2 回归 | 实际命令输出 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-21.md`，同步坐标与 viewport 契约 | 文档 diff | 必须 |
| 历史债务 | 若 Day 4 的 StageRenderer 含重复缩放逻辑，必须收敛为单一坐标模块 | diff 与决策记录 | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 逻辑画布固定 1920×1080，主窗口需要等比缩放显示。 |
| 待确认问题 | 当前 Konva Stage 封装；容器测量方式；设备像素比处理；实际大小模式的滚动策略。 |
| 预期输出 | 一套可复用的 viewport transform 与 CanvasStage 外壳。 |
| 停止条件 | fit、actual size、窗口变化、背景与点击映射全部验证。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-21/45
- **角色**：Engineer
- **依赖关系**：依赖 M2 PASS 与共享 StageRenderer。

### 输出交付物

- **预计变更文件**：
  - `src/features/canvas/CanvasStage.tsx`
  - `src/features/canvas/CanvasViewport.tsx`
  - `src/features/canvas/CanvasToolbar.tsx`
  - `src/domain/geometry/viewportTransform.ts`
  - `src/stores/canvasViewportStore.ts`
  - `src/domain/renderers/StageRenderer.tsx`
  - 对应 unit/component tests
  - `docs/test-receipts/DAY-21.md`
- **核心修改点**：
  - 固定逻辑宽高常量；
  - 根据容器宽高计算 `scale = min(containerW/1920, containerH/1080)`；
  - 计算居中 offset；
  - `screenToStage()` 与 `stageToScreen()` 纯函数；
  - fit / actual size 两种视图模式；
  - 背景按 cover 或明确规则铺满；
  - 背景 `listening=false` 或等价不可选策略；
  - 中心参考线；
  - 画布外区域与空镜头引导；
  - 视口状态不进入项目序列化。
- **必须包含**：
  - 960,540 始终映射画布中心；
  - 800×600、1280×720、1920×1080 等容器测试；
  - fit 模式点击位置逆变换正确；
  - actual size 下 1:1 显示；
  - resize 前后 Layer JSON 完全不变；
  - 背景不可选；
  - 空镜头有明确引导；
  - 高 DPI 下不改变逻辑坐标。
- **禁止包含**：
  - 把 viewport scale 写进 Layer；
  - 根据窗口大小改 1920×1080 常量；
  - 组件内复制多份坐标公式；
  - 背景进入普通选中逻辑；
  - 提前实现拖动、缩放、历史或动作预设。
- **交付证明**：
  - viewportTransform 单测；
  - 多容器尺寸组件证据；
  - resize 前后 project diff；
  - fit/actual size 截图；
  - 背景点击不改变选中状态。

### 规模与复杂度观察

- 几何换算必须是无 React/Konva 依赖的纯函数。
- CanvasStage 负责组合视图，不承担项目数据修改。
- 设备像素比与 CSS 尺寸不得混用；若平台差异存在，声明 `DEBT-PLATFORM-B21-001`。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型通过 | `pnpm typecheck` | 返工 |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | 几何、视图模式、resize、背景交互测试通过 | unit/component tests | 返工 |
| ARCH | viewport 状态不进入 project；几何为纯函数 | 静态搜索 + JSON 断言 | 返工 |
| REAL | 实际窗口缩放与点击映射正确 | `pnpm dev` 手动证据 | 返工 |
| DOC | 坐标契约与回执同步 | 文档 diff | 返工或债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 固定 1920×1080 Stage | 组件/常量测试 | [ ] |
| FUNC | FUNC-002 | fit 模式等比居中 | 多尺寸测试 | [ ] |
| FUNC | FUNC-003 | actual size 为 1:1 | component/manual | [ ] |
| FUNC | FUNC-004 | 背景与中心参考线正确 | UI 证据 | [ ] |
| CONST | CONST-001 | 960,540 永远为中心 | geometry tests | [ ] |
| CONST | CONST-002 | viewport scale 不写项目 | JSON diff | [ ] |
| CONST | CONST-003 | 坐标换算集中纯函数 | 依赖审查 | [ ] |
| CONST | CONST-004 | 背景不可选 | event test | [ ] |
| NEG | NEG-001 | 容器宽或高很小时不产生 NaN | boundary test | [ ] |
| NEG | NEG-002 | 0 尺寸容器安全降级 | unit/component test | [ ] |
| NEG | NEG-003 | 缺背景素材有可读错误 | component test | [ ] |
| NEG | NEG-004 | resize 不修改 Layer 数据 | project snapshot diff | [ ] |
| UX | UX-001 | 空镜头引导清楚 | UI 证据 | [ ] |
| UX | UX-002 | fit/actual size 切换反馈明确 | UI 证据 | [ ] |
| E2E | E2E-001 | 打开镜头→切换模式→resize→保存重开 | 完整流程 | [ ] |
| High | HIGH-001 | 缩放视图下点击逻辑坐标准确 | 点击点对照测试 | [ ] |

---

## 【模块3-B】地狱红线

1. M2 Gate 非 PASS 仍开工 → 停止。
2. 窗口缩放修改项目坐标 → 返工。
3. 视口 scale 写入 project.json → 返工。
4. 坐标公式散落多个组件 → 返工。
5. 背景可被普通点击误选 → 返工。
6. fit 模式点击位置偏移却声称完成 → 返工。
7. 0 尺寸容器出现 NaN/Infinity → 返工。
8. 提前实现图层编辑、历史或时间轴 → 范围失控。
9. 仅看截图不验证逆变换 → 未验证。
10. 质量门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 固定画布、fit、actual size 是否可用？ | [ ] | CF-B21-001 |
| RG | M2 项目数据是否保持不变？ | [ ] | RG-B21-001 |
| NG | 小容器、0 尺寸、缺背景是否覆盖？ | [ ] | NG-B21-001 |
| UX | 空镜头和模式切换是否清楚？ | [ ] | UX-B21-001 |
| E2E | resize 与保存重开是否走通？ | [ ] | E2E-B21-001 |
| High | 逆变换点击是否准确？ | [ ] | HIGH-B21-001 |
| 字段完整性 | 回执是否记录尺寸、截图和 project diff？ | [ ] | DAY-21.md |
| 需求映射 | 是否覆盖 Day 21 全任务？ | [ ] | 刀刃表 |
| 自测执行 | 是否真实调整桌面窗口？ | [ ] | 操作证据 |
| 范围边界与债务 | DPI/平台限制是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-21/45 完成并提交
- Commit: `feat(canvas): add fixed logical stage with responsive viewport`
- 分支: `feat/day-21-canvas-stage`
- M2 Gate: PASS（证据路径）
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- 固定逻辑画布:
- fit 模式:
- actual size:
- 背景与参考线:
- 坐标换算:
- resize 数据不变:
- 空镜头:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- component tests:
- `pnpm build`:
- `pnpm dev` 手动结果:

### 决策与债务
- DECISION-001: [viewport transform]
- DECISION-002: [背景铺满规则]
- DEBT-PLATFORM-B21-001:
- DEBT-TEST-B21-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| GATE-B21-001 | M2 非 PASS | 停止 Day 21 | 阻塞 |
| COORD-B21-001 | resize 改变项目坐标 | 重构视图/数据边界 | 阻塞 |
| ARCH-B21-001 | 几何逻辑必须依赖组件状态 | 抽出纯函数 | 返工 |
| DPI-B21-001 | 高 DPI 导致点击偏移 | 统一 CSS 与逻辑坐标 | 返工 |
| TEST-B21-001 | 无法验证实际窗口 resize | 声明债务，不得判 E2E 完全通过 | 有条件交付 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 21：Fixed Logical Canvas + Responsive Viewport**！

验收铁律：1920×1080 固定；960,540 永远是中心；窗口变化不改项目；背景不可选；fit 模式点击准确；actual size 为 1:1。

Ouroboros 闭环启动，**B-21/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "CanvasStage\|viewportTransform\|screenToStage\|stageToScreen" -- src tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
git diff --stat
```
