# Panda Stage DESIGN.md

> **Version：v2.0 · Project ReShell / UI 2.0**
>
> **更新：2026-11-27（Asia/Shanghai）**
>
> **状态：已选定设计方向的正式迁移基线；生产接线与 Windows Electron 验收按迁移任务完成。**
>
> **方向：B 的专业工作台骨架 + C 的中性、松弛视觉 + A 的对象直接操作。**
>
> **源码基准：`prototype/reshell-ui2` @ `b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6`，包含 #1390 融合 D 与 #1392 布局补修。**

本文是可替换仓库根目录旧版 `DESIGN.md` 的完整设计合同。它将 Owner 已确认的 Q1–Q48、D 实际组件和样式、布局补修结果，以及旧规范仍有效的产品与工程原则合为一套后续施工标准。源码链接固定到本次编制所读取的提交，避免分支继续更新后依据漂移。[原型基准][D-README] · [融合工单][ISSUE-D] · [布局补修][ISSUE-FIX]

## 1. 适用范围、权威与证据

### 1.1 这份规范负责什么

Panda Stage 是面向个人创作者的 Windows Electron 短篇 2D 剪纸动画编辑器。新版以桌面鼠标、键盘和可调整工作台为目标，帮助用户完成素材组织、角色与镜头编辑、动画编排和输出。

本文负责整体布局、视觉角色、组件与交互合同、信息密度、复用边界及迁移验收口径。后续迁移先遵循同一个成品方向，再分区域接线；各工单不另起审美方案。

| 需要判断的问题 | 依据 |
| --- | --- |
| 用户已经选定什么体验 | 本文记录的 Owner 决策与后续明确指示。 |
| 本次允许改哪些文件、行为，何时交付 | 当前任务、Issue / PR 的明确范围；本文不自动扩大施工范围。 |
| 新版应达到什么 UI / UX 行为 | 本文的设计合同；原型未实现部分在第 12 节列明。 |
| D 在基准提交中实际做了什么 | 固定提交下的组件、CSS、共享交互源码。 |
| 正式业务状态、项目格式、保存与安全由谁负责 | 当前 `AGENTS.md`、生产架构与 domain / IPC 合同。 |
| 迁移后精确样式值由谁维护 | 生产语义 tokens、公共控件与对应功能样式；本文保留角色和基准，不建立第二套运行时值。 |

引用的生产规范基准为 main `804bb05f1e6db8dbde402ba2a2fec949aebe9d6d`。本轮读取了其 DESIGN、AGENTS 和共享样式；工程所有权以现行仓库合同继承，并非宣布完成全部生产代码审计。[现行工程合同][MAIN-AGENTS] · [旧设计合同][OLD-DESIGN] · [生产 tokens][MAIN-TOKENS]

### 1.2 证据状态

| 项目 | 本次可以确认的状态 |
| --- | --- |
| 融合方向、适中紧凑、信息最小化、可调整工作台 | Owner 已逐项确认；现已明确要求基于 D 编制 v2.0。 |
| 时间轴调整、整块面板拖动、一键恢复默认布局 | Owner 已在实际体验中明确反馈可用。 |
| D 的颜色、尺寸、组件引用、布局保存与恢复机制 | 本次已核对固定提交源码。 |
| 构建、Chrome 1440×900 / 1280×768、布局恢复与刷新记忆 | 施工 README 记录已验证；本轮未重新运行，不改写为本轮独立实测。 |
| Owner 对刷新记忆的体验 | 当前反馈为“刷新一下没啥感觉”；不单独标为人工验收通过。 |
| Windows Electron、真实项目、真实导出与失败恢复 | 留到对应生产迁移任务验证；浏览器原型不是这些能力的完成回执。 |

D 已具备足够的成品依据来固化设计方向。局部尚未接线的行为随对应区域迁移处理，不因此重新进行 A/B/C 选型，也不新增一套全局验收门禁。[施工记录][D-README]

### 1.3 对 v0.1 的明确替代

- 旧竹青 / 绿色主强调体系由 D 的中性深灰与青蓝基线替代；颜色可通过统一语义值继续调整。
- 正式放弃移动端与 Cloud Touch 横竖屏专用适配。桌面窗口缩放、窄窗口可用性和共享业务继续保留。
- 旧版“此次不做整体重设计”的阶段限制不再否定已确认的 ReShell；实际实现仍按授权切片进行。
- 保留画布优先、任务优先、渐进披露、单一信息 owner、共享外观 / 本地几何、可访问性与安全原则。
- 旧 UI、移动专用布局、被替代 CSS / tokens / 文档在新版对应范围迁移并验收后清理；不因发布本文立即批量删除，也不长期维护两套平行正式 UI。

## 2. 产品方向与设计原则

### 2.1 已选定的整体体验

**专业工作台、现代视觉、直接操作、适中紧凑。** 画布承担创作中心，时间轴提供动画编排深度，资源与属性能随任务调整空间。界面应能承载专业功能，同时让用户感到轻松、有秩序。

| 继承来源 | 保留的价值 | 在 D 中的落点 |
| --- | --- | --- |
| B · 工业专业派 | 独立面板、完整工作台、专业时间轴 | Dockview、全宽底部时间轴、图层管理、属性与曲线。 |
| C · 现代效率派 | 中性深色、素材浏览、片段表达、清晰主操作 | 轻边界与微圆角、资源网格 / 列表、内容类型色、顶部镜头切换与导出。 |
| A · 现代创作派 | 对象直接操作、就近工具 | 画布选中对象悬浮工具栏、数值拖动和曲线交互。 |

D 是胜出方向的一次集中融合。A/B/C 保留在实验目录用于对照，黄色方案切换器不属于产品界面。

### 2.2 最小任务集合

- 创作者能同时看到画布、资源、图层、属性和时间轴，开始创作前不必先抢救默认布局。
- 创作者能在素材、图层、画布与时间轴之间选中和调整同一对象，状态保持一致。
- 创作者能通过直接拖动快速调整，也能通过数值精确输入；一次连续手势对应一次撤销。
- 创作者能按当前任务调整面板，并随时恢复默认工作台，工程内容与编辑进度保持完整。

### 2.3 持续适用的红线

