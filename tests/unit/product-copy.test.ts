import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PRODUCT_SURFACE_FILES = [
  'src/renderer/shell/StartScreen.tsx',
  'src/renderer/shell/NewProjectEntry.tsx',
  'src/renderer/shell/EditorTopBar.tsx',
  'src/renderer/shell/RecoveryCandidateBanner.tsx',
  'src/renderer/shell/LegacyWorkspace.tsx',
  'src/renderer/features/welcome/RecentProjectsPanel.tsx',
  'src/renderer/features/recovery/ProjectRecoveryPanel.tsx',
  'src/renderer/features/assets/AssetImportPanel.tsx',
  'src/renderer/features/assets/AssetLibrary.tsx',
  'src/renderer/features/assets/AssetDetails.tsx',
  'src/renderer/features/characters/CharacterManager.tsx',
  'src/renderer/features/characters/CharacterEditor.tsx',
  'src/renderer/features/shots/ShotManager.tsx',
  'src/renderer/features/shots/ShotEditor.tsx',
  'src/renderer/features/shots/ShotThumbnailPlaceholder.tsx',
  'src/renderer/features/canvas/CanvasStage.tsx',
  'src/renderer/features/canvas/CanvasToolbar.tsx',
  'src/renderer/features/properties/LayerPositionPanel.tsx',
  'src/renderer/features/properties/LayerTransformPanel.tsx',
  'src/renderer/features/properties/LayerOrderControls.tsx',
  'src/renderer/features/editor/HistoryControls.tsx',
  'src/renderer/features/actions/ActionPresetPanel.tsx',
] as const;

function productSources(): string {
  return PRODUCT_SURFACE_FILES.map((path) => readFileSync(path, 'utf8')).join(
    '\n',
  );
}

describe('Stage 1A product copy', () => {
  it('does not expose construction DAY or GATE labels in product JSX', () => {
    const source = productSources();

    expect(source).not.toMatch(
      /className="eyebrow">\s*Day\s+\d+/iu,
    );
    expect(source).not.toMatch(/>\s*M\d+\s+gate\s*</iu);
    expect(source).not.toContain('aria-label="Day ');
  });

  it('uses Chinese product names and canvas states', () => {
    const source = productSources();

    for (const text of [
      '最近项目',
      '项目素材库',
      '角色与表情',
      '镜头管理',
      '镜头画布',
      '图层变换',
      '图层顺序',
      '编辑历史',
      '动作预设',
      '当前镜头还没有图层',
      '背景预览不可用',
    ]) {
      expect(source).toContain(text);
    }
    for (const text of [
      'Shot canvas',
      'Background preview unavailable',
      'This shot has no layers yet',
      'Fit to viewport',
      'Actual size',
    ]) {
      expect(source).not.toContain(text);
    }
  });

  it('distinguishes local apply actions from whole-project disk save', () => {
    const source = productSources();

    expect(source).toContain('应用名称修改');
    expect(source).toContain('应用时长修改');
    expect(source).toContain('保存整个项目');
    expect(source).toContain('修改已应用，项目尚未保存');
    expect(source).not.toContain('保存镜头');
  });

  it('focuses the canvas without scrolling the workspace', () => {
    const canvasSource = readFileSync(
      'src/renderer/features/canvas/CanvasStage.tsx',
      'utf8',
    );

    expect(canvasSource).toContain(
      'event.currentTarget.focus({ preventScroll: true })',
    );
  });
});
