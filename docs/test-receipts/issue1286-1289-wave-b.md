# Wave B · 原生动画工具交付回执

集成分支为 `fix/issue-1262-a00`，保留 [Draft PR #1265](https://github.com/Cognitive-Architect/panda-stage/pull/1265) 等待 OWNER 验收。

| Issue | 工具入口与操作 | 实现提交 |
| --- | --- | --- |
| [#1286](https://github.com/Cognitive-Architect/panda-stage/issues/1286) | 选中最底部的普通 Graphic 单帧背景模板，在工具中打开「背景铺排 / 循环」。选静态铺排或指定循环方向与周期，然后生成。 | [铺排和循环](https://github.com/Cognitive-Architect/panda-stage/commit/908faae) · [B01 边缘修复](https://github.com/Cognitive-Architect/panda-stage/commit/498febf) |
| [#1287](https://github.com/Cognitive-Architect/panda-stage/issues/1287) | 选中飞行 Graphic，在工具中打开「环绕飞行」，选择一到两个参考图层并设定椭圆轨迹。每个飞行实例烘焙成两个或三个可编辑遮挡图层。 | [环绕飞行](https://github.com/Cognitive-Architect/panda-stage/commit/6657857) |
| [#1288](https://github.com/Cognitive-Architect/panda-stage/issues/1288) | 选中飞行 Graphic，在工具中打开「万剑归宗」，设定汇聚点、弯曲和错峰时间。相同参数与种子可生成相同路径。 | [万剑归宗](https://github.com/Cognitive-Architect/panda-stage/commit/7f4015f) |
| [#1289](https://github.com/Cognitive-Architect/panda-stage/issues/1289) | 选中起帧可见的 Graphic，在工具中打开「扩散虚影」，设定放大倍数、衰减与相位间隔。 | [扩散虚影](https://github.com/Cognitive-Architect/panda-stage/commit/71a89fb) |

**阵法波动待核实。** [作者公开演示](https://www.bilibili.com/video/BV1UyaReVECG/) 的索引中可以定位名为「阵法波动」的 11 秒条目。页面访问返回 HTTP 412，公开视频接口返回了 38:03 主视频的元数据和播放地址，媒体请求返回 HTTP 403。现有证据无法确定准确时间段、可见操作、实例布局、变换、透明度、相位传播或首尾行为。当前交付包含扩散虚影，阵法波动等待可观看片段。

## 验证

- **SOURCE** · 工具入口与 Domain 定向测试通过，共 37 项。覆盖边缘坐标归一化、四向循环含屏外回收、环绕遮挡、固定种子汇聚、固定中心虚影及正式入口一次提交。四工具保存重开、手改键、Undo/Redo、Stage / Product Preview / Export 正式帧序列及 off-grid 对照的定向集成测试通过。见 [交付回归提交](https://github.com/Cognitive-Architect/panda-stage/commit/117be62)。
- **本地命令** · `pnpm build` 含 `pnpm typecheck` 已通过，`pnpm lint` 与最终改动文件的 ESLint 检查已通过。首次并行执行时，`pnpm test:unit` 有 6 项超时，`pnpm test:integration` 有 5 项超时，部分超时伴随临时文件清理错误。涉及 FLA 导入、导出服务、媒体元数据和桌面自动化。
- **CI** · [代码基线 `d64868d` 的自动 Core CI](https://github.com/Cognitive-Architect/panda-stage/actions/runs/45536359985) 已通过 typecheck、lint、unit、integration、build。当前结果见 [PR Checks](https://github.com/Cognitive-Architect/panda-stage/pull/1265/checks)。
- **Windows 执行者** · 在 Windows Electron 43.1.1 正式构建中，通过项目中心打开含 640×360 不透明条纹 Graphic 的项目，在画布选中模板，经工具生成 15 个向左循环副本。通过时间轴采样第 0、6、23、24 帧，舞台像素匹配预期方向与相位，第 24 帧恢复第 0 帧图案。截图保存在执行机的 `D:\PandaStage-Acceptance\issues-1286-1289-an-demo\windows-89b6db4f-16e2-4607-8bd9-f77d5fa0127b`。其余工具的证据来自 SOURCE 和 CI，成品文件的 Windows 检查未纳入本次抽查。
- **OWNER UAT** · 待 OWNER 实机验收。