1. **任务驱动控件。** 不把 schema 每个字段机械翻译为输入框。视觉内容优先缩略图、直接操作、时间轴；需要精度时使用数值字段。
2. **空间表达层级。** 用对齐、间距、明暗、标题和必要分隔组织信息，避免无语义的卡片套娃、密集描边和阴影。
3. **最小必要文字。** 默认不加 slogan、教学段落、次要标签、重复说明。必要补充优先 info 图标 + Tooltip；重要错误、阻塞和确认继续明确展示。
4. **一个事实一个主要位置。** 选中、结果、保存状态不在相邻区域反复宣告；界面已经显示结果时不再追加成功提示。
5. **创作界面使用创作者语言。** 内部 ID、schema 字段、调试 flag、实现路径和工程状态只在真实诊断需要时出现。
6. **专业感来自可操作的结构。** 不靠缩小一切、减少能力或堆常驻说明获得“简洁”；高频常驻，低频渐进披露。

以上是行为原则，不机械禁止表单、卡片、必要说明或确认。控件和文案应服务用户眼前的任务。[继承依据][OLD-DESIGN]

## 3. 默认工作台与空间分配

### 3.1 六个面板与默认位置

| 面板 | D 源码 ID | 默认位置与职责 |
| --- | --- | --- |
| 资源库 | `assets` | 左上；分类、筛选、素材网格 / 列表、放入镜头或应用动作。 |
| 图层 | `layers` | 左下；选中、显隐、锁定、排序；父级与景深按需展示。 |
| 画布 | `stage` | 上部中央；构图、对象直接操作与就近工具。 |
| 属性检查器 | `props` | 右侧；随选中对象变化，高频属性先出现。 |
| 缓动曲线 | `curve` | 默认与属性同组标签；可拖出独立停靠面板。 |
| 时间轴 | `timeline` | 底部全宽；轨道、片段、关键帧、相机、音频及现有产品动画语义。 |

顶栏独立承载菜单、镜头切换、全局播控与导出。六个面板是当前 D 的工作台基线，不是正式产品能力的上限；已有项目中心、角色 / 表情 / 口型编辑、导入与恢复等入口按原业务继续接入。[布局实现][D-LAYOUT]

### 3.2 从实际代码提取的默认尺寸

以 Dockview **实际可分配区域**为基准；不直接拿浏览器总高度乘比例。

| 项目 | 源码默认值 / 计算 | 设计解释 |
| --- | --- | --- |
| 时间轴高度 | `round(dockHeight × 0.32)` | 初始约 32%，上部约 68%；用户可自由调整。 |
| 左侧宽度 | `260px` | 初始宽度，保护中央画布；不是固定宽度要求。 |
| 右侧宽度 | `275px` | 属性初始宽度，允许调整。 |
| 左下图层高度 | `round((dockHeight − timelineHeight) × 0.40)` | 左栏初始资源约 60%、图层约 40%，边框与标签占用由实际布局计算。 |
| 工作台外侧留白 | `5px` | 提供轻间隔，避免大面积网页式卡片留白。 |
| 面板标签条 | `32px` | 控制面板标签与操作入口的共同密度。 |

D 先分出底部时间轴，再切上部左右栏；这一顺序形成全宽时间轴。不要根据相似截图重新拼一套固定 CSS 网格，也不要在每次尺寸变化时重置默认比例。[`defaultLayout`][D-LAYOUT] · [D 样式][D-CSS]

### 3.3 可用空间合同

- 首次打开和恢复默认后，资源库要看到实际素材、图层要可操作、画布要有正常创作面积、时间轴要正常展开。
- 轨道增多或子轨展开时，在时间轴内部滚动；不让内容高度自动吞掉画布。
- 素材、图层、检查器各自承担内容滚动。嵌套 flex 容器使用合适的收缩和 overflow 规则，避免 min-content 把兄弟面板挤没。
- 时间轴标尺固定在滚动区域顶部，名称列固定在左侧；轨道内容、标尺、播放头使用同一时间坐标，不各滚各的。
- 用户主动拖大时间轴是正常需求；68:32 仅用于默认布局，不反复覆盖用户操作。
- D 的 `minimumHeight=34 / 100` 是折叠或布局下限参数，不能作为“面板已可用”的验收标准。当前没有由 D 明确设置的统一最小宽度。

这些规则直接吸收 #1392 的修复经验，重点是用户能同时工作，不按截图绝对像素设硬门槛。[补修要求][ISSUE-FIX] · [滚动样式][D-CSS]

### 3.4 拖动、停靠、折叠与恢复

优先复用 Dockview 的拖标签、分割调整、重新停靠、标签合组、关闭与窗口菜单重开。默认同组的曲线可独立停靠；本阶段不扩展独立 OS 浮窗、多显示器或新的布局引擎。

当前 D 开启 `proportionalLayout`、禁用 floating groups。资源、图层、时间轴在“单面板 + grid 组”中折叠到约 34px，并记录相对高度用于展开；其他组当前只隐藏内容。规范保留折叠能力，但不承诺原型每种标签组合都自动收成一条标题栏。

窗口菜单负责面板显示与“恢复默认布局”。当前重开面板会按 `below / within` 插入，并没有每个已关闭面板原位置的独立恢复机制；精确恢复关闭前停靠位置不是本轮新增要求。[`FoldControl` / `togglePanel`][D-LAYOUT]

## 4. 视觉系统与源码基线

以下值来自 D 生效样式及共享控件。它们是 v2.0 的迁移起点；语义角色应稳定，数值允许在实际产品体验中统一调整。不要把每个局部 literal 升格为全局 token，也不建立像素级 CI 门禁。

### 4.1 表面、文字与强调

| 角色 | D 实际值 | 使用规则 |
| --- | --- | --- |
| 应用底色 | `#111316` | 工作台外层。 |
| 停靠区底色 | `#121418` | 面板间背景。 |
| 面板 / 顶栏 / 可见标签 | `#1a1d22` | 主要工作表面。 |
| 控件 / 数值字段底色 | `#20242a` | 可编辑或可操作区域。 |
| 菜单 / 非活动标签 / 素材表面 | `#22262d` | 次级层级；不为每项再套外框。 |
| 画布外部背景 | `#141619` | 让实际画面成为视觉中心。 |
| 主文字 | `#e3e7ed` | 名称、操作与主要内容。 |
| 次要文字 | `#a0a8b6` | 必要的单位、元数据和次级标签，不据此增加文案。 |
| 通用分隔线 / 字段边框 | `#30353d` | 轻量边界。 |
| 面板外边框 | `#2b3038` | 区分停靠组。 |
| 主强调 / 播放头 | `#54cdf3` | 主操作、选中、焦点与必要交互反馈。 |
| 强调色上的深文字 | `#13212a` | 强调实底按钮的前景。 |
| 普通 hover 背景 | `#2c333d` | 短暂反馈，不与选中混用。 |
| 按下 / 激活控件 | `#23363f` + 青蓝文字 | 表达真实开关或工具状态。 |
| 选中图层 | `#23343e` + 左侧 `2px` 青蓝标记 | 局部强调，名称仍可读。 |

