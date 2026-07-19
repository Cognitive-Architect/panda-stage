# Panda Stage Agent Task — Day 26

> **工单编号**：B-26/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 26  
> **分支建议**：`feat/day-26-timeline-shell`  
> **任务类型**：功能开发 + 时间坐标 + 播放头交互  
> **唯一目标**：建立镜头内轻量时间轴、时间刻度、播放头、点击/拖动跳转、吸附与横向缩放，并保证这些交互只改变预览时间，不修改项目数据。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Timeline Ruler + Playhead + Seeking + Snapping
- **轰炸目标**：实现镜头内时间轴外壳、`mm:ss.mmm` 时间格式、播放头、点击/拖动跳转、100 ms 或帧边界吸附、最小横向滚动与缩放。
- **任务性质**：功能开发 + 几何映射 + UI 状态管理
- **输入基线**：M3 Gate 必须 PASS；Shot 具有整数 `durationMs`；PreviewStore 可接受当前镜头内时间；History 与项目数据边界已明确。
- **输出要求**：播放头 0～duration 范围稳定 + 时间像素双向映射 + 吸附可验证 + 切镜头规则明确 + 16 项刀刃表 + 结构化收卷。
- **通用铁律**：
  1. M3 Gate 非 PASS 时停止，不得继续堆时间轴。
  2. 播放头属于预览 UI 状态，禁止写入 `project.json` 或 History。
  3. 所有时间使用整数毫秒，任何拖动结果必须 clamp 到 `[0, durationMs]`。
  4. 时间轴宽度与缩放只影响显示，不改变事件时间。
  5. 时间与像素换算必须集中为纯函数，禁止组件内散落公式。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD SHA | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| Gate 前置 | `docs/test-receipts/M3.md` 结论为 PASS | 读取 Gate 文档 | 必须 |
| 当前能力 | Shot duration、PreviewStore、FPS 常量、当前镜头选择可用 | `git grep -n "durationMs\|PreviewStore\|FPS\|currentShot" -- src shared tests` | 必须 |
| 目标范围 | TimelineShell、ruler、playhead、time geometry、snap、viewport state、测试与回执 | `git diff --name-only` | 必须 |
| 目标结果 | 播放头范围正确；末尾不越界；24 FPS 帧边界稳定；时间轴宽度变化不改时间；切镜头规则明确 | unit/component/manual evidence | 必须 |
| 技术约束 | `timeToPx` / `pxToTime` 纯函数；时间格式稳定；吸附模式明确；缩放最小/最大值受控 | 代码与测试 | 必须 |
| 风险边界 | 不做事件片段编辑；不做多轨；不做对白；不做完整播放引擎；不做关键帧曲线 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + M3 回归 | 命令输出 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-26.md`，同步时间轴坐标与吸附规则 | 文档 diff | 必须 |
| 历史债务 | 若 PreviewStore 当前使用秒或浮点时间，必须收敛为整数毫秒 | diff + 单元测试 | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 项目固定 24 FPS，镜头时长为整数毫秒，播放头不属于项目内容。 |
| 待确认问题 | 当前 PreviewStore API；时间轴容器测量方式；默认吸附选择 100 ms 还是帧边界；切镜头时重置规则。 |
| 预期输出 | 一套可复用、可测试的时间/像素映射与播放头交互。 |
| 停止条件 | 点击、拖动、吸附、缩放、滚动、切镜头和边界全部验证。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-26/45
- **角色**：Engineer
- **依赖关系**：依赖 M3 PASS、Shot duration 与 PreviewStore。

### 输出交付物

- **预计变更文件**：
  - `src/domain/timeline/timeGeometry.ts`
  - `src/domain/timeline/timeFormat.ts`
  - `src/domain/timeline/snapTime.ts`
  - `src/features/timeline/TimelineShell.tsx`
  - `src/features/timeline/TimelineRuler.tsx`
  - `src/features/timeline/TimelinePlayhead.tsx`
  - `src/features/timeline/TimelineToolbar.tsx`
  - `src/stores/timelineViewportStore.ts`
  - PreviewStore 必要适配文件
  - 对应 unit/component tests
  - `docs/test-receipts/DAY-26.md`
- **核心修改点**：
  - 根据镜头时长与 pixels-per-second 生成刻度；
  - `timeToPx()` / `pxToTime()`；
  - 播放头显示与拖动；
  - 点击 ruler 跳转；
  - `mm:ss.mmm` 格式；
  - 100 ms / 24 FPS 帧边界吸附策略；
  - 横向滚动；
  - 最小缩放控制；
  - 切镜头时按明确规则归零或 clamp；
  - 播放头变化不设置项目 dirty。
- **必须包含**：
  - 0 ms、镜头中点、durationMs 映射测试；
  - 拖到左侧/右侧外部时 clamp；
  - 24 FPS 第 0、1、24、最后帧换算稳定；
  - 格式化 0、1000、61001 ms；
  - 宽度/缩放变化前后 currentTimeMs 不变；
  - 切短镜头时 currentTimeMs 归零或 clamp，规则必须测试；
  - 点击和拖动只更新预览时间；
  - 吸附关闭与开启结果可区分；
  - 0 时长或无镜头状态安全降级。
- **禁止包含**：
  - 播放头写入项目或 History；
  - 使用浮点秒作为项目真相；
  - 改变时间轴宽度时重算并写回事件；
  - 使用 DOM offset 魔法常数补坐标；
  - 提前实现对白片段、事件拖动、完整 evaluator 或多镜头预览。
- **交付证明**：
  - time geometry 单测；
  - snap 与 frame conversion 单测；
  - 组件点击/拖动测试；
  - dirty 状态不变断言；
  - `pnpm dev` 实际拖动与缩放录屏/截图。

### 规模与复杂度观察

- 几何、格式化、吸附三类逻辑分离为纯函数，UI 只组合。
- 刻度生成不得按每毫秒创建节点；根据缩放选择合理主/次刻度。
- 若横向缩放导致大量 DOM 节点，声明 `DEBT-PERF-B26-001` 并限制刻度密度。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型检查通过 | `pnpm typecheck` | 返工 |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | 时间映射、吸附、格式、播放头和切镜头测试通过 | unit/component tests | 返工 |
| ARCH | 播放头不进项目/History；时间逻辑纯函数 | 静态搜索 + dirty 断言 | 返工 |
| REAL | 实际点击、拖动、滚动与缩放正确 | `pnpm dev` 手动证据 | 返工 |
| DOC | 时间轴规则与回执同步 | 文档 diff | 返工或债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | ruler 与刻度正确显示 | component test | [ ] |
| FUNC | FUNC-002 | 点击和拖动更新播放头 | component test | [ ] |
| FUNC | FUNC-003 | `mm:ss.mmm` 格式正确 | unit tests | [ ] |
| FUNC | FUNC-004 | 横向滚动/缩放可用 | component/manual | [ ] |
| CONST | CONST-001 | 播放头范围为 0～duration | boundary tests | [ ] |
| CONST | CONST-002 | 时间/像素双向映射稳定 | property-like tests | [ ] |
| CONST | CONST-003 | 24 FPS 帧换算稳定 | frame tests | [ ] |
| CONST | CONST-004 | 播放头不设置 dirty | store assertion | [ ] |
| NEG | NEG-001 | 左右越界被 clamp | drag boundary test | [ ] |
| NEG | NEG-002 | 0 时长/无镜头安全 | component test | [ ] |
| NEG | NEG-003 | 缩放后事件时间不改变 | project snapshot diff | [ ] |
| NEG | NEG-004 | 切短镜头不保留越界时间 | store test | [ ] |
| UX | UX-001 | 当前时间和总时长可读 | UI 证据 | [ ] |
| UX | UX-002 | 吸附状态与缩放反馈明确 | UI 证据 | [ ] |
| E2E | E2E-001 | 选镜头→点击→拖动→缩放→切镜头 | 完整流程 | [ ] |
| High | HIGH-001 | 末尾帧与 duration 边界不越界 | frame/time 对照 | [ ] |

---

## 【模块3-B】地狱红线

1. M3 Gate 非 PASS 仍开工 → 停止。
2. 播放头写入 project.json → 返工。
3. 播放头操作进入 History → 返工。
4. 时间轴缩放修改事件时间 → 返工。
5. 拖到末尾产生越界时间 → 返工。
6. 使用浮点秒造成累计误差 → 返工。
7. 坐标公式散落多个组件 → 返工。
8. 提前实现事件片段、对白或完整预览 → 范围失控。
9. 未验证 24 FPS 边界却声称稳定 → 未验证。
10. 质量门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | ruler、播放头、跳转、吸附是否可用？ | [ ] | CF-B26-001 |
| RG | M3 项目数据和 History 是否不受影响？ | [ ] | RG-B26-001 |
| NG | 越界、0 时长、切镜头是否覆盖？ | [ ] | NG-B26-001 |
| UX | 时间格式、吸附和缩放反馈是否清楚？ | [ ] | UX-B26-001 |
| E2E | 完整播放头交互是否走通？ | [ ] | E2E-B26-001 |
| High | 24 FPS 末尾边界是否单独验证？ | [ ] | HIGH-B26-001 |
| 字段完整性 | 回执是否记录宽度、缩放、时间与证据？ | [ ] | DAY-26.md |
| 需求映射 | 是否覆盖 Day 26 全任务？ | [ ] | 刀刃表 |
| 自测执行 | 是否真实拖动并切换镜头？ | [ ] | 操作证据 |
| 范围边界与债务 | 性能/吸附限制是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-26/45 完成并提交
- Commit: `feat(timeline): add ruler playhead seeking and snapping`
- 分支: `feat/day-26-timeline-shell`
- M3 Gate: PASS（证据路径）
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- 时间刻度:
- 播放头点击/拖动:
- 时间格式:
- 100 ms / 帧吸附:
- 横向滚动/缩放:
- 切镜头规则:
- dirty/History 隔离:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- component tests:
- `pnpm build`:
- `pnpm dev`:

### 决策与债务
- DECISION-001: [吸附策略]
- DECISION-002: [切镜头播放头规则]
- DEBT-PERF-B26-001:
- DEBT-TEST-B26-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| GATE-B26-001 | M3 非 PASS | 停止 Day 26 | 阻塞 |
| TIME-B26-001 | 时间/像素换算不稳定 | 停止 UI 扩展，修纯函数 | 阻塞 |
| STATE-B26-001 | 播放头污染项目/History | 分离 UI 状态 | 返工 |
| PERF-B26-001 | 刻度节点导致明显卡顿 | 降低刻度密度/虚拟化 | 返工 |
| TEST-B26-001 | 无法验证真实拖动 | 补可复现实测，不得判完全通过 | 有条件交付 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 26：Timeline Ruler + Playhead + Seeking + Snapping**！

验收铁律：播放头不改项目；0～duration 不越界；24 FPS 换算稳定；缩放不改事件；切镜头规则明确；点击和拖动均可复现。

Ouroboros 闭环启动，**B-26/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "TimelineShell\|TimelinePlayhead\|timeToPx\|pxToTime\|snapTime" -- src tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
git diff --stat
```
