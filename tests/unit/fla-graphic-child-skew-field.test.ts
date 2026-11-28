// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FlaGraphicStructureSchema,
  LayerService,
  ProjectSchema,
  composeAffineMatrix,
  decomposeAffineMatrix,
  type FlaGraphicDefinition,
  type Project,
} from '../../src/domain';
import type { AffineMatrix2D } from '../../src/shared/affine-matrix';
import { resolveFlaGraphicEditTarget } from '../../src/renderer/features/canvas/flaGraphicEditScope';
import { FlaGraphicChildTransform } from '../../src/renderer/features/properties/FlaGraphicChildTransform';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { buildProjectWithAnimation, IDS } from './domain/testProject';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FLA_FRAME_ASSET_ID = '10000000-0000-4000-8000-000000000004';
const SHEARED: AffineMatrix2D = { a: 1, b: 0, c: 0.45, d: 1, tx: 12, ty: -8 };
const TRS: AffineMatrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 };

function skewFieldFixture(): {
  project: Project;
  shotId: string;
  layerId: string;
  definition: FlaGraphicDefinition;
} {
  const base = buildProjectWithAnimation();
  const animation = base.animations[0]!;
  const frameAsset = {
    id: FLA_FRAME_ASSET_ID,
    kind: 'image' as const,
    name: 'Graphic frame',
    relativePath: 'assets/graphic-frame.svg',
    mimeType: 'image/svg+xml',
    sha256: 'e'.repeat(64),
    width: 640,
    height: 640,
    usage: 'uncategorized' as const,
    keywords: [],
    flaGraphicFrame: { definitionId: animation.id, ordinal: 0 },
  };
  const structure = FlaGraphicStructureSchema.parse({
    version: 1,
    timeline: {
      tracks: [
        {
          trackId: 'addr:Hero/Layer1/sheared',
          keyframes: [
            { timeMs: 0, transform: decomposeAffineMatrix(SHEARED), easing: 'linear' },
          ],
        },
        {
          trackId: 'addr:Hero/Layer1/trs',
          keyframes: [
            {
              timeMs: 0,
              transform: { tx: TRS.tx, ty: TRS.ty, rotationDeg: 0, scaleX: 1, scaleY: 1 },
              easing: 'linear',
            },
          ],
        },
      ],
    },
    frames: [
      {
        ordinal: 0,
        layers: [
          {
            name: 'Body',
            nodes: [
              {
                type: 'bitmap',
                id: 'sheared',
                sourceAddress: 'Hero/Layer1/sheared',
                drawOrder: 0,
                localTransform: SHEARED,
                bitmapRef: 'Library/sheared.png',
                assetId: IDS.assetChar,
              },
              {
                type: 'bitmap',
                id: 'trs',
                sourceAddress: 'Hero/Layer1/trs',
                drawOrder: 1,
                localTransform: TRS,
                bitmapRef: 'Library/trs.png',
                assetId: IDS.assetChar,
              },
            ],
          },
        ],
      },
    ],
  });
  const definition: FlaGraphicDefinition = {
    ...animation,
    kind: 'fla-graphic',
    durationMs: 40,
    source: {
      ...animation.source,
      endFrameIndex: animation.source.startFrameIndex,
    },
    frames: [
      {
        ...animation.frames[0]!,
        ordinal: 0,
        assetId: frameAsset.id,
        sha256: frameAsset.sha256,
        createdBySequenceImport: false,
      },
    ],
    structure,
  };
  let project = ProjectSchema.parse({
    ...base,
    assets: [...base.assets, frameAsset],
    animations: [definition],
  });
  const service = new LayerService();
  const shotId = project.shots[0]!.id;
  const created = service.createFromAsset(project, shotId, {
    version: 3,
    type: 'animation',
    animationId: definition.id,
    position: { x: 400, y: 300 },
    startTimeMs: 0,
  });
  project = created.project;
  return { project, shotId, layerId: created.layer.id, definition };
}

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;

function renderInspector(): HTMLDivElement {
  mountedContainer = document.createElement('div');
  document.body.appendChild(mountedContainer);
  mountedRoot = createRoot(mountedContainer);
  act(() => {
    mountedRoot!.render(createElement(FlaGraphicChildTransform));
  });
  return mountedContainer;
}

afterEach(() => {
  if (mountedRoot) {
    act(() => mountedRoot!.unmount());
    mountedRoot = null;
  }
  mountedContainer?.remove();
  mountedContainer = null;
  editorProjectStore.clear();
  selectionStore.clear();
  timelineUiStore.setFlaGraphicInternalContext(null);
});

