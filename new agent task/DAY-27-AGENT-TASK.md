# Panda Stage Agent Task — Day 27

> **源工单编号**：R-27/45  
> **执行工单编号**：B-27/45  
> **标题**：Dialogue Sheet + Speaker/Text Authoring  
> **角色**：Engineer  
> **模板**：ID-59 v3.0 通用增强版  
> **路线状态**：Day 26～45 Rebaseline v1  
> **派单编写时审计基线**：`main@72881b203a0aa9598c7b284d9ee213620cffce59`  
> **执行基线**：必须是 **Day 26 PASS + merged 后的最新稳定 main**；开工时重新记录分支与 HEAD  
> **核心范围声明**：本日只建立“角色：台词”的正式对白录入、选择、编辑、删除、批量粘贴主路径，以及为此不可避免的最小 Dialogue schema 演进；不做 TTS、语音生成、动作事件、ActionPreset、自动导演或复杂字幕系统。

---

# 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Day 27 — Dialogue Sheet + Speaker/Text Authoring
- **轰炸目标**：在 Day 26 已通过真人验收并合入的正式 Timeline / BottomWorkspace 基础上，为当前镜头建立可批量录入“角色：台词”的 Dialogue Sheet，并将对白选择接入唯一 RightInspector；所有已提交对白变更必须进入现有 ProjectCommand / History / dirty / save 生命周期。
- **任务性质**：领域模型兼容演进 + 功能开发 + UI 状态管理 + History 集成 + 真实产品验收
- **输入基线**：完整读取本工单【模块2】；Day 26 合入后重新锁定 Timeline 实际 owner / 路径 / selectors，不得照本工单的“预期路径”另建平行 Timeline。
- **输出要求**：可执行 Dialogue authoring + 可复现自动化验证 + schema/migration 证据 + 真实 Windows Electron 验收 + 显式债务声明 + `docs/test-receipts/DAY-27.md` 结构化收卷。
- **用户可见结果**：用户不碰 JSON 就能在当前镜头新增、选择、修改、删除对白；能粘贴多行“角色：台词”，先预览再提交；未知角色不会被 AI/程序偷偷猜；选中对白后右侧 Inspector 明确显示当前 speaker / text。

## 通用铁律

1. **数据诚实**：测试数、warning 数、schemaVersion、HEAD、PASS/FAIL、真人步骤必须来自真实命令或真实操作。
2. **零占位符**：禁止假 Dialogue、假角色、假音频、临时 JSON 注入、硬编码“导入成功”。
3. **自动化优先**：解析、角色解析、schema/migration、History、项目隔离、选择状态必须优先用自动化证明；真人 Electron 仍是最终 Gate。
4. **最小必要复杂度**：不建设“剧本系统”“对白轨引擎”“通用表格框架”“TTS 管线”“事件总线”；只做 Day 27 所需正式能力。
5. **债务透明化**：测试基础设施、历史音频对白兼容、未覆盖交互必须显式写 `DEBT-*`。
6. **唯一 owner**：Dialogue 必须扩展 Day 26 合入后的唯一 Timeline/BottomWorkspace；Inspector 必须扩展当前唯一 `RightInspector`，禁止平行右栏。
7. **项目身份安全**：任何批量粘贴草稿、Dialogue selection 都必须绑定 `projectRoot + shotId` 或在身份切换时清空；A→B→A 不得串草稿/选择。
8. **真人安全门优先**：自动化全绿但真实 Electron 主路径 FAIL，则 Day 27 = FAIL。

---

# 【模块2】输入基线（完整技术背景，零占位符）

## 2.1 Git 与执行依赖

| 输入项 | 当前已确认事实 | 开工验证命令 / 证据 | 状态 |
|---|---|---|---|
| 派单审计坐标 | 编写本工单时 `main@72881b203a0aa9598c7b284d9ee213620cffce59`，该提交仅加入新版 Day 26 工单文档 | `git log --oneline -n 5` | 已确认 |
| Day 27 执行坐标 | 必须在 Day 26 PASS + merge 后，以当时最新稳定 main 为准 | `git branch --show-current`；`git rev-parse HEAD`；`git log --oneline -n 8` | 开工必须重录 |
| Day 26 依赖 | 编写本工单时 `src/renderer/features/timeline/` 尚不存在；因此 Day 27 不能在当前审计 HEAD 直接实施 Timeline 扩展 | `test -d src/renderer/features/timeline && find src/renderer/features/timeline -maxdepth 2 -type f -print` | **硬前置** |
| Day 26 真人门 | 必须确认 `docs/test-receipts/DAY-26.md` 最终结论为 PASS，且 Timeline 已进入正式 BottomWorkspace | `cat docs/test-receipts/DAY-26.md`；`git show --stat --oneline <Day26 merge SHA>` | **硬前置** |
| 禁止继承线 | Stage 3-B / ActionPreset / PR #177 不属于当前核心路线 | `git diff main...HEAD --name-only`；`git log --oneline main..HEAD` | 硬边界 |

### Day 27 开工阻塞规则

满足任一条，**不得进入实现**：

1. Day 26 回执不是 PASS。
2. Day 26 的 Timeline/BottomWorkspace 实际代码尚未合入执行基线。
3. 当前分支不是从最新稳定 main 建立。
4. 为实现 Dialogue Sheet 被迫复活 ActionPreset / Stage 3-B / PR #177。

> 人话版：Day27 是在 Day26 新装好的“时间轴桌子”上摆对白本。桌子还没装好，不能拿工单当锤子，硬在空气里钉抽屉。🤣

## 2.2 当前 Dialogue 正式模型：原工单的关键结构冲突

**文件**：`src/domain/models/dialogue.ts`（当前文件约 1–31 行；开工后用 `nl -ba` 重新锁行号）

当前 `DialogueSchema` 已确认包含且严格要求：

- `id`
- `characterId`
- `voiceProfileId`
- `audioClipId`
- `subtitleStyleId`
- `startMs`
- `endMs`
- `text`

并要求 `endMs >= startMs`。

**文件**：`src/domain/validators/projectReferences.ts`（`shot.dialogues.forEach(...)` 区域）

当前项目级引用校验已确认：

- `characterId` 必须存在；
- `voiceProfileId` 必须存在且属于同一角色；
- `audioClipId` **必须指向当前 shot 的真实 audio clip**；
- `subtitleStyleId` 必须存在；
- `endMs <= shot.durationMs`。

