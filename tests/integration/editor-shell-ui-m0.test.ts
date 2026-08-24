import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

describe('Issue #315 UI-M0 ownership and non-mutation contracts', () => {
  it('keeps one authoritative production owner for each editor region', () => {
    const app = readSource('src/renderer/App.tsx');
    const shell = readSource('src/renderer/shell/EditorShell.tsx');
    const left = readSource('src/renderer/shell/LeftWorkspace.tsx');
    const resourceDock = readSource(
      'src/renderer/shell/ResourceActivityDock.tsx',
    );
    const canvas = readSource('src/renderer/shell/CanvasWorkspace.tsx');
    const inspector = readSource('src/renderer/shell/RightInspector.tsx');
    const bottom = readSource('src/renderer/shell/BottomWorkspace.tsx');
    const legacy = readSource('src/renderer/shell/LegacyWorkspace.tsx');
    const compatibility = readSource(
      'src/renderer/shell/LegacyCompatibilityActivity.tsx',
    );
    const projectStore = readSource('src/renderer/stores/EditorProjectStore.ts');

    expect(count(app, /<EditorShell/gu)).toBe(1);
    expect(count(shell, /new ProjectSessionController/gu)).toBe(1);
    expect(count(shell, /<LeftWorkspace/gu)).toBe(1);
    expect(count(shell, /<CanvasWorkspace/gu)).toBe(1);
    expect(count(shell, /<RightInspector/gu)).toBe(1);
    expect(count(shell, /<BottomWorkspace/gu)).toBe(1);
    expect(count(left, /<ResourceActivityDock/gu)).toBe(1);
    expect(count(resourceDock, /<ShotManager/gu)).toBe(1);
    expect(count(resourceDock, /<AssetLibrary/gu)).toBe(1);
    expect(count(resourceDock, /<CharacterManager/gu)).toBe(1);
    expect(count(canvas, /<CanvasStage/gu)).toBe(1);
    expect(count(inspector, /<LayerBackgroundControl/gu)).toBe(1);
    expect(count(inspector, /<LayerTransformPanel/gu)).toBe(1);
    expect(count(inspector, /<LayerOrderControls/gu)).toBe(1);
    expect(count(bottom, /<TimelineDock/gu)).toBe(1);
    expect(count(bottom, /<HistoryControls/gu)).toBe(1);
    expect(count(legacy, /<CanvasStage/gu)).toBe(0);
    expect(count(legacy, /<HistoryControls/gu)).toBe(0);
    expect(count(compatibility, /<LegacyWorkspace/gu)).toBe(1);
    expect(count(projectStore, /export const editorProjectStore =/gu)).toBe(1);
    expect(count(projectStore, /export const historyStore =/gu)).toBe(1);
  });

  it('keeps stable selectors attached to their real production owners', () => {
    const shell = readSource('src/renderer/shell/EditorShell.tsx');
    const left = readSource('src/renderer/shell/LeftWorkspace.tsx');
    const canvas = readSource('src/renderer/shell/CanvasWorkspace.tsx');
    const inspector = readSource('src/renderer/shell/RightInspector.tsx');
    const bottom = readSource('src/renderer/shell/BottomWorkspace.tsx');
    const timeline = readSource(
      'src/renderer/features/timeline/TimelineDock.tsx',
    );
    const history = readSource(
      'src/renderer/features/editor/HistoryControls.tsx',
    );

    expect(shell).toContain('data-testid="editor-layout"');
    expect(shell).toContain('data-testid="editor-body"');
    expect(left).toContain('data-testid="left-workspace-scroll"');
    expect(canvas).toContain('data-testid="canvas-workspace-scroll"');
    expect(inspector).toContain('data-testid="right-inspector"');
    expect(inspector).toContain('data-testid="inspector-rail-handle"');
    expect(inspector).toContain('data-testid="right-inspector-drawer"');
    expect(bottom).toContain('data-testid="bottom-workspace"');
    expect(timeline).toContain('data-testid="timeline-dock"');
    expect(timeline).toContain('data-testid="timeline-collapse"');
    expect(timeline).toContain('data-testid="timeline-ruler-scroll"');
    expect(timeline).toContain('data-testid="timeline-playhead"');
    expect(history).toContain('data-testid="history-controls"');
    expect(history).toContain('data-undo-count={history.undoCount}');
    expect(history).toContain('data-redo-count={history.redoCount}');
  });

  it('keeps responsive and view-only state outside Project persistence', () => {
    const timeline = readSource(
      'src/renderer/features/timeline/timelineUiStore.ts',
    );
    const viewport = readSource(
      'src/renderer/stores/canvasViewportStore.ts',
    );
    const resourceDock = readSource(
      'src/renderer/shell/ResourceActivityDock.tsx',
    );
    const inspector = readSource('src/renderer/shell/RightInspector.tsx');
    const flags = readSource('src/renderer/shell/useDebugFlag.ts');
    const styles = readSource('src/renderer/styles.css');

    for (const source of [timeline, viewport, resourceDock, inspector, flags]) {
      expect(source).not.toContain('editorProjectStore.updateProject');
      expect(source).not.toContain('editorProjectStore.restore');
      expect(source).not.toContain('historyStore.execute');
    }
    expect(timeline).toContain('UI-only');
    expect(timeline).toContain('setExpanded');
    expect(timeline).toContain('setZoom');
    expect(timeline).toContain('setScrollPx');
    expect(viewport).toContain('setMode');
    expect(resourceDock).toContain('useNarrowViewport');
    expect(inspector).toContain('useNarrowViewport');
    expect(styles).toMatch(
      /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.editor-body\s*\{[\s\S]*?grid-template-columns:/u,
    );
    expect(styles).toMatch(
      /@media\s*\(max-width:\s*720px\)[\s\S]*?\.bottom-workspace\s*\{/u,
    );
    expect(flags).not.toContain('editorProjectStore');
    expect(flags).not.toContain('revision');
  });

  it('keeps the UI-M0 measurement harness outside production source', () => {
    const harness = readSource('scripts/issue315-ui-m0-electron-acceptance.cjs');

    expect(harness).toContain("require('electron')");
    expect(harness).toContain('window.innerWidth');
    expect(harness).toContain('devicePixelRatio');
    expect(harness).toContain('softKeyboard');
    expect(harness).toContain('pointerMode');
    expect(harness).not.toContain('src/renderer/');
    expect(harness).not.toMatch(/readFileSync\([^\n]*project\.json/u);
  });

  it('keeps the Wuying/Redmi target sampler explicit and non-synthetic', () => {
    const harness = readSource('scripts/issue315-ui-m0-electron-acceptance.cjs');
    const manualStart = harness.indexOf('async function runManualTarget');
    const manualEnd = harness.indexOf('async function openFixture');
    const manualSection = harness.slice(manualStart, manualEnd);

    expect(harness).toContain("MANUAL_TARGET_PROFILE = 'wuying-redmi-manual'");
    expect(harness).toContain('landscape-before-keyboard');
    expect(harness).toContain('portrait-keyboard-visible');
    expect(harness).toContain('portrait-keyboard-dismissed');
    expect(harness).toContain('landscape-round-trip');
    expect(harness).toContain('pointer-touch');
    expect(harness).toContain('keyboard_before_innerHeight');
    expect(harness).toContain('keyboard_visible_innerHeight');
    expect(harness).toContain('keyboard_after_innerHeight');
    expect(harness).toContain('cloudClientScaleObservation');
    expect(harness).toContain('maintainer-observed Wuying client UI');
    expect(harness).toContain('repository: repositoryEvidence()');
    expect(harness).toContain('sourceRefs: sourceReferences()');
    expect(harness).toContain('syntheticViewportResize: false');
    expect(manualSection).not.toContain('resizeContent(');
    expect(manualSection).not.toContain('sendInputEvent');
  });
});
