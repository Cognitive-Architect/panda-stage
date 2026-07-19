# Panda Stage Agent Task — Day 22

> **工单编号**：B-22/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 22  
> **分支建议**：`feat/day-22-layer-placement`  
> **任务类型**：功能开发 + 坐标映射 + 状态持久化  
> **唯一目标**：让用户从素材库把素材拖进画布、创建 Layer、选中与移动，并确保缩放视图下的落点和保存重开后的坐标都准确。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Asset-to-Canvas Placement + Selection + Move
- **轰炸目标**：打通素材库拖放、视图坐标转逻辑坐标、Layer 创建、选中/取消选中、拖动移动、属性面板 x/y 与锁定保护。
- **任务性质**：功能开发 + 坐标一致性 + 交互状态
- **输入基线**：M2 Gate PASS；Day 21 已有固定逻辑画布和 `screenToStage()` / `stageToScreen()`；Day 18 已有受控 asset ID 拖放载荷。
- **输出要求**：拖入落点准确、选择稳定、移动持久化、锁定保护、拖动只在结束时提交一次持久状态。
- **通用铁律**：
  1. 拖放只使用 asset ID 等受控数据，不得传绝对路径或完整文件内容。
  2. 视图坐标必须先经过统一逆变换再写入 Layer。
  3. 拖动过程可本地预览，但持久状态只在 drag end 提交一次。
  4. 锁定图层不可被拖动或属性修改。
  5. 选择状态属于编辑器 UI，不得混入项目模型。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录分支与 HEAD | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| 前置能力 | M2 PASS，Day 21 viewport transform 与 Day 18 drag payload 可用 | 回执 + 代码搜索 | 必须 |
