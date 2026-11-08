import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cameraViewFromCenter,
  evaluateShotCamera,
  prepareShotCamera,
  ProjectSchema,
  resolveCameraToolPreview,
  SHOT_CAMERA_MAX_ZOOM,
  stepShotCameraZoom,
  type CameraView,
} from '../../src/domain';
import { CameraToolStore } from '../../src/renderer/features/camera/cameraToolStore';
import {
  readLiveShotCameraTarget,
  recordShotCameraKeyframe,
} from '../../src/renderer/features/camera/shotCameraActions';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { buildProject, IDS } from './domain/testProject';

const ROOT = path.resolve(__dirname, '../..');
const read = (relativePath: string): string =>
  readFileSync(path.join(ROOT, relativePath), 'utf8');
const WIDTH = 1_920;
const HEIGHT = 1_080;
const PROJECT_ROOT = 'D:/camera-tool-lifecycle-fixture.pandastage';
const FULL_STAGE: CameraView = { centerX: 960, centerY: 540, zoom: 1 };

function openProject(): void {
  editorProjectStore.open(PROJECT_ROOT, buildProject());
  shotStore.select(IDS.shot);
}

describe('AUTO-07-FIX-01 framing preview follows the draft', () => {
  it('previews the clamped draft instead of the persisted camera after dragging', () => {
    const draft: CameraView = { centerX: 700, centerY: 420, zoom: 1.8 };
    const tool = { previewing: true, draft };
    expect(
      resolveCameraToolPreview(tool, FULL_STAGE, WIDTH, HEIGHT),
    ).toEqual(draft);

    const outOfRange = { centerX: -500, centerY: 9_999, zoom: 99 };
    expect(
      resolveCameraToolPreview(
        { previewing: true, draft: outOfRange },
        FULL_STAGE,
        WIDTH,
        HEIGHT,
      ),
    ).toEqual(
      cameraViewFromCenter(-500, 9_999, SHOT_CAMERA_MAX_ZOOM, WIDTH, HEIGHT),
    );
  });

  it('keeps the untouched persisted trajectory when no draft exists', () => {
    const persisted: CameraView = { centerX: 1_020, centerY: 560, zoom: 1.6 };
    expect(
      resolveCameraToolPreview(
        { previewing: true, draft: null },
        persisted,
        WIDTH,
        HEIGHT,
      ),
    ).toEqual(persisted);
    expect(
      resolveCameraToolPreview(
        { previewing: false, draft: null },
        persisted,
        WIDTH,
        HEIGHT,
      ),
    ).toBeNull();
    expect(
      resolveCameraToolPreview(
        { previewing: true, draft: null },
        null,
        WIDTH,
        HEIGHT,
      ),
    ).toBeNull();
    expect(
      resolveCameraToolPreview(
        { previewing: true, draft: FULL_STAGE },
        persisted,
        WIDTH,
        HEIGHT,
      ),
    ).toBeNull();
  });

  it('drag -> preview -> record stays one History step with the draft values', () => {
    openProject();
    const tool = new CameraToolStore();
    tool.setActive(true);
    const draft = cameraViewFromCenter(700, 420, 1.8, WIDTH, HEIGHT);
    tool.setDraft(draft);
    tool.setPreviewing(true);
    expect(
      resolveCameraToolPreview(tool.getSnapshot(), FULL_STAGE, WIDTH, HEIGHT),
    ).toEqual(draft);

    const target = readLiveShotCameraTarget()!;
    const revision = editorProjectStore.getSnapshot()!.revision;
    recordShotCameraKeyframe(target, tool.getSnapshot().draft!, 1_200);
    expect(editorProjectStore.getSnapshot()!.revision).toBe(revision + 1);
    expect(readLiveShotCameraTarget()!.shot.camera).toEqual({
      mode: 'manual',
      keyframes: [{ timeMs: 1_200, ...draft }],
    });
    expect(editorProjectStore.undo()).toBe(true);
    expect(readLiveShotCameraTarget()!.shot.camera.keyframes).toEqual([]);
  });
});