### 关键结论

原 Day 27 要求“只录 speaker/text、不做 TTS/音频”，但当前正式 schema 又强制 `audioClipId` 指向真实音频片段。两者不可同时成立。

**本工单禁止以下伪解法：**

- 生成假静音文件只为了凑 `audioClipId`；
- 创建 fake audio clip / fake asset；
- 在 UI 层维护一套不进 ProjectSchema 的永久 `DialogueDraft[]`，假装已保存对白；
- 直接绕过 `ProjectSchema.parse()` 写 JSON。

### Day 27 正式解决合同

Day 27 必须做**最小正式 schema 演进**：

1. **现有 `Dialogue` 仍是唯一正式 schema**，不新建平行永久 Draft schema。
2. `audioClipId` 改为**可选正式字段**：文本对白可以先于音频存在。
3. 旧项目中已有 `audioClipId` 的 Dialogue 必须继续可读、可保存、可复制。
4. 引用校验改为：
   - 有 `audioClipId` → 必须引用当前 shot 中真实 audio clip；
   - 无 `audioClipId` → 合法，代表“尚未绑定音频”的正式文本对白。
5. Day 27 **不生成、不删除、不伪造音频**。
6. 因 persisted shape 发生变化，默认要求将 `PROJECT_SCHEMA_VERSION` 从当前 `5` 演进到 `6`，并补齐 v5→v6 migration/compatibility 测试。
7. 如果开工时 Day 26 或其他已合入改动已经把 schemaVersion 前移，则基于实际最新版本顺延 1，禁止硬改回 6；在回执写 `DECISION-B27-SCHEMA-VERSION`。

> 这不是“顺手重构 schema”，而是 Day27 能否真实存在的地基。没有它，所谓“先写台词、以后再 TTS”只能靠假音频撑门面。

## 2.3 Character 正式模型与创建路径

**文件**：`src/domain/models/character.ts`（当前约 1–38 行）

已确认：

- Character 有 `id / name / defaultVoiceProfileId / expressions / ...`；
- VoiceProfile 有 `id / name / characterId / locale / rate / pitch`。

**文件**：`src/domain/services/CharacterService.ts`（`create(...)` 区域）

已确认角色创建时会同时创建一个默认 VoiceProfile，并把其 ID 写入 `character.defaultVoiceProfileId`。

**Day 27 speaker 合同：**

- 新 Dialogue 选择角色后，`voiceProfileId` 默认使用该角色的 `defaultVoiceProfileId`；
- 本日不提供 VoiceProfile 高级选择器；
- 切换 speaker 时同步切换为新角色默认 VoiceProfile；
- 不允许 Dialogue 引用外国角色的 VoiceProfile。

**文件**：`src/renderer/features/characters/CharacterList.tsx`

当前角色 UI 明确要求至少两张不同图片素材才能创建角色。因此原 Day 27 真人验收“空项目直接创建 2 个角色”不符合当前真实产品。

**新版验收前置改为：**

> 新建空项目 → 导入至少 2 张不同图片素材 → 创建 2 个角色 → 再进入对白批量录入。

## 2.4 Shot 与 Dialogue 容器事实

**文件**：`src/domain/models/shot.ts`（当前约 1–48 行）

已确认：

- `Shot` 正式包含 `dialogues: Dialogue[]`；
- 还包含 `durationMs / defaultSubtitleStyleId / audioClips / timelineEvents / layers`。

**文件**：`src/domain/services/ShotService.ts`

已确认：

- `maximumContentEndMs()` 会把 Dialogue 的 `endMs` 纳入 shot duration 下限；
- `duplicate()` 会复制 dialogues；
- 当前 duplicate 对 `dialogue.audioClipId` 假设为必填并映射到复制后的 audio clip ID。

因此 `audioClipId` 可选化后，必须同步修正：

- shot duplication：无 audio link 的 Dialogue 复制后仍无 audio link；
- 有 audio link 的 Dialogue 继续映射到复制后的 audio clip；
- duration 逻辑不受破坏。

## 2.5 项目 schema / migration 事实

**文件**：`src/domain/constants.ts`

当前已确认：

```ts
PROJECT_SCHEMA_VERSION = 5
PROJECT_FPS = 24
SHOT_MIN_DURATION_MS = 500
```

**文件**：`src/domain/models/project.ts`

已确认：

- `ProjectSchema` 通过 `migrateFormalProject` + `ProjectDataSchema.superRefine(validateProjectReferences)` 形成正式入口；
- 已存在历史版本 schema / migration 路径。

**现有测试**：

- `tests/unit/domain-schema.test.ts`
- `tests/unit/migrations/project-migration.test.ts`
- `tests/unit/shot-duplicate-regression.test.ts`
- `tests/unit/shot-service.test.ts`

Day 27 schema 演进必须扩展这些真实测试位置，而不是另造一套“测试专用 schema”。

## 2.6 正式 History / dirty 账本

**文件**：`src/renderer/stores/EditorProjectStore.ts`

已确认：

- `updateProject(...)` 会 `ProjectSchema.parse(rawProject)`；
- 实际 project mutation 通过 `ProjectCommand` 进入 `HistoryStore`；
- `applyHistoryProject()` 负责 dirty/revision 更新；
- `undo()` / `redo()` 已是正式入口。

### Day 27 mutation 合同

- **单条新增**：1 次正式 `updateProject` / 1 个 History command。
- **单条编辑**：speaker/text 一次确认视为 1 个 History command；禁止每个键盘字符都塞一条 History。
- **单条删除**：1 个 History command。
- **批量粘贴提交**：整批作为 **1 个 History command**，一次 Undo 撤销整批；预览阶段不得 dirty、不得进入 History。
- 所有已提交操作必须 dirty=true；保存后 dirty=false；重开一致。

> 人话版：批量粘贴像“端一盘菜上桌”，预览时只是厨房摆盘，不记账；真正点“提交”时一次记一笔。不要一粒葱花记一张发票。🤣

## 2.7 Dialogue mutation owner：当前缺口与允许新增

当前 `src/domain/services/` 已确认只有：

- `CharacterService.ts`
- `LayerService.ts`
- `ShotService.ts`

当前没有独立 `DialogueService`。

**Day 27 允许新增正式最小 owner：**

- `src/domain/services/DialogueService.ts`
- `src/renderer/stores/dialogueStore.ts`

### 推荐职责边界

