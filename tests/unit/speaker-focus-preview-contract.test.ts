import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commitStageVisualFrame, selectStageVisualFrame } from '../../src/renderer/stage/stageVisualFrame';

const overlay = readFileSync('src/renderer/shell/ProductPreviewOverlay.tsx', 'utf8');
const renderer = readFileSync('src/renderer/stage/StageRenderer.tsx', 'utf8');
const shell = readFileSync('src/renderer/shell/EditorShell.tsx', 'utf8');

describe('Speaker Focus Preview integration contract', () => {
  it('keeps the opt-in local to a newly mounted Preview and uses one resolver in both ranges', () => {
    expect(overlay).toContain("useState(false);");
    expect(overlay).toContain('data-testid="product-preview-speaker-focus"');
    expect(overlay).toContain('aria-pressed={speakerFocus}');
    expect(overlay).toContain('resolveSpeakerFocusCamera(project, shot, activeShotTimeMs)');
    expect(overlay).toContain('camera={camera}');
    expect(shell).toContain('setProductPreviewOpen(false)');
    expect(overlay).not.toMatch(/updateProject|HistoryStore|setDirty|setRevision/);
  });

  it('places world under Camera while screen-space subtitle and diagnostics stay outside', () => {
    const worldStart = renderer.indexOf('<Group\n            listening={false}\n            x={displayModel!');
    const worldEnd = renderer.indexOf('</Group>', worldStart);
    const subtitle = renderer.indexOf('<SubtitleRenderer', worldStart);
    expect(worldStart).toBeGreaterThan(0);
    expect(worldEnd).toBeGreaterThan(worldStart);
    expect(subtitle).toBeGreaterThan(worldEnd);
    expect(renderer.indexOf('<Text\n', subtitle)).toBeGreaterThan(subtitle);
  });

  it('holds Camera with the exact completed visual frame during image replacement', () => {
    const old = { model: { timeMs: 10 }, caption: 'A', camera: { centerX: 640, centerY: 500, zoom: 1.5 } };
    const desired = { model: { timeMs: 20 }, caption: 'B', camera: { centerX: 1280, centerY: 500, zoom: 1.5 } };
    const committed = commitStageVisualFrame(null, old, true);
    expect(selectStageVisualFrame(committed, desired, false)).toEqual(old);
    expect(renderer).toContain('displayFrame ? displayFrame.camera : camera');
  });
});