来源：`html[data-variant="D"]`、`.vd`、`.dockview-theme-dark` 与局部选择器。[D CSS][D-CSS] · [画布主题][D-LAYOUT]

生产应将这些角色映射到现有 `--ui-color-*` 体系及必要局部变量，保留语义职责。旧绿色数值不继续绑定新版；迁移范围外的旧消费者按实际切片处理，避免直接全局换值造成未接线界面失配。

**需要收敛的实际差异：** D 画布选框仍写 `#53ccf4`，继承 C 的导出分段控件 / 进度等仍含 `#22b8ff`。迁移时默认归一到 D 主强调 `#54cdf3`；这是本文的收敛规则，不宣称原型已全部统一。warning、danger、success 延续生产语义，D 没有给出完整新色板，不凭空补一套已实现的颜色。[C 供体样式][C-CSS] · [生产语义值][MAIN-TOKENS]

### 4.2 字体与密度

| 项目 | D 源码基线 |
| --- | --- |
| 正文字体 | `"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif` |
| 常规正文 | `13px` |
| 面板标签、素材名、字段标签、菜单、Tooltip | 通常 `12px` |
| 单位、必要元数据、快捷键提示 | 通常 `11px`；不承担主要正文。 |
| 时间标尺刻度 | `10px` 局部紧凑值；不得扩散为全界面字号。 |
| 时间码 | `600 13px Consolas, monospace` |
| 数值字段 | `12px`，等宽数字 `tabular-nums` |
| 普通按钮 / 下拉 | 最小高 `28px`；图标按钮通常 `28×28px`。 |
| 数值输入框 | 高 `29px` |
| 导出主按钮 / 面板标签条 | 高 `30px / 32px` |
| 图层行 | 最小高 `30px` |
| 时间轴主轨 / 子轨 / 音频轨 | `27px / 23px / 28px` |
| 时间轴标尺 / 名称列 | `24px / 206px` |

这是适中紧凑的桌面密度。不同控件可保留本地几何，不强制所有点击区域同高，也不机械套用旧移动端 44–56px 触控尺寸。需要精确拖动的小控件仍应有可用命中区域与键盘 / 输入替代。[共享样式][SHARED-CSS] · [D 样式][D-CSS] · [轨道尺寸][D-TIMELINE]

### 4.3 圆角、间距与边界

| 角色 | D 源码基线 |
| --- | --- |
| 面板、普通按钮、数值框、菜单 | `5px` 圆角 |
| 菜单项 / 对象栏按钮 | `4px` 圆角 |
| 素材缩略图 | `3px` 圆角 |
| 导出弹窗 / 曲线画布 | `6px` 圆角 |
| 面板工具条 | 内边距 `4px 8px`，间隔 `5px` |
| 检查器 | 内边距 `10px`，分组间隔 `8px` |
| 资源内容区 | 内边距 `8px`，网格间隔 `6px` |
| 素材网格 | 列宽以 `89px` 为最小参考并随面板适配；缩略图高 `56px`。 |
| 素材列表缩略图 | `26×26px` |
| 普通边框 | 通常 `1px` |
| 键盘焦点 | `2px` 青蓝轮廓；当前 D 多使用内收轮廓。 |

微圆角与轻边界服务于连续工作台。阴影只用于菜单、Tooltip、对象工具栏和模态浮层等真实层叠关系，不给每块内容增加卡片阴影。间距值按职责复用，不要求把 3、5、6、10 等所有局部值纳入新的全局刻度。[D CSS][D-CSS]

### 4.4 状态与类型颜色

选中、hover、pressed、focus-visible、展开 / 折叠分别表达不同状态。展开面板不等于选中对象；键盘焦点不能只靠 hover；disabled 使用真实禁用语义配合外观，D 的 `.45` 透明度仅是外观值。危险色只用于破坏性操作。

| 时间轴 / 类型角色 | D 实际颜色 |
| --- | --- |
| 普通关键帧 | `#f2b65c`，菱形 |
| 相机关键帧 | `#65c5a0`，圆形 |
| 角色动作片段 | `#493878` |
| 非角色动作片段 | `#865337` |
| 音频片段 | `#28594e`，带波形表达 |
| 角色 / 道具 / 背景图标 | `#b69bf2 / #edb582 / #8cb6cd` |
| 选中片段 / 关键帧 | 青蓝内描边 / 轮廓 |

颜色表达内容类型和状态，同时通过形状、图标、名称和位置辅助识别。现有产品的口型、景深等未由 D 提供完整色值时，沿用产品语义再按同一饱和度体系局部适配；不随意生成彩虹轨道。[D 时间轴][D-TIMELINE] · [图层类型][D-LAYERS]

## 5. 各区域交互合同

### 5.1 顶栏、菜单、镜头与导出

D 实际提供“文件 / 编辑 / 视图 / 窗口”菜单、项目名称、撤销重做、顶部镜头下拉、播控、时间码和右侧导出。镜头切换是当前源码中的下拉选择，不把 C 的镜头缩略条误记为 D 已实现形态。

菜单负责发现完整功能，高频工具负责快速操作。主导出保留文字，常用播控和撤销使用语义图标及 Tooltip。同一命令的按钮、菜单和快捷键复用现有业务动作。

正式接线保留已有新建 / 打开 / 保存、导入、项目管理等必要入口；D 的“文件”菜单只有模拟导出，不是删减产品菜单的依据。真实导出选项、取消、进度、错误与恢复沿用既有导出服务；原型列出的 MP4 / GIF / PNG、720p / 1080p / 4K、24 / 30 / 60fps 不构成新增格式或能力承诺。[顶栏实现][D-LAYOUT] · [模拟导出界面][C-COMPONENT]

### 5.2 资源库

- 分类沿用角色、道具、背景、音频、动作；视觉素材默认网格，音频与动作默认列表，允许用户切换。
- 单击选中，双击 / 底部主操作 / 对象右键菜单执行放入或应用；视觉素材支持拖到画布。
- 搜索围绕素材名称和已有标签，空结果给一个明确短状态；不附长篇教学文字。
- 动作针对符合当前产品规则的选中对象应用；无目标或不可编辑时禁用，并提供可理解的原因。
- 面板较窄时网格自适应，长名称省略并可获取完整名称。尺寸、时长只在有助于选择时展示，不把工程元数据铺满卡片。