`DialogueService`：纯 Project→Project 领域 mutation，至少覆盖：

- create one
- create many（批量一次 mutation）
- update speaker/text
- remove
- 当前 shot / dialogue / character identity 验证
- 默认 voiceProfile / subtitleStyle / 时间字段生成规则

`dialogueStore`：仿照现有 `characterStore` / `shotStore`，只负责：

- 从 `EditorProjectStore` 取当前 Project；
- 调 `DialogueService`；
- 用清楚的 label 调 `editorProjectStore.updateProject(...)`；
- 不自己保存文件、不自己维护第二份 Project。

**禁止**把所有 mutation 直接散写在 JSX 中。

## 2.8 Day 27 新 Dialogue 的时间字段合同

Day 27 **不做时间段编辑器**，但现有 Dialogue 仍要求 `startMs/endMs`。

为了不虚构台词时长，本日新建 Dialogue 使用以下最小正式规则：

1. 若 Day 26 提供可读取的当前 playhead，则 `startMs = endMs = clamp(currentTimeMs, 0, shot.durationMs)`。
2. 若 Day 26 合入后的 Timeline 没有暴露可安全读取 playhead 的正式 API，则 **不要为了 Day 27 改造整套 Timeline 状态机**；新 Dialogue 使用 `startMs = endMs = 0`，并在 `DECISION-B27-POINT-TIME` 明确记录。
3. 批量粘贴的一批 Dialogue 本日不自动导演、不自动估算时长；全部按同一当前 point-time 进入正式列表。
4. 本日 UI 只拥有 speaker/text；不提供 start/end 数字输入框。
5. 后续 TTS/时序工单可以扩展区间，但 Day 27 不猜“每句 2 秒”之类假规则。

## 2.9 Dialogue selection 与唯一 Inspector

**文件**：`src/renderer/stores/selectionStore.ts`

当前已确认它是**图层选择** store，内部上下文绑定：

- `projectId`
- `projectRoot`
- `shotId`

并会在项目/镜头/图层身份变化时 reconcile。

**文件**：`src/renderer/shell/RightInspector.tsx`（当前约 1–137 行）

当前唯一 Inspector：

- 读取 `editorProjectStore / shotStore / selectionStore`；
- 当前只显示 layer/background 属性。

### Day 27 selection 合同

允许新增：

- `src/renderer/stores/dialogueSelectionStore.ts`
- `src/renderer/features/dialogue/DialogueInspector.tsx`

要求：

1. Dialogue selection 必须绑定当前 `projectRoot + shotId`，项目或镜头切换即失效。
2. Dialogue 被删除后 selection 自动清空。
3. 选择 Dialogue 时必须清除普通 layer selection，避免右侧同时有两种“当前对象”。
4. 当用户随后选择普通 layer/background 时，Dialogue selection 必须被清掉或失效；两种 selection 在 Inspector 层必须严格互斥。
5. `RightInspector` 仍是**唯一右栏 root**：
   - 有有效 Dialogue selection → 显示 `DialogueInspector`；
   - 否则继续显示原 layer/background inspector。
6. 不复制 `RightInspector`，不隐藏第二套右栏过测试。

若实现发现需要把 layer/dialogue/background 全部升级为一个统一 selection union，这属于架构扩大；先触发 `ARCH-001`，不得 Day 27 顺手重写全编辑器 selection 系统。

## 2.10 Day 26 Timeline 依赖与 Dialogue Sheet 接入

编写本工单时，当前 main 的 `BottomWorkspace.tsx` 仍只挂载 `HistoryControls`，且 `src/renderer/features/timeline/` 尚不存在。

Day 26 新版工单的目标是建立正式 Timeline Shell，但**Day 27 不允许假定尚未合入的文件名等于事实**。

### Day 27 开工时必须先运行

```bash
find src/renderer -maxdepth 4 -type f | grep -Ei 'timeline|bottomworkspace'
grep -Rni "Timeline\|playhead\|currentTimeMs" src/renderer tests | head -n 200
nl -ba src/renderer/shell/BottomWorkspace.tsx
```

然后在 `docs/test-receipts/DAY-27.md` 记录：

- Day 26 实际 Timeline owner 文件；
- 当前 playhead 状态 owner；
- Dialogue Sheet 的真实接入点。

### 接入原则

- Dialogue Sheet / lane/list 必须成为 Day 26 唯一 Timeline 产品 surface 的子能力；
- 如果 Day 26 最终文件确实为 `src/renderer/features/timeline/TimelineDock.tsx`，直接扩展它；
- 如果 Day 26 使用别的真实路径，使用真实 owner，并在回执写 `DECISION-B27-TIMELINE-OWNER`；
- 禁止因为路径不同再创建第二个 `TimelineDock`。

## 2.11 Batch Paste 合同

允许新增：

- `src/renderer/features/dialogue/parseDialoguePaste.ts`
- `src/renderer/features/dialogue/DialogueBatchPaste.tsx`

### 输入语法

每个非空行使用：

```text
角色名：台词
```

本日允许同时接受第一个全角冒号 `：` 或 ASCII 冒号 `:` 作为分隔符；只按**第一个**分隔符切开，台词正文后续冒号保留。

### 解析规则

1. 行首尾空白 trim。
2. 空行忽略，但预览摘要要能诚实报告忽略数量。
3. 无分隔符 → `malformed`。
4. 角色名为空 → invalid。
5. 台词 trim 后为空 → invalid。
6. 角色匹配只能使用确定性规则：`trim + locale-lowercase` 后与现有 Character.name 精确匹配。
7. **禁止 fuzzy / AI / 相似度猜角色。**
8. 当前 ProjectSchema 已禁止重复 character name；若未来基线改变允许重名，则出现多匹配必须判 `ambiguous`，不得自动选第一个。
9. 未知角色行必须在预览里显式标记，并提供手动映射到现有角色的入口。
10. 本日不允许批量粘贴顺手自动创建新角色。
11. 只有所有待提交非空行均变成 valid + resolved，提交按钮才可用。

### 预览与草稿身份

- 粘贴文本、解析结果、手动映射都属于 **UI draft**；
- 预览阶段：dirty/revision/History/project 均不变；
- draft 必须绑定 `projectRoot + shotId`，或通过 React `key` / 等价机制在身份切换时销毁；
- Project A → B → A 后，A 的未提交草稿不得自动复活；
- Shot A → Shot B 后，同理不得串镜头。

