import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateShotCamera,
  isFullStageCamera,
  prepareShotCamera,
  ProjectSchema,
  resolveShotCamera,
  withShotCamera,
  type Project,
} from '../../src/domain';
import { buildProject } from './domain/testProject';

const ROOT = path.resolve(__dirname, '../..');

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function trackedProject(): Project {
  const base = buildProject();
  return ProjectSchema.parse({
    ...base,
    shots: base.shots.map((shot) => ({
      ...shot,
      durationMs: 6_000,
      camera: {
        mode: 'manual',
        keyframes: [
          { timeMs: 0, centerX: 960, centerY: 540, zoom: 1 },
          { timeMs: 3_000, centerX: 1_020, centerY: 560, zoom: 1.6 },
          { timeMs: 6_000, centerX: 1_300, centerY: 600, zoom: 1.35 },
        ],
      },
    })),
  });
}

describe('AUTO-07B one camera evaluation for Editor, Preview and Export', () => {
  it('resolves the same requested-time camera for every consumer', () => {
    const project = trackedProject();
    const shot = project.shots[0]!;
    const plan = prepareShotCamera(project, shot);

    for (const timeMs of [0, 1_500, 3_000, 4_500, 6_000]) {
      const evaluated = evaluateShotCamera(plan, timeMs);
      // Editor Canvas, Product Preview and the hidden Export renderer all call
      // this pair; the shared evaluator must stay the only camera authority.
      expect(evaluated).toEqual(resolveShotCamera(project, shot, timeMs));
    }
    expect(isFullStageCamera(resolveShotCamera(project, shot, 0), 1_920, 1_080)).toBe(true);
    expect(isFullStageCamera(resolveShotCamera(project, shot, 3_000), 1_920, 1_080)).toBe(false);
  });

  it('keeps the track attached to its Shot when the Project is edited', () => {
    const project = trackedProject();
    const shot = project.shots[0]!;
    const moved = withShotCamera(project, shot.id, {
      mode: 'manual',
      keyframes: [{ timeMs: 1_000, centerX: 800, centerY: 500, zoom: 2 }],
    });
    expect(resolveShotCamera(moved, moved.shots[0]!, 1_000)).toEqual({
      centerX: 800,
      centerY: 500,
      zoom: 2,
    });
    expect(resolveShotCamera(project, project.shots[0]!, 1_000).zoom).toBeLessThan(2);
  });

  it('routes every consumer through the shared evaluator', () => {
    const overlay = read('src/renderer/shell/ProductPreviewOverlay.tsx');
    const exportRenderer = read('src/export-renderer/ExportRendererApp.tsx');
    const canvas = read('src/renderer/features/canvas/CanvasStage.tsx');

    for (const source of [overlay, exportRenderer, canvas]) {
      expect(source).toContain('prepareShotCamera');
      expect(source).toContain('evaluateShotCamera');
      // No consumer may re-derive the camera from a session flag or its own
      // keyframe interpolation.
      expect(source).not.toContain('evaluateSpeakerFocusCamera');
      expect(source).not.toContain('SPEAKER_FOCUS_ZOOM');
    }
    // The Canvas applies the camera to a content group, never to layers.
    expect(canvas).toContain("'camera-world'");
    expect(canvas).not.toContain('cameraLayerOffset');

    const editorShell = read('src/renderer/shell/EditorShell.tsx');
    expect(editorShell).toContain('resolveProjectCameraMode(');
    expect(editorShell).not.toContain('autoCameraEnabled ?');
  });
});