D 对视图选择、分类、搜索与选中素材使用面板内状态；它们没有跨刷新持久化保证。新规范要求布局记忆，不顺带新增所有筛选条件同步系统。[Library 源码][D-LIBRARY]

### 5.3 图层

名称、类型、显隐和锁定常驻；父级与景深信息按需展开。上移 / 下移、拖动排序及针对当前图层的右键菜单共同服务组织任务。

点击图层与画布、属性、时间轴共享选中语义。父链候选必须遵守正式 domain 规则，避免自身 / 后代形成环；深度和父链字段不是扩张业务模型的理由。锁定状态须在所有编辑入口保持一致，不能只让检查器变灰而允许时间轴或快捷键绕过。[Layers][D-LAYERS] · [父级候选][D-INSPECTOR]

### 5.4 画布与对象悬浮工具栏

画布应使用实际可用区域进行等比适配，按项目宽高显示，不拉伸。D 的实现以 ResizeObserver 读取容器尺寸、四周留白 `16px`，再计算 fit 与用户缩放倍率：

```text
baseFit = max(0.01,
              min((availableWidth - 2 × padding) / projectWidth,
                  (availableHeight - 2 × padding) / projectHeight))
displayScale = baseFit × userZoom
显示位置 = 容器居中位置 + 用户平移
```

生产接线使用真实项目尺寸。原型 `1280×720 / 24fps` 是共同样例参数；其“100%”表示 fit 倍率为 1，并非原生像素 1:1。产品若区分“适合窗口”和像素倍率，应使用明确语义，不能把两者混称。显式“适合窗口”应让完整画面回到可见中心；被动调整面板则尊重用户缩放和平移，不反复归零。[Stage][STAGE] · [D 画布包装][D-LAYOUT]

对象工具栏继承 A：围绕选中对象提供添加关键帧、添加动作、层级调整、锁定和隐藏等就近高频操作。D 不重复显示对象名称；根据对象类型和锁定状态隐藏或禁用不适用动作。对象拖动与播放时隐藏，停止后按选中对象恢复。

工具栏在对象上方或下方定位，并限制在画布容器范围。当前 D 使用 CSS container units 与 `clamp`；生产接线应保证窄画布、边缘对象和缩放后的可操作性，不照搬固定宽度假设导致工具栏被裁掉。它不承担第二套全局播控或完整属性表单。[对象工具栏][A-COMPONENT] · [选框坐标与显示时机][STAGE]

### 5.5 时间轴

保留 Panda 的角色动作、口型、变换、相机、景深、音频与关键帧语义。轨道能折叠 / 展开；动作重叠时分子轨呈现，避免内容彼此覆盖。默认密度与局部滚动共同控制空间，而不是砍掉功能。

当前 D 已实现主轨、动作 / 变换子轨、相机关键帧与音频表示，支持播放头定位、逐帧、关键帧移动、动作移动与尾部改时长、缩放、选中和右键操作。名称列、标尺、片段与播放头使用同一滚动 / 时间坐标。

当前景深子轨 `items: []`，仅显示景深值；没有口型轨，音频波形为算法示例。正式迁移接回已有业务，不把空行或假波形当完成。动作最短时长、景深范围、镜头帧率等原型示例限制不覆盖生产 domain 规则。[D 轨道组合][D-TIMELINE] · [共享时间轴机制][CORE-TIMELINE] · [示例边界][D-README]

### 5.6 属性检查器与曲线

检查器按选中对象显示相关内容：图层的变换 / 父级与景深 / 动作，相机关键帧的位置与缩放，音频片段的起始帧。生产现有对象属性按同一分组原则接入，不能以原型字段较少为由删减。

常用变换默认展开，父级与景深等低频组默认折叠，动作组在相关片段选中时展开。曲线默认与属性同组标签，可独立停靠；没有合适关键帧时使用一句简短空状态，不展示不可操作的大表单。

D 曲线采用 Animora 适配的 EasingEditor，并吸收 OpenCut 的手柄吸附思路：支持预设、贝塞尔手柄和坐标输入，手柄纵向接近 0 / 1 时吸附，Shift 暂时解除吸附；一次手柄拖动使用同一手势标识合并撤销。D 没有直接调用 OpenCutBezier 组件，不据此推断其全部行为都已接入。属性、曲线、图层和时间轴操作必须经过同一编辑动作与 History。[Inspector / Curve][D-INSPECTOR] · [EasingEditor][EASING]

## 6. 共用操作：数值、快捷键、上下文与图标

### 6.1 数值编辑合同

精确输入、标签横向拖动、Shift 粗调、Alt 微调、适用时的滑条与恢复默认共同构成统一手感。手势期间实时预览；一次连续手势形成一个逻辑编辑与一次撤销，撤销回到手势前的值。无改动不产生无意义历史。

D 已通过手势标识合并原型历史，但使用了两种数值供体：Animora NumberField 用于位置 / 旋转等，OpenCutNumberField 用于图层缩放。两者当前粗细调倍率分别为 `Shift ×10 / Alt ×0.1` 与 `Shift ×5 / Alt ×0.2`。**生产应在共用适配层统一同类数值的手感**；具体倍率沿用适用的现有产品行为或在该控件迁移中统一，本文不把原型差异固化为双重标准。

沿用成熟输入与 pointer capture 实现，复用项目事务 / History；不移植示例全量快照 store。数值边界、单位、允许精度、锁定和非法输入由当前业务规则决定。字段需有可访问名称，精确输入不能被全局快捷键抢占。[NumberField][NUMBER] · [OpenCutNumberField][OPENCUT] · [原型 History 合并][STORE]

### 6.2 快捷键与操作上下文

保留现有桌面快捷键，同一命令在按钮、菜单、右键和键盘入口中有一致结果。以下只是 D 实际使用的参考映射，接入时与正式产品当前绑定合并，不自动覆盖冲突的既有快捷键。

| D 输入 | 当前作用 |
| --- | --- |
| Space | 播放 / 暂停 |
| ← / → | 前 / 后一帧 |
| K | 为当前对象添加关键帧 |
| Delete / Backspace | 删除选中的时间轴项 |
| Ctrl+Z | 撤销 |
| Ctrl+Shift+Z / Ctrl+Y | 重做 |
| Ctrl+M | 打开导出 |
| 画布滚轮 | 画布缩放 |
| Alt+左键拖动 / 中键拖动 | 画布平移 |
| 时间轴 Ctrl 或 Alt + 滚轮 | 时间轴缩放 |

