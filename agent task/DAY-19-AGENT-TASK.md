# Panda Stage Agent Task — Day 19

> **工单编号**：B-19/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 19  
> **分支建议**：`feat/day-19-character-definitions`  
> **任务类型**：功能开发 + 领域约束 + UI 管理  
> **唯一目标**：把多张图片组织成可复用角色，完成默认表情、表情增删改、张嘴图、默认缩放/翻转与引用安全，并保证保存重开后角色定义完整。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Character Definitions + Expression Management
- **轰炸目标**：实现角色创建、表情映射、默认表情、张嘴图、默认变换、尺寸差异预警和引用校验；VoiceProfile 仅保留数据结构，不做 TTS UI。
- **任务性质**：功能开发 + 数据一致性 + 表单交互
- **输入基线**：Day 16～18 已提供素材导入、元数据、缩略图、素材浏览与引用扫描；ProjectSchema v1 已包含 Character 与 VoiceProfile。
- **输出要求**：角色可创建、可配置、可保存、可重新打开；无效表情与删除风险被阻止；自动化证据和结构化收卷齐全。
- **通用铁律**：
  1. Character 只通过 asset ID 引用项目素材，不复制图片、不保存绝对路径。
  2. 每个角色必须有有效默认表情，默认表情不能悬空。
  3. 删除被角色引用的素材或删除默认表情时必须阻止或先完成替换。
  4. 表情切换保持中心锚点语义，不因图片尺寸差异改变角色逻辑位置。
  5. 本日不实现 TTS、声音克隆、嘴型识别或画布角色放置。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录分支与 HEAD | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| Gate 前置 | M1 Gate PASS，Day 16～18 回执通过 | 回执文件 + 测试结果 | 必须 |
