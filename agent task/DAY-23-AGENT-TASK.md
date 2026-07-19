# Panda Stage Agent Task — Day 23

> **工单编号**：B-23/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 23  
> **分支建议**：`feat/day-23-layer-transform`  
> **任务类型**：功能开发 + 几何变换 + 状态一致性  
> **唯一目标**：完成图层缩放、旋转、水平翻转、层级调整、锁定和删除，并保证变换结果保存重开不丢、翻转不导致角色瞬移。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Layer Transform + Z-Order + Locking + Deletion
- **轰炸目标**：实现 Transformer、等比缩放、旋转、水平翻转、层级操作、锁定/解锁和删除，并保持中心锚点、zIndex 与选择状态一致。
- **任务性质**：功能开发 + 几何约束 + 交互安全
- **输入基线**：Day 22 已完成 Layer 创建、选中、移动、属性面板与锁定基础；M2 Gate PASS。
- **输出要求**：所有静态变换可用、可持久化、可回归；自动化闸门、16 项刀刃表、P4 自测、熔断与收卷齐全。
- **通用铁律**：
  1. 图层中心锚点语义不得因翻转或表情切换改变。
  2. 锁定图层不得操作 Transformer、拖动、层级或删除，除非用户明确解锁。
  3. 所有数值必须有限，禁止 NaN/Infinity 进入项目模型。
  4. zIndex 与项目中的图层顺序必须一致，不能只改视觉层。
  5. 选择状态与 Transformer 状态不得写入 `project.json`。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录分支与 HEAD | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| 前置能力 | Day 22 的 LayerService、selectionStore、CanvasStage 与保存重开通过 | Day 22 回执 + 测试结果 | 必须 |