输入框、可编辑文字、下拉、菜单、滑条和模态对话框应获得适合自身的键盘事件；关闭 / 折叠面板不能留下失效焦点。原型切换不得占用逐帧方向键。D 已对共享快捷键做上下文避让，独立导出监听等接线时仍应纳入同一规则。[快捷键源码][STORE] · [D 导出监听][D-LAYOUT]

### 6.3 右键菜单与图标

素材、图层、关键帧和片段的右键菜单只放当前对象可用的常见操作；与显式按钮共用命令和禁用规则。右键菜单是效率入口，主要能力仍有可发现的界面入口。

Lucide 优先，已有语义使用现成图标；必要缺项允许按一致尺寸、描边和视觉重心补少量 SVG，不为一两个图标引入整套第二图标库。操作按钮不使用 emoji 或字符字形假装图标。品牌与用户画布内容不受该操作图标规则限制。

熟悉操作可用图标 + Tooltip；主操作、不熟悉或易混淆操作保留简短文字。纯图标按钮有 accessible name，装饰图标不重复朗读。D 的 Tooltip 延迟基线为 `350ms`，不是要求所有说明信息只能悬停获取；键盘焦点应同样获得必要帮助。[D 轻量控件][D-CONTROLS]

## 7. 布局偏好与创作状态分离

### 7.1 必须保留的状态边界

| 状态 | 所属层与规则 |
| --- | --- |
| 正式 Project、dirty、revision | `EditorProjectStore` 与既有 domain 服务；布局变动不得写入。 |
| 撤销 / 重做 | 现有 `HistoryStore`；面板调整不生成历史，不清空创作历史。 |
| 当前镜头 / 图层选择 | 既有 shotStore / selectionStore 的会话语义；面板移动或重置不改变当前创作对象。 |
| 播放头、编辑中的角色、当前会话 | 继续由现有编辑 owner 管理；不得因 Dockview 面板重建而重新开工程。 |
| 停靠结构、面板可见性、尺寸与折叠 | 用户工作台偏好，按现有应用设置机制存储；不写入动画工程。 |
| 面板临时筛选、搜索、安全框、子轨展开等 | 采用当前功能需要的本地 / 会话状态；不顺带承诺全部跨刷新记忆。 |

D 将共享工程状态放在面板外，平移引用放在 D 根部；折叠通过 `hidden` 保留内容子树。关闭重开和恢复默认会重建面板，局部 useState 可能回默认。正式迁移保证核心创作状态不受影响；布局重置并不是项目重置。[源码机制][D-LAYOUT] · [生产状态合同][MAIN-AGENTS]

### 7.2 保存、恢复与降级

当前 D 使用 `reshell-proto-d-layout-v1`：布局变化时 `toJSON()` 保存，初始化通过 `fromJSON()` 恢复；无记录或解析 / 加载异常时恢复默认，存储不可用时保持编辑可用。旧的有效布局仍被接受，失衡布局通过窗口菜单主动重置，没有自动清空所有偏好的逻辑。

示例工程另由共享内存 store 管理，并通过 `sessionStorage['reshell-proto-state']` 缓存；恢复时暂停播放。它与 localStorage 中的布局记录独立，是原型比较的便利机制，不作为正式工程保存、自动保存、恢复或 History 持久化设计。[原型缓存源码][STORE]

正式产品保留这些体验原则，存储接入既有偏好服务；原型 key 不是生产协议。按实际需要做局部版本兼容，不全局擦除 localStorage、不覆盖有效自定义布局，不为写偏好失败禁止整个编辑器。

“恢复默认布局”只恢复工作台结构与默认尺寸；“重置示例”会清示例状态，只属于实验切换器。生产不能把两个动作合并，也不能让它们共享误导性的名称。[保存与恢复源码][D-LAYOUT] · [实验切换器][ENTRY]

## 8. 信息、状态与反馈

本节继承旧版已确认的全局轻量反馈合同；D 的临时 toast 实现不改变产品规则。[旧 DESIGN 反馈合同][OLD-DESIGN]

| 情况 | 产品反馈 |
| --- | --- |
| 结果已经在界面可见 | 不重复提示“已完成”。 |
| 极短的素材准备 / 加载 | 不制造瞬闪提示，不人为延长任务。 |
| 必要的普通成功 / 非阻塞信息 | 悬浮轻提示，约 `3000ms` 消失；悬停、键盘焦点或操作时暂停；按一次结果去重 / 合并。 |
| 真正需要等待的长任务 | 展示简短、真实的状态，随任务结束而结束；不编造进度，不被普通 toast 定时器隐藏。 |
| 失败、部分成功、未知结果、资源冲突、恢复 | 持续可见，说明发生了什么与下一步；必要技术详情可展开，不能自动消失或伪装成功。 |
| 需要确认的破坏性 / 高风险决定 | 沿用产品的持续确认与撤销 / 恢复合同，等待用户明确操作。 |

轻提示不参与布局、不挤占素材 / 画布 / 时间轴、不留占位、不抢焦点。项目保存状态由项目级界面负责，普通局部成功不追加泛化的“项目尚未保存”。

未配置、搜索无结果、资源不可用、规则冲突和动作禁用是不同状态，不全部处理成灰框。错误 / 帮助信息应能被辅助技术理解；普通通知使用适当的 status / live 语义，严重错误使用明确 alert。提示需要长时间阅读、诊断或操作时改用稳定反馈，不强迫用户在 3 秒内读完。

原型当前 toast 约 `1800ms` 且不支持悬停 / 焦点暂停；D 过滤了素材放入和音频添加的重复成功文案。生产沿用上述 3 秒合同及可靠反馈机制，避免每个面板各造计时器。[原型 toast][STORE] · [D 过滤][D-LAYOUT]

## 9. 可访问性、桌面适配与动效

- 新建或触达控件采用原生 / 成熟组件语义；可键盘到达、focus-visible 清楚、字段名称与输入关联、纯图标有名称。
- 选中、禁用、错误不能只靠颜色判断；焦点态与选中态可同时辨认。
- 折叠 / 非活动内容不留在正常焦点路径；模态界面按其语义管理焦点，关闭后返回合理入口。
- 窄桌面窗口优先面板调整、标签合组、内部滚动与次要操作渐进披露；不把全部控件压到难读，也不重新开发手机横竖屏布局。
- `1440×900` 和 `1280×768` 是已有浏览器验证样本，不是产品硬性分辨率门禁；D 的 `max-width:900px` 工具条微调也不是完整桌面自适应策略。
- 菜单、悬浮工具栏、折叠和选中反馈允许轻量动效，尊重 reduced-motion。画布拖动、时间轴操作、数值 scrub、播放头更新直接跟手，不加装饰性滞后。
- D 没有统一的动效时长体系；不凭空宣称 150ms / 200ms 是已验收值，也不为此单独造动画系统。