## 2.12 默认变更范围

### 允许修改 / 新增：领域与迁移

1. `src/domain/models/dialogue.ts`
2. `src/domain/models/shot.ts`（仅兼容 Dialogue contract 必需修改）
3. `src/domain/models/project.ts`
4. `src/domain/constants.ts`
5. `src/domain/validators/projectReferences.ts`
6. `src/domain/services/DialogueService.ts`（新增）
7. `src/domain/services/ShotService.ts`（仅 duplicate/兼容点）
8. `src/domain/services/index.ts` / `src/domain/index.ts`（若当前 export 结构需要）

### 允许修改 / 新增：renderer

1. Day 26 实际 Timeline owner 文件（开工后按真实 main 锁定）
2. `src/renderer/features/dialogue/DialogueSheet.tsx`（新增）
3. `src/renderer/features/dialogue/DialogueBatchPaste.tsx`（新增）
4. `src/renderer/features/dialogue/DialogueInspector.tsx`（新增）
5. `src/renderer/features/dialogue/parseDialoguePaste.ts`（新增）
6. `src/renderer/stores/dialogueStore.ts`（新增）
7. `src/renderer/stores/dialogueSelectionStore.ts`（新增）
8. `src/renderer/shell/RightInspector.tsx`
9. `src/renderer/styles.css` 中 Dialogue/Timeline/Inspector 必需样式

### 允许修改 / 新增：测试与文档

- `tests/unit/domain-schema.test.ts`
- `tests/unit/migrations/project-migration.test.ts`
- `tests/unit/shot-duplicate-regression.test.ts`
- `tests/unit/shot-service.test.ts`
- 新增 `tests/unit/dialogue-service.test.ts`
- 新增 `tests/unit/dialogue-paste.test.ts`
- 新增 `tests/unit/dialogue-selection-store.test.ts`
- 现有/新增与 Day 26 Timeline + Inspector 集成直接相关的 integration test
- `docs/test-receipts/DAY-27.md`

### 开工必须先做 blast-radius 搜索

```bash
git grep -n "audioClipId" -- src tests scripts
git grep -n "dialogues" -- src tests scripts
git grep -n "DialogueSchema\|type Dialogue" -- src tests scripts
```

搜索结果出现的真实 consumer 必须逐项判断是否受 `audioClipId` optional 影响，并在回执列出；禁止只改 schema 编译报哪修哪。

### 明确禁止

- TTS provider / voice cloning / speech synthesis
- 自动生成音频 asset / audio clip
- ActionPreset / 动作事件 authoring
- PR #177 / Stage 3-B 复活
- AI 剧本解析 / 自动角色猜测
- 自动镜头导演
- 自动估算每句对白时长
- 字幕字体/描边/排版设计器
- 多轨 NLE / keyframe / 通用 event editor
- 平行 `DialogueDraft` 持久化 schema
- 第二份 Timeline / RightInspector / Project store
- 直接编辑 `project.json` 作为产品路径

## 2.13 目标结果

Day 27 完成时必须同时成立：

1. Day 26 Timeline 正式 owner 保持唯一，Dialogue Sheet 集成其内。
2. 当前镜头的 `shot.dialogues` 能在 UI 列表中查看。
3. 用户能新增一条文本 Dialogue，选择 speaker，填写 text。
4. 用户能选中 Dialogue，唯一 RightInspector 切到 speaker/text 编辑界面。
5. 用户能修改 speaker/text、删除 Dialogue。
6. 用户能粘贴至少 6 行“角色：台词”，先预览、处理未知角色、再一次提交。
7. 批量预览不 dirty；整批提交只产生 1 个 History command；一次 Undo 撤销整批，一次 Redo 恢复。
8. 单条 edit/delete 正确 dirty、Undo/Redo。
9. 保存、关闭、重开后 speaker/text 一致。
10. 未绑定音频的正式 Dialogue 可通过 ProjectSchema / 保存 / 重开，不需要 fake audio。
11. 旧有带 `audioClipId` Dialogue 继续可读；shot duplicate 保持音频引用映射。
12. Project A→B→A、Shot A→B 的未提交 batch draft 不串身份。
13. Dialogue selection 与 layer/background selection 在 Inspector 严格互斥。
14. 全程不要求开发者工具、不改 JSON。

## 2.14 当前测试工具链事实

当前 `package.json` 已确认存在：

```text
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm dev
```

当前依赖中存在 Vitest；未确认有 Playwright / React Testing Library 独立 E2E/component stack。

因此：

- 有现成能力 → 用现成能力；
- 没有对应测试工具 → `N/A + 原因 + unit/integration + 真人替代证据`；
- 禁止为了模板漂亮临时引入整套测试框架，除非关键路径确实无法验证并经 `TEST-001` 记录。

