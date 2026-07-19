# Panda Stage Agent Task — Day 27

> **工单编号**：B-27/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 27  
> **分支建议**：`feat/day-27-timeline-evaluator`  
> **任务类型**：领域逻辑 + 插值算法 + 冲突规则  
> **唯一目标**：完成纯函数时间轴求值器，使 move、scale、opacity、shake、expression、flip、visibility 在任意时间点都得到确定结果，并建立重叠冲突与稳定排序规则。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Deterministic Timeline Evaluator + Interpolation + Conflicts
- **轰炸目标**：扩展 `evaluateShotAtTime()`，实现连续属性插值、离散属性稳定求值、shake 叠加、事件边界与冲突检测。
- **任务性质**：领域逻辑 + 算法实现 + 高密度单元测试
- **输入基线**：M3 Gate PASS；Day 25 能生成合法 TimelineEvent；Day 26 提供稳定镜头内时间；StageRenderer 读取 evaluator 结果。
- **输出要求**：同输入同输出、无 UI 副作用、边界可证明、冲突可拒绝、16 项刀刃表与结构化收卷齐全。
- **通用铁律**：
  1. evaluator 必须是纯函数，不依赖 React、Electron、Konva、AudioContext 或当前时间。
  2. 所有时间输入使用整数毫秒并 clamp 到镜头范围。
  3. 同属性连续事件重叠必须被编辑器拒绝或返回结构化冲突。
  4. 同时刻离散事件必须有稳定排序规则，不能依赖数组偶然顺序。
  5. shake 只能作为附加偏移，结束后必须回到基础位置。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| Gate 前置 | M3 Gate PASS，Day 25/26 测试通过 | Gate/回执文件 | 必须 |