可访问性与适配按实际迁移的控件和范围核对，不附加全仓巡检或额外 CI 门禁。[共享控件实现][D-CONTROLS] · [旧设计原则][OLD-DESIGN] · [D 样式][D-CSS]

## 10. 组件复用、样式所有权与许可

### 10.1 已选技术路线

| 能力 | 当前 D 实际使用 | 生产迁移规则 |
| --- | --- | --- |
| 停靠与分割 | `dockview-react`，原型依赖 `^8.10.0` | 优先使用已验证开源组件；不并行造布局引擎或重复分割库。 |
| 菜单、右键、Tooltip、Slider、Dialog | Radix Primitives | 保留成熟焦点 / 键盘行为，统一外观；按实际需要引入。 |
| 按钮、选择框、分组 | 轻量 React / 原生 HTML；检查器使用 details | 优先适配生产已有 primitives，避免为统一外观重写成熟业务。 |
| 数值编辑 / 缓动 | Animora 与 OpenCut 的已适配局部组件 | 保留来源与许可；统一手感后接入 Panda 业务命令。 |
| 图标 | Lucide | 定点 SVG 补缺，不新增完整平行图标系统。 |
| 画布 | Konva / react-konva | 接回生产渲染与变换语义，不移植示例引擎替换正式能力。 |
| 时间轴 | 原型共享 TimelineBody + D 的行组合 | 借鉴展示与交互；既有 Panda 时间轴业务保持，按实际耦合适配。 |

D 没有直接依赖 Blueprint 控件；B 仍以 lazy import 保留，其依赖与 CSS 仍在实验工程中，访问 B 后样式会留在页面。生产优先消除重复 Blueprint / 样式负担；个别控件确有价值时允许局部保留，不为“清零依赖”重造功能。A/B/C 为对照所需的库不在本轮清理。[入口][ENTRY] · [原型依赖][D-PACKAGE] · [供体说明][D-README]

D 当前从 A 导入 ContextToolbar、从 C 导入 ExportDialogC，并使用 A/C 的一部分样式。生产提取需要的组件和样式，形成明确公共 / 功能边界，不整包带入竞争方案壳。复用顺序为直接复用 → 移植适配 → 补齐缺口 → 必要自主实现；已完成的供体研究无需再跑一轮。

### 10.2 样式与组件所有权

- `src/renderer/styles/tokens.css`：跨真实组件族共用的语义值。
- `src/renderer/styles/primitives.css` 与 `src/renderer/ui/`：公共控件外观和必要行为；保留 Button、IconButton、Field、Stepper、SegmentedTabs 等已有职责，按 D 适配。
- shell 样式：应用和工作台几何；feature 样式：本功能布局与内容组合。
- 家族合同：只覆盖真实同类消费者，例如 ImageAssetPicker 的 selected surface；不因颜色相近扩散到时间轴、工具或删除按钮。
- 主样式入口保持 import / composition 职责，兼容 CSS 随对应旧实现退休，不再成为功能样式杂物堆。

共享外观允许本地几何。只有真实重复语义出现时才从 local 提升到 family，再到 global；两个 literal 相同不是新建全局 token 的充分理由。不得把这条规则变成新的抽象层或门禁工程。[生产 primitives][MAIN-PRIMITIVES] · [继承方法][OLD-DESIGN]

### 10.3 许可与资产

项目维持 Apache-2.0。成熟 MIT / BSD / Apache 兼容代码优先，实际复制的代码保留版权与许可；GPL / AGPL / 闭源默认只参考设计，直接移植另行核实。

原型保留 Animora、OpenCut Classic 的 MIT LICENSE；Flare / AniCraft 为设计参考，不引入 Rust / egui 运行时。README 记载示例美术为原创内联 SVG，波形为算法示例；这不替代未来真实素材的独立许可判断。[来源与许可记录][D-README] · [Animora LICENSE][ANIMORA-LICENSE] · [OpenCut LICENSE][OPENCUT-LICENSE]

## 11. 工程保护与未覆盖产品界面

UI 结构允许重组，以下既有合同继续执行：[AGENTS][MAIN-AGENTS]

- `EditorProjectStore` 是 Project / dirty / revision 唯一 owner；正式修改经既有 domain 服务与 `updateProject`。`HistoryStore` 管理撤销重做，历史不序列化到 project.json。
- shotStore / selectionStore 管理会话选择；`EditorShell` 唯一构造并管理 `ProjectSessionController`。面板不能另建项目会话、资源 store 或第二套 controller。
- Main 继续负责文件、保存、自动保存、恢复、资源文件系统与外部导出；共享项目根操作继续使用 `ProjectOperationCoordinator`。
- Renderer 不直接访问 Node / fs / path / 子进程；Preload allowlist、集中式 IPC schema、双边 payload 校验和 Main trusted-sender 检查保留。
- `src/domain/` 是正式模型；旧 probe 兼容层不是新编辑器业务入口。布局与只读查看不写项目 revision / dirty / history。
- Electron 本地资源采用现有 bundler import 等兼容方式，不把浏览器根绝对路径能显示当作正式资源路径已正确。

D 未完整覆盖的项目中心、角色 / 表情 / 口型编辑、素材导入、保存、恢复、诊断与真实导出，沿用现有业务流程与能力，并应用本文的视觉和信息原则。它们是后续区域迁移范围，不需要重新批准已确认的整体风格，也不因原型没画出就删除。

当前读取的 AGENTS 没有锁定竹青色或要求继续移动端适配，且已要求 UI 工作读取 DESIGN。Q48 的“同步必要约束调整”按实际冲突处理；不为本次文档机械重写 AGENTS 或删除工程约束。

## 12. 原型与正式迁移之间的明确差距

下表用于对应区域接线，不自动创建额外工单，不要求在迁移前先修完整原型。它也不代替正式产品既有行为和 active Issue 范围。

