# Panda Stage Agent Task — Day 18

> **工单编号**：B-18/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 18  
> **分支建议**：`feat/day-18-asset-library-ui`  
> **任务类型**：功能开发 + UI 状态 + 引用安全  
> **唯一目标**：建立可分类、可浏览、可拖动的素材库 UI，并在删除素材前扫描项目引用，防止用户误删正在使用的素材。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Categorized Asset Library + Reference-Safe Deletion
- **轰炸目标**：实现角色/背景/音频分类、缩略图网格、空状态、导入入口、拖放反馈、素材详情和引用安全删除。
- **任务性质**：功能开发 + 用户体验 + 数据一致性
- **输入基线**：Day 16 已完成素材导入与去重；Day 17 已完成缩略图、图片尺寸与音频时长；M1 Gate PASS。
- **输出要求**：素材可见、可筛选、可拖出、可安全删除；100 个占位素材仍可操作；自动化证据与结构化收卷齐全。
- **通用铁律**：
  1. 被项目引用的素材不得无提示删除。
  2. 删除操作必须先计算引用位置，再由用户做明确决定。
  3. 素材网格必须使用缩略图，不得一次解码 100 张原图。
  4. 删除未引用素材时，项目模型、素材文件和缓存必须保持一致。
  5. 本日只做素材库，不得顺手做角色编辑器或画布放置。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录分支与 HEAD | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| Gate 前置 | M1 Gate PASS，Day 16/17 回执通过 | 回执文件 + 测试结果 | 必须 |