| 当前模型 | TimelineEvent union、Layer 初始状态、Shot duration 与旧 evaluator 可用 | `git grep -n "evaluateShotAtTime\|TimelineEvent\|move\|scale\|opacity\|shake\|expression\|visibility" -- src shared tests` | 必须 |
| 目标范围 | interpolation、event sort、conflict detector、evaluator、测试与回执 | `git diff --name-only` | 必须 |
| 目标结果 | move/scale/opacity 插值；shake 叠加；expression/flip/visibility 离散求值；linear/ease-in-out；边界与冲突稳定 | unit/property-like evidence | 必须 |
| 技术约束 | 纯函数；无随机数；shake 使用基于事件 ID/时间的确定性函数；离散排序规则文档化；结果不修改输入 | 代码与测试 | 必须 |
| 风险边界 | 不做时间轴 UI 编辑；不做贝塞尔曲线编辑器；不做物理模拟；不做音频调度 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + Day 25/26 回归 | 命令输出 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-27.md`，同步 evaluator 与冲突契约 | 文档 diff | 必须 |
| 历史债务 | 若旧 evaluator 与 StageRenderer 有重复逻辑，必须收敛到同一求值入口 | diff 与架构说明 | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | move 与 shake 可叠加；离散事件在同一时刻需要稳定顺序；预览与导出必须共享 evaluator。 |
| 待确认问题 | TimelineEvent 字段细节；ease-in-out 公式；shake 频率/振幅语义；冲突检测放 schema 还是编辑服务。 |
| 预期输出 | 一个无副作用、可跨预览/导出复用的确定性求值内核。 |
| 停止条件 | 全事件类型、插值、冲突、边界、重复调用与输入不可变性全部验证。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-27/45
- **角色**：Engineer
- **依赖关系**：依赖 Day 25 事件生成与 Day 26 时间坐标。

### 输出交付物

- **预计变更文件**：
  - `src/domain/evaluators/shotEvaluator.ts`
  - `src/domain/evaluators/interpolation.ts`
  - `src/domain/evaluators/eventOrdering.ts`
  - `src/domain/validators/eventConflicts.ts`
  - `src/domain/models/TimelineEvent.ts` 必要适配
  - 对应大量 unit/property-like tests
  - `docs/test-receipts/DAY-27.md`
- **核心修改点**：
  - move：x/y 连续插值；
  - scale：连续插值；
  - opacity：0～1 连续插值；
  - shake：基于基础位置的确定性附加偏移；
  - expression/flip/visibility：离散状态；
  - linear / ease-in-out；
  - start/end 边界语义；
  - 同属性连续事件重叠检测；
  - 同时刻离散事件按 `time → priority → eventId` 或等价稳定规则排序；
  - 输入不可变与重复调用一致。
- **必须包含**：
  - 0 ms、事件 start、事件中点、event end、镜头末尾测试；
  - move 与 shake 同时存在时正确叠加；
  - shake 结束后偏移归零；
  - opacity 不越界；
  - expression/flip/visibility 同时刻稳定；
  - 重叠 move、scale、opacity 冲突测试；
  - 相邻但不重叠事件允许；
  - evaluator 不修改 Project/Shot/Layer/Event 输入；
  - 同一输入重复 100 次结果一致；
  - 预览与隐藏导出窗口继续调用同一 evaluator。
- **禁止包含**：
  - 使用 `Math.random()` 生成 shake；
  - 在 evaluator 中访问 store 或 DOM；
  - 在渲染组件中再写第二套插值；
  - 用事件数组原始顺序作为唯一冲突/优先级规则；
  - 允许重叠 move 静默覆盖；
  - 提前实现时间轴片段拖动、音频或项目级播放。
- **交付证明**：插值测试、冲突矩阵、输入深冻结测试、重复调用一致性、预览/导出静态搜索、边界结果表。

### 规模与复杂度观察

- evaluator 可分为“基础 Layer 状态→连续属性→离散属性→附加效果”四阶段，但不得为形式拆成无意义中间层。
- shake 的确定性函数必须简单、可解释、无跨平台随机差异。
- 冲突检测与运行时求值分离：编辑时阻止非法重叠，运行时对旧/损坏项目给出明确错误。
- 若事件优先级规则仍有未决项，声明 `DEBT-SEMANTICS-B27-001`，不得假装自然排序足够。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型检查通过 | `pnpm typecheck` | 返工 |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | 全事件类型、边界、冲突、纯函数与重复性测试通过 | `pnpm test:unit` | 返工 |
| ARCH | evaluator 无 UI/平台依赖，预览与导出共享 | 静态依赖检查 + 调用点证据 | 返工 |
| REAL | 用同一事件在主窗口与导出窗口取样结果一致 | 对照证据 | 返工 |
| DOC | 求值语义、冲突规则和回执同步 | 文档 diff | 返工或债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | move/scale/opacity 插值正确 | parameterized tests | [ ] |
| FUNC | FUNC-002 | shake 作为附加偏移正确 | evaluator tests | [ ] |
| FUNC | FUNC-003 | expression/flip/visibility 稳定求值 | discrete tests | [ ] |
| FUNC | FUNC-004 | linear/ease-in-out 结果正确 | interpolation tests | [ ] |
| CONST | CONST-001 | evaluator 为纯函数 | dependency + freeze test | [ ] |
| CONST | CONST-002 | 同输入重复结果一致 | repeated-call test | [ ] |
| CONST | CONST-003 | 同时刻离散事件稳定排序 | ordering tests | [ ] |
| CONST | CONST-004 | 预览/导出共享 evaluator | call-site evidence | [ ] |
| NEG | NEG-001 | 重叠 move 被拒绝 | conflict test | [ ] |
| NEG | NEG-002 | opacity 越界输入被拒绝/clamp | validator tests | [ ] |
| NEG | NEG-003 | shake 结束归零 | end-boundary test | [ ] |
| NEG | NEG-004 | 未知事件类型不被静默忽略 | schema/runtime test | [ ] |
| UX | UX-001 | 冲突错误指出图层、属性和时间段 | error object evidence | [ ] |
| UX | UX-002 | 事件边界语义有文档 | docs diff | [ ] |
| E2E | E2E-001 | 预设事件→求值→StageRenderer 状态 | integration test | [ ] |
| High | HIGH-001 | move+shake 与镜头末尾无残留/跳变 | sampled timeline table | [ ] |

---

## 【模块3-B】地狱红线

1. evaluator 依赖 React、Electron、Konva 或 store → 返工。
2. shake 使用随机数 → 返工。
3. 预览和导出存在两套插值逻辑 → 返工。
4. 重叠 move 被静默接受 → 返工。
5. 同时刻离散事件结果依赖偶然数组顺序 → 返工。
6. evaluator 修改输入对象 → 返工。
7. 边界时点出现 NaN/Infinity → 返工。
8. 提前实现时间轴 UI、对白或播放调度 → 范围失控。
9. 未验证 0/start/end/末尾就声称确定性完成 → 未验证。
10. 质量门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 所有事件类型是否得到正确状态？ | [ ] | CF-B27-001 |
| RG | Day 25 预设和共享渲染是否保持？ | [ ] | RG-B27-001 |
| NG | 重叠、越界、未知类型、边界是否覆盖？ | [ ] | NG-B27-001 |
| UX | 冲突错误是否可定位？ | [ ] | UX-B27-001 |
| E2E | 事件到 StageRenderer 是否走通？ | [ ] | E2E-B27-001 |
| High | move+shake 末尾是否无残留？ | [ ] | HIGH-B27-001 |
| 字段完整性 | 回执是否记录公式、边界和结果表？ | [ ] | DAY-27.md |
| 需求映射 | 是否覆盖 Day 27 全项？ | [ ] | 刀刃表 |
| 自测执行 | 是否实际对照预览/导出采样？ | [ ] | 对照证据 |
| 范围边界与债务 | 事件语义未决项是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-27/45 完成并提交
- Commit: `feat(timeline): implement deterministic event evaluation and conflicts`
- 分支: `feat/day-27-timeline-evaluator`
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- move/scale/opacity:
- shake:
- expression/flip/visibility:
- interpolation:
- conflict detection:
- stable ordering:
- input immutability:
- preview/export sharing:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- `pnpm build`:
- 主窗口/导出窗口对照:

### 决策与债务
- DECISION-001: [事件边界语义]
- DECISION-002: [离散事件排序]
- DECISION-003: [shake 确定性算法]
- DEBT-SEMANTICS-B27-001:
- DEBT-TEST-B27-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| PURE-B27-001 | evaluator 产生副作用或平台依赖 | 停止并重构为纯函数 | 阻塞 |
| CONFLICT-B27-001 | 无法定义稳定重叠规则 | 暂停编辑器扩展，先完成语义决策 | 阻塞 |
| DETERMINISM-B27-001 | 同输入结果不一致 | 移除随机/时钟依赖 | 阻塞 |
| REGRESSION-B27-001 | 预览与导出状态不一致 | 统一调用链 | 阻塞 |
| TEST-B27-001 | 边界矩阵不完整 | 不得收卷 | 阻塞 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 27：Deterministic Timeline Evaluator + Interpolation + Conflicts**！

验收铁律：同输入同输出；shake 无残留；move+shake 可叠加；重叠连续事件受控；离散事件排序稳定；evaluator 无 UI 副作用；预览和导出共享。

Ouroboros 闭环启动，**B-27/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "evaluateShotAtTime\|eventConflicts\|easeInOut\|shake\|eventOrdering" -- src tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
git diff --stat
```
