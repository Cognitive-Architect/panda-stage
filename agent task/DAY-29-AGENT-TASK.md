# Panda Stage Agent Task — Day 29

> **工单编号**：B-29/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 29  
> **分支建议**：`feat/day-29-project-preview`  
> **任务类型**：功能开发 + 多镜头调度 + 音频时钟  
> **唯一目标**：完成项目级连续预览，让 5 个镜头按照总时间自动切换，并用 AudioContext 作为唯一主时钟，保证暂停、跳转、停止和镜头边界不会产生音频叠播或画面残影。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Multi-Shot Project Preview + Audio Clock + Clean Transitions
- **轰炸目标**：实现项目总时间到镜头映射、当前镜头/全部预览、播放暂停停止、音频重排、镜头切换清理与结束后恢复编辑模式。
- **任务性质**：功能开发 + 时间调度 + 资源生命周期
- **输入基线**：M3 Gate PASS；Day 26 时间轴、Day 27 evaluator、Day 28 对白/字幕/音频/嘴巴链路均已通过。
- **输出要求**：5 镜头连续播放 + 边界无残影 + 暂停/跳转无叠播 + 停止归零 + 30 秒漂移证据 + 结构化收卷。
- **通用铁律**：
  1. AudioContext 是播放中的唯一主时钟，`requestAnimationFrame` 只能读取时间并刷新画面。
  2. 项目总时间映射到镜头必须使用纯函数，边界规则稳定。
  3. 跳转和切镜头时必须停止旧音频并按新位置重新调度。
  4. 镜头切换必须清除上一镜头的图层、字幕、嘴巴和音频状态。
  5. 播放状态、当前时间和当前预览模式不得写入 `project.json`。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD SHA | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| Gate 前置 | M3 Gate PASS，Day 26～28 回执通过 | Gate/回执文件 | 必须 |
