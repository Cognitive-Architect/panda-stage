/**
 * Issue #162 — editor ActionPreset preview contract locks.
 *
 * Source-level guarantees that the preview reuses the FORMAL evaluator/renderer
 * and stays strictly read-only (never touches the project, revision, dirty flag,
 * selection or history), and that it is mounted only while a preview session is
 * active (no hidden DOM, editor base render path preserved).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const OVERLAY_PATH =
  'src/renderer/features/actions/EditorActionPreviewOverlay.tsx';
const CANVAS_PATH = 'src/renderer/features/canvas/CanvasStage.tsx';
const PANEL_PATH = 'src/renderer/features/actions/ActionPresetPanel.tsx';
const STORE_PATH = 'src/renderer/features/actions/editorActionPreviewStore.ts';

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('editor action preview contract', () => {
  it('reuses the formal evaluator and renderer instead of a preview copy', () => {
    const overlay = readSource(OVERLAY_PATH);
    const store = readSource(STORE_PATH);

    expect(overlay).toContain('evaluatePreviewFrame');
    expect(overlay).toContain("from '../../stage/CanvasStage'");
    expect(overlay).toContain('<CanvasStage');
    // No preview-only evaluation / drawing implementation.
    expect(overlay).not.toContain('react-konva');
    expect(overlay).not.toContain('buildStageRenderModel(');
    expect(store).not.toContain('evaluateShotAtTime(');
    expect(store).toContain("import type { EditorActionPreviewSession } from './editorActionPreviewModel'");
  });

  it('never writes the project, revision, dirty flag, selection or history', () => {
    const overlay = readSource(OVERLAY_PATH);
    for (const forbidden of [
      'editorProjectStore',
      'selectionStore',
      'layerStore',
      'shotStore',
      'historyStore',
      'canvasViewportStore',
      'updateProject(',
      'restore(',
      '.select(',
      'window.pandaStage.project',
      'window.pandaStage.autosave',
      'window.pandaStage.recovery',
    ]) {
      expect(overlay).not.toContain(forbidden);
    }
    // Both reads are read-only; original canvas bytes are preferred and the
    // thumbnail path is an explicit last-resort fallback.
    expect(overlay).toContain('window.pandaStage.assets.readCanvasImage');
    expect(overlay).toContain('window.pandaStage.assets.readThumbnail');
    expect(overlay).toContain('Fall through to the bounded thumbnail fallback');
  });

  it('is mounted only while a preview session is active (no hidden DOM)', () => {
    const canvas = readSource(CANVAS_PATH);

    expect(canvas).toContain('EditorActionPreviewOverlay');
    // The editor's own (base-layer) render path must remain intact.
    expect(canvas).toContain('buildEditorStageRenderModel');
    // Mounted conditionally on the preview being active.
    expect(canvas).toMatch(
      /preview\.active\s*\?\s*\(\s*<EditorActionPreviewOverlay/u,
    );
  });

  it('keeps the overlay hidden until StageRenderer reports a valid first frame', () => {
    const overlay = readSource(OVERLAY_PATH);

    expect(overlay).toContain('onReady={handlePreviewReady}');
    expect(overlay).toContain(
      "visibility: previewStageReady ? 'visible' : 'hidden'",
    );
    expect(overlay).toContain('data-preview-authoritative={String(previewStageReady)}');
  });

  it('prefers original canvas bytes and revokes transient object URLs', () => {
    const overlay = readSource(OVERLAY_PATH);
    const originalRead = overlay.indexOf(
      'window.pandaStage.assets.readCanvasImage',
    );
    const thumbnailRead = overlay.indexOf(
      'window.pandaStage.assets.readThumbnail',
    );

    expect(originalRead).toBeGreaterThan(-1);
    expect(thumbnailRead).toBeGreaterThan(originalRead);
    expect(overlay).toContain('new Blob([response.bytes]');
    expect(overlay).toContain('URL.createObjectURL');
    expect(overlay).toContain('URL.revokeObjectURL');
  });

  it('panel triggers a bounded preview after apply and offers replay', () => {
    const panel = readSource(PANEL_PATH);

    expect(panel).toContain('editorActionPreviewStore.start');
    expect(panel).toContain('previewWindowFromEvents');
    expect(panel).toContain('triggerPreviewAfterApply');
    expect(panel).toContain('data-testid="action-preset-replay"');
    expect(panel).toContain('editorActionPreviewStore.replay');
  });
});