### 开工 baseline 命令

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --check
```

**UNVERIFIED AT TASK AUTHORING**：本工单编写阶段没有替执行 Agent 声称这些命令在 Day 27 实际基线已 PASS。

## 2.15 文档同步

必须新建/更新：

- `docs/test-receipts/DAY-27.md`

至少记录：

- Day 26 prerequisite receipt / merge SHA
- Day 27 开工 HEAD / 收卷 HEAD
- 实际 Timeline owner 路径
- schemaVersion 演进决策
- `audioClipId` blast-radius 搜索结果
- DialogueService/store/selection owner
- batch parser 规则
- 自动化命令与真实输出摘要
- Windows Electron 验收步骤
- dirty / revision / History 证据
- A→B→A draft 隔离证据
- PASS / FAIL
- debt
- 下一步唯一动作

## 2.16 历史债务 / 高风险回归点

1. Stage 3-B 已证明“草稿状态与目标身份混写”会造成跨目标 mutation；Day 27 batch draft 必须绑定项目+镜头身份。
2. 当前 layer selection 已有完整身份 reconcile；Dialogue selection 不得降低这条安全线。
3. 当前 Dialogue 与 audio clip 强绑定；optional 演进是本日最高数据兼容风险。
4. Character 删除已有引用扫描；新增/保留 Dialogue 引用必须继续阻止删除被使用角色。
5. CI 全绿不能替代真实 Windows Electron 批量录入、Undo/Redo、保存重开。

## 2.17 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | Dialogue 当前强制 audioClip；Character 创建自动给 default VoiceProfile；Shot 正式拥有 dialogues；EditorProjectStore 已有 ProjectCommand/History；当前 main 尚无 Day26 Timeline 实现 |
| 待确认问题 | 1）Day 26 合入后 Timeline 实际 owner/playhead API；2）`audioClipId` optional 的全部真实 consumer；3）Day26 Timeline 布局中 Dialogue Sheet 最小可用形态 |
| 预期输出 | 在不造假音频、不新建永久 Draft schema 的前提下，收敛并实现文本对白正式 authoring 主路径 |
| 停止条件 | Day 26 owner 已确认；audioClip blast radius 已列全；schema/migration 方案可保持旧项目可读；无需进入 TTS/ActionPreset/通用 timeline engine 即可实现目标 |

---

# 【模块3】工单矩阵（通用高压版）

## B-27/45｜Engineer｜Dialogue Sheet + Speaker/Text Authoring

### 3.1 基础信息

- **工单编号**：B-27/45
- **角色**：Engineer
- **目标**：把当前 `Shot.dialogues` 从“只能靠已有音频/JSON 存在的数据结构”变成真实可用的文本对白 authoring 产品路径，同时保持旧音频对白兼容和现有 History/Inspector/Timeline 单一 owner。
- **输入**：模块2中的 Dialogue schema、Project reference validation、Character default VoiceProfile、Shot duplication、EditorProjectStore History、Day26 Timeline prerequisite。
- **依赖关系**：严格依赖 Day 26 PASS + merged；不依赖 ActionPreset / Stage 3-B / PR #177。

### 3.2 输出交付物

#### 核心领域交付

- 正式 Dialogue schema 可表示“有 speaker/text、暂未绑定 audio clip”的合法 Dialogue。
- schemaVersion/migration 兼容旧项目。
- 最小 `DialogueService` 提供 create/createMany/update/remove。
- `dialogueStore` 通过 `EditorProjectStore.updateProject` 接入现有 History。

#### 核心 UI 交付

- Day26 Timeline 内的 `DialogueSheet` / list。
- 单条新增、选择、删除。
- 唯一 RightInspector 中的 `DialogueInspector`。
- Batch Paste：输入 → 解析 → preview → 手动映射未知角色 → 一次 commit。
- 项目/镜头身份切换自动清草稿与 Dialogue selection。

#### 必须包含

- 无 audioClip Dialogue 的 schema/migration/save/reopen 测试。
- 旧有 audio-backed Dialogue 兼容测试。
- Shot duplicate 对 optional audioClip 的回归测试。
- Character 引用约束保持测试。
- parser 正常/非法/未知角色/正文含冒号测试。
- batch preview 不 dirty、batch commit 一次 History、Undo/Redo 测试。
- Dialogue selection 与 layer selection 互斥测试。
- Project/Shot 切换 draft 隔离测试。
- Windows Electron 主路径。

#### 禁止包含

- fake audio asset/clip
- fake TTS success
- AI/fuzzy speaker matching
- auto-create character from paste
- timer/setTimeout 模拟保存或生成
- permanent parallel draft schema
- direct JSON mutation
- second Inspector / Timeline root
- ActionPreset / TimelineEvent authoring

#### 交付证明

```bash
git branch --show-current
git rev-parse HEAD
git log --oneline -n 8
git status --short
git diff --name-only
git diff --stat
git diff --check
git grep -n "audioClipId" -- src tests scripts
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

以及真实 Windows Electron：

- 新建项目→导入 2 图片→创建 2 角色；
- 批量粘贴 ≥6 行；
- 未知角色预览与手动映射；
- 编辑第 3 条；
- Undo / Redo；
- 保存 / 关闭 / 重开；
- A→B→A 未提交草稿隔离；
- layer↔dialogue Inspector 互斥切换。

### 3.3 规模与复杂度观察

- parser 必须为纯函数优先；UI 不承担字符串解析业务规则。
- schema/migration 兼容逻辑集中在正式 domain 层，不散落 renderer。
- Dialogue mutation 集中 `DialogueService`，不要在 4 个组件各复制 Project replacement 逻辑。
- selection store 只做当前对象身份，不保存表单草稿、不持久化 Project。
- 批量 preview state 尽量组件局部化并用 project/shot identity 重置；不要因为 1 个文本框建设全局 draft framework。
- 若 RightInspector 为接 Dialogue 被迫大规模重写，先检查是否可用小的“active mode + 子组件”完成。
- 明显 >50 行的复杂单函数需解释，但禁止为压行数硬拆。

### 3.4 自动化质量闸门（强制）

| 闸门 | 要求 | 验证命令 / 证据 | 不通过后果 |
|---|---|---|---|
| BUILD | TS + Renderer + Electron build 通过 | `pnpm build` | 返工 |
| FMT | 当前仓库未确认独立 formatter script；至少无 whitespace/error diff | `git diff --check`；若无 formatter，回执写 `N/A + repo 未配置独立 formatter` | 返工或诚实 N/A |
| LINT | 无新增 lint error；warning 必须真实声明 | `pnpm lint` | 返工或 debt |
| TEST | schema/migration/parser/service/store/History/integration 全覆盖 | `pnpm test:unit` + `pnpm test:integration` | 返工 |
| ARCH | 单一 Project/Timeline/Inspector owner；无 fake audio；Dialogue draft 不持久化 | `git diff` + `git grep` + 相关测试 | 返工 |
| REAL | 真实 Electron 完成 6 行批量录入、Undo/Redo、保存重开、A→B→A | `pnpm dev` + human evidence | 返工 |
| DOC | Day27 receipt 与 schema/行为一致 | `git diff -- docs/test-receipts/DAY-27.md` | 返工或 DEBT-DOC |

---

# 【模块3-A】刀刃表（16项，强制命令化）

