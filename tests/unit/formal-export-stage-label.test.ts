import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stageRenderer = readFileSync('src/renderer/stage/StageRenderer.tsx', 'utf8');
const exportRenderer = readFileSync('src/export-renderer/ExportRendererApp.tsx', 'utf8');

describe('formal export stage chrome', () => {
  it('keeps the fixed label in Preview by default and omits it from formal export frames', () => {
    expect(stageRenderer).toMatch(/showStageLabel = true/u);
    expect(stageRenderer).toContain('visible={showStageLabel}');
    expect(stageRenderer).toContain('text="PANDA STAGE \u00b7 1920 \u00d7 1080"');
    expect(exportRenderer).toMatch(/<CanvasStage[\s\S]*?showStageLabel=\{false\}/u);
  });
});