| 当前能力 | Shot 顺序/时长、总时长 selector、evaluator、字幕、AudioScheduler、PreviewStore 可用 | `git grep -n "projectDuration\|evaluateShotAtTime\|AudioScheduler\|PreviewStore\|currentShot" -- src tests` | 必须 |
| 目标范围 | project time mapping、PreviewController、AudioClock、镜头切换、播放控制、测试与回执 | `git diff --name-only` | 必须 |
| 目标结果 | 5 镜头连续播放；边界无残影；暂停和跳转不叠播；停止回 0；30 秒预览无明显漂移 | unit/component/integration/manual evidence | 必须 |
| 技术约束 | 总时间/镜头内时间为整数毫秒；AudioContext 单时钟；rAF 不累加时间；seek 重排音频；资源清理幂等 | 代码与测试 | 必须 |
| 风险边界 | 不做导出；不做多音轨混音；不做复杂转场；不做后台播放；不做倍速 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + Day 26～28 回归 | 命令输出 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-29.md`，同步项目预览状态机与时间映射 | 文档 diff | 必须 |
| 历史债务 | 若已有探针 PreviewStore 与新项目预览重复，必须收敛为单一控制器 | diff 与决策记录 | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 项目总时长等于镜头时长之和；单镜头 evaluator 已确定；音频需按 seek 位置重排。 |
| 待确认问题 | AudioContext 生命周期；当前镜头预览的总时间起点；镜头边界归属前一镜头还是后一镜头；后台窗口行为。 |
| 预期输出 | 一个可重复播放、可暂停跳转、无残留资源的项目预览状态机。 |
| 停止条件 | 5 镜头、暂停、跳转、停止、结束、边界与 30 秒漂移全部验证。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-29/45
- **角色**：Engineer
- **依赖关系**：依赖 Day 26～28 完整时间与媒体链路。

### 输出交付物

- **预计变更文件**：
  - `src/domain/timeline/projectTimeMapping.ts`
  - `src/features/preview/ProjectPreviewController.ts`
  - `src/features/preview/AudioClock.ts`
  - `src/features/preview/AudioScheduler.ts`
  - `src/features/preview/PreviewControls.tsx`
  - `src/stores/previewStore.ts`
  - `src/domain/renderers/StageRenderer.tsx` 必要适配
  - 对应 unit/component/integration tests
  - `docs/test-receipts/DAY-29.md`
- **核心修改点**：
  - `mapProjectTimeToShot()` 纯函数；
  - 当前镜头预览与全部预览模式；
  - AudioContext 主时钟；
  - play / pause / stop / seek；
  - rAF 只读取时钟；
  - 自动镜头切换；
  - seek 后停止旧音频并重新调度；
  - 镜头切换清理上一镜头状态；
  - 播放结束后停止音频、时间归零或停在末尾并明确规则、恢复编辑模式；
  - 重复播放从相同初始状态开始。
- **必须包含**：
  - 5 镜头总时间映射；
  - 边界时点：0、每个镜头开始/结束、项目末尾；
  - 暂停后时间冻结，继续播放不跳错；
  - seek 前后的音频节点不叠播；
  - 停止后画面、字幕、音频、嘴巴回到 0；
  - 镜头切换无上一镜头图层/字幕残留；
  - 当前镜头预览不误播其他镜头音频；
  - 连续播放结束后 UI 恢复编辑状态；
  - 30 秒漂移测量方法和真实结果；
  - 连续播放 5 次资源数量不持续增长。
- **禁止包含**：
  - 用 rAF 累加 delta 作为主时钟；
  - 每次渲染创建新的 AudioContext；
  - seek 时不清理旧音频；
  - 镜头切换复用上一镜头临时状态；
  - 播放状态写入项目模型或 History；
  - 提前实现导出、混音、转场或倍速。
- **交付证明**：项目时间映射单测、状态机测试、音频节点 start/stop spy、边界截图、5 镜头录屏、30 秒计时对照、重复播放资源观察。

### 规模与复杂度观察

- ProjectPreviewController 负责状态机，AudioClock 负责时间，AudioScheduler 负责音频节点，StageRenderer 只消费求值状态。
- 时间映射必须通过前缀和或等价稳定算法，避免在多个组件重复计算。
- 音频清理要幂等，重复 pause/stop/seek 不得抛异常。
- 若浏览器/系统音频调度存在平台误差，声明 `DEBT-AUDIO-B29-001` 并记录实测范围。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型检查通过 | `pnpm typecheck` | 返工 |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | 时间映射、状态机、音频清理、边界和重复播放测试通过 | unit/component/integration tests | 返工 |
| ARCH | AudioContext 单时钟；rAF 不累计时间；预览状态不持久化 | 静态搜索 + store 断言 | 返工 |
| REAL | 5 镜头 30 秒真实连续预览 | `pnpm dev` 录屏/日志 | 返工 |
| DOC | 预览状态机、漂移结果与回执同步 | 文档 diff | 返工或债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 项目时间正确映射到镜头/镜头内时间 | mapping tests | [ ] |
| FUNC | FUNC-002 | play/pause/stop/seek 正确 | controller tests | [ ] |
| FUNC | FUNC-003 | 5 镜头自动切换 | integration/manual | [ ] |
| FUNC | FUNC-004 | 当前镜头/全部预览模式正确 | component tests | [ ] |
| CONST | CONST-001 | AudioContext 为唯一主时钟 | dependency evidence | [ ] |
| CONST | CONST-002 | rAF 只读取时间 | code review/test | [ ] |
| CONST | CONST-003 | 预览状态不进项目/History | JSON/store assertion | [ ] |
| CONST | CONST-004 | 切镜头清理幂等 | repeated cleanup test | [ ] |
| NEG | NEG-001 | seek 后旧音频不叠播 | scheduler spy | [ ] |
| NEG | NEG-002 | 项目末尾不越界 | mapping boundary | [ ] |
| NEG | NEG-003 | 暂停期间时间不增长 | fake clock test | [ ] |
| NEG | NEG-004 | 空项目/0 镜头安全降级 | controller test | [ ] |
| UX | UX-001 | 播放状态、时间和模式可读 | UI 证据 | [ ] |
| UX | UX-002 | 结束后恢复编辑模式 | component/manual | [ ] |
| E2E | E2E-001 | 5 镜头播放→暂停→跳转→继续→停止 | 完整流程 | [ ] |
| High | HIGH-001 | 30 秒漂移与重复播放资源稳定 | 计时/资源报告 | [ ] |

---

## 【模块3-B】地狱红线

1. rAF 累加时间充当主时钟 → 返工。
2. 多个 AudioContext 同时作为时钟 → 返工。
3. seek 后旧音频继续播放 → 返工。
4. 镜头边界出现上一镜头残影 → 返工。
5. 暂停后时间仍增长 → 返工。
6. stop 后字幕/嘴巴/音频不归零 → 返工。
7. 预览状态写入项目或 History → 返工。
8. 顺手实现导出、混音、倍速或转场 → 范围失控。
9. 未跑 30 秒真实预览却声称无漂移 → 未验证。
10. 质量门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 多镜头播放控制是否完整？ | [ ] | CF-B29-001 |
| RG | Day 26～28 的时间、求值和媒体是否保持？ | [ ] | RG-B29-001 |
| NG | 空项目、末尾、暂停、seek 叠播是否覆盖？ | [ ] | NG-B29-001 |
| UX | 模式、时间和结束状态是否清楚？ | [ ] | UX-B29-001 |
| E2E | 5 镜头完整操作是否走通？ | [ ] | E2E-B29-001 |
| High | 30 秒漂移和资源是否单独验证？ | [ ] | HIGH-B29-001 |
| 字段完整性 | 回执是否记录漂移、节点和边界证据？ | [ ] | DAY-29.md |
| 需求映射 | 是否覆盖 Day 29 全任务？ | [ ] | 刀刃表 |
| 自测执行 | 是否连续播放至少 5 次？ | [ ] | 操作证据 |
| 范围边界与债务 | 平台音频限制是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-29/45 完成并提交
- Commit: `feat(preview): play synchronized multi-shot project timeline`
- 分支: `feat/day-29-project-preview`
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- 项目时间映射:
- 5 镜头切换:
- play/pause/stop/seek:
- 当前镜头/全部预览:
- 音频重排与清理:
- 边界残影:
- 30 秒漂移:
- 重复播放资源:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- component/integration tests:
- `pnpm build`:
- `pnpm dev` 30 秒预览:

### 决策与债务
- DECISION-001: [镜头边界归属]
- DECISION-002: [预览结束规则]
- DECISION-003: [AudioContext 生命周期]
- DEBT-AUDIO-B29-001:
- DEBT-TEST-B29-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| CLOCK-B29-001 | 无法维持单一音频时钟 | 停止并重构 PreviewController | 阻塞 |
| AUDIO-B29-001 | seek/切镜头产生叠播 | 修调度与清理 | 阻塞 |
| STATE-B29-001 | 镜头切换有状态残留 | 强制重建/清理镜头态 | 返工 |
| PERF-B29-001 | 30 秒预览资源持续增长 | 停止功能扩展，先修泄漏 | 阻塞 |
| TEST-B29-001 | 无法测量真实漂移 | 不得声称无漂移 | 有条件交付 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 29：Multi-Shot Project Preview + Audio Clock + Clean Transitions**！

验收铁律：AudioContext 单时钟；5 镜头连续播放；边界无残影；暂停/跳转无叠播；停止归零；30 秒漂移有真实证据；重复播放资源稳定。

Ouroboros 闭环启动，**B-29/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "ProjectPreviewController\|AudioClock\|mapProjectTimeToShot\|AudioScheduler\|requestAnimationFrame" -- src tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm dev
git diff --stat
```
