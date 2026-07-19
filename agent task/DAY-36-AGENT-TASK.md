# Panda Stage Agent Task — Day 36

> **工单编号**：B-36/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 36  
> **分支建议**：`feat/day-36-demo-project`  
> **任务类型**：功能开发 + 首次使用引导 + 许可合规  
> **唯一目标**：提供一个 5～10 秒、素材权利清晰、可一键复制打开的演示项目，并为新用户提供不依赖技术术语的首次使用引导。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：License-Clean Demo Project + First-Run Guide
- **轰炸目标**：建立无版权风险的演示模板、欢迎页入口、只读模板复制流程、空白项目四步引导、许可说明，并验证预览与导出。
- **任务性质**：功能开发 + 内容制作 + 合规验证
- **输入基线**：Gate C 必须 PASS；项目生命周期、素材、角色、镜头、动作、对白、字幕、预览和导出链路可用；Windows 路径行为已验证。
- **输出要求**：一键打开演示 + 模板不可被覆盖 + 素材许可可追溯 + 预览/导出通过 + 16 项刀刃表 + 结构化收卷。
- **通用铁律**：
  1. Gate C 非 PASS 时停止，不得用演示项目掩盖核心导出问题。
  2. 演示素材必须为项目自制、几何生成或许可明确，禁止使用来源不明图片、音乐或字体。
  3. 内置演示必须作为只读模板，首次打开复制到用户目录，禁止直接修改安装资源。
  4. 引导文案使用普通用户语言，不出现 IPC、schema、renderer 等技术词作为操作指令。
  5. 演示项目必须使用正式项目格式和真实功能，禁止硬编码专用播放路径。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD SHA | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| Gate 前置 | `docs/test-receipts/GATE-C.md` 结论为 PASS | 读取 Gate 文档 | 必须 |