| 项目 | 基准源码事实 | 正式迁移处理 |
| --- | --- | --- |
| 数值手感 | 两套供体的 Shift / Alt 倍率不同。 | 共用适配层统一同类编辑手感，保留一次手势一次撤销。 |
| 轨道覆盖 | 景深子轨为空项；无口型轨；音频波形为算法示例。 | 接回既有景深 / 口型 / 音频业务与真实数据，不削减能力。 |
| 画布手柄 | 四角为 `listening={false}` 的视觉标记。 | 沿用正式画布可用的变换交互；未接线时不以外观宣称可拖缩放 / 旋转。 |
| 适合窗口 | 菜单仅把 viewZoom 设 1，未清平移。 | 显式 fit 恢复完整画面可见与居中；被动 resize 保持用户意图。 |
| 强调色 | `#54cdf3`、`#53ccf4` 和继承 C 的 `#22b8ff` 并存。 | 收敛同一语义，默认以 D 主强调为基准。 |
| 锁定与命令入口 | 部分按钮禁用，原型 store 不是完整生产领域约束。 | 在共用业务命令保持既有锁定合同，覆盖时间轴、键盘和右键入口。 |
| 状态与刷新 | 布局有 localStorage 保存 / 恢复实现；模拟工程由共享内存 store 管理并有 sessionStorage 缓存；部分面板局部状态随重建丢失。 | 布局偏好与正式项目恢复分开；保证核心创作状态，其他偏好按实际需要处理。 |
| 反馈 | 1800ms 原型 toast、模拟导出进度。 | 继承第 8 节反馈合同，接真实任务；不复制假进度或误报成功。 |
| 导出与示例限制 | 格式、帧率、尺寸、动作清单等为原型选项。 | 从真实服务 / domain 读取支持范围，不扩大或缩减产品能力。 |
| 控件 / 样式耦合 | D 导入 A/C 控件和样式，B 的 CSS 可残留。 | 提取必要控件到正式归属，验证触达消费者，不带入整套竞争壳。 |
| 实验专用 UI | 黄色切换条、重置示例、D 底部 36px 预留。 | 留在实验目录，不进入生产工作台。 |

事实来源：D 布局与样式、Inspector / Timeline、共享 Stage / store、A 对象栏、C 导出及供体数值控件，见第 15 节固定源码索引。

## 13. 迁移与最小充分验收

### 13.1 实施顺序

设计方向已定。后续基于本文形成正式迁移规格，再拆成可交付区域任务，在独立迁移分支完成：共享视觉与壳 → 各区域业务接线 → 核心创作链路验收 → 对应旧 UI / 移动专用实现清理。具体切片和依赖由后续实施规格确定，本文不虚构已创建的新工单。

main 保持稳定。新旧过渡只服务迁移，不增加永久双 UI 选择器。每个任务复用已有可靠实现、只补当前缺口；不附带无关架构重构、全量历史 verifier 扫描、全量 Hash 或新门禁。

### 13.2 按改动选择验证场景

| 改动范围 | 需要看到的外部行为 |
| --- | --- |
| 工作台 / 布局偏好 | 首次与重置后五个主要区域可用；拖动 / 调整 / 合组 / 折叠可用；刷新记忆与异常回退可理解；工程内容、选择、播放头和 History 不被布局动作清空。 |
| 画布 / 时间轴几何 | 正常展开时间轴仍可创作；多轨内部滚动；缩放 / 平移 / 显式 fit 正确；标尺、轨道、播放头同步。 |
| 资源 / 图层 / 属性 | 选择同步，添加与排序符合真实业务；锁定一致；精确输入与连续拖动的撤销粒度正确。 |
| 公共控件 / 视觉值 | 目标消费者和相关交互状态可用，代表性未改区域不被全局样式带坏；图标、焦点、菜单和字段语义合理。 |
| 保存 / 导入 / 导出等实际链路 | 按原服务合同接线；真实进度、取消、失败和恢复可用，不以模拟成功替代。 |
| 移除旧实现 | 对应新版能力已接入并验收，共享业务与桌面自适应仍保留。 |

只选择当前触达项，执行现行 AGENTS Validation Matrix 和 Issue 明确要求的检查。视觉与交互最终在 Windows Electron 的相关表面确认；源码阅读、构建或浏览器截图各自说明证据范围。若环境缺少某项能力，局部记录待验项，不整体禁止推进。

Markdown-only 工作核对差异空白、链接、命令、当前状态和授权文件范围即可；无需安装原型或跑产品全量测试。正式代码任务使用对应工程检查，未经明确授权不手动升级 Full CI、`pnpm verify:project` 或全仓 verifier。[工程验证矩阵][MAIN-AGENTS]

## 14. 已确认决策覆盖索引

本索引用于保持 Q1–Q48 连续性；条目均为已有决策，不是新一轮问题。原型选型阶段的权重与对照要求属于历史依据，不转为当前 CI 评分系统。

| 决策 | 已确认内容摘要 | 本文落点 |
| --- | --- | --- |
| Q1–Q3 | 整体 UI / UX 重构；保护核心；独立实验后固化规范。 | 第 1、11、13 节 |
| Q4、Q7、Q20 | 先找成熟实现，完成供体研究后复用。 | 第 10 节 |
| Q5、Q9、Q18 | 可运行 React / TS 原型，使用相同样例和素材。 | 第 1、10、15 节；实验记录 |
| Q6、Q8 | 专业深色、适度活力；允许更换旧外观与结构。 | 第 1、2、4 节 |
| Q10、Q13 | 正式退役移动 / Cloud Touch 专用适配，保留共享业务与桌面缩放。 | 第 1、9、13 节 |
| Q11、Q15、Q27、Q47 | A/B/C 竞争后集中融合 D，保留对照；追加探索由 Owner 决定。 | 第 2、12 节 |
| Q12、Q24、Q48 | 成品反推规范，整体定方向，再按统一标准迁移。 | 第 1、11、13 节 |
| Q14 | Apache-2.0 与兼容许可复用。 | 第 10 节 |
| Q16、Q38 | 可调整、停靠、折叠、记忆、恢复；不扩展独立浮窗 / 多屏。 | 第 3、7 节 |
| Q17、Q23 | 可重组流程，保留核心能力与快捷键；不重做引擎 / schema / 导出。 | 第 5、6、11 节 |
| Q19、Q25 | 独立分支分区迁移，验收后清旧 UI；最小充分验证。 | 第 13 节 |
| Q21、Q44 | 统一供体语言；Dockview + Radix + 适配组件 + Panda 业务，避免重复库。 | 第 10 节 |
| Q22 | 选型参考视觉 35%、效率 30%、复用迁移 20%、维护 15%；Owner 拍板。 | 第 2 节及已完成的选型记录 |
| Q26、Q28、Q29 | B 骨架、C 视觉；高频常驻、低频披露。 | 第 2–5 节 |
| Q30 | 左上资源、左下图层、中央画布、右属性、底部全宽时间轴。 | 第 3 节 |
| Q31 | 分类缩略图，网格 / 列表切换。 | 第 5.2 节 |
| Q32 | 图层专业信息与按需父链 / 景深。 | 第 5.3 节 |
| Q33 | A 对象悬浮工具栏，拖动 / 播放时收起。 | 第 5.4 节 |
| Q34 | 专业轨道 + 现代片段，保留完整产品语义。 | 第 4.4、5.5 节 |
| Q35 | 上下文属性、分组披露、可独立曲线。 | 第 5.6 节 |
| Q36 | 专业菜单、顶部镜头切换、明确导出。 | 第 5.1 节 |
| Q37 | 中性黑灰与可调整青蓝强调，不锁死色值。 | 第 4 节 |
| Q39、Q40 | 适中紧凑、微圆角、轻边界。 | 第 3、4 节 |
| Q41 | 最少必要文案，info + Tooltip，Lucide 与必要 SVG。 | 第 2.3、6.3、8 节 |
| Q42、Q43 | 统一数值手感、手势撤销、快捷键与右键共用业务。 | 第 6 节 |
| Q45 | 布局偏好与创作状态分离。 | 第 7、11 节 |
| Q46 | 轻量反馈动效；连续创作操作跟手。 | 第 9 节 |

