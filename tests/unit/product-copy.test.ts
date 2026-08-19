import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PRODUCT_SURFACE_FILES = [
  'src/renderer/shell/StartScreen.tsx',
  'src/renderer/shell/NewProjectEntry.tsx',
  'src/renderer/shell/NewProjectDialog.tsx',
  'src/renderer/shell/CompactProjectBar.tsx',
  'src/renderer/shell/ProductPreviewOverlay.tsx',
  'src/renderer/shell/CloseConfirmDialog.tsx',
  'src/renderer/shell/closeProjectFlow.ts',
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

const ASSET_LIBRARY_SOURCE = readFileSync(
  'src/renderer/features/assets/AssetLibrary.tsx',
  'utf8',
);

function productSources(): string {
  return PRODUCT_SURFACE_FILES.map((path) => readFileSync(path, 'utf8')).join(
    '\n',
  );
}

describe('Stage 1A product copy', () => {
  it('keeps the normal FLA confirmation status localized and stage-free', () => {
    expect(ASSET_LIBRARY_SOURCE).toContain(
      '已确认 FLA 素材选择；尚未创建项目素材。',
    );
    expect(ASSET_LIBRARY_SOURCE).not.toContain('Read-only FLA selection intent');
    expect(ASSET_LIBRARY_SOURCE).not.toContain('Slice 3');
  });

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
      '产品预览',
      '当前项目还没有可预览的镜头',
      '关闭预览',
      '关闭当前项目',
      '保存后关闭',
      '不保存关闭',
      '取消',
    ]) {
      expect(source).toContain(text);
    }
    for (const text of [
      'Shot canvas',
      'Background preview unavailable',
      'This shot has no layers yet',
      'Fit to viewport',
      'Actual size',
      'Product preview',
      'No shot to preview',
      'Close preview',
      'Close project',
      'Save and close',
      'Close without saving',
    ]) {
      expect(source).not.toContain(text);
    }
  });

  it('warns that an unsaved close keeps the recovery record', () => {
    const source = productSources();

    expect(source).toContain(
      '不保存关闭会保留恢复记录，下次打开该项目可能出现恢复候选。',
    );
    // The in-app close must never promise to delete anything.
    expect(source).not.toContain('恢复记录将被删除');
    expect(source).not.toContain('丢弃恢复');
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