describe('FLA Graphic internal affine editing surface (#1451)', () => {
  it('shows the 斜切 field for a sheared node and commits it as one undoable affine key edit', () => {
    const { project, shotId, layerId, definition } = skewFieldFixture();
    editorProjectStore.open('C:\\dummy\\skew-field.pandastage', project);
    shotStore.select(shotId);
    selectionStore.selectExplicit(layerId);
    timelineUiStore.setFlaGraphicInternalContext({
      layerId,
      animationId: definition.id,
      frameOrdinal: 0,
      selectedNodePath: ['sheared'],
      internalTimeMs: 0,
      fps: 24,
      timelineAuthoringActive: true,
    });
    const snapshot = editorProjectStore.getSnapshot()!;
    const target = resolveFlaGraphicEditTarget({
      project: snapshot.project,
      projectRoot: snapshot.projectRoot,
      projectInstanceId: editorProjectStore.getProjectInstanceId(),
      shot: snapshot.project.shots[0]!,
      layerId,
    })!;
    selectionStore.setStructuredEditScope({
      targetKey: target.key,
      sessionKey: target.sessionKey,
      editMode: 'definition',
      frameOrdinal: 0,
      path: [],
    });
    selectionStore.setSelectedStructuredNodeSelection(['sheared']);

    const container = renderInspector();
    const fieldset = container.querySelector('fieldset')!;
    expect(fieldset.disabled).toBe(false);
    const skewInput = container.querySelector<HTMLInputElement>('input[name="skew"]');
    expect(skewInput).not.toBeNull();
    expect(skewInput!.labels?.[0]?.textContent ?? '').toContain('斜切');
    const expectedSkew = decomposeAffineMatrix(SHEARED).skewXDeg ?? 0;
    expect(Number(skewInput!.value)).toBeCloseTo(Number(expectedSkew.toFixed(3)), 6);

    // One confirm/gesture = one undo entry; the key stores the exact affine shear.
    const undoBefore = editorProjectStore.history.getSnapshot().undoCount;
    act(() => {
      skewInput!.value = '10';
      container.querySelector('form')!.requestSubmit();
    });
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoBefore + 1);
    const editedProject = editorProjectStore.getSnapshot()!.project;
    const editedDefinition = editedProject.animations[0] as FlaGraphicDefinition;
    const keyframe = editedDefinition.structure!.timeline!.tracks.find(
      (track) => track.trackId === 'addr:Hero/Layer1/sheared',
    )!.keyframes[0]!;
    expect(keyframe.transform.skewXDeg).toBeCloseTo(10, 6);
    const expectedMatrix = composeAffineMatrix({
      ...decomposeAffineMatrix(SHEARED),
      skewXDeg: 10,
    });
    const tracked = composeAffineMatrix(keyframe.transform);
    for (const key of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const) {
      expect(tracked[key]).toBeCloseTo(expectedMatrix[key], 9);
    }
  });

  it('keeps the historical five-field inspector for a plain TRS node', () => {
    const { project, shotId, layerId, definition } = skewFieldFixture();
    editorProjectStore.open('C:\\dummy\\skew-field.pandastage', project);
    shotStore.select(shotId);
    selectionStore.selectExplicit(layerId);
    timelineUiStore.setFlaGraphicInternalContext({
      layerId,
      animationId: definition.id,
      frameOrdinal: 0,
      selectedNodePath: ['trs'],
      internalTimeMs: 0,
      fps: 24,
      timelineAuthoringActive: true,
    });
    const snapshot = editorProjectStore.getSnapshot()!;
    const target = resolveFlaGraphicEditTarget({
      project: snapshot.project,
      projectRoot: snapshot.projectRoot,
      projectInstanceId: editorProjectStore.getProjectInstanceId(),
      shot: snapshot.project.shots[0]!,
      layerId,
    })!;
    selectionStore.setStructuredEditScope({
      targetKey: target.key,
      sessionKey: target.sessionKey,
      editMode: 'definition',
      frameOrdinal: 0,
      path: [],
    });
    selectionStore.setSelectedStructuredNodeSelection(['trs']);

    const container = renderInspector();
    expect(container.querySelector('fieldset')!.disabled).toBe(false);
    expect(container.querySelector('input[name="rotation"]')).not.toBeNull();
    expect(container.querySelector('input[name="skew"]')).toBeNull();
    expect(container.textContent ?? '').not.toContain('斜切');
  });
});