| 当前模型 | Character/VoiceProfile schema、Asset 元数据、ReferenceScanner 已存在 | `git grep -n "CharacterSchema\|VoiceProfile\|ReferenceScanner\|width\|height" -- src shared electron tests` | 必须 |
| 目标范围 | CharacterService、角色表单、表情映射、引用验证、尺寸预警、测试与回执 | `git diff --name-only` | 必须 |
| 目标结果 | 至少 normal/angry 两表情；默认表情有效；嘴图可配置；删除默认表情受保护；尺寸差异预警；保存重开完整 | unit/component/integration/manual evidence | 必须 |
| 技术约束 | 表情名唯一且可读；asset ID 引用；默认 scale/flip 受 schema 约束；尺寸比较基于 Asset metadata | 代码与测试 | 必须 |
| 风险边界 | 不做画布图层；不做时间轴 expression event UI；不做 TTS；不做自动抠图；不做骨骼动画 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + Day 16～18 回归 | 命令输出 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-19.md`，同步 Character/Expression 数据规则 | 文档 diff | 必须 |
| 历史债务 | 如 Character schema 与现有实现不匹配，必须补 migration 并保留旧项目可打开 | migration tests | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 角色是对多张图片素材的可复用映射；表达式切换必须保持中心坐标。 |
| 待确认问题 | 当前 Character schema 字段；嘴图是一张独立 Asset 还是每个表情可选 mouth Asset；尺寸差异提示的比较基准。 |
| 预期输出 | 一个清晰、可验证、不过度设计的角色定义模型和管理 UI。 |
| 停止条件 | 创建、保存、重开、表情切换、默认保护、尺寸预警和引用校验全部通过。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-19/45
- **角色**：Engineer
- **依赖关系**：依赖 Day 16～18 的素材与引用能力。

### 输出交付物

- **预计变更文件**：
  - `src/domain/services/CharacterService.ts`
  - `src/domain/validators/characterReferences.ts`
  - `src/features/characters/CharacterList.tsx`
  - `src/features/characters/CharacterEditor.tsx`
  - `src/features/characters/ExpressionEditor.tsx`
  - `src/stores/characterStore.ts` 或等价 selectors/actions
  - Character/VoiceProfile schema 与 migration 必要文件
  - 对应 unit/component/integration tests
  - `docs/test-receipts/DAY-19.md`
- **核心修改点**：
  - 新建、重命名、删除角色；
  - 添加、重命名、删除 expression；
  - 设置 defaultExpression；
  - 配置 mouthOpenAssetId；
  - 配置 defaultScale 与 defaultFlipX；
  - 表情 asset 引用校验；
  - 删除默认表情前要求选择替代；
  - 默认表情素材删除受 ReferenceScanner 保护；
  - 图片尺寸差异超过 ±30% 时提示；
  - 保存和重开保持角色数据；
  - VoiceProfile 只显示或保存最小数据，不提供 TTS 调用入口。
- **必须包含**：
  - normal/angry 两表情示例；
  - 表情名重复拒绝；
  - 默认表情不能缺失；
  - 删除默认表情被阻止或要求替换；
  - mouthOpenAssetId 可选且必须指向图片素材；
  - 尺寸差异 >30% 触发预警；
  - 切换表情时逻辑中心不变；
  - 保存重开后角色、表情、嘴图、默认变换完整；
  - 被镜头/图层引用的角色删除策略明确。
- **禁止包含**：
  - 保存绝对路径；
  - 表情直接嵌入图片 Base64；
  - 默认表情悬空；
  - 自动缩放素材以掩盖尺寸差异且不提示；
  - TTS、声音克隆、音素嘴型；
  - 画布放置、时间轴编辑。
- **交付证明**：
  - CharacterService 单测；
  - 表单组件测试；
  - schema/migration 回归；
  - 保存重开 integration test；
  - normal↔angry 中心锚点对比；
  - 尺寸差异提示截图/测试。

### 规模与复杂度观察

- 角色领域逻辑放在纯服务/validator，组件只处理输入和反馈。
- expression 映射优先使用显式对象/数组契约，不建立插件系统。
- 删除角色、删除表情和删除素材的引用逻辑必须复用 ReferenceScanner，不得出现三套规则。
- 若嘴图模型存在争议，选择最小可满足 Day 28 基础开合的结构，并记录 `DECISION`，不预建音素系统。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型通过 | `pnpm typecheck` | 返工 |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | 角色、表情、引用、尺寸预警和保存重开测试通过 | unit/component/integration tests | 返工 |
| ARCH | 角色只引用 Asset ID；无 FS/TTS 依赖 | 静态搜索 + schema 检查 | 返工 |
| REAL | 真实图片元数据驱动尺寸预警 | fixture evidence | 返工 |
| DOC | 数据规则和 Day 19 回执同步 | 文档 diff | 返工或债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 可创建角色并配置 normal/angry | component/integration | [ ] |
| FUNC | FUNC-002 | 默认表情可设置并解析 Asset | unit test | [ ] |
| FUNC | FUNC-003 | mouthOpenAssetId 可配置 | schema/component test | [ ] |
| FUNC | FUNC-004 | 保存重开后角色完整 | lifecycle integration | [ ] |
| CONST | CONST-001 | 角色只存 asset ID | JSON 断言 | [ ] |
| CONST | CONST-002 | 表情名唯一 | validator test | [ ] |
| CONST | CONST-003 | 中心锚点语义不变 | renderer/evaluator evidence | [ ] |
| CONST | CONST-004 | VoiceProfile 无 TTS UI/调用 | 静态搜索 | [ ] |
| NEG | NEG-001 | 删除默认表情被阻止或要求替换 | component test | [ ] |
| NEG | NEG-002 | 缺失/错误媒体类型引用被拒绝 | validator test | [ ] |
| NEG | NEG-003 | 尺寸差异 >30% 触发提示 | fixture test | [ ] |
| NEG | NEG-004 | 被使用角色删除受引用保护 | scanner/integration | [ ] |
| UX | UX-001 | 表情缩略图和默认标记清楚 | UI 证据 | [ ] |
| UX | UX-002 | 删除/尺寸风险提示可理解 | UI 证据 | [ ] |
| E2E | E2E-001 | 导入素材→建角色→保存→重开 | 完整流程 | [ ] |
| High | HIGH-001 | 表情切换不导致角色逻辑位置瞬移 | 同坐标渲染对比 | [ ] |

---

## 【模块3-B】地狱红线

1. 角色保存绝对素材路径 → 返工。
2. 默认表情可悬空 → 返工。
3. 删除默认表情无替换保护 → 返工。
4. 表情素材媒体类型不校验 → 返工。
5. 尺寸差异直接自动修正且不提示 → 返工。
6. 切换表情导致逻辑中心变化 → 返工。
7. 角色/素材引用规则重复实现且不一致 → 返工。
8. 顺手做 TTS、声音克隆、骨骼或画布 → 范围失控。
9. 未保存重开验证却声称持久化完成 → 未验证。
10. 门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 角色、表情、嘴图和默认变换是否可用？ | [ ] | CF-B19-001 |
| RG | 素材、引用与项目保存是否保持？ | [ ] | RG-B19-001 |
| NG | 默认删除、错误引用、尺寸差异是否覆盖？ | [ ] | NG-B19-001 |
| UX | 表情和风险提示是否清楚？ | [ ] | UX-B19-001 |
| E2E | 建角色到重开是否完整？ | [ ] | E2E-B19-001 |
| High | 表情切换中心锚点是否稳定？ | [ ] | HIGH-B19-001 |
| 字段完整性 | 回执是否记录素材、角色 JSON 和结果？ | [ ] | DAY-19.md |
| 需求映射 | 是否覆盖 Day 19 全任务？ | [ ] | 刀刃表 |
| 自测执行 | 是否实际配置两表情和嘴图？ | [ ] | 操作证据 |
| 范围边界与债务 | 嘴图/引用限制是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-19/45 完成并提交
- Commit: `feat(characters): manage reusable expressions and mouth assets`
- 分支: `feat/day-19-character-definitions`
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- 角色创建:
- normal/angry:
- 默认表情保护:
- 张嘴图:
- 默认缩放/翻转:
- 尺寸差异预警:
- 保存重开:
- 引用删除保护:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- component/integration tests:
- `pnpm build`:

### 决策与债务
- DECISION-001: [expression 数据结构]
- DECISION-002: [mouth asset 结构]
- DECISION-003: [尺寸比较基准]
- DEBT-MODEL-B19-001:
- DEBT-TEST-B19-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| DATA-B19-001 | 默认表情或引用可悬空 | 收紧 schema/validator | 阻塞 |
| REF-B19-001 | 角色删除与素材引用规则不一致 | 统一 ReferenceScanner | 返工 |
| RENDER-B19-001 | 表情切换导致位置漂移 | 修中心锚点与尺寸处理 | 阻塞 |
| SCOPE-B19-001 | 实现开始扩展到 TTS/骨骼 | 立即回退超范围变更 | 返工 |
| TEST-B19-001 | 无法验证保存重开或锚点 | 不得收卷 | 阻塞 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 19：Character Definitions + Expression Management**！

验收铁律：角色只引用项目 Asset；至少 normal/angry；默认表情有效；嘴图可配置；尺寸差异提示；引用删除安全；保存重开完整；表情切换不瞬移。

Ouroboros 闭环启动，**B-19/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "CharacterService\|defaultExpression\|mouthOpenAssetId\|VoiceProfile" -- src shared electron tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm dev
git diff --stat
```