| 当前能力 | ProjectService、欢迎页、项目复制、素材/角色/镜头/动作、预览、导出可用 | `git grep -n "ProjectService\|Welcome\|demo\|StageRenderer\|ExportService" -- src electron shared tests` | 必须 |
| 目标范围 | 演示项目资源、复制服务、欢迎页入口、四步引导、许可、测试与回执 | `git diff --name-only` | 必须 |
| 目标结果 | 新安装用户一键复制并打开演示；模板不被直接覆盖；可预览/导出；引导可理解；权利清晰 | unit/component/integration/manual evidence | 必须 |
| 技术约束 | 使用正式 schema；模板复制后生成新 projectId；内部素材使用相对路径；安装资源只读；失败可重试 | 代码与测试 | 必须 |
| 风险边界 | 不做模板商城；不联网下载素材；不做 AI 生成；不新增复杂教学系统；不修改核心导出语义 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + Gate C 回归 | 命令输出 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-36.md` 与演示素材许可说明 | 文档 diff | 必须 |
| 历史债务 | 若项目复制 API 不支持安装资源到用户目录，必须最小扩展并保留原子写入 | integration tests | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 演示项目需覆盖背景、角色、表情、对白、字幕、音频和动作；模板不能被直接覆盖。 |
| 待确认问题 | 模板默认复制目录；欢迎页当前结构；几何素材生成方式；内置字体和音频许可记录格式。 |
| 预期输出 | 一个普通用户安装后即可验证核心能力的最小演示闭环。 |
| 停止条件 | 复制、打开、预览、导出、再次打开、模板保护与许可检查全部验证。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-36/45
- **角色**：Engineer
- **依赖关系**：依赖 Gate C PASS、项目复制与完整预览/导出链路。

### 输出交付物

- **预计变更文件**：
  - `demo-project/` 或 `resources/demo-project/` 下的正式演示模板
  - `demo-project/assets/` 下项目自制/许可明确素材
  - `demo-project/project.json`
  - `demo-project/LICENSES.md`
  - `src/features/onboarding/WelcomePage.tsx`
  - `src/features/onboarding/FirstRunGuide.tsx`
  - `electron/main/services/DemoProjectService.ts`
  - Preload/IPC 必要适配
  - 对应 unit/component/integration tests
  - `docs/test-receipts/DAY-36.md`
- **核心修改点**：
  - 制作 5～10 秒演示项目；
  - 至少包含背景、2 个几何/自制角色、2 种表情、对白、字幕、音频、动作；
  - 欢迎页“打开演示项目”；
  - 首次打开复制模板到用户选择目录；
  - 复制后生成新 projectId 并保持 schema 合法；
  - 内置模板只读，不被 autosave/save 覆盖；
  - 空白项目四步引导：导入素材→建角色→建镜头→预览/导出；
  - 素材、字体、音频许可说明；
  - 演示项目完整预览与导出验证。
- **必须包含**：
  - 演示总时长 5～10 秒；
  - 所有素材来源和许可逐项记录；
  - 模板复制后 projectId 与目标路径更新；
  - 内部引用仍为相对路径；
  - 用户取消目录选择时不产生半成品；
  - 目标目录已存在时提供明确冲突处理；
  - 复制失败不修改模板；
  - 模板资源不可被普通保存覆盖；
  - 演示项目可完整预览和导出；
  - 引导文案不依赖技术术语；
  - 空白项目仍可跳过引导；
  - 重复创建演示副本不会互相覆盖。
- **禁止包含**：
  - 来源不明素材；
  - 直接打开并修改安装目录中的模板；
  - 为演示项目硬编码专属渲染/导出逻辑；
  - 网络下载、登录、云模板或商城；
  - AI 生成、TTS 或声音克隆；
  - 用引导遮罩阻止用户退出。
- **交付证明**：许可清单、模板 hash、复制前后 projectId/路径对照、取消/冲突测试、预览录屏、导出 MP4 与 ffprobe、首次引导截图。

### 规模与复杂度观察

- DemoProjectService 只负责定位、校验和复制模板，不承担项目编辑逻辑。
- 四步引导优先用静态步骤和现有页面锚点，不建立复杂状态编排框架。
- 素材尽量采用简单几何图形和项目自制短音频，降低许可与体积风险。
- 若安装资源只读行为依赖打包器差异，声明 `DEBT-PACKAGE-B36-001` 并在 Day 38 干净环境复验。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型检查通过 | `pnpm typecheck` | 返工 |
| FMT | 格式检查通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | 模板复制、冲突、取消、引导与 schema 测试通过 | unit/component/integration tests | 返工 |
| ARCH | 使用正式项目链路；模板只读；无演示专用假实现 | 静态检查 + tests | 返工 |
| REAL | 演示项目真实预览并导出 | `pnpm dev` + MP4/ffprobe | 返工 |
| DOC | 许可、引导和回执同步 | 文档 diff | 返工或债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 一键复制并打开演示项目 | integration/manual | [ ] |
| FUNC | FUNC-002 | 演示含完整核心元素 | project JSON/preview | [ ] |
| FUNC | FUNC-003 | 四步首次引导可用 | component/manual | [ ] |
| FUNC | FUNC-004 | 演示可完整预览和导出 | MP4/ffprobe | [ ] |
| CONST | CONST-001 | 模板只读且不被保存覆盖 | file protection test | [ ] |
| CONST | CONST-002 | 复制后新 projectId 且引用相对 | JSON assertions | [ ] |
| CONST | CONST-003 | 使用正式 schema/evaluator/renderer | call-site evidence | [ ] |
| CONST | CONST-004 | 素材许可逐项可追溯 | license audit | [ ] |
| NEG | NEG-001 | 取消目录选择不留半成品 | integration test | [ ] |
| NEG | NEG-002 | 目标目录冲突有明确处理 | boundary test | [ ] |
| NEG | NEG-003 | 复制失败不污染模板/目标 | fault injection | [ ] |
| NEG | NEG-004 | 重复创建副本不互相覆盖 | integration test | [ ] |
| UX | UX-001 | 欢迎页入口与四步文案易懂 | user-facing evidence | [ ] |
| UX | UX-002 | 引导可跳过、可重新打开 | component/manual | [ ] |
| E2E | E2E-001 | 新安装态→复制演示→预览→导出 | complete flow | [ ] |
| High | HIGH-001 | 无任何来源不明素材或字体 | rights checklist | [ ] |

---

## 【模块3-B】地狱红线

1. Gate C 非 PASS 仍开工 → 停止。
2. 使用来源不明图片、音乐或字体 → 返工。
3. 直接修改安装目录模板 → 返工。
4. 为演示项目添加专用假渲染/导出路径 → 返工。
5. 复制后仍沿用模板 projectId → 返工。
6. 取消或失败留下半成品目录 → 返工。
7. 引导充满技术术语 → 返工。
8. 顺手实现商城、联网下载或 AI 内容 → 范围失控。
9. 未真实预览/导出演示就声称可用 → 未验证。
10. 质量门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 演示复制、打开、引导、预览和导出是否完整？ | [ ] | CF-B36-001 |
| RG | Gate C 与正式项目链路是否保持？ | [ ] | RG-B36-001 |
| NG | 取消、冲突、复制失败、重复副本是否覆盖？ | [ ] | NG-B36-001 |
| UX | 新用户是否无需技术知识即可操作？ | [ ] | UX-B36-001 |
| E2E | 新安装态完整演示流程是否走通？ | [ ] | E2E-B36-001 |
| High | 素材权利是否逐项验证？ | [ ] | HIGH-B36-001 |
| 字段完整性 | 回执是否记录项目、素材、许可和产物？ | [ ] | DAY-36.md |
| 需求映射 | 是否覆盖 Day 36 全任务？ | [ ] | 刀刃表 |
| 自测执行 | 是否真实复制两个独立副本？ | [ ] | 操作证据 |
| 范围边界与债务 | 打包资源限制是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-36/45 完成并提交
- Commit: `feat(onboarding): add license-clean demo project and first-run guide`
- 分支: `feat/day-36-demo-project`
- Gate C: PASS（证据路径）
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- 演示项目时长/内容:
- 素材与许可:
- 模板复制:
- projectId/相对路径:
- 欢迎页入口:
- 四步引导:
- 取消/冲突/失败:
- 预览:
- 导出与 ffprobe:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- component/integration tests:
- `pnpm build`:
- `pnpm dev`:

### 决策与债务
- DECISION-001: [演示素材来源]
- DECISION-002: [模板复制目录]
- DECISION-003: [引导步骤]
- DEBT-PACKAGE-B36-001:
- DEBT-TEST-B36-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| GATE-B36-001 | Gate C 非 PASS | 停止 M6 | 阻塞 |
| RIGHTS-B36-001 | 任一素材权利不清晰 | 替换素材并重做许可检查 | 阻塞 |
| TEMPLATE-B36-001 | 模板可被用户保存覆盖 | 修复制/只读边界 | 阻塞 |
| E2E-B36-001 | 演示不能真实预览或导出 | 修正式链路，不建专用旁路 | 阻塞 |
| TEST-B36-001 | 无法模拟首次安装态 | 可复现实测 + debt，Day 38 必须复验 | 有条件交付 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 36：License-Clean Demo Project + First-Run Guide**！

验收铁律：Gate C 已 PASS；素材权利清晰；模板只读复制；使用正式项目链路；新用户一键打开；引导不用技术术语；演示可完整预览和导出。

Ouroboros 闭环启动，**B-36/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "DemoProjectService\|FirstRunGuide\|WelcomePage\|LICENSES" -- electron src demo-project resources tests docs
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm dev
git diff --stat
```