| 类别 | 检查点ID | 检查目标 | 验证命令 / 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 当前镜头可新增/选择/编辑/删除正式 Dialogue | dialogue service/store tests + Electron | [ ] |
| FUNC | FUNC-002 | Batch paste ≥6 行先 preview 后一次 commit，speaker/text 正确 | parser tests + integration + Electron | [ ] |
| FUNC | FUNC-003 | 未知角色显式 invalid/manual mapping，不 fuzzy 猜测 | parser/UI tests + Electron unknown-role case | [ ] |
| FUNC | FUNC-004 | 选中 Dialogue 后唯一 RightInspector 显示 speaker/text，layer 选择可切回 | selection/integration + Electron | [ ] |
| CONST | CONST-001 | 无 audioClip 的文本 Dialogue 是正式 ProjectSchema 数据；旧 audio-backed Dialogue 仍兼容 | domain-schema + migration tests | [ ] |
| CONST | CONST-002 | 所有正式 Dialogue mutation 进入 ProjectCommand/History；preview 不 dirty | editor store/history tests + snapshot 证据 | [ ] |
| CONST | CONST-003 | Timeline=1 / RightInspector=1 / ProjectStore=1；无平行 draft schema / fake audio | `git grep` + diff/import 检查 | [ ] |
| CONST | CONST-004 | 未触碰 TTS/ActionPreset/动作 authoring/AI 解析范围 | `git diff --name-only` + `git diff` | [ ] |
| NEG | NEG-001 | malformed、空角色、空台词、未知角色均不可提交 | parser tests | [ ] |
| NEG | NEG-002 | Project/Shot 切换清未提交 batch draft 与失效 Dialogue selection | store/integration + A→B→A Electron | [ ] |
| NEG | NEG-003 | Dialogue 删除、角色引用、shot duplicate、旧 audio link 不产生悬空引用 | domain/service/reference tests | [ ] |
| NEG | NEG-004 | 现有 layer/background Inspector、Character、History、Day26 Timeline 无回归 | `pnpm test:integration` + Electron smoke | [ ] |
| UX | UX-001 | 新建项目→导入2图→建2角色→粘贴6行→预览→提交，全程不碰 JSON/devtools | Windows Electron 操作记录 | [ ] |
| UX | UX-002 | 错误行/未知角色能看懂哪里错、怎么处理；提交按钮状态明确 | Windows Electron + screenshot | [ ] |
| E2E | E2E-001 | 编辑第3条→Undo→Redo→保存→关闭→重开，speaker/text 完全一致 | Windows Electron + project state receipt | [ ] |
| High | HIGH-001 | schema migration + 真人主路径同时 PASS；任一失败 Day27 均 FAIL | migration output + human receipt | [ ] |

### 刀刃表铁律

1. 每项必须有真实命令输出或真实 Windows Electron 证据。
2. “看起来兼容”“理论上不 dirty”不算证据。
3. N/A 必须写原因与替代证据。
4. 同一命令覆盖多项，在 Day27 receipt 写覆盖关系。

---

# 【模块3-B】地狱红线（10项）

1. **零占位符违规**：用假音频/假 Dialogue/硬编码角色凑功能 → 返工。
2. **验证造假**：未跑 migration/test/Electron 却写 PASS → 返工。
3. **构建失败仍交付**：`pnpm build` FAIL 仍声称完成 → 返工。
4. **测试缺失伪完成**：schema migration、History、batch parser、identity isolation 无证据 → 返工。
5. **假实现**：fake audio clip、mock TTS、setTimeout success、直接 JSON 注入 → 返工。
6. **架构违规**：第二 Project store / Timeline / Inspector，或永久平行 DialogueDraft schema → 返工。
7. **新增 warning/debt 不申报**：迁移/兼容/测试缺口隐藏不报 → 返工。
8. **范围失控**：擅自做 TTS、ActionPreset、AI script parser、自动导演、复杂字幕 → 立即停止。
9. **Git 历史不完整**：reset/force-push 抹历史、整包搬旧实验分支 → 返工。
10. **未知伪装确定性**：Day26 owner、audioClip blast radius 尚未核完就直接施工 → 返工。

---

# 【模块4】P4 自测轻量检查表 v3.0

| 检查点 | 自检问题 | 覆盖情况 | 相关用例ID / 命令 | 备注 |
|---|---|---|---|---|
| 核心功能用例（CF） | CRUD、batch preview/commit、Inspector 是否各有标准路径？ | [ ] | FUNC-001～004 | |
| 约束与回归用例（RG） | schema/audio compatibility/History/unique owners 是否覆盖？ | [ ] | CONST-001～004 | |
| 负面路径用例（NG） | malformed/unknown role/project switch/delete/duplicate 是否覆盖？ | [ ] | NEG-001～004 | |
| 用户体验用例（UX） | 真实 6 行录入和错误提示是否用户能完成？ | [ ] | UX-001～002 | |
| 端到端关键路径（E2E） | edit→undo→redo→save→reopen 是否完整？ | [ ] | E2E-001 | |
| 高风险场景（High） | schema migration 与 human gate 是否同时验？ | [ ] | HIGH-001 | |
| 字段完整性 | 回执是否写前置/预期/实际/风险？ | [ ] | `docs/test-receipts/DAY-27.md` | |
| 需求映射 | 每条验证是否回到“对白 authoring”目标？ | [ ] | 刀刃表 | |
| 自测执行 | 是否真实跑完整质量命令 + Electron？ | [ ] | quality gates | |
| 范围边界与债务 | 未覆盖 TTS/时序等是否明确不在本日？ | [ ] | debt ledger | |

---

# 【模块5】收卷格式（强制结构）

```markdown
## ✅ Panda Stage Day 27 / B-27/45 完成并提交

### 提交信息
- Day26 prerequisite receipt: `PASS / FAIL`
- Day26 merge SHA: `<真实 SHA>`
- Day27 开工 HEAD: `<真实 SHA>`
- Day27 收卷 HEAD: `<真实 SHA>`
- Commit: `feat(dialogue): ...`
- 分支: `<真实分支>`
- 变更文件: `<git diff --name-only 实际输出>`

### 本轮目标与实际结果
- 目标: 建立正式 speaker/text Dialogue authoring + batch paste，不依赖 fake audio/TTS。
- 实际完成: [真实项]
- 未完成/不在范围: [真实列出]

### 关键决策记录
- DECISION-B27-TIMELINE-OWNER: [Day26 实际 owner 路径] - [为何在此接 Dialogue Sheet]
- DECISION-B27-SCHEMA-VERSION: [旧版本→新版本] - [迁移策略]
- DECISION-B27-AUDIO-OPTIONAL: [audioClipId 正式语义] - [兼容策略]
- DECISION-B27-POINT-TIME: [新对白 start/end 规则] - [为什么不猜时长]
- DECISION-B27-SELECTION: [dialogue/layer 互斥方案] - [为什么]
- DECISION-B27-BATCH-HISTORY: [整批一次 command] - [为什么]

### audioClipId Blast Radius
```bash
git grep -n "audioClipId" -- src tests scripts
[真实输出摘要/涉及文件]
```

### 自动化质量检查报告
```bash
[TYPE] pnpm typecheck
[真实输出摘要]