| 当前模型 | Layer schema 包含 asset/character 引用、x/y、lock、zIndex 等基础字段 | `git grep -n "LayerSchema\|screenToStage\|AssetDropPayload\|locked" -- src shared tests` | 必须 |
| 目标范围 | drop adapter、LayerService、selection store、Canvas interaction、属性面板、测试与回执 | `git diff --name-only` | 必须 |
| 目标结果 | 拖入位置与鼠标一致；保存重开位置一致；锁定不可移动；空白取消选中；缩放视图下仍准确 | unit/component/integration/manual evidence | 必须 |
| 技术约束 | x/y 为图层中心；创建坐标 clamp 到画布或按明确策略提示；拖动结束才提交；所有坐标为有限数值 | 代码与测试 | 必须 |
| 风险边界 | 不做旋转、缩放、翻转、层级按钮；不做历史；不做时间轴事件 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + Day 21 回归 | 命令输出 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-22.md`，同步拖放与坐标提交规则 | 文档 diff | 必须 |
| 历史债务 | 若素材卡片与画布使用不同拖放协议，必须统一，禁止双协议长期共存 | diff 与决策记录 | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | Canvas 使用固定逻辑坐标；素材库拖放载荷包含 asset ID。 |
| 待确认问题 | 当前拖放库；角色素材和背景素材是否都能创建普通 Layer；Layer 初始尺寸/缩放策略；画布外落点策略。 |
| 预期输出 | 一个坐标准确、状态稳定、可保存的最小图层放置流程。 |
| 停止条件 | 100%、50%、fit 等视图比例下拖入与移动均准确，保存重开通过。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-22/45
- **角色**：Engineer
- **依赖关系**：依赖 Day 18 拖放载荷、Day 21 viewport transform 与 M2 数据模型。

### 输出交付物

- **预计变更文件**：
  - `src/domain/services/LayerService.ts`
  - `src/features/canvas/useCanvasDrop.ts`
  - `src/features/canvas/SelectableLayer.tsx`
  - `src/features/canvas/CanvasStage.tsx`
  - `src/features/properties/LayerPositionPanel.tsx`
  - `src/stores/selectionStore.ts`
  - `src/stores/projectStore.ts` 或对应 actions
  - 对应 unit/component/integration tests
  - `docs/test-receipts/DAY-22.md`
- **核心修改点**：
  - 解析受控拖放载荷；
  - 使用 `screenToStage()` 计算 Layer 中心坐标；
  - 创建唯一 Layer ID；
  - 点击图层选中，点击空白清空；
  - 拖动时仅更新临时视觉位置；
  - drag end 提交一次 x/y；
  - 属性面板显示并允许合法 x/y 输入；
  - locked 图层禁止拖动和位置编辑；
  - 项目 dirty 状态正确更新；
  - 保存重开位置一致。
- **必须包含**：
  - 视图比例 1.0、0.5、fit 三组落点测试；
  - asset ID 不存在时拒绝创建；
  - 图层中心坐标语义；
  - 空白点击取消选择；
  - locked 图层不可拖动；
  - 非有限 x/y、空值、NaN 被拒绝；
  - drag move 不产生大量项目提交；
  - drag end 只提交一次；
  - 保存重开后坐标一致。
- **禁止包含**：
  - 用屏幕坐标直接写 Layer；
  - 传递绝对文件路径；
  - 每个 pointermove 都写项目和 autosave；
  - locked 仅显示图标但仍可移动；
  - 把 selectedLayerId 写进 project.json；
  - 提前实现 Transformer、历史或动作预设。
- **交付证明**：坐标纯函数测试、drop 组件测试、提交次数 spy、锁定负面测试、保存重开 integration、不同 zoom 下截图/记录。

### 规模与复杂度观察

- LayerService 负责纯数据创建/更新，组件负责事件翻译。
- 临时拖动位置与项目持久状态要分开，避免历史和 autosave 污染。
- 如 Konva 事件坐标与 CSS 坐标存在偏差，必须写转换测试，不得靠“减几个像素”硬补。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型通过 | `pnpm typecheck` | 返工 |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | drop、selection、lock、坐标与保存测试通过 | unit/component/integration tests | 返工 |
| ARCH | 受控 payload；选择状态不持久化；drag end 单次提交 | 静态搜索 + spy | 返工 |
| REAL | 不同 zoom 下真实拖入和移动正确 | `pnpm dev` 手动证据 | 返工 |
| DOC | 坐标/提交协议与回执同步 | 文档 diff | 返工或债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 素材拖入创建 Layer | component/integration | [ ] |
| FUNC | FUNC-002 | 点击选中与空白取消 | component test | [ ] |
| FUNC | FUNC-003 | 拖动更新逻辑坐标 | geometry + interaction test | [ ] |
| FUNC | FUNC-004 | 属性面板显示/提交 x/y | component test | [ ] |
| CONST | CONST-001 | x/y 语义为中心点 | model/renderer test | [ ] |
| CONST | CONST-002 | selectedLayerId 不写项目 | JSON 断言 | [ ] |
| CONST | CONST-003 | drag end 单次提交 | action spy | [ ] |
| CONST | CONST-004 | payload 不含绝对路径 | 类型/事件断言 | [ ] |
| NEG | NEG-001 | 无效 asset ID 不创建 Layer | negative test | [ ] |
| NEG | NEG-002 | locked 图层不可移动 | interaction test | [ ] |
| NEG | NEG-003 | NaN/Infinity/空值被拒绝 | boundary tests | [ ] |
| NEG | NEG-004 | 画布外落点按规则处理 | boundary test | [ ] |
| UX | UX-001 | 拖放高亮和落点反馈清楚 | UI 证据 | [ ] |
| UX | UX-002 | locked 状态和错误提示可理解 | UI 证据 | [ ] |
| E2E | E2E-001 | 拖入→移动→保存→重开 | 完整流程 | [ ] |
| High | HIGH-001 | 50%/fit 缩放下落点与鼠标一致 | 坐标对照 | [ ] |

---

## 【模块3-B】地狱红线

1. 屏幕坐标直接写项目 → 返工。
2. 拖放载荷包含绝对路径 → 返工。
3. pointermove 每帧写项目状态 → 返工。
4. locked 图层仍可移动 → 返工。
5. 选择状态写入 project.json → 返工。
6. 缩放视图下落点偏移却不验证 → 返工。
7. NaN/Infinity 进入 Layer → 返工。
8. 提前实现 Transformer、历史或时间轴 → 范围失控。
9. 未保存重开验证就声称持久化完成 → 未验证。
10. 质量门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 拖入、选择、移动、属性编辑是否可用？ | [ ] | CF-B22-001 |
| RG | Day 21 坐标与 M2 保存是否保持？ | [ ] | RG-B22-001 |
| NG | 无效素材、锁定、非法坐标是否覆盖？ | [ ] | NG-B22-001 |
| UX | 拖放和锁定反馈是否清楚？ | [ ] | UX-B22-001 |
| E2E | 拖入到重开是否完整？ | [ ] | E2E-B22-001 |
| High | 缩放视图坐标是否准确？ | [ ] | HIGH-B22-001 |
| 字段完整性 | 回执是否记录比例、落点和提交次数？ | [ ] | DAY-22.md |
| 需求映射 | 是否覆盖 Day 22 全项？ | [ ] | 刀刃表 |
| 自测执行 | 是否真实拖动并重开项目？ | [ ] | 操作证据 |
| 范围边界与债务 | 拖放库/坐标限制是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-22/45 完成并提交
- Commit: `feat(canvas): place select and move persistent layers`
- 分支: `feat/day-22-layer-placement`
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- 拖入创建:
- 1.0 / 0.5 / fit 落点:
- 选中与取消:
- 拖动与单次提交:
- 属性面板:
- 锁定保护:
- 保存重开:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- component/integration tests:
- `pnpm build`:
- `pnpm dev`:

### 决策与债务
- DECISION-001: [拖动临时状态]
- DECISION-002: [画布外落点策略]
- DEBT-COORD-B22-001:
- DEBT-TEST-B22-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| COORD-B22-001 | 缩放下坐标无法稳定映射 | 停止交互扩展，修 transform | 阻塞 |
| STATE-B22-001 | 拖动产生大量持久提交 | 分离临时与持久状态 | 返工 |
| DATA-B22-001 | 非有限坐标进入项目 | 加强 validator | 阻塞 |
| ARCH-B22-001 | UI 需要绝对路径才能创建图层 | 修拖放协议 | 返工 |
| TEST-B22-001 | 无法验证真实 drag/drop | 补可复现实测与债务，不得判完全通过 | 有条件交付 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 22：Asset-to-Canvas Placement + Selection + Move**！

验收铁律：拖入落点准确；缩放下坐标正确；选择状态不持久化；锁定不可移动；drag end 只提交一次；保存重开坐标一致。

Ouroboros 闭环启动，**B-22/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "LayerService\|useCanvasDrop\|selectionStore\|screenToStage" -- src tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm dev
git diff --stat
```