describe('AUTO-07-FIX-01 camera tool lifecycle', () => {
  it('reset clears only session state, never the saved Shot.camera', () => {
    openProject();
    recordShotCameraKeyframe(
      readLiveShotCameraTarget()!,
      { centerX: 900, centerY: 520, zoom: 1.4 },
      800,
    );
    const saved = readLiveShotCameraTarget()!.shot.camera;

    const tool = new CameraToolStore();
    tool.setActive(true);
    tool.setDraft({ centerX: 700, centerY: 420, zoom: 1.8 });
    tool.setPreviewing(true);
    tool.reset();
    expect(tool.getSnapshot()).toEqual({
      active: false,
      previewing: false,
      draft: null,
    });
    tool.reset();
    expect(tool.getSnapshot().draft).toBeNull();
    tool.setActive(true);
    tool.setDraft({ centerX: 700, centerY: 420, zoom: 1.8 });
    tool.setActive(false);
    expect(tool.getSnapshot().draft).toBeNull();
    expect(readLiveShotCameraTarget()!.shot.camera).toEqual(saved);
  });

  it('clears the tool on exit and on Shot/Project identity change', () => {
    const drawer = read('src/renderer/shell/ProjectToolsDrawer.tsx');
    const panel = read('src/renderer/features/camera/ShotCameraPanel.tsx');
    const back = drawer.slice(
      drawer.indexOf('data-testid="project-tools-back"'),
    );
    expect(back.slice(0, 220)).toContain('cameraToolStore.reset()');
    // Unmount covers the close button, Escape and activity switches.
    expect(drawer).toContain(
      'useEffect(() => () => cameraToolStore.reset(), [])',
    );
    expect(panel).toContain('[projectId, currentShotId]');
    expect(panel).toMatch(
      /useEffect\(\(\) => \{\s*cameraToolStore\.reset\(\);/,
    );
  });
});

describe('AUTO-07-FIX-01 screen-space subtitles and touch zoom', () => {
  it('keeps Editor subtitles outside the camera-world Group on a push-in + pan', () => {
    const canvas = read('src/renderer/features/canvas/CanvasStage.tsx');
    const world = canvas.indexOf("'camera-world'");
    const groupClose = canvas.indexOf('</Group>', world);
    const subtitle = canvas.indexOf('<SubtitleRenderer', world);
    expect(world).toBeGreaterThan(0);
    expect(groupClose).toBeGreaterThan(world);
    expect(subtitle).toBeGreaterThan(groupClose);

    const base = buildProject();
    const project = ProjectSchema.parse({
      ...base,
      shots: [
        {
          ...base.shots[0]!,
          durationMs: 6_000,
          camera: {
            mode: 'manual',
            keyframes: [
              { timeMs: 0, centerX: 960, centerY: 540, zoom: 1 },
              { timeMs: 3_000, centerX: 1_020, centerY: 560, zoom: 1.6 },
              { timeMs: 6_000, centerX: 1_300, centerY: 600, zoom: 1.35 },
            ],
          },
        },
      ],
    });
    const plan = prepareShotCamera(project, project.shots[0]!);
    const mid = evaluateShotCamera(plan, 3_000);
    expect(mid.zoom).toBeGreaterThan(1);
    expect(mid.centerX).not.toBe(960);
  });

  it('offers bounded tap zoom controls that reuse the wheel zoom step', () => {
    const overlay = read(
      'src/renderer/features/canvas/CameraFramingOverlay.tsx',
    );
    expect(overlay).toContain('camera-framing-zoom-in');
    expect(overlay).toContain('camera-framing-zoom-out');
    expect(overlay).toContain('onTap={() => zoomBy(control.factor)}');
    expect(overlay).toContain('stepShotCameraZoom(view.zoom, factor)');
    expect(stepShotCameraZoom(7.9, 1.1)).toBe(SHOT_CAMERA_MAX_ZOOM);
    expect(stepShotCameraZoom(1, 0.1)).toBe(1);
    expect(stepShotCameraZoom(Number.NaN, 1.1)).toBe(1);
  });
});