| 当前能力 | Asset 有 mediaKind、relativePath、thumbnail/metadata；项目 schema 有引用关系 | `git grep -n "mediaKind\|thumbnail\|assetId\|backgroundAssetId\|audioAssetId" -- src shared electron tests` | 必须 |
| 目标范围 | 素材库 store/selectors、分类 UI、网格、详情、拖放载荷、引用扫描、删除服务与测试 | `git diff --name-only` | 必须 |
| 目标结果 | 素材分类显示；拖动反馈明确；引用素材阻止或展示引用；未引用素材删除并清缓存；100 项滚动可用 | component/integration/manual evidence | 必须 |
| 技术约束 | UI 不直接读 FS；删除由 Main 服务执行；引用扫描基于当前 Project 快照；拖放只传 asset ID/受控载荷 | 代码与测试 | 必须 |
| 风险边界 | 不创建角色；不创建图层；不实现画布；不实现素材标签系统；不做全文搜索 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + Day 16/17 回归 | 命令输出 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-18.md`；记录删除协议和拖放载荷 | 文档 diff | 必须 |
| 历史债务 | 若引用字段分散，允许建立纯函数 ReferenceScanner；不得在 UI 中手写多份扫描逻辑 | 代码审查 | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 资产已经复制入项目并有缩略图/元数据；项目实体通过 asset ID 引用素材。 |
| 待确认问题 | 当前 UI 布局与 store；拖放库选择；引用位置如何转成人话；100 项是否需要虚拟化。 |
| 预期输出 | 一个最小但可靠的素材浏览与删除入口。 |
| 停止条件 | 分类、拖放、引用阻止、未引用删除和 100 项性能全部验证。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-18/45
- **角色**：Engineer
- **依赖关系**：依赖 Day 16 素材服务和 Day 17 缩略图/元数据。

### 输出交付物

- **预计变更文件**：
  - `src/features/assets/AssetLibrary.tsx`
  - `src/features/assets/AssetGrid.tsx`
  - `src/features/assets/AssetCard.tsx`
  - `src/features/assets/AssetDetails.tsx`
  - `src/features/assets/AssetDropPayload.ts`
  - `src/stores/assetLibraryStore.ts` 或 selectors
  - `src/domain/validators/referenceScanner.ts`
  - `electron/main/services/AssetDeleteService.ts`
  - `electron/main/ipc/handlers/assets.ts`
  - 对应 component/unit/integration tests
  - `docs/test-receipts/DAY-18.md`
- **核心修改点**：
  - 角色/背景/音频分类；
  - 缩略图网格与空状态；
  - 导入按钮和拖放高亮；
  - 选中素材详情：名称、类型、尺寸/时长、路径状态；
  - 拖动载荷只包含 asset ID 和受控类型；
  - ReferenceScanner 返回镜头、图层、角色、对白等引用位置；
  - 引用存在时阻止删除或要求用户先解除引用；
  - 未引用素材删除文件、缓存和 Project Asset 记录；
  - 100 项列表避免全尺寸原图解码。
- **必须包含**：
  - 三类素材分类显示；
  - 无素材空状态；
  - 拖动开始/经过/结束反馈；
  - 被背景、图层、角色表情或音频片段引用的素材测试；
  - 未引用素材删除成功；
  - 删除失败不修改项目模型；
  - 100 个 fixture 滚动与选择仍可用；
  - 缩略图缺失时显示可理解占位并允许重建。
- **禁止包含**：
  - UI 直接删除磁盘文件；
  - 引用存在时强制删除；
  - 用原图替代缩略图批量展示；
  - 把拖放对象序列化为完整 Asset/文件路径；
  - 角色 CRUD、画布 Layer 创建、时间轴逻辑。
- **交付证明**：
  - component 测试；
  - ReferenceScanner 单测；
  - 引用删除失败与未引用删除成功的 integration test；
  - 100 项素材库录屏/性能观察；
  - 删除前后 project.json、文件和 cache 对比。

### 规模与复杂度观察

- 引用扫描应是纯函数，接收 Project 与 asset ID，返回结构化引用列表。
- 删除服务采用“先验证引用→删文件/缓存→更新模型→原子保存”的一致性流程；失败时不得半删。
- 100 项若无需虚拟化即可稳定，保持简单；若滚动明显卡顿，再引入轻量虚拟化并声明依据。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型通过 | `pnpm typecheck` | 返工 |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | component、引用扫描、删除一致性测试通过 | unit/component/integration tests | 返工 |
| ARCH | UI 无 FS；删除走 Main；拖放载荷受控 | 静态搜索 + 类型检查 | 返工 |
| REAL | 真实文件、缓存、模型同步删除 | integration evidence | 返工 |
| DOC | 删除协议与回执同步 | 文档 diff | 返工或债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 三类素材分类显示 | component test | [ ] |
| FUNC | FUNC-002 | 缩略图网格和详情可用 | component/manual | [ ] |
| FUNC | FUNC-003 | 拖放载荷只含 asset ID/类型 | 类型与事件测试 | [ ] |
| FUNC | FUNC-004 | 未引用素材可完整删除 | integration test | [ ] |
| CONST | CONST-001 | UI 不直接访问 FS | 静态搜索 | [ ] |
| CONST | CONST-002 | ReferenceScanner 为纯函数 | 依赖审查 | [ ] |
| CONST | CONST-003 | 删除同步清理 cache | 文件断言 | [ ] |
| CONST | CONST-004 | 网格使用缩略图而非原图 | DOM/network/path 证据 | [ ] |
| NEG | NEG-001 | 被背景引用的素材不可删除 | unit/integration | [ ] |
| NEG | NEG-002 | 被角色/图层/音频引用时列出位置 | scanner tests | [ ] |
| NEG | NEG-003 | 文件删除失败不修改模型 | 故障注入 | [ ] |
| NEG | NEG-004 | 缩略图缺失不导致白屏 | component test | [ ] |
| UX | UX-001 | 空状态和导入入口清楚 | UI 证据 | [ ] |
| UX | UX-002 | 引用提示能说明“哪里在用” | UI 证据 | [ ] |
| E2E | E2E-001 | 导入→浏览→选中→删除未引用素材 | 完整流程 | [ ] |
| High | HIGH-001 | 100 项素材滚动、选择和拖动仍可用 | 实测记录 | [ ] |

---

## 【模块3-B】地狱红线

1. 引用素材无提示被删 → 返工。
2. UI 直接删除磁盘文件 → 返工。
3. 删除文件成功但模型/缓存未同步 → 返工。
4. 删除失败却从 UI 和模型消失 → 返工。
5. 100 项全部加载原图 → 返工。
6. 拖放载荷包含绝对路径或完整文件内容 → 返工。
7. 缩略图缺失导致素材库白屏 → 返工。
8. 顺手实现角色、画布或标签系统 → 范围失控。
9. 未验证引用位置就声称删除安全 → 未验证。
10. 门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 分类、浏览、拖动和删除是否可用？ | [ ] | CF-B18-001 |
| RG | Day 16/17 导入和缓存是否保持？ | [ ] | RG-B18-001 |
| NG | 引用、删除失败、缩略图缺失是否覆盖？ | [ ] | NG-B18-001 |
| UX | 空状态、详情和引用提示是否清楚？ | [ ] | UX-B18-001 |
| E2E | 素材库主路径是否完整？ | [ ] | E2E-B18-001 |
| High | 100 项性能是否单独验证？ | [ ] | HIGH-B18-001 |
| 字段完整性 | 回执是否记录文件、引用、性能和结果？ | [ ] | DAY-18.md |
| 需求映射 | 是否覆盖 Day 18 全项？ | [ ] | 刀刃表 |
| 自测执行 | 是否真实拖动和删除素材？ | [ ] | 操作证据 |
| 范围边界与债务 | 性能/测试限制是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-18/45 完成并提交
- Commit: `feat(assets): add categorized library with reference-safe deletion`
- 分支: `feat/day-18-asset-library-ui`
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- 分类与空状态:
- 缩略图网格:
- 详情面板:
- 拖放载荷:
- 引用扫描:
- 未引用删除:
- 100 项性能:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- component tests:
- integration tests:
- `pnpm build`:

### 决策与债务
- DECISION-001: [引用扫描结构]
- DECISION-002: [删除一致性策略]
- DECISION-003: [网格性能策略]
- DEBT-PERF-B18-001:
- DEBT-TEST-B18-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| DATA-B18-001 | 删除造成文件/模型/cache 不一致 | 停止并重构删除事务 | 阻塞 |
| REF-B18-001 | 无法可靠扫描全部引用 | 暂停删除功能，先补引用契约 | 阻塞 |
| PERF-B18-001 | 100 项素材库明显不可用 | 优先优化解码/渲染策略 | 返工 |
| ARCH-B18-001 | UI 必须直接读写 FS | 修 Main/Preload 边界 | 返工 |
| TEST-B18-001 | 无法做真实删除集成测试 | 不得判删除安全 | 阻塞 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 18：Categorized Asset Library + Reference-Safe Deletion**！

验收铁律：素材分类可见；缩略图网格可用；拖放反馈明确；引用素材不能误删；未引用素材文件、缓存、模型同步删除；100 项仍可操作。

Ouroboros 闭环启动，**B-18/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "AssetLibrary\|ReferenceScanner\|AssetDeleteService\|assetId" -- src electron shared tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm dev
git diff --stat
```
