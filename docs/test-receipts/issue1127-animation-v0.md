# #1127 V0-04：自动化结果与 OWNER 验收交接

2026-11-16；母 PR [#1123](https://github.com/Cognitive-Architect/panda-stage/pull/1123) 保持 Draft。
**状态：自动化主体完成，D 的产品局部降级验收、Windows OWNER UAT 与维护者终审尚未完成。**

## 有界修复

- Canvas 的 0ms 基础视图原先丢失 Animation Core 求值字段；现保留同一 evaluator 的 `animationValues` / `animationTimeMs`。
- 既有 Shot 复制现将 Clip 的 target bases / tracks 指向复制后的 Layer ID，保持 Part identity、keys 和冻结 basis。
- 未新增 Character 复制功能，未新增 renderer/evaluator，也未改动 Auto-Key OFF 的冻结合同。

## 自动化证据

[集成测试](../../tests/integration/animation-v0-acceptance.test.ts) 的 6 项测试覆盖：

- 真实 `ProjectService.save/open`，完整 Project equality，Image/Graphic basis、pivot、center、source references、keys、interpolation 和 overrides 保持。
- 重开后 500ms ×20、900→250→900，无历史依赖。
- 同 Definition A/B 的独立动画与 overrides；共享 Definition 改动传播，Clip 不变。
- Editor temporal model、Product Preview plan、Export evaluator / shared Stage model 在 0/250/500ms 的矩阵、frame、parts 对账。
- 既有 Shot 复制及后续独立编辑。
- 两层嵌套 Symbol，Loop / Play Once / Single Frame 的明确源帧对账，外层动画继续生效。

[生产 Electron 验证](../../scripts/verify-issue1127-animation-v0.cjs) 复用真实 Main、sandboxed Preload、EditorShell session、Product Preview、隐藏 Export renderer 和 FFmpeg。
fixture 的 Clip 经生产 authoring service 创建；脚本通过既有 acceptance seam 制造普通未保存编辑，然后实际 Save→Close→Reopen。
Stage 鼠标 authoring 的自动化证据沿用 #1126；本脚本不能替代 OWNER 的真实创作路径。

```powershell
pnpm build
pnpm exec electron scripts/verify-issue1127-animation-v0.cjs
pnpm exec electron scripts/verify-issue1127-animation-v0.cjs --nested
```

- A/B PASS：`D:/PandaStage-Acceptance/issue1127/2026-11-16T04-04-33.140Z`
- C PASS：`D:/PandaStage-Acceptance/issue1127/2026-11-16T04-08-51.281Z`
- 两次均真实保存重开 equality、新 session identity、Preview 加载、MP4 完成、24 帧 / 1920×1080、无 renderer error。
- 每份目录含 result.json、真实项目、Stage / Preview / 解码 Export 在 0/250/500ms 的图片、1 秒 MP4。截图供人工审阅；没有新建截图 diff 基础设施。

Core 本地检查：typecheck、lint、build、integration 231 PASS + 1 环境 skip。
首次全量 unit 为 3570 PASS / 2 timeout；与构建及 integration 并行运行时触发。
只复跑两份失败文件：22/22 PASS，未降低 timeout 或修改历史测试。
后续 PR Core CI 为最终 CI 结果；未手动触发 Full CI / verify:project。

## D：真实 bitmap fill 诊断，尚未产品验收

用户指向默认下载目录中的素材。素材包内“原始人动作.fla”未检出 BitmapFill；同目录的真实样本：

`C:/Users/admin/Downloads/沙雕表情三视角-原（网络素材，短剧慎用）.fla`

[诊断脚本](../../scripts/inspect-issue1127-bitmap-fill.cjs) 使用既有安全恢复、display-list / SVG builder 和结构 capture。
Graphic `沈唐5/沈唐145` 真实返回：

```text
TARGET_UNSUPPORTED
Shape fla-shape-a20c4caea81109baa4856808 FillStyle 1 uses unsupported bitmap fill;
P2-C05 supports solid, linear, and radial fills
```

```powershell
pnpm exec node scripts/inspect-issue1127-bitmap-fill.cjs 'C:/Users/admin/Downloads/沙雕表情三视角-原（网络素材，短剧慎用）.fla' 'D:/PandaStage-Acceptance/issue1127/bitmap-fill-diagnostic.json'
```

真实源 SHA、恢复标记、target、原始 renderer 拒绝信息，以及在捕获结构上创建外层 rotation key 的数据证据，见 A/B 目录 `bitmap-fill-diagnostic.json`。
数据 authoring 独立性 PASS；renderer DEGRADED；产品中选择/编辑及局部 fallback 视觉 **NOT VERIFIED**。
未伪造可显示的真实 FLA fixture，未修 bitmap fill renderer；D 的完整 DoD 仍未勾选。

## OWNER Windows 真人步骤

自动化结果不是本节的 PASS。真人按 #1127 §12 操作并回填实际结果：

1. 在该 worktree 运行 `pnpm exec electron .`，打开交接的 `OWNER.pandastage`（无 Clip 的 A/B 起点）。
2. 点击 Instance A 的 Image，部件选 Image；展开时间轴，seek 500ms，打开 Auto-Key，实际拖动/旋转/缩放。
3. 保存，关闭项目，重新打开；在 0ms / 500ms 核对画面、key 与 pivot。
4. 打开 Preview，再导出 1 秒 MP4，实际播放观察。
5. 对 Graphic 重复核心路径，确认内部 4 帧继续播放且外层 pivot 不漂。
6. 对同 Definition 的 Instance B 写不同动作，确认 A 不变；保存重开后再次确认。
7. 打开 C-nested 项目，观察三种嵌套 clock 与外层动作；核对 Preview / Export。
8. 对已有 Clip 关闭 Auto-Key 后拖一次，记录当前冻结动画与 Library 默认姿势的实际手感：可接受 / 困惑 / 不可用。
9. 用真实 D 样本观察现有 renderer warning/fallback，确认是否仍可选择外层 Part 并编辑。若导入/显示阻断，记录具体环节，不能写 PASS。

按 Image、Graphic、A/B 隔离、C、D、OFF 体验分别填 `PASS` / `FAIL + 现象` / `DEGRADED + renderer gap`。
OFF 体验若困惑仅登记独立 UX follow-up，不在本票改 snapshot 合同。
OWNER 和维护者终审完成前不 Ready、不 Merge、不关闭 Issue。
