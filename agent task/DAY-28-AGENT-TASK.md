# Panda Stage Agent Task — Day 28

> **工单编号**：B-28/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 28  
> **分支建议**：`feat/day-28-dialogue-subtitle-audio`  
> **任务类型**：功能开发 + 多媒体同步 + 降级容错  
> **唯一目标**：让角色对白同时驱动字幕、音频片段与基础嘴巴开合，并建立重叠对白优先级、长字幕安全区与无嘴图降级规则。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Dialogue Clips + Subtitles + Audio + Basic Mouth Motion
- **轰炸目标**：实现对白创建与拖动、字幕样式、安全区、音频片段显示、对白期间固定频率嘴巴开合以及重叠对白优先级。
- **任务性质**：功能开发 + 时间同步 + 用户体验
- **输入基线**：M3 Gate PASS；Day 26 时间轴与播放头可用；Day 27 evaluator 确定性通过；Character 可配置嘴图；Asset 有音频时长。
- **输出要求**：3 句对白可预览、字幕/音频起点一致、嘴巴只在对白期活动、长字幕不越界、缺音频/嘴图可降级。
- **通用铁律**：
  1. 对白、字幕、音频与嘴巴开合必须由同一整数毫秒时间轴驱动。
  2. 嘴巴开合只能在对应角色对白区间内生效，不能影响其他角色。
  3. 无音频或无嘴图时必须正常降级，不能阻塞字幕与预览。
  4. 字幕不得溢出安全区，长字幕最多两行或给出明确编辑提示。
  5. 不做语音识别、TTS、声音克隆或精细音素嘴型。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| Gate 前置 | M3 Gate PASS，Day 26/27 回执通过 | Gate/回执文件 | 必须 |
