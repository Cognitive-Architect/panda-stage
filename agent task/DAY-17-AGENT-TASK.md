# Panda Stage Agent Task — Day 17

> **工单编号**：B-17/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 17  
> **分支建议**：`feat/day-17-asset-metadata`  
> **任务类型**：功能开发 + 缓存策略 + 损坏文件容错  
> **唯一目标**：为项目内图片生成尺寸与缩略图缓存，为音频读取时长，并把可信元数据写回 Asset；损坏文件不得拖垮应用。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Asset Metadata Extraction + Thumbnail Cache
- **轰炸目标**：在 Main Process 建立图片/音频元数据提取与缩略图缓存服务，完成缓存命名、失效、重建、损坏文件和超大图片处理。
- **任务性质**：功能开发 + 性能边界 + 容错测试
- **输入基线**：Day 16 已将合法 PNG/JPG/MP3/WAV 复制进项目 `assets/`，Asset 具有稳定 ID、hash、relativePath 与 mediaKind。
- **输出要求**：图片尺寸、缩略图、音频时长、缓存重建、损坏文件错误与自动化证据齐全。
- **通用铁律**：
  1. 元数据只能从项目内副本读取，不依赖外部原文件。
  2. 缩略图属于可删除缓存，不得成为项目打开的硬依赖。
  3. 损坏文件返回结构化错误，不得导致白屏、卡死或 project.json 损坏。
  4. 缓存命名必须与素材 hash/版本绑定，避免同名覆盖和陈旧缩略图。
  5. 不允许在素材网格中解码完整原图来假装有缩略图。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录分支和 HEAD | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| Gate 前置 | M1 Gate PASS，Day 16 导入测试通过 | M1/Day16 回执 | 必须 |