[FMT] git diff --check
[真实输出摘要]

[LINT] pnpm lint
[真实输出摘要]

[UNIT] pnpm test:unit
[真实输出摘要]

[INTEGRATION] pnpm test:integration
[真实输出摘要]

[BUILD] pnpm build
[真实输出摘要]
```

### Schema / Migration 证据
- schemaVersion: [真实旧值→新值]
- v5/旧项目读取: [PASS/FAIL]
- 无 audioClip Dialogue save/reopen: [PASS/FAIL]
- 带 audioClip Dialogue compatibility: [PASS/FAIL]
- shot duplicate: [PASS/FAIL]

### History / dirty 证据
- preview 前后 dirty/revision/history: [真实值]
- batch commit 后: [真实值]
- Undo 后: [真实值]
- Redo 后: [真实值]
- save 后: [真实值]

### 真实 Windows Electron 验收
- 环境: Windows / Electron / 窗口尺寸 / DPI
- 空项目→导入2图→建2角色: [PASS/FAIL]
- 粘贴≥6行→preview→未知角色映射→commit: [PASS/FAIL]
- 第3条 edit→Undo→Redo: [PASS/FAIL]
- save→close→reopen: [PASS/FAIL]
- Project A→B→A draft isolation: [PASS/FAIL]
- layer↔dialogue Inspector selection: [PASS/FAIL]
- 全程 devtools/JSON: [未使用 / 若使用则 FAIL 原因]

### 刀刃表摘要
| 类别 | 覆盖数 | 关键证据 |
|:---|:---:|:---|
| FUNC | X/4 | |
| CONST | X/4 | |
| NEG | X/4 | |
| UX | X/2 | |
| E2E | X/1 | |
| High | X/1 | |

### P4 检查表摘要
| 检查点 | 状态 | 备注 |
|:---|:---:|:---|
| CF | [ ] | |
| RG | [ ] | |
| NG | [ ] | |
| UX | [ ] | |
| E2E | [ ] | |
| High | [ ] | |

### 规模与复杂度说明
- 关键函数/模块: [真实名称]
- 是否存在复杂度例外: [无 / 有]
- 若有: [来源与必要性]

### 债务声明
- DEBT-COMPLEXITY-B27: [无 / 描述]
- DEBT-TEST-B27: [无 / 描述]
- DEBT-DOC-B27: [无 / 描述]
- DEBT-SCOPE-B27: [无 / 描述]
- DEBT-PERF-B27: [无 / 描述]
- DEBT-AUDIO-COMPAT-B27: [无 / 描述]

### 风险与回滚点
- 主要风险: Dialogue persisted contract 演进、跨项目 batch draft 串线、Inspector selection 冲突。
- 回滚方式: `git revert <Day27 commit>`；禁止 reset/force-push 抹历史。

### Day 结论
- `PASS`: 所有强制 gate + migration + 真实 Windows Electron 主路径通过。
- `FAIL`: 任一关键 gate / human acceptance 失败，不开始 Day 28 功能开发。

### 下一步唯一动作
- [只写一条]
```

---

# 【模块6】技术熔断预案（非时间熔断）

| 熔断ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| PREREQ-001 | Day26 未 PASS/merge，或 Timeline 正式 owner 尚不存在 | 立即停止 Day27 实现，只保留调查证据 | 等 Day26 收口 |
| ARCH-001 | Dialogue authoring 必须重写通用 Timeline engine / 全局 selection 架构 / ActionPreset 才能成立 | 暂停实现，提交最小架构问题给主理人 | 拆工单或降级 |
| SCHEMA-001 | `audioClipId` optional 发现会破坏无法局部修复的 export/preview/legacy contract | 停止 UI 扩展，先列 blast radius + 兼容方案 | 返工或拆 schema 前置 |
| QUALITY-001 | typecheck/lint/unit/integration/build 持续失败且不是一次性小问题 | 停止堆 UI，先恢复质量基线 | 返工 |
| COMPLEXITY-001 | 连续 2 次返工仍因必要 migration/selection 状态复杂度无法保持简单 | 允许 `DEBT-COMPLEXITY-B27`，但必须说明来源/清偿点 | 有条件交付，不自动 PASS |
| TEST-001 | 当前测试设施无法自动驱动关键 DOM paste/Inspector 行为 | 用 pure parser + store/integration + 可复现实测替代，并声明 `DEBT-TEST-B27` | 真人证据加重 |
| PERF-001 | 6～100 行粘贴或列表操作出现明显卡顿/重复 mutation 风暴 | 停止视觉扩展，先修 batch mutation/render | 返工 |
| HUMAN-001 | 自动化全绿但 Electron 6 行录入/Undo/Redo/save/reopen/A→B→A 任一 FAIL | Day27 直接 FAIL | 止损 |

## 复杂度熔断条款

- 初始标准：一个最小 DialogueService + 一个 renderer store + 一个 selection store + 几个聚焦 UI/纯函数。
- 不允许第一次实现就建设 script AST、event bus、generic spreadsheet、track registry。
- migration 的复杂度若来自历史 persisted contract，必须写清；不能一句“schema 很复杂”带过。

---

# 【模块7】派单口令（Day 27 定制版）

启动饱和攻击集群，执行 **Panda Stage Day 27：Dialogue Sheet + Speaker/Text Authoring**！

## 技术背景

- 编写工单时 main=`72881b203a0aa9598c7b284d9ee213620cffce59`，但 Day27 执行必须等待 Day26 PASS + merged 后最新稳定 main。
- 当前 Dialogue 正式 schema 强制 `audioClipId`，Project references 又要求其指向真实 audio clip；这与“Day27 只写 speaker/text、不做 TTS”直接冲突。
- Day27 必须最小演进正式 Dialogue schema，使 `audioClipId` 可选；不得 fake audio，不得另造永久 DialogueDraft schema。
- Character 创建自动生成 default VoiceProfile；新 Dialogue 默认使用 speaker 的 default VoiceProfile。
- Shot 正式拥有 `dialogues[]`；EditorProjectStore 已有 ProjectCommand/History/dirty/revision。
- 当前唯一 RightInspector 仍是 layer/background owner；Day27 只扩展其 mode，不创建第二右栏。
- Day26 实际 Timeline owner 必须在开工时重新读取真实 main 后确定。