| 当前模型 | Dialogue、AudioClip、SubtitleStyle、Character mouth asset、Asset duration 可用 | `git grep -n "Dialogue\|AudioClip\|SubtitleStyle\|mouthOpenAssetId\|durationMs" -- src shared tests` | 必须 |
| 目标范围 | DialogueService、片段 UI、字幕引擎、音频调度适配、嘴巴求值、测试与回执 | `git diff --name-only` | 必须 |
| 目标结果 | 3 句对白按时间显示；音频起点一致；嘴巴只在对白期；无音频仍有字幕；长字幕最多两行并留在安全区 | unit/component/integration/manual evidence | 必须 |
| 技术约束 | 时间为整数毫秒；对白 start/duration 合法；音频不隐式拉伸；嘴巴周期确定性；重叠优先级稳定 | 代码与测试 | 必须 |
| 风险边界 | 不做项目级连续播放；不做混音；不做波形；不做音素识别；不做 AI/TTS | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + Day 26/27 回归 | 命令输出 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-28.md`，同步对白、字幕和嘴巴规则 | 文档 diff | 必须 |
| 历史债务 | 若 Dialogue/AudioClip schema 不足，补最小 migration 并保持旧项目可打开 | schema/migration tests | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 对白需要角色、文本、startMs、durationMs、可选音频；嘴巴只做固定频率开合。 |
| 待确认问题 | 重叠对白字幕优先级；mouthOpenAssetId 的数据结构；音频起点由 Dialogue 还是 AudioClip 决定；字幕测量方式。 |
| 预期输出 | 一个同步、可降级、不会越界的最小对白链路。 |
| 停止条件 | 3 句对白、重叠、无音频、无嘴图、长字幕和保存重开全部验证。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-28/45
- **角色**：Engineer
- **依赖关系**：依赖 Day 26 时间轴、Day 27 evaluator、Day 19 角色嘴图与音频素材元数据。

### 输出交付物

- **预计变更文件**：
  - `src/domain/services/DialogueService.ts`
  - `src/domain/evaluators/dialogueEvaluator.ts`
  - `src/domain/evaluators/mouthMotionEvaluator.ts`
  - `src/domain/engines/subtitleEngine.ts`
  - `src/features/timeline/DialogueClip.tsx`
  - `src/features/dialogue/DialogueEditor.tsx`
  - `src/features/subtitles/SubtitleRenderer.tsx`
  - `src/features/preview/AudioScheduler.ts`
  - 对应 unit/component/integration tests
  - `docs/test-receipts/DAY-28.md`
- **核心修改点**：
  - 新增/编辑/移除 Dialogue；
  - 片段在时间轴显示并可拖动；
  - startMs/durationMs 校验与镜头边界；
  - 字幕开关、样式、描边、安全区与自动换行；
  - 音频片段显示和起点映射；
  - 对白期固定频率 open/closed 嘴图切换；
  - 无 mouth asset 使用正常表情；
  - 无音频对白仍显示字幕；
  - 重叠对白按明确规则选择字幕层级和嘴巴状态；
  - 保存重开保持完整。
- **必须包含**：
  - 3 句对白标准用例；
  - 音频 start 与 Dialogue start 一致；
  - 嘴巴只在对应角色且只在区间内开合；
  - 对白结束后恢复基础表情；
  - 无音频、无嘴图、空文本、超长文本路径；
  - 长字幕最多两行并留在安全区；
  - 重叠对白优先级稳定且文档化；
  - 拖动对白片段后时间为整数毫秒并进入 History；
  - 音频不因 duration 不同被隐式拉伸；
  - 保存重开后文本、时间、音频和样式一致。
- **禁止包含**：
  - 用系统当前时间驱动嘴巴开合；
  - 嘴巴影响非说话角色；
  - 无嘴图时抛错阻塞预览；
  - 把长字幕直接缩成不可读小字；
  - 自动拉伸音频填满 Dialogue；
  - TTS、声音克隆、音素识别、波形、多轨混音或项目级预览。
- **交付证明**：DialogueService 单测、嘴巴时间采样表、字幕布局组件测试、音频调度起点断言、重叠优先级测试、完整 3 句预览证据。

### 规模与复杂度观察

- 对白状态、字幕布局、音频调度和嘴巴求值分层，避免一个组件包办所有逻辑。
- 嘴巴频率用确定性整数周期，不使用随机数或 `setInterval` 作为状态真相。
- 字幕测量若依赖 Canvas/Konva，应把换行算法与渲染分开测试。
- 若重叠对白产品规则仍不充分，声明 `DEBT-SEMANTICS-B28-001`，但必须选一个稳定最小规则执行。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型检查通过 | `pnpm typecheck` | 返工 |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | 对白、字幕、嘴巴、音频起点与降级测试通过 | unit/component/integration tests | 返工 |
| ARCH | 同一时间轴驱动；无 TTS/随机/系统时钟依赖 | 静态搜索 + evaluator tests | 返工 |
| REAL | 3 句对白真实预览且音画字幕一致 | `pnpm dev` 证据 | 返工 |
| DOC | 规则与 Day 28 回执同步 | 文档 diff | 返工或债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | Dialogue 创建/编辑/拖动可用 | unit/component | [ ] |
| FUNC | FUNC-002 | 字幕按时间出现和消失 | evaluator/render tests | [ ] |
| FUNC | FUNC-003 | 音频起点与对白一致 | scheduler test | [ ] |
| FUNC | FUNC-004 | 嘴巴在对白期确定性开合 | time-sample tests | [ ] |
| CONST | CONST-001 | 时间为整数毫秒且不越界 | validator tests | [ ] |
| CONST | CONST-002 | 字幕安全区与最多两行 | layout tests | [ ] |
| CONST | CONST-003 | 嘴巴只作用对应角色 | multi-character test | [ ] |
| CONST | CONST-004 | 音频不被隐式拉伸 | scheduler/metadata assertion | [ ] |
| NEG | NEG-001 | 无音频仍显示字幕 | integration test | [ ] |
| NEG | NEG-002 | 无嘴图正常降级 | evaluator test | [ ] |
| NEG | NEG-003 | 长字幕不越出安全区 | layout boundary | [ ] |
| NEG | NEG-004 | 重叠对白优先级稳定 | overlap tests | [ ] |
| UX | UX-001 | 对白片段与角色/时间信息清楚 | UI 证据 | [ ] |
| UX | UX-002 | 缺素材/越界错误可理解 | UI 证据 | [ ] |
| E2E | E2E-001 | 3 句对白→字幕→音频→嘴巴→保存重开 | 完整流程 | [ ] |
| High | HIGH-001 | 暂停/跳转采样时嘴巴与字幕状态仍确定 | seek test | [ ] |

---

## 【模块3-B】地狱红线

1. 对白、字幕和音频使用不同时间真相 → 返工。
2. 嘴巴使用随机数或系统时钟 → 返工。
3. 非说话角色也开合嘴巴 → 返工。
4. 无嘴图/无音频导致预览失败 → 返工。
5. 长字幕越过安全区或缩成不可读 → 返工。
6. 音频被隐式拉伸 → 返工。
7. 重叠对白结果依赖数组偶然顺序 → 返工。
8. 顺手实现 TTS、音素、混音或项目级播放 → 范围失控。
9. 未做 3 句真实预览就声称同步完成 → 未验证。
10. 质量门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 对白、字幕、音频和嘴巴是否同步？ | [ ] | CF-B28-001 |
| RG | Day 26/27 时间与 evaluator 是否保持？ | [ ] | RG-B28-001 |
| NG | 无音频、无嘴图、长字幕、重叠是否覆盖？ | [ ] | NG-B28-001 |
| UX | 对白编辑与错误反馈是否清楚？ | [ ] | UX-B28-001 |
| E2E | 3 句对白保存重开是否完整？ | [ ] | E2E-B28-001 |
| High | seek/pause 时状态是否确定？ | [ ] | HIGH-B28-001 |
| 字段完整性 | 回执是否记录时间、音频、字幕和截图？ | [ ] | DAY-28.md |
| 需求映射 | 是否覆盖 Day 28 全任务？ | [ ] | 刀刃表 |
| 自测执行 | 是否真实播放 3 句对白？ | [ ] | 操作证据 |
| 范围边界与债务 | 重叠语义/字幕限制是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-28/45 完成并提交
- Commit: `feat(dialogue): synchronize subtitles audio and basic mouth motion`
- 分支: `feat/day-28-dialogue-subtitle-audio`
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- Dialogue CRUD/拖动:
- 字幕与安全区:
- 音频起点:
- 嘴巴开合:
- 无音频/无嘴图降级:
- 重叠对白:
- 保存重开:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- component/integration tests:
- `pnpm build`:
- `pnpm dev` 3 句预览:

### 决策与债务
- DECISION-001: [重叠对白优先级]
- DECISION-002: [嘴巴开合周期]
- DECISION-003: [字幕换行规则]
- DEBT-SEMANTICS-B28-001:
- DEBT-TEST-B28-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| SYNC-B28-001 | 字幕、音频、嘴巴不共享时间真相 | 停止并统一调度 | 阻塞 |
| LAYOUT-B28-001 | 长字幕无法稳定留在安全区 | 修换行/编辑限制 | 返工 |
| AUDIO-B28-001 | 音频需拉伸才能匹配对白 | 禁止拉伸，改提示与时长规则 | 返工 |
| SCOPE-B28-001 | 实现扩展到 TTS/音素/混音 | 回退超范围变更 | 返工 |
| TEST-B28-001 | 无真实音频与嘴图样例 | 补合法 fixture，不得假测 | 阻塞 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 28：Dialogue Clips + Subtitles + Audio + Basic Mouth Motion**！

验收铁律：3 句对白同步；音频与对白同起点；嘴巴只在对应角色对白期；无音频/无嘴图可降级；长字幕留在安全区；重叠规则稳定。

Ouroboros 闭环启动，**B-28/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "DialogueService\|dialogueEvaluator\|mouthMotionEvaluator\|SubtitleRenderer\|AudioScheduler" -- src tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm dev
git diff --stat
```
