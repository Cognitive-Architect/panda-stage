import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACTION_PRESETS } from '../../src/domain';

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

describe('Issue 127 Stage 3-B action preset integration contract', () => {
  it('T1-T4: makes RightInspector the only discoverable ActionPreset owner', () => {
    const editorShell = readSource('src/renderer/shell/EditorShell.tsx');
    const inspector = readSource('src/renderer/shell/RightInspector.tsx');
    const legacy = readSource('src/renderer/shell/LegacyWorkspace.tsx');
    const compatibility = readSource(
      'src/renderer/shell/LegacyCompatibilityActivity.tsx',
    );
    const panel = readSource(
      'src/renderer/features/actions/ActionPresetPanel.tsx',
    );

    expect(count(inspector, /<ActionPresetPanel/gu)).toBe(1);
    expect(count(inspector + legacy, /<ActionPresetPanel/gu)).toBe(1);
    expect(editorShell).not.toContain('<ActionPresetPanel');
    expect(inspector).toContain(
      'data-testid="right-inspector-action-presets"',
    );
    expect(compatibility).toContain('{active ? <LegacyWorkspace');
    expect(legacy).not.toContain('<ActionPresetPanel');
    expect(legacy).toContain('data-testid="legacy-workspace-empty"');
    expect(panel).toContain('ACTION_PRESETS.map');
    expect(panel).toContain('data-testid="action-preset-panel"');
    expect(ACTION_PRESETS.map((preset) => preset.label)).toEqual([
      '左入场',
      '右入场',
      '移动到',
      '放大强调',
      '抖动',
      '表情切换',
      '淡入',
      '淡出',
    ]);
  });

  it('T11-T14: preserves Stage 3-A owners and keeps the action section inside nested scroll', () => {
    const shell = readSource('src/renderer/shell/EditorShell.tsx');
    const inspector = readSource('src/renderer/shell/RightInspector.tsx');
    const canvasWorkspace = readSource('src/renderer/shell/CanvasWorkspace.tsx');
    const canvas = readSource('src/renderer/features/canvas/CanvasStage.tsx');
    const history = readSource('src/renderer/features/editor/HistoryControls.tsx');
    const styles = readSource('src/renderer/styles.css');

    expect(count(shell, /<RightInspector/gu)).toBe(1);
    expect(count(inspector, /<LayerBackgroundControl/gu)).toBe(1);
    expect(count(inspector, /<LayerTransformPanel/gu)).toBe(1);
    expect(count(inspector, /<LayerOrderControls/gu)).toBe(1);
    expect(count(canvasWorkspace, /<CanvasStage/gu)).toBe(1);
    expect(count(canvas, /<HistoryControls/gu)).toBe(1);
    expect(inspector).not.toContain('<HistoryControls');
    expect(styles).toMatch(
      /\.right-inspector\s*\{[\s\S]*?overflow-y:\s*auto;/u,
    );
    expect(styles).toMatch(
      /\.right-inspector-action-presets\s*\{[\s\S]*?min-width:\s*0;/u,
    );
    expect(styles).toMatch(
      /\.right-inspector-action-presets\s+\.action-preset-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/u,
    );
    expect(styles).toMatch(
      /html,[\s\S]*?#root\s*\{[\s\S]*?overflow:\s*hidden;/u,
    );
    expect(styles).toMatch(
      /\.editor-body\s*\{[\s\S]*?grid-template-columns:/u,
    );
    expect(history).toContain('data-testid="history-controls"');
  });
});
