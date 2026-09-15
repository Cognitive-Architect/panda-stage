# Panda Stage｜Phase 1 机械拆分 Section Map v1.0

日期：2026-09-15  
父路线图：[#529｜CSS Decomposition & Visual System Migration Phase 1–4](https://github.com/Cognitive-Architect/panda-stage/issues/529)  
状态：**规划稿；未实施；候选边界尚需完整文件语法预检。**

## 1. 核心结论：8 张实施 Issue，16 个有序分片

**按当前基线，建议用 8 张实施 Issue 完成 Phase 1。**

工单规划编号为 `P1-01`～`P1-08`，不是已经创建的 GitHub Issue 编号；#529 是总路线图，不计入这 8 张。第一张同时完成安全工具与第一批搬迁，最后一张同时完成尾段搬迁与 Phase 1 收口，不再额外拆一张“只做准备”或“只写总结”的工单。

8 张工单并不承诺必须只有 8 个 PR。默认一张工单一个可验收 PR；较大批次允许分为连续的小提交或小 PR，但前一批未验收前，不并行修改同一个样式入口。

Phase 1 的交付目标是：原来的 `styles.css` 变成小型、明确排序的加载目录；原有规则逐段搬进 16 个临时分片。**界面不变、规则顺序不变、样式总量不要求减少。**这不是去重、设计系统接入或性能优化阶段。

人话：把同一本菜谱按原页码装订成几册，不改菜、不换配方，也不偷偷调整下锅顺序。

## 2. 基线与证据范围

| 字段 | 固定值 |
|---|---|
| 仓库 | `Cognitive-Architect/panda-stage` |
| 基线提交 | `35fe7963a50e7bd9be68f1e39d12833c99bb4436` |
| 源文件 | `src/renderer/styles.css`（注意是 styles，带 s） |
| 文件 Git blob | `94c141fcff1df3fd0c309456c9b72f4df8773df0` |
| 原始末行 | L32818，最后一个 `}` |
| 原始 L1–L2 | `tokens.css`、`primitives.css` 的两个 import，继续留在入口 |
| 待搬内容 | L3–L32818，共 32,816 行 |
| 入口接线 | `src/renderer/main.tsx` 继续加载 `./styles.css` |
| 临时目录 | `src/renderer/styles/legacy-slices/` |

**行号约定：所有范围均为上述固定提交中的原始行号，1 起算、包含首尾。**完成前一批后，当前入口文件的行号会缩短，禁止再按它的“当前第 N 行”执行下一批。

本轮已核对：GitHub 当前 main、#529、候选切口周边源码、代表性规则与两个直接读取 CSS 的合同测试；对本地图执行了范围连续性与行数加总校验，确认无缺口、无重叠。

本轮未执行：整个源文件的语法树解析、完整资源路径/所有测试读取点盘点、Vite 构建、Windows Electron 实机检查。**“地图覆盖全部原始行号”不等于“逐条源码已完成审计”，更不等于“这些切口已经可盲切”。**P1-01 必须补齐完整源文件预检，再生成可执行的切割清单。

本次没有修改仓库、创建子 Issue、提交 PR，也没有勾选 #529 的完成状态。

## 3. Section Map：保持原顺序的 16 个候选分片

这些文件名只是临时定位标签，不代表已经完成 Phase 2 的样式归属整理。一个功能出现在多个分片里是允许的；为“归类好看”移动不相邻规则则不允许。文件名不完整描述片内每一条规则，片内全部原文都应保留。

所有目标文件都位于 `src/renderer/styles/legacy-slices/`。

| 分片 | 原始行号（含首尾） | 行数 | 目标文件名 | 所属工单 |
|---|---:|---:|---|---|
| S01 | 3-1,951 | 1,949 | `01-shell-import-review-base.css` | P1-01 |
| S02 | 1,952-3,916 | 1,965 | `02-review-workbench-dialogue.css` | P1-02 |
| S03 | 3,917-6,019 | 2,103 | `03-terminal-launcher-sequence.css` | P1-02 |
| S04 | 6,020-8,038 | 2,019 | `04-launcher-render-workbench.css` | P1-03 |
| S05 | 8,039-9,839 | 1,801 | `05-asset-library-stage-sequence.css` | P1-03 |
| S06 | 9,840-11,883 | 2,044 | `06-canvas-portrait-foundation.css` | P1-04 |
| S07 | 11,884-13,801 | 1,918 | `07-portrait-assets-inspector-start.css` | P1-04 |
| S08 | 13,802-17,819 | 4,018 | `08-inspector-portrait-dialogue.css` | P1-05 |
| S09 | 17,820-19,783 | 1,964 | `09-portrait-timed-landscape-assets.css` | P1-06 |
| S10 | 19,784-21,802 | 2,019 | `10-landscape-characters-tools-start.css` | P1-06 |
| S11 | 21,803-23,799 | 1,997 | `11-tools-inspector-timeline-start.css` | P1-07 |
| S12 | 23,800-25,876 | 2,077 | `12-landscape-task-tray.css` | P1-07 |
| S13 | 25,877-27,997 | 2,121 | `13-timed-render-media-tail.css` | P1-07 |
| S14 | 27,998-29,794 | 1,797 | `14-dialogue-polish-image-picker.css` | P1-08 |
| S15 | 29,795-31,795 | 2,001 | `15-character-identity-workspace-start.css` | P1-08 |
| S16 | 31,796-32,818 | 1,023 | `16-character-settings-final-polish.css` | P1-08 |

合计：16 个分片、32,816 行；加入口保留的 2 行基础 import，覆盖原文件 32,818 行。

S08 暂为 4,018 行，不为了一个任意行数指标继续切碎。当前目标是稳定搬迁，不是比赛谁的文件最短。P1-01 发现更合适的完整块边界时可以调整相邻分片，但必须同步地图、锚点与校验记录。

## 4. 8 张实施 Issue 的安排

下表中的界面名称是建议回归重点，不是重新设计范围。最终最小测试集由 P1-01 的完整读取点与规则范围盘点补足；没有实际入口的历史界面，不为验收而恢复已下线功能。

| 工单 | 本批范围 / 分片 | 行数 | 主要工作 | 重点验收 |
|---|---|---:|---|---|
| P1-01 | L3–L1951 / S01 | 1,949 | 完整预检、安全工具、测试读取适配、第一批搬迁 | 应用启动、全局基础、主壳与第一批规则涉及的界面 |
| P1-02 | L1952–L6019 / S02–S03 | 4,068 | FLA 工作台、穿插的字幕工作区、终态与项目入口序列原样搬迁 | FLA 弹层/滚动/终态、相关字幕工作区和项目入口 |
| P1-03 | L6020–L9839 / S04–S05 | 3,820 | 项目入口、FLA 渲染工作台、素材库至舞台基础序列 | 项目入口、素材列表/详情、预览容器与舞台框架 |
| P1-04 | L9840–L13801 / S06–S07 | 3,962 | 画布、竖屏基础与素材、属性区前段 | 画布适应/实际尺寸、选择/拖入提示、竖屏资源区、属性区 |
| P1-05 | L13802–L17819 / S08 | 4,018 | 属性区后续、竖屏字幕创建与待安排序列 | 属性折叠、字幕创建/待安排、焦点、滚动与溢出 |
| P1-06 | L17820–L21802 / S09–S10 | 3,983 | 竖屏精确字幕编辑、横屏素材与角色工作区序列 | 时间字段、横屏素材、角色空态/列表/详情与表情 |
| P1-07 | L21803–L27997 / S11–S13 | 6,195 | 工具、属性、时间轴任务区与后段条件样式 | 时间轴折叠/展开及字幕任务状态；宽窄窗口；FLA 后段展示 |
| P1-08 | L27998–L32818 / S14–S16 | 4,821 | 最新字幕补丁、图片选择器、角色身份/R8 尾段，整阶段收口 | 字幕批量与操作、选择器状态、角色设置/表情单卡编辑、累计总回归 |

### P1-01｜建立可证明的搬迁方式，并真正搬出第一批

建议标题：`Phase 1 / 01: CSS split preflight, source-reader adaptation and first extraction`

先从固定提交取得完整源文件，读取执行时的仓库 AGENTS 规则，核对文件身份；不能以聊天中的行数或文件名替代原文。

第一张必须完成四件事：

1. **完整预检。**使用能识别 CSS 语法结构的工具检查全部 16 个候选切口。切口必须位于完整顶层规则之间，不能切断注释、选择器列表、声明、条件块或动画块。盘点 import、`url(...)`、字体资源和其他影响移动位置的结构。
2. **建立可自动执行的搬迁与校验。**生成已校验的清单，记录每片的原始范围、首尾锚点、内容校验值、目标路径、顺序与工单归属。搬迁应由脚本完成，不要求人工拷贝几万行。
3. **适配直接受影响的测试读取方式。**查明哪些测试/脚本直接读取旧 `styles.css`，让它们通过统一辅助函数读取等价源文本。保留行为断言；不删测试、不把入口重新填胖。
4. **搬出 S01。**入口仍从原来的两个基础 import 开始，紧接 S01 的 import，后面保留未搬的原始尾段。生成本批检查回执。

验收：完整预检有结果；S01 原样搬出；展开“已搬分片＋剩余尾段”后与固定原文一致；本批相关测试和 `pnpm build:renderer` 通过；Windows 对应界面验收通过。

这张不是“研究完就算完成”：必须包含第一批实际搬迁，但上述动作属于后续实施，本地图没有执行它们。

### P1-02｜搬出 S02–S03

建议标题：`Phase 1 / 02: extract ordered review and terminal-launcher slices`

严格沿原顺序搬 L1952–L6019。FLA、字幕工作区和项目入口规则虽然穿插，也不在本批重排。只复用 P1-01 的工具与测试读取适配，不另造一套迁移框架。

验收重点：FLA 弹层能打开/关闭，滚动归属和终态展示不变；所涉及的字幕工作区和项目入口不变；不修改导入事务、解析器或其他数据逻辑。

### P1-03｜搬出 S04–S05

建议标题：`Phase 1 / 03: extract ordered launcher, render-workbench and asset-stage slices`

搬 L6020–L9839，包括后续项目入口规则、FLA 快照/渲染工作台、素材库至舞台基础的连续序列。看起来重复的项目入口规则也必须保留。

验收重点：项目入口、素材列表/详情、工作台预览布局、舞台边框；资源路径解析不能因为文件下移两层目录而变化。

### P1-04｜搬出 S06–S07

建议标题：`Phase 1 / 04: extract ordered canvas and portrait-resource slices`

搬 L9840–L13801。保留画布及选择/拖入提示规则、竖屏资源区规则和属性区开头，不能借机“修复”已接受的画布布局。

验收重点：适应窗口/实际尺寸、选中反馈、画布拖入提示，竖屏镜头/素材工作区与属性入口。作品内容、字幕输出及素材渲染逻辑不在修改范围。

### P1-05｜搬出 S08

建议标题：`Phase 1 / 05: extract inspector and portrait-dialogue continuation`

搬 L13802–L17819。选择器经常跨多行，必须依据完整规则边界而不是缩进或空行剪切。S08 可暂时保持为一个约 4k 行的文件。

验收重点：属性分区、表单和焦点状态；竖屏字幕创建/待安排相关表面；滚动、底部操作入口和窄屏溢出。不能混入字幕文案或流程优化。

### P1-06｜搬出 S09–S10

建议标题：`Phase 1 / 06: extract portrait timing and landscape asset-character slices`

搬 L17820–L21802。保留竖屏精确编辑、横屏素材和角色区域当前所有样式与覆盖关系。

验收重点：字幕时间输入、横屏素材卡、角色空态/列表/详情和表情。身份逻辑、表情绑定、角色默认设置行为不能改变。

### P1-07｜搬出 S11–S13

建议标题：`Phase 1 / 07: extract tools, timeline tray and conditional tail slices`

搬 L21803–L27997。这是体量最大的一批，按 S11、S12、S13 做三个可追踪的搬迁提交；不是把三片揉成一次难以复核的大编辑。

**尤其保留包住 #441 的完整 `@media (max-width: 900px)`。**在该条件块真正闭合前不能开始下一个分片。本批不判断这个历史范围是否产品上正确，只保证搬迁不改变它。

验收重点：时间轴折叠/展开、创建/待安排/已安排任务表面，属性区、工具区及 FLA 后段展示；在 900px 两侧分别核对相应条件生效情况。不能只在一个宽窗口截图验收。

### P1-08｜搬出 S14–S16，并关闭 Phase 1

建议标题：`Phase 1 / 08: extract final subtitle-picker-character slices and close mechanical split`

搬 L27998–L32818。最后完成入口、全部分片与源码读取辅助函数的一致性核对。近期字幕和角色样式仍保持原状，不因为已到尾段就提前做 Phase 3 的视觉统一。

验收重点：字幕列表操作、批量创建、图片选择器未配置/已配置/展开状态，角色设置与表情单卡编辑；随后合并前七批的检查范围形成一份累计 Windows 验收回执。

最终入口应只有原先 2 个基础 import 加 16 个有序分片 import，以及必要说明/空行，不再包含功能规则正文。回填 #529 的 Phase 1 证据和完成状态；**不同时勾选 Phase 2–4。**

## 5. 加载方式：入口不换，顺序不变

生产接线继续使用 `main.tsx → styles.css`。Phase 1 最终的入口目标是：

```css
@import './styles/tokens.css';
@import './styles/primitives.css';
@import './styles/legacy-slices/01-shell-import-review-base.css';
@import './styles/legacy-slices/02-review-workbench-dialogue.css';
@import './styles/legacy-slices/03-terminal-launcher-sequence.css';
@import './styles/legacy-slices/04-launcher-render-workbench.css';
@import './styles/legacy-slices/05-asset-library-stage-sequence.css';
@import './styles/legacy-slices/06-canvas-portrait-foundation.css';
@import './styles/legacy-slices/07-portrait-assets-inspector-start.css';
@import './styles/legacy-slices/08-inspector-portrait-dialogue.css';
@import './styles/legacy-slices/09-portrait-timed-landscape-assets.css';
@import './styles/legacy-slices/10-landscape-characters-tools-start.css';
@import './styles/legacy-slices/11-tools-inspector-timeline-start.css';
@import './styles/legacy-slices/12-landscape-task-tray.css';
@import './styles/legacy-slices/13-timed-render-media-tail.css';
@import './styles/legacy-slices/14-dialogue-polish-image-picker.css';
@import './styles/legacy-slices/15-character-identity-workspace-start.css';
@import './styles/legacy-slices/16-character-settings-final-polish.css';
```

过程中所有新增 import 都排在普通规则之前。第 n 批完成后，展开已搬分片，再接剩余尾段，顺序仍须与原文件一致。不能把 import 随便插在原文件中间。

不采用“扫描目录，把所有 CSS 文件按文件名排序后拼起来”来代替真实入口顺序；没有被入口加载的文件不能混入验证结果。

## 6. 两个已经看到的具体风险

### 6.1 看似新章节，其实还在旧条件块里面

在原文件 L27800–L28080 的检查片段中，#441 的字幕属性修饰规则仍被前面的 `@media (max-width: 900px)` 包裹；该条件块到 L27996 才结束，#443 从 L27998 开始。

因此 S13 必须保留它的外层条件。不能因为 #441 注释看起来像新章节、缩进也像顶层，就在那里下刀。

人话：菜谱里的“仅限小锅”还没说完，不能把后半段搬出去，变成所有锅都照着做。

证据：[原始条件块及 #441/#443 交界](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/styles.css#L27800-L28010)。

### 6.2 检查员仍在旧柜子找东西

`tests/contract/issue197-timeline-collapse-space.test.ts` 直接读取 `src/renderer/styles.css`，从正文里匹配时间轴高度。拆分后只读入口当然找不到这些规则。

`tests/contract/ui-m1-touch-foundation.test.ts` 还存在 `expect(styles.length).toBeGreaterThan(3000)`，同时检查最前面的两个基础 import。这是对旧文件形态的依赖，不能为满足它而给入口填充几千字符。

建议按测试用途区分：

- 入口接线测试继续读取原始入口，检查基础 import 和有序分片引用。
- 旧正文正则测试使用统一辅助函数：只按实际入口顺序展开 legacy 分片，保留原先两行基础 import；所得文本应等价于旧 monolith。不要额外把 tokens/primitives 的规则插到最前面，悄悄改变正则的首个匹配对象。

人话：告诉检查员“东西搬到旁边几个柜子了”，不是把检查员开除，也不是在旧柜子贴一堆废纸骗他柜子还很满。

这里只盘点和调整直接受拆分影响的读取，不追查无关历史测试债务。

证据：[时间轴源文本测试](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/tests/contract/issue197-timeline-collapse-space.test.ts)、[UI-M1 入口与长度测试](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/tests/contract/ui-m1-touch-foundation.test.ts)。

## 7. 每张 Issue 共用的最小验收合同

### 7.1 源码等价

完整预检通过后才能执行搬迁。每片应保留原声明、选择器、条件、注释及顺序。分片中的额外“这是 S01”的说明应写进地图，不插入受字节校验的原始正文。

按生产入口核对实际顺序和唯一引用，再把“分片＋未搬尾段”还原，与固定基线比较，证明没有漏搬、重复加载或换序。比较 Git 中的规范源文本；Windows 工作区换行处理必须明确记录，不能把格式化差异隐藏在一句“差不多一致”中。

若发现 `url(...)` 等必须调整，先验证原路径与新路径最终指向同一资源，再记录最小例外及等价证据；未做完整路径盘点前不能声称迁移完全无路径风险。

### 7.2 有针对性的测试与构建

执行直接受影响的源文本合同测试及其读取辅助函数测试，再执行仓库已有命令：

```bash
pnpm build:renderer
```

该命令在本基线中对应 `vite build`。这份地图没有实际运行它，也没有凭空指定尚未盘点完成的全量测试名单。

维持正常 required CI，不绕过分支保护；禁止未经授权手动 Full CI、手动重跑 Full CI、`pnpm verify:project` 或全仓历史 verifier 套餐。无关失败记录为外部阻塞，不借本次迁移顺手修复。

### 7.3 Windows Electron 真人验收

确认验收应用确实包含本批提交，不要再次拿旧构建看新代码。使用固定样例和窗口尺寸，对照本批相关界面；关注普通、展开、选中、禁用、键盘焦点和滚动状态，而不只是默认截图。

竖屏或历史状态无法通过现有真实入口触发时，使用已有测试夹具/条件检查并明确记录未实机覆盖，不为验收恢复已经移除的产品模式。

构建成功不代替视觉验收；源码还原一致也不代替 import 接线与资源解析检查。

### 7.4 回执

每批记录：基线/本批提交、已搬分片、入口引用顺序、等价校验结果、实际执行的测试与构建、Windows 验收状态、未覆盖项。全部通过后更新父路线图，并开始下一批。

## 8. 依赖、冻结与止损

```text
P1-01 → P1-02 → P1-03 → P1-04 → P1-05 → P1-06 → P1-07 → P1-08
```

八批都在抽取同一个文件的剩余内容，默认串行。下一批从前一批已验收、已合并的状态继续，不开八个分支同时改入口。

迁移期间，不向原入口或临时 legacy 分片追加无关新功能样式。必要的生产修复另立明确变更，更新基线、地图与等价例外；不得把新设计藏进“机械拆分”。

出现以下情况，先停当前批次并修正或回退：

- 切口落在未闭合结构内，或源文件 blob 与规划基线不一致且尚未重新对齐。
- 需要修改选择器、组件 DOM、token 数值、字体颜色、布局尺寸才能让搬迁“看起来过关”。
- 原文还原不一致、资源解析改变、引用重复/漏载，或界面出现本次引入的回归。
- 为继续推进而删行为断言、填胖入口、放宽 required CI 或启动无关全量验证。

八张是基于当前范围的实施规划，不是强行忽略风险的硬上限。若完整预检发现必须改变范围的实质阻塞，先更新 #529 与本地图，说明原因；不能悄悄扩张成全仓重写。

## 9. Phase 1 完成定义与本轮不做

Phase 1 完成时：入口小而稳定、16 个候选分片经校验后落地、顺序/条件/资源目标保持、直接受影响的读取测试已适配、renderer 构建通过、Windows 累计验收有回执、#529 有对应证据。

以下留给后续阶段：按功能真正归并规则、减少跨文件覆盖、去重/删除死样式、收口角色/素材选择器公共视觉合同、接入统一组件与设计规范。深蓝主题 #515、R5 纯外观追加优化、业务状态重构都不属于 Phase 1。

因此，Phase 1 结束不应宣传为“样式债务清零”或“整个设计系统已经统一”。它解决的是巨型文件难以定位和安全搬迁的问题，为 Phase 2–4 建立可继续工作的基础。

## 附录 A｜每片起点定位锚点

这些锚点用于人工复核与清单生成，不是独立的安全证明。所有候选切口都需要 P1-01 的完整文件语法结构检查。片段内同名 selector 可能重复，执行脚本应结合基线、范围、首尾锚点和内容校验值定位。

### S01 / P1-01

[L3-L1951](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/styles.css#L3-L1951)

```css
:root { (first rule at original L4; preserve blank L3)
```

### S02 / P1-02

[L1952-L3916](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/styles.css#L1952-L3916)

```css
/* Issue #255: the FLA review owns one deliberate top-level foreground layer.
```

### S03 / P1-02

[L3917-L6019](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/styles.css#L3917-L6019)

```css
/* Issue #405: Stage G terminal presentation.
```

### S04 / P1-03

[L6020-L8038](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/styles.css#L6020-L8038)

```css
/* Issue #410
```

### S05 / P1-03

[L8039-L9839](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/styles.css#L8039-L9839)

```css
.asset-library {
```

### S06 / P1-04

[L9840-L11883](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/styles.css#L9840-L11883)

```css
/* Issue #436 LM-004: drop .project-canvas inner panel chrome
```

### S07 / P1-04

[L11884-L13801](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/styles.css#L11884-L13801)

```css
/* Issue #328: the portrait Assets page is a single top-level workspace.
```

### S08 / P1-05

[L13802-L17819](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/styles.css#L13802-L17819)

```css
.editor-layout[data-shell-mode='landscape']
  .right-inspector-drawer
  .right-inspector-section
  .layer-transform-panel-heading,
```

### S09 / P1-06

[L17820-L19783](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/styles.css#L17820-L19783)

```css
/* Issue #353: State C is one flat precision editor.
```

### S10 / P1-06

[L19784-L21802](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/styles.css#L19784-L21802)

```css
/* Issue #364: the Cloud Touch landscape Character drawer is a visual
```

### S11 / P1-07

[L21803-L23799](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/styles.css#L21803-L23799)

```css
/* Issue #460: the right-side
```

### S12 / P1-07

[L23800-L25876](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/styles.css#L23800-L25876)

```css
.editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape']
  .bottom-workspace[data-resizable='true']
  .timeline-task-tray
  .dialogue-sheet-heading {
```

### S13 / P1-07

[L25877-L27997](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/styles.css#L25877-L27997)

```css
/* Issue #384: the Timed Task Tray is the subtitle editing mother surface.
```

### S14 / P1-08

[L27998-L29794](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/styles.css#L27998-L29794)

```css
/* Issue #443 Correction 01: pending subtitle list stays as ONE continuous
```

### S15 / P1-08

[L29795-L31795](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/styles.css#L29795-L31795)

```css
/* Issue #495: Character identity is an avatar-assisted Character choice.
```

### S16 / P1-08

[L31796-L32818](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/styles.css#L31796-L32818)

```css
.editor-layout[data-shell-mode='landscape']
  .resource-activity-dock-landscape[data-active-activity='characters']
  .character-manager[data-character-presentation='landscape']
  .character-settings-workspace > .character-settings-section {
```


## 附录 B｜源证据入口

- [父路线图 #529](https://github.com/Cognitive-Architect/panda-stage/issues/529)
- [固定提交](https://github.com/Cognitive-Architect/panda-stage/commit/35fe7963a50e7bd9be68f1e39d12833c99bb4436)
- [完整 styles.css 原文](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/styles.css)
- [main.tsx 接线](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/src/renderer/main.tsx)
- [package.json 构建命令](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/package.json#L75-L95)
- [时间轴 source contract](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/tests/contract/issue197-timeline-collapse-space.test.ts)
- [UI-M1 source contract](https://github.com/Cognitive-Architect/panda-stage/blob/35fe7963a50e7bd9be68f1e39d12833c99bb4436/tests/contract/ui-m1-touch-foundation.test.ts)

## AUTO SAVE v1.1

```text
=== AUTO SAVE v1.1 ===
时间：2026-09-15
阶段：规划 / Phase 1 Section Map
本次变化 Delta：将 #529 Phase 1 展开为 8 张实施工单、16 个原顺序候选分片。
做了什么（结果）：核对固定 main、切口周边与代表性测试；生成 Markdown 与 JSON 地图；范围连续与行数加总校验通过。
当前状态（一句话）：规划已交付，尚未创建子 Issue 或修改代码；候选切口等待完整文件预检。
下一步（唯一可执行）：基于本地图创建 P1-01，包含完整预检、直接受影响测试读取适配和 S01 首批机械搬迁。
止损条件：切口结构不完整、基线未对齐、原文还原失败或出现视觉回归，即停当前批并修正/回退。
反话闸门：拆文件不等于消除全局耦合；需要顺序/内容/资源证据以及 Windows 实机回执，才算搬迁完成。
风险 / 未验证：未做全文件语法解析、完整 URL/测试读取点盘点、构建或 Windows 验收。
置信度（0-5）：4（工单规划与范围加总）；执行安全需由 P1-01 预检确认。
=================
```