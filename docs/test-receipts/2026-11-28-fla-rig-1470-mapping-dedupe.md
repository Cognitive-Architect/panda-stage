# FLA-RIG 1470 回执（跨工程动作映射归并去重）

> 依据 #1470（#1469 F2 收尾：私有副本 ID 归并后的 `motionMappings` 重复键）。
> 同一集成线 `integration/fla-rig-1448-1458`，续 PR #1463，不新建 PR。

## 结论

- **成立并已修**：`585e049`→`b5f1057` 上以最小反例复现 Schema 拒绝，修复后导入成功且映射唯一、确定性。
- 未修改 Schema 唯一性约束、未升格私有动作、未删除已生成的独立动作。
- Schema 仍 v47，无迁移、无新依赖、无新系统；未合并、未关票、未转 Ready。

## 根因

`ProjectResourceImportPlanner` 在 #1469 F2 后把每个私有副本 alias 到其共享 origin 的目标 id，但 `motionMappings` 仍逐条独立 remap、无碰撞处理。源工程中 `(S, A)` 与 `(S, P)` 是两条合法映射（A 为共享动作，P 为其私有副本），导入后都落到同一个 `(targetS, importedA)` 键，触发 `CharacterMotionMappingSchema` 的 “Each source action may have one reusable mapping.”，`buildImportedProjectCandidate` 的 `ProjectSchema.parse` 直接抛错，整个导入失败。

## 修复

`src/domain/services/ProjectResourceImportPlanner.ts`：

- Phase 1 新增 `characterSharedActionIds`：记录每个角色中「本身就是共享动作」的源动作 id（私有副本不计入）。
- `motionMappings` remap 改为先生成带元数据的候选（`preferShared`、原始 `sourceActionId`、原始 `generatedActionId`），再由新增的 `dedupeImportedMotionMappings` 按目标 `sourceCharacterId + sourceActionId` 去重：
  1. **原本直接引用共享 origin 的映射优先**；
  2. 否则取**原始 `sourceActionId` 字典序最小**者（与创作顺序、批次顺序无关）；
  3. 再并列时取原始 `generatedActionId` 字典序最小者。
- 无冲突时保持原顺序与原行为；发生冲突时输出按键排序的确定集合。
- 被归并掉的只是映射行：生成动作仍全部导入并独立可用；私有源动作仍不进入公共动作库（#1469 F2 语义不变）。

## 反例与证据

- 新增测试 `cross-project motion-mapping dedupe after private-copy ID merge (#1470)`（3 条，位于 `tests/unit/character-action-instance-scope.test.ts`）：
  1. `imports a shared and a private mapping as one reusable mapping instead of failing the schema` —— 共享+私有各一条映射；断言仅一条映射、映射到导入的共享动作、生成动作保留且规则 remap 到导入身份、`ProjectSchema.parse` 通过；
  2. `keeps the directly-shared mapping when the authored mapping order is swapped` —— 交换创作顺序后仍由直接共享映射胜出；
  3. `keeps one deterministic mapping when only private copies collapse` —— 仅私有副本归并时按稳定规则保留一条（两次副本 id 顺序与创作顺序相反，胜者仍为 `sourceActionId` 较小者）。
- **修复前证据**：把生产改动 revert 后重跑同一测试文件 → `3 failed / 8 passed`，失败为
  `ZodError ... "Each source action may have one reusable mapping."`（`buildImportedProjectCandidate` 内 `ProjectSchema.parse`）。
- **修复后**：同文件 `11 passed`。

## 验证（集成线，顺序执行）

| Gate | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS（0 error） |
| `pnpm lint` | PASS（0 error） |
| `pnpm test:unit` | **4632 passed / 554 files，0 fail**（较 #1469 后 4629 增加 3 条） |
| `pnpm test:integration` | **304 passed / 7 skipped / 68 files，0 fail** |
| `pnpm build` | PASS |

定向回归：`character-action-instance-scope`（11）、`project-resource-import-bones`（2）、`project-resource-import-planner`（6）、`character-action-instance-copy`（7）、`tests/integration/project-resource-import.test.ts`（6）全部通过。

## 未验证 / 边界

- 未运行 Windows Electron 人工验收、AN2023 A/B、像素对照、性能基准、OWNER UAT（NOT RUN）；自然 CI 由 push 后自动触发。
- 冲突胜出规则是「共享优先 + 源动作 id 字典序」的产品选择；若同一源动作确有多条业务上必需的私有映射，本票不提供保留全部的能力（Schema 限制不变）。
- 未改动 `character-action` 事件、骨树、遮罩、骨骼或 UI；#1459/#1460 未施工。