| 当前模型 | Layer 具备 x/y、scale、rotation、flip、zIndex、locked 或等价字段 | `git grep -n "scale\|rotation\|flip\|zIndex\|locked" -- src shared tests` | 必须 |
| 目标范围 | Transformer、LayerService 变换、层级操作、删除、属性面板、测试与回执 | `git diff --name-only` | 必须 |
| 目标结果 | 缩放/旋转/翻转/层级/锁定/删除可用；保存重开一致；表情切换保持中心；删除后选择清理 | unit/component/integration/manual evidence | 必须 |
| 技术约束 | 等比缩放；中心锚点；rotation 规范化；scale 边界；zIndex 连续或明确排序规则；删除进入 dirty | 代码与测试 | 必须 |
| 风险边界 | 不做历史；不做时间轴变换事件；不做多选；不做复杂对齐工具 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + Day 22 回归 | 命令输出 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-23.md`，同步 transform 与层级规则 | 文档 diff | 必须 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | Layer 中心坐标已稳定；Day 19 表情切换也要求中心锚点稳定。 |
| 待确认问题 | Konva Transformer 当前封装；scale/rotation 字段命名；zIndex 是数字还是数组顺序；翻转采用负 scale 还是显式 flipX。 |
| 预期输出 | 一个数值安全、中心稳定、可持久化的静态变换系统。 |
| 停止条件 | 全部变换、锁定、层级、删除与保存重开有证据。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-23/45
- **角色**：Engineer
- **依赖关系**：依赖 Day 22 Layer 放置与 Day 19 角色表情。

### 输出交付物

- **预计变更文件**：
  - `src/domain/services/LayerService.ts`
  - `src/features/canvas/LayerTransformer.tsx`
  - `src/features/canvas/SelectableLayer.tsx`
  - `src/features/properties/LayerTransformPanel.tsx`
  - `src/features/properties/LayerOrderControls.tsx`
  - `src/stores/selectionStore.ts`
  - 对应 unit/component/integration tests
  - `docs/test-receipts/DAY-23.md`
- **核心修改点**：
  - 选中图层显示 Transformer；
  - 等比缩放并限制最小/最大 scale；
  - 旋转并规范化角度；
  - 水平翻转但保持中心位置；
  - 上移/下移/置顶/置底；
  - 锁定/解锁；
  - Delete 键与按钮删除；
  - 删除后清理 selectedLayerId；
  - 表情切换后继续复用同一中心点；
  - NaN、Infinity、0/负 scale 边界处理。
- **必须包含**：
  - 变换结果保存重开一致；
  - flip 不改变 x/y；
  - 层级操作后顺序与视觉一致；
  - locked 时 Transformer 不可操作；
  - 删除后选择状态为空；
  - scale、rotation 非法值被拒绝；
  - 表情切换前后中心坐标一致；
  - 空选择时快捷键不误删背景或其他对象。
- **禁止包含**：
  - 通过改 x/y 补偿翻转；
  - 用负 scale 导致序列化语义混乱而无测试；
  - 仅改变 Konva 节点不写项目模型；
  - locked 只是视觉标记；
  - 提前实现 undo/redo、动画关键帧、多选或对齐分布。
- **交付证明**：LayerService 单测、Transformer 组件测试、flip 中心对比、层级前后 JSON、锁定与删除负面路径、保存重开 integration。

### 规模与复杂度观察

- 变换归一化和边界校验集中在纯函数或 LayerService，不散落在 UI 事件中。
- zIndex 若以数组顺序表达，应提供显式 reorder 函数，避免数字漂移。
- 若 Konva 内部 scale 与模型字段映射复杂，必须记录 `DECISION`，不得靠临时补偿常量。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型通过 | `pnpm typecheck` | 返工 |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | transform、order、lock、delete、persist 测试通过 | unit/component/integration tests | 返工 |
| ARCH | 所有持久变换走 LayerService；UI 状态不进项目 | 静态搜索 + JSON 断言 | 返工 |
| REAL | 实际 Transformer 与快捷键行为正确 | `pnpm dev` 手动证据 | 返工 |
| DOC | transform 契约与回执同步 | 文档 diff | 返工或债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 等比缩放与旋转可用 | component/unit | [ ] |
| FUNC | FUNC-002 | 水平翻转保持中心 | geometry test | [ ] |
| FUNC | FUNC-003 | 上移/下移/置顶/置底正确 | order tests | [ ] |
| FUNC | FUNC-004 | 删除与选择清理正确 | component/store test | [ ] |
| CONST | CONST-001 | scale/rotation 为有限值 | validator tests | [ ] |
| CONST | CONST-002 | zIndex 与视觉顺序一致 | integration evidence | [ ] |
| CONST | CONST-003 | locked 禁止全部变换 | interaction tests | [ ] |
| CONST | CONST-004 | UI 状态不写 project.json | JSON 断言 | [ ] |
| NEG | NEG-001 | NaN/Infinity 被拒绝 | boundary tests | [ ] |
| NEG | NEG-002 | scale 过小/过大被限制或提示 | boundary tests | [ ] |
| NEG | NEG-003 | 空选择 Delete 不误删 | keyboard test | [ ] |
| NEG | NEG-004 | 背景不可被删除或变换 | interaction test | [ ] |
| UX | UX-001 | Transformer 和锁定状态清楚 | UI 证据 | [ ] |
| UX | UX-002 | 层级和删除反馈明确 | UI 证据 | [ ] |
| E2E | E2E-001 | 变换→排序→保存→重开 | 完整流程 | [ ] |
| High | HIGH-001 | 表情切换与翻转均不导致瞬移 | 中心点对比 | [ ] |

---

## 【模块3-B】地狱红线

1. 翻转导致角色中心瞬移 → 返工。
2. 变换只改画面不写项目模型 → 返工。
3. locked 图层仍可操作 → 返工。
4. NaN/Infinity 进入项目 → 返工。
5. zIndex 与视觉顺序不一致 → 返工。
6. 删除后选择状态悬空 → 返工。
7. 背景被普通变换或删除 → 返工。
8. 提前实现历史、时间轴或多选 → 范围失控。
9. 未保存重开验证却声称持久化完成 → 未验证。
10. 质量门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 缩放、旋转、翻转、层级、删除是否可用？ | [ ] | CF-B23-001 |
| RG | Day 22 移动与 Day 19 表情是否保持？ | [ ] | RG-B23-001 |
| NG | 非法数值、空选择、锁定、背景是否覆盖？ | [ ] | NG-B23-001 |
| UX | Transformer、层级和锁定反馈是否清楚？ | [ ] | UX-B23-001 |
| E2E | 变换后保存重开是否完整？ | [ ] | E2E-B23-001 |
| High | 翻转/表情切换是否保持中心？ | [ ] | HIGH-B23-001 |
| 字段完整性 | 回执是否记录变换值、顺序和截图？ | [ ] | DAY-23.md |
| 需求映射 | 是否覆盖 Day 23 全项？ | [ ] | 刀刃表 |
| 自测执行 | 是否真实使用 Transformer 和快捷键？ | [ ] | 操作证据 |
| 范围边界与债务 | Konva 映射限制是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-23/45 完成并提交
- Commit: `feat(canvas): add safe layer transforms ordering and locking`
- 分支: `feat/day-23-layer-transform`
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- 缩放:
- 旋转:
- 翻转:
- 层级:
- 锁定:
- 删除:
- 表情切换中心:
- 保存重开:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- component/integration tests:
- `pnpm build`:
- `pnpm dev`:

### 决策与债务
- DECISION-001: [flip 模型]
- DECISION-002: [zIndex 表达]
- DEBT-GEOMETRY-B23-001:
- DEBT-TEST-B23-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| GEOM-B23-001 | flip/rotation 破坏中心锚点 | 停止扩展并修模型映射 | 阻塞 |
| DATA-B23-001 | 非有限值进入项目 | 收紧 validator | 阻塞 |
| STATE-B23-001 | locked 或选择状态不可靠 | 修交互状态机 | 返工 |
| ORDER-B23-001 | 层级顺序无法稳定持久化 | 统一排序模型 | 返工 |
| TEST-B23-001 | 无法验证 Transformer 真实行为 | 补可复现实测，不得判完全通过 | 有条件交付 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 23：Layer Transform + Z-Order + Locking + Deletion**！

验收铁律：变换可持久化；翻转不瞬移；层级与视觉一致；锁定不可操作；删除后选择清理；非法数值不得入库。

Ouroboros 闭环启动，**B-23/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "LayerTransformer\|flip\|rotation\|zIndex\|locked" -- src tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm dev
git diff --stat
```