| 当前能力 | Asset 可定位项目内文件，项目有 `cache/` 目录 | `git grep -n "relativePath\|mediaKind\|cache" -- electron src shared tests` | 必须 |
| 目标范围 | MetadataService、ThumbnailService、缓存路径、Asset schema 最小扩展、IPC、测试与文档 | `git diff --name-only` | 必须 |
| 目标结果 | 图片宽高与缩略图可用；音频时长可用；损坏文件不阻塞；cache 删除后可重建；外部源文件删除不影响 | unit/integration/manual evidence | 必须 |
| 技术约束 | Main 读取媒体；元数据单位明确；durationMs 为整数毫秒；缩略图固定上限；缓存写入可失败降级 | 代码与测试 | 必须 |
| 风险边界 | 不做素材库网格；不做引用删除；不做音频波形；不做视频支持；不改原始素材 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + Day 16 回归 | 实际输出摘要 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-17.md`，记录缓存策略和依赖许可 | 文档 diff | 必须 |
| 历史债务 | 新增媒体解析依赖必须记录版本、许可证、打包影响 | package diff + 文档 | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 图片需宽高与缩略图，音频需时长；cache 可删可重建。 |
| 待确认问题 | 采用何种图片处理库；音频时长读取复用 FFprobe 还是轻量解析；超大图片阈值；缓存尺寸。 |
| 预期输出 | 可重复、可失效、可重建的元数据和缩略图管线。 |
| 停止条件 | 正常、损坏、超大、缓存删除和源文件删除五类路径均验证。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-17/45
- **角色**：Engineer
- **依赖关系**：依赖 Day 16 项目内素材导入。

### 输出交付物

- **预计变更文件**：
  - `electron/main/services/AssetMetadataService.ts`
  - `electron/main/services/ThumbnailService.ts`
  - `electron/main/services/CacheService.ts`
  - `electron/main/ipc/handlers/assets.ts`
  - `shared/asset-metadata-types.ts`
  - Asset schema/migration 必要文件
  - `tests/unit/assets/metadata*.test.ts`
  - `tests/integration/asset-metadata.test.ts`
  - `tests/fixtures/assets/`
  - `docs/test-receipts/DAY-17.md`
- **核心修改点**：
  - 图片实际读取并提取 width/height；
  - 生成最大边受限的缩略图；
  - 音频 durationMs 提取；
  - cache key 包含 asset hash 和 thumbnail schema version；
  - 缓存命中、失效与重建；
  - 超大图片警告而非无提示硬吃内存；
  - 损坏文件错误与 Asset 状态；
  - 元数据写入后通过 ProjectSchema 保存。
- **必须包含**：
  - PNG/JPG 尺寸测试；
  - MP3/WAV 时长测试；
  - 缩略图尺寸上限与透明度/方向处理说明；
  - 损坏图片和损坏音频测试；
  - cache 删除后重建；
  - 原始外部文件删除后仍可读取项目副本；
  - 超大图片预警；
  - 缓存失败时项目仍可打开。
- **禁止包含**：
  - 修改原始素材；
  - 把缩略图写进 project.json；
  - 缓存不存在就阻止项目打开；
  - Renderer 直接读取本地媒体元数据；
  - 生成音频波形、素材库网格或角色 UI。
- **交付证明**：图片尺寸、缩略图文件、音频 durationMs、损坏 fixture、cache 重建和内存/耗时观察。

### 规模与复杂度观察

- 元数据提取与缓存管理职责分离；IPC handler 不承担媒体解析。
- 依赖 native module 时必须验证 Electron 打包兼容性；若只在开发环境可用，不能收卷。
- 超大图片处理应受尺寸/内存约束，若无法稳定处理则声明 `DEBT-PERF-B17-001` 并明确拒绝阈值。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型通过 | `pnpm typecheck` | 返工 |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | 元数据、缓存、损坏文件与重建测试通过 | unit + integration tests | 返工 |
| ARCH | Main 负责媒体读取；cache 非项目真相 | 静态搜索 + schema 检查 | 返工 |
| REAL | 真实缩略图和真实时长，不是假固定值 | fixture + 文件/ffprobe 对照 | 返工 |
| DOC | 缓存策略和依赖许可同步 | 文档 diff | 返工或债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | PNG/JPG 宽高正确 | fixture tests | [ ] |
| FUNC | FUNC-002 | MP3/WAV durationMs 正确 | fixture/ffprobe 对照 | [ ] |
| FUNC | FUNC-003 | 缩略图生成且尺寸受限 | 文件与尺寸检查 | [ ] |
| FUNC | FUNC-004 | cache 删除后可重建 | integration test | [ ] |
| CONST | CONST-001 | durationMs 为非负整数 | schema/test | [ ] |
| CONST | CONST-002 | cache key 绑定 asset hash | 代码与路径断言 | [ ] |
| CONST | CONST-003 | 缩略图不写入 project.json | JSON 断言 | [ ] |
| CONST | CONST-004 | 原素材不被修改 | 前后 hash | [ ] |
| NEG | NEG-001 | 损坏图片返回可读错误 | fixture test | [ ] |
| NEG | NEG-002 | 损坏音频返回可读错误 | fixture test | [ ] |
| NEG | NEG-003 | cache 写入失败可降级 | 故障注入 | [ ] |
| NEG | NEG-004 | 超大图片触发预警或安全拒绝 | 边界 fixture | [ ] |
| UX | UX-001 | 错误指出具体素材 | 错误对象/UI 证据 | [ ] |
| UX | UX-002 | 元数据处理状态可理解 | 状态证据 | [ ] |
| E2E | E2E-001 | 导入→元数据→保存→重开 | 完整流程 | [ ] |
| High | HIGH-001 | 删除外部源和 cache 后项目仍可恢复元数据 | 实测 | [ ] |

---

## 【模块3-B】地狱红线

1. 元数据读取依赖外部原路径 → 返工。
2. 缩略图成为打开项目的硬依赖 → 返工。
3. 把固定时长或固定尺寸当真实结果 → 返工。
4. 损坏文件导致主流程卡死 → 返工。
5. 修改原始素材 → 返工。
6. 缩略图写入 project.json → 返工。
7. 每次展示都解码完整原图 → 返工。
8. 顺手实现素材库、波形或角色 UI → 范围失控。
9. 新依赖许可证/打包影响未申报 → 返工。
10. 门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 图片尺寸、缩略图和音频时长是否准确？ | [ ] | CF-B17-001 |
| RG | Day 16 导入和项目保存是否保持？ | [ ] | RG-B17-001 |
| NG | 损坏、超大和 cache 失败是否覆盖？ | [ ] | NG-B17-001 |
| UX | 素材错误是否可定位？ | [ ] | UX-B17-001 |
| E2E | 导入到重开是否走通？ | [ ] | E2E-B17-001 |
| High | cache 和外部源删除后是否仍可靠？ | [ ] | HIGH-B17-001 |
| 字段完整性 | 回执是否记录依赖、文件、尺寸和时长？ | [ ] | DAY-17.md |
| 需求映射 | 是否覆盖 Day 17 全项？ | [ ] | 刀刃表 |
| 自测执行 | 是否实际打开缩略图并核对音频？ | [ ] | 手动证据 |
| 范围边界与债务 | 性能/打包限制是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-17/45 完成并提交
- Commit: `feat(assets): generate thumbnails and media metadata safely`
- 分支: `feat/day-17-asset-metadata`
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- 图片尺寸:
- 缩略图缓存:
- 音频时长:
- 损坏文件:
- 超大图片:
- cache 删除重建:
- 外部源删除回归:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- integration tests:
- `pnpm build`:

### 决策与债务
- DECISION-001: [图片处理依赖]
- DECISION-002: [音频时长提取方式]
- DECISION-003: [cache key 与失效策略]
- DEBT-PERF-B17-001:
- DEBT-PACKAGING-B17-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| DATA-B17-001 | 元数据写入破坏项目 schema | 停止并修 schema/migration | 阻塞 |
| PERF-B17-001 | 超大图片导致内存异常 | 增加阈值与受控处理 | 返工 |
| PACKAGE-B17-001 | 依赖无法随 Electron 打包 | 更换方案或明确阻塞 | 阻塞 |
| CACHE-B17-001 | cache 丢失导致项目打不开 | 降级为重建策略 | 返工 |
| TEST-B17-001 | 无合法损坏 fixture/真实媒体对照 | 补 fixture，不得假测 | 阻塞 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 17：Asset Metadata Extraction + Thumbnail Cache**！

验收铁律：真实读取图片宽高和音频时长；缩略图可删可重建；损坏文件不拖垮应用；原素材不修改；cache 不进入项目真相。

Ouroboros 闭环启动，**B-17/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "AssetMetadataService\|ThumbnailService\|durationMs\|thumbnail" -- electron src shared tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --stat
```