## 15. 固定源码索引与实验复现

### 15.1 本次实际读取的主要来源

| 来源 | 用途 |
| --- | --- |
| [D README][D-README] | 施工记录、示例边界、供体与兼容说明。 |
| [D VariantD.tsx][D-LAYOUT] / [d.css][D-CSS] | 六面板布局、折叠 / 保存 / 恢复、顶栏与视觉基线。 |
| [Library][D-LIBRARY] / [Layers][D-LAYERS] / [Inspector][D-INSPECTOR] | 素材、图层、属性与曲线的实际交互。 |
| [D Timeline][D-TIMELINE] / [controls][D-CONTROLS] | 轨道组合与 Radix 控件封装。 |
| [Stage][STAGE] / [共享 Timeline][CORE-TIMELINE] / [共享 CSS][SHARED-CSS] | 画布适配、选框、拖动、时间轴滚动与共同视觉机制。 |
| [store][STORE] / [main][ENTRY] | 原型状态、快捷键、实验切换与加载边界。 |
| [NumberField][NUMBER] / [OpenCutControls][OPENCUT] / [EasingEditor][EASING] | 已适配的数值和曲线供体。 |
| [A 组件][A-COMPONENT] / [A CSS][A-CSS] / [C 组件][C-COMPONENT] / [C CSS][C-CSS] | D 实际复用的对象工具栏、导出和样式。 |
| [原型 package.json][D-PACKAGE] | 实际依赖范围与启动 / 构建命令。 |
| [生产 AGENTS][MAIN-AGENTS] / [旧 DESIGN][OLD-DESIGN] / [tokens][MAIN-TOKENS] / [primitives][MAIN-PRIMITIVES] | 继承工程、反馈和公共组件合同，识别被替代的旧视觉 / 双端目标。 |

### 15.2 复现入口

在上述实验分支或固定提交中运行；以下命令已与其 package.json / README 核对，本次文档编制未执行运行测试：

```powershell
pnpm --dir prototypes/reshell-ui2 install
pnpm --dir prototypes/reshell-ui2 dev
```

打开 `http://localhost:5199/?variant=D`。需要构建时使用原型已有命令：

```powershell
pnpm --dir prototypes/reshell-ui2 build
```

共同示例为“竹林里的早晨”，两镜头、1280×720、24fps。A/B/C/D 共用内存 store，并有 sessionStorage 缓存；浏览器恢复布局与恢复示例工程内容是两个不同机制，均不能替代正式项目保存。布局重置使用“窗口 → 恢复默认布局”，不要误用黄色实验切换器中的“重置示例”。[入口与边界][D-README] · [原型缓存][STORE]

本版本没有阻碍继续编写迁移规格的未决设计选择。后续遇到具体兼容或接线问题，在已确认方向内做最小适配；只有确实改变产品取舍时才提出新的选择。

[D-README]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/README.md
[D-LAYOUT]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/variants/d/VariantD.tsx
[D-CSS]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/variants/d/d.css
[D-LIBRARY]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/variants/d/Library.tsx
[D-LAYERS]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/variants/d/Layers.tsx
[D-INSPECTOR]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/variants/d/Inspector.tsx
[D-TIMELINE]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/variants/d/Timeline.tsx
[D-CONTROLS]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/variants/d/controls.tsx
[STAGE]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/core/Stage.tsx
[CORE-TIMELINE]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/core/Timeline.tsx
[SHARED-CSS]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/core/shared.css
[STORE]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/core/store.ts
[ENTRY]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/main.tsx
[NUMBER]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/donors/NumberField.tsx
[OPENCUT]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/donors/OpenCutControls.tsx
[EASING]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/donors/EasingEditor.tsx
[A-COMPONENT]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/variants/a/VariantA.tsx
[A-CSS]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/variants/a/a.css
[C-COMPONENT]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/variants/c/VariantC.tsx
[C-CSS]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/src/variants/c/c.css
[D-PACKAGE]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/package.json
[ANIMORA-LICENSE]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/LICENSES/animora-LICENSE
[OPENCUT-LICENSE]: https://github.com/Cognitive-Architect/panda-stage/blob/b2c6a4dc4a467b399c18cdfba546db92ccdc8ab6/prototypes/reshell-ui2/LICENSES/opencut-LICENSE
[MAIN-AGENTS]: https://github.com/Cognitive-Architect/panda-stage/blob/804bb05f1e6db8dbde402ba2a2fec949aebe9d6d/AGENTS.md
[OLD-DESIGN]: https://github.com/Cognitive-Architect/panda-stage/blob/804bb05f1e6db8dbde402ba2a2fec949aebe9d6d/DESIGN.md
[MAIN-TOKENS]: https://github.com/Cognitive-Architect/panda-stage/blob/804bb05f1e6db8dbde402ba2a2fec949aebe9d6d/src/renderer/styles/tokens.css
[MAIN-PRIMITIVES]: https://github.com/Cognitive-Architect/panda-stage/blob/804bb05f1e6db8dbde402ba2a2fec949aebe9d6d/src/renderer/styles/primitives.css
[ISSUE-D]: https://github.com/Cognitive-Architect/panda-stage/issues/1390
[ISSUE-FIX]: https://github.com/Cognitive-Architect/panda-stage/issues/1392