## 关键约束

- Day26 未 PASS/merge → 不开工。
- speaker/text 是 Day27 用户可编辑字段；不做 TTS、动作、自动时长。
- Batch preview 不改 Project；整批 commit 一次 History command。
- 未知角色禁止 fuzzy/AI 猜，必须显式映射。
- batch draft + Dialogue selection 必须项目/镜头隔离。
- 无 audioClip Dialogue 必须正式 save/reopen；旧 audio-backed Dialogue 必须兼容。
- Timeline / Inspector / ProjectStore 均保持唯一 owner。

## 质量红线

- 10 项地狱红线全部生效。
- 16 项刀刃表全部命令/证据化。
- `audioClipId` blast-radius 必须先 `git grep` 再改。
- 不存在的测试工具写 `N/A + 原因 + 替代证据`。
- 自动化全绿不能替代 Windows Electron 真人 Gate。

## 工单矩阵

- `B-27/45 Engineer`：单 Agent 完成本轮；不并行修改 Project schema / Dialogue store / Timeline / Inspector，避免多个 Agent 同时改共享 persisted contract 和 selection owner。

## 验收铁律

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --check
```

然后必须启动真实 Windows Electron 完成：

> 空项目 → 导入至少 2 张图片 → 创建 2 个角色 → 粘贴 ≥6 行对白 → preview → 处理未知角色 → commit → 修改第3条 → Undo → Redo → 保存 → 关闭 → 重开 → A→B→A 草稿隔离。

## 收卷要求

- 必须生成 `docs/test-receipts/DAY-27.md`。
- 必须记录 schemaVersion、audioClip optional 兼容、blast radius、History/dirty、真人证据。
- 结论只能 PASS / FAIL。
- FAIL 时只处理 Day27 阻塞，不开始 Day28。

Ouroboros 闭环启动，**B-27/45**，执行！ ☝️🐍♾️🔥

---

# 【模块8】通用验证命令库（本工单实际技术栈）

## Git / prerequisite

```bash
git branch --show-current
git rev-parse HEAD
git log --oneline -n 8
git status --short
cat docs/test-receipts/DAY-26.md
git diff --name-only
git diff --stat
git diff --check
```

## Day26 Timeline owner 核对

```bash
find src/renderer -maxdepth 4 -type f | grep -Ei 'timeline|bottomworkspace'
grep -Rni "Timeline\|playhead\|currentTimeMs" src/renderer tests | head -n 200
nl -ba src/renderer/shell/BottomWorkspace.tsx
```

## Dialogue schema / blast radius

```bash
nl -ba src/domain/models/dialogue.ts
nl -ba src/domain/models/shot.ts | sed -n '1,140p'
grep -n "PROJECT_SCHEMA_VERSION" src/domain/constants.ts
grep -n "ProjectDataSchema\|migrateFormalProject\|ProjectV" src/domain/models/project.ts
grep -n "shot.dialogues\|audioClipId" src/domain/validators/projectReferences.ts
git grep -n "audioClipId" -- src tests scripts
git grep -n "dialogues" -- src tests scripts
git grep -n "DialogueSchema\|type Dialogue" -- src tests scripts
```

## Character / History / selection owner

```bash
grep -n "defaultVoiceProfileId\|VoiceProfileSchema" src/domain/models/character.ts
grep -n "voiceProfileId\|defaultVoiceProfileId" src/domain/services/CharacterService.ts
nl -ba src/renderer/stores/EditorProjectStore.ts | sed -n '1,180p'
nl -ba src/renderer/stores/selectionStore.ts | sed -n '1,220p'
nl -ba src/renderer/shell/RightInspector.tsx | sed -n '1,200p'
```

## 范围反查

```bash
git diff --name-only main...HEAD
git diff main...HEAD -- src/renderer/features/actions src/domain/actions
```

第二条默认应为空；若出现 ActionPreset/动作语义改动，触发范围审查。

## TS / JS 质量闸门

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --check
```

## 真人验收

```bash
pnpm dev
```

Windows 测试数据继续优先使用：

```text
D:\PandaStage-Acceptance\
```

大文件不得无说明堆到 C 盘；若不可避免，Day27 receipt 写路径/用途/体积。

---

# 最终 DoD

- [ ] Day26 receipt=PASS 且代码已 merge
- [ ] Day27 开工真实 HEAD 已记录
- [ ] Day26 实际 Timeline owner 已重新锁定
- [ ] `audioClipId` blast radius 已完整搜索并记录
- [ ] 正式 Dialogue schema 支持无 audioClip 文本对白
- [ ] schemaVersion/migration 兼容旧项目
- [ ] 旧 audio-backed Dialogue 仍合法
- [ ] Shot duplicate 正确处理有/无 audioClip Dialogue
- [ ] DialogueService + dialogueStore 接入正式 ProjectCommand/History
- [ ] Dialogue Sheet 在唯一 Timeline owner 内
- [ ] Dialogue CRUD 可用
- [ ] Batch paste 支持 ≥6 行、preview、明确未知角色映射
- [ ] preview 不 dirty；batch commit 一次 History
- [ ] Dialogue selection 项目/镜头安全
- [ ] Dialogue / layer/background Inspector 互斥
- [ ] 唯一 RightInspector 保持不变
- [ ] 不做 TTS / fake audio / ActionPreset / AI parser / 自动导演
- [ ] `pnpm typecheck` PASS
- [ ] `pnpm lint` PASS 或 warning 诚实声明
- [ ] `pnpm test:unit` PASS
- [ ] `pnpm test:integration` PASS
- [ ] `pnpm build` PASS
- [ ] `git diff --check` PASS
- [ ] Windows Electron：空项目→导入2图→创建2角色 PASS
- [ ] Windows Electron：粘贴≥6行→preview→映射→commit PASS
- [ ] Windows Electron：第3条 edit→Undo→Redo PASS
- [ ] Windows Electron：save→close→reopen PASS
- [ ] Windows Electron：Project A→B→A 未提交 draft 不串 PASS
- [ ] Windows Electron：layer↔dialogue Inspector 切换 PASS
- [ ] 16 项刀刃表完成
- [ ] P4 完成
- [ ] `docs/test-receipts/DAY-27.md` 完整
- [ ] debt 透明记录
- [ ] Day27 结论 PASS 后才允许提出 Day28
