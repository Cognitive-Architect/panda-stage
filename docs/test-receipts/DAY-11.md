# Day 11 — ProjectSchema v1 + Migration Framework

## ✅ 工单 B-11/45 完成并提交

### 提交信息

- Commit: `feat(project): define complete versioned ProjectSchema v1`
- 分支: `feat/day-11-project-schema-v1`
- Gate A: PASS（`docs/test-receipts/GATE-A.md`；机器证据 `docs/evidence/gate-a/results.json`）
- 基线 SHA: `d80bb40da25a3d3fb107adccc88d367cd7373c6a`
- 结果 SHA: 以本回执所在提交为准
- 变更文件:
  - `src/domain/constants.ts`
  - `src/domain/models/`：asset、audio、character/voice、dialogue、layer、project、shot、subtitle、timeline-event
  - `src/domain/validators/projectReferences.ts`
  - `src/domain/migrations/`：版本检测、v0 与旧探针 v1 兼容迁移
  - `demo-project/project-v1.example.json`
  - `tests/unit/models/`、`tests/unit/migrations/`
  - `docs/architecture.md`
  - `docs/test-receipts/DAY-11.md`
  - `tsconfig.json`

### 本轮目标与实际结果

- 目标: 完整 ProjectSchema v1 + migration framework。
- 实际完成:
  - Project、Asset、Character、VoiceProfile、Shot、Layer、Dialogue、AudioClip、SubtitleStyle 全部有严格 Zod schema；
  - TimelineEvent 使用 `type` discriminated union，覆盖 move、scale、opacity、shake、expression、flip、visibility；
  - 固定 1920×1080 / 24 FPS、中心点坐标语义、整数毫秒和非空名称；
  - 集中验证素材、角色、表情、VoiceProfile、字幕、音频、图层和事件引用；
  - 显式版本检测、v0→v1 纯迁移、旧 M0.5 probe v1 兼容迁移；
  - 示例 JSON 真实 parse、round-trip 稳定、未知字段/版本/事件拒绝。
- 未完成/不在范围: 项目磁盘生命周期、UI、自动保存、素材导入、V2/V3 预留结构。

### 关键决策记录

- DECISION-001: 正式模型放在 `src/domain`，与 `src/shared/domain` 的 M0.5 探针模型分离；实体按职责拆文件，统一从 `src/domain/index.ts` 导出。
- DECISION-002: 实体 schema 负责局部字段，`ProjectSchema.superRefine()` 调用 `validateProjectReferences()` 集中处理跨实体引用和精确错误路径。
- DECISION-003: 迁移仅实现实际存在的 v0→v1 与旧 probe v1→正式 v1；迁移为同步纯函数，严格 schema 先验证再映射，不建立过重的多版本注册中心。

### 自动化质量检查报告

- 变更前 `pnpm typecheck`: PASS。
- 变更前 `pnpm lint`: PASS。
- 变更前 `pnpm test:unit`: PASS，14 个文件、97 个测试。
- 变更前 `pnpm build`: PASS。
- 最终 `pnpm typecheck`: PASS。
- 最终 `pnpm lint`: PASS。
- 最终 `pnpm test:unit`: PASS，17 个文件、124 个测试。
- 最终 `pnpm build`: PASS。
- 格式检查: N/A；仓库没有 Prettier 依赖或独立格式脚本，现有 ESLint 与 `git diff --check` 作为格式门禁。
- 合法 fixture: 3 个顶层输入（正式 v1 示例、显式 v0、旧 probe v1）全部通过；正式示例包含 7 种合法 TimelineEvent。
- 非法 fixture: 20 个真实拒绝断言，覆盖固定常量、负数/小数毫秒、end/start 逆序、缺失引用、未知字段、未知事件和未知/缺失版本。

### 关键验证结果

- `ProjectSchema.parse(project-v1.example.json)`: PASS。
- `parse → JSON serialize → parse`: 语义完全相等。
- `detectSchemaVersion`: 仅接受 0/1；2、99 和缺失版本拒绝。
- `migrateProject(v0)`: 保留项目/素材/镜头/图层/移动事件 UUID、名称、时间戳和关键时间。
- `migrateProject(PROBE_PROJECT)`: 旧 probe v1 冲突通过严格兼容分支迁移。
- 未知 `event.type`: discriminated union 拒绝。
- `endMs < startMs`: 错误路径定位到具体 `endMs`。
- domain 静态依赖搜索: 无 Electron、React、`node:fs`、`child_process`。

### 刀刃表摘要

| 类别 | 覆盖数 | 关键证据 |
|---|---:|---|
| FUNC | 4/4 | 示例 parse、实体导出、7 事件参数化、v0 migration |
| CONST | 4/4 | 固定常量、整数毫秒拒绝、中心点文档、静态依赖搜索 |
| NEG | 4/4 | 未知事件、end/start、缺失引用、未来版本测试 |
| UX | 2/2 | Zod issue 精确 path、可读示例 JSON |
| E2E | 1/1 | round-trip 深相等 |
| High | 1/1 | 迁移字段对比、输入不变、纯依赖搜索 |

总计：16/16。

### 债务声明

- DEBT-COMPLEXITY-B11-001: 无。跨引用规则集中但按实体分段，当前复杂度由路径测试覆盖。
- DEBT-MIGRATION-B11-001: M0.5 probe 已使用 `schemaVersion: 1`，与正式 v1 发生历史命名碰撞；当前用两个 strict schema 做显式形状识别和兼容迁移。旧 probe 项目退役后应删除该兼容分支。
- DEBT-TEST-B11-001: 无。

### 风险与回滚点

- 主要风险: schema 过宽或迁移静默丢字段；已通过 strict object、未知事件/字段拒绝、字段保留断言和 round-trip 降低风险。
- 回滚方式: `git revert <Day 11 结果 SHA>`。
