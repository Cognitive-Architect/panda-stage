import { describe, expect, it } from 'vitest';
import {
  LayerService,
  ProjectSchema,
  layoutVisualRectAt,
  listLayoutTargets,
  planLayerLayout,
  resolveLayoutVisualMetrics,
  type Layer,
  type LayoutAlignAction,
  type LayoutLayerTransform,
  type LayoutVisualRect,
  type Project,
  type Shot,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { buildProject, IDS } from './domain/testProject';

const LAYER_A = '60000000-0000-4000-8000-0000000000b1';
const LAYER_B = '60000000-0000-4000-8000-0000000000b2';
const LAYER_C = '60000000-0000-4000-8000-0000000000b3';
const LAYER_D = '60000000-0000-4000-8000-0000000000b4';
const MOVE_EVENT = '80000000-0000-4000-8000-0000000000b1';
const SCALE_EVENT = '80000000-0000-4000-8000-0000000000b2';
/** The fixture Character asset is 640x640, so a half extent is 320 * scale. */
const CHARACTER_HALF = 320;

function characterLayer(
  id: string,
  name: string,
  scale: number,
  zIndex: number,
  overrides: Partial<Layer> = {},
): Layer {
  return {
    id,
    name,
    source: {
      kind: 'character',
      characterId: IDS.character,
      expressionId: IDS.expressionNormal,
    },
    anchor: 'center',
    x: 400,
    y: 400,
    scaleX: scale,
    scaleY: scale,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    zIndex,
    locked: false,
    flipX: false,
    ...overrides,
  };
}

function assetLayer(
  id: string,
  name: string,
  assetId: string,
  scale: number,
  zIndex: number,
  overrides: Partial<Layer> = {},
): Layer {
  return {
    id,
    name,
    source: { kind: 'asset', assetId },
    anchor: 'center',
    x: 1200,
    y: 600,
    scaleX: scale,
    scaleY: scale,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    zIndex,
    locked: false,
    flipX: false,
    ...overrides,
  };
}

/**
 * Four differently sized objects: two Characters (256px and 160px visuals), a
 * wide 1920x1080 prop at 0.1 (192x108) and a square prop at 0.2 (128px).
 */
function fixture(input: {
  a?: Partial<Layer>;
  b?: Partial<Layer>;
  c?: Partial<Layer>;
  d?: Partial<Layer>;
  timelineEvents?: Shot['timelineEvents'];
} = {}): Project {
  const base = buildProject();
  const shot = base.shots[0]!;
  const background = shot.layers.find((layer) => layer.id === IDS.layerBg)!;
  return ProjectSchema.parse({
    ...base,
    shots: [
      {
        ...shot,
        timelineEvents: input.timelineEvents ?? [],
        layers: [
          background,
          characterLayer(LAYER_A, '张三', 0.4, 2, {
            x: 400,
            y: 400,
            ...input.a,
          }),
          characterLayer(LAYER_B, '李四', 0.25, 3, {
            x: 800,
            y: 500,
            ...input.b,
          }),
          assetLayer(LAYER_C, '桌子', IDS.assetBg, 0.1, 4, {
            x: 1200,
            y: 600,
            ...input.c,
          }),
          assetLayer(LAYER_D, '杯子', IDS.assetChar2, 0.2, 5, {
            x: 1500,
            y: 450,
            ...input.d,
          }),
        ],
      },
    ],
  });
}

function shotOf(project: Project): Shot {
  return project.shots[0]!;
}

function layersOf(project: Project): Map<string, Layer> {
  return new Map(shotOf(project).layers.map((layer) => [layer.id, layer]));
}

/** Independent geometry read: the rendered visual rect of one Layer. */
function rectOf(project: Project, layerId: string): LayoutVisualRect {
  const layer = layersOf(project).get(layerId)!;
  const metrics = resolveLayoutVisualMetrics(project, shotOf(project)).get(
    layerId,
  )!;
  return layoutVisualRectAt(metrics, { x: layer.x, y: layer.y });
}

function planOrThrow(
  project: Project,
  action: LayoutAlignAction,
  layerIds: readonly string[],
  referenceLayerId?: string | null,
): readonly LayoutLayerTransform[] {
  const result = planLayerLayout(project, shotOf(project), {
    action,
    layerIds,
    referenceLayerId,
  });
  if (!result.ok) {
    throw new Error(`expected a plan, got ${result.reason}: ${result.message}`);
  }
  return result.plan.transforms;
}

/** Commit a plan through the formal service, exactly like the store does. */
function commit(
  project: Project,
  transforms: readonly LayoutLayerTransform[],
): Project {
  const service = new LayerService();
  let next = project;
  for (const transform of transforms) {
    next = service.updateLayoutTransform(next, shotOf(project).id, transform.layerId, {
      x: transform.x,
      y: transform.y,
      scaleX: transform.scaleX,
      scaleY: transform.scaleY,
    });
  }
  return next;
}

function closeTo(actual: number, expected: number, digits = 3): void {
  expect(actual).toBeCloseTo(expected, digits);
}

describe('EF-02 layout targets', () => {
  it('lists Characters and props of the shot but never the background', () => {
    const project = fixture();
    const options = listLayoutTargets(project, shotOf(project));

    expect(options.map((option) => option.layerId)).toEqual([
      LAYER_A,
      LAYER_B,
      LAYER_C,
      LAYER_D,
    ]);
    expect(options.map((option) => option.label)).toEqual([
      '张三',
      '李四',
      '桌子',
      '杯子',
    ]);
    expect(options.every((option) => option.blocked === null)).toBe(true);
  });

  it('keeps two identically named Layer instances apart by id', () => {
    const project = fixture({ b: { name: '张三' } });
    const options = listLayoutTargets(project, shotOf(project));

    expect(options.map((option) => option.label)).toEqual([
      '张三（1）',
      '张三（2）',
      '桌子',
      '杯子',
    ]);
    expect(new Set(options.map((option) => option.layerId)).size).toBe(4);
  });

  it('reports each blocked target with its own reason', () => {
    const project = fixture({
      b: { locked: true },
      c: { visible: false },
      d: { rotationDeg: 12 },
      a: { name: '张三' },
    });
    const options = new Map(
      listLayoutTargets(project, shotOf(project)).map((option) => [
        option.layerId,
        option.blocked,
      ]),
    );

    expect(options.get(LAYER_B)).toBe('locked');
    expect(options.get(LAYER_C)).toBe('hidden');
    expect(options.get(LAYER_D)).toBe('rotated');
    expect(options.get(LAYER_A)).toBeNull();
  });
});

describe('EF-02 alignment uses the rendered visual edges', () => {
  it('aligns left/centre/right edges of two differently sized objects', () => {
    const project = fixture();
    // Real geometry, not the Layer anchor: A is 256 wide, B is 160 wide.
    expect(rectOf(project, LAYER_A)).toMatchObject({ left: 272, right: 528 });
    expect(rectOf(project, LAYER_B)).toMatchObject({ left: 720, right: 880 });

    const left = commit(project, planOrThrow(project, 'align-left', [LAYER_A, LAYER_B]));
    closeTo(rectOf(left, LAYER_A).left, 272);
    closeTo(rectOf(left, LAYER_B).left, 272);
    expect(rectOf(left, LAYER_B).right).toBeCloseTo(432, 3);
    // Only x moves.
    expect(layersOf(left).get(LAYER_B)).toMatchObject({ y: 500, scaleX: 0.25 });

    const centre = commit(
      project,
      planOrThrow(project, 'align-center', [LAYER_A, LAYER_B]),
    );
    closeTo(
      (rectOf(centre, LAYER_A).left + rectOf(centre, LAYER_A).right) / 2,
      400,
    );
    closeTo(
      (rectOf(centre, LAYER_B).left + rectOf(centre, LAYER_B).right) / 2,
      400,
    );

    const right = commit(
      project,
      planOrThrow(project, 'align-right', [LAYER_A, LAYER_B]),
    );
    closeTo(rectOf(right, LAYER_B).right, 528);
    closeTo(rectOf(right, LAYER_A).right, 528);
  });

  it('lands different heights on one bottom line without touching the rest', () => {
    const project = fixture();
    const before = layersOf(project);
    const after = commit(
      project,
      planOrThrow(project, 'align-bottom', [LAYER_A, LAYER_B, LAYER_C]),
    );

    for (const layerId of [LAYER_A, LAYER_B, LAYER_C]) {
      closeTo(rectOf(after, layerId).bottom, 528);
    }
    // The reference keeps its own transform values.
    expect(layersOf(after).get(LAYER_A)).toEqual(before.get(LAYER_A));
    // An unselected object is not part of the batch.
    expect(layersOf(after).get(LAYER_D)).toEqual(before.get(LAYER_D));
    expect(layersOf(after).get(IDS.layerBg)).toEqual(before.get(IDS.layerBg));
    // Bottom alignment never resizes.
    expect(layersOf(after).get(LAYER_C)).toMatchObject({
      scaleX: 0.1,
      scaleY: 0.1,
    });
  });

  it('lets a plain image prop join an ordinary alignment', () => {
    const project = fixture();
    const after = commit(
      project,
      planOrThrow(project, 'align-left', [LAYER_A, LAYER_C]),
    );

    closeTo(rectOf(after, LAYER_C).left, 272);
    expect(layersOf(after).get(LAYER_C)).toMatchObject({
      source: { kind: 'asset', assetId: IDS.assetBg },
      scaleX: 0.1,
      scaleY: 0.1,
    });
  });
});

describe('EF-02 equal height', () => {
  it('matches the reference visible height while keeping each aspect ratio', () => {
    const project = fixture();
    const referenceHeight = rectOf(project, LAYER_A).bottom - rectOf(project, LAYER_A).top;
    expect(referenceHeight).toBeCloseTo(256, 3);

    const transforms = planOrThrow(project, 'equal-height', [LAYER_A, LAYER_B, LAYER_C]);
    // The reference object itself is never rewritten.
    expect(transforms.map((transform) => transform.layerId)).toEqual([
      LAYER_B,
      LAYER_C,
    ]);

    const after = commit(project, transforms);
    for (const layerId of [LAYER_A, LAYER_B, LAYER_C]) {
      closeTo(rectOf(after, layerId).bottom - rectOf(after, layerId).top, 256);
    }
    const b = layersOf(after).get(LAYER_B)!;
    closeTo(b.scaleX / b.scaleY, 1);
    closeTo(b.scaleX, 0.4);
    // A wide prop keeps its 16:9 shape: 256 * 1920/1080.
    closeTo(rectOf(after, LAYER_C).right - rectOf(after, LAYER_C).left, 455.111);
    // The visual centre stays put; only the size changes.
    const cBefore = rectOf(project, LAYER_C);
    const cAfter = rectOf(after, LAYER_C);
    closeTo((cAfter.left + cAfter.right) / 2, (cBefore.left + cBefore.right) / 2);
    closeTo((cAfter.top + cAfter.bottom) / 2, (cBefore.top + cBefore.bottom) / 2);
  });

  it('keeps flipX and the per-axis ratio of a mirrored object', () => {
    const project = fixture({ b: { flipX: true, scaleX: 0.25, scaleY: 0.2 } });
    const before = rectOf(project, LAYER_B);
    const after = commit(
      project,
      planOrThrow(project, 'equal-height', [LAYER_A, LAYER_B]),
    );

    const b = layersOf(after).get(LAYER_B)!;
    expect(b.flipX).toBe(true);
    closeTo(b.scaleY / b.scaleX, 0.2 / 0.25);
    closeTo(rectOf(after, LAYER_B).bottom - rectOf(after, LAYER_B).top, 256);
    closeTo(
      (rectOf(after, LAYER_B).left + rectOf(after, LAYER_B).right) / 2,
      (before.left + before.right) / 2,
    );
  });
});

describe('EF-02 horizontal distribution', () => {
  it('keeps the outer pair and equalises the visible gaps in between', () => {
    const project = fixture();
    const before = layersOf(project);
    const transforms = planOrThrow(project, 'distribute-horizontal', [
      LAYER_A,
      LAYER_B,
      LAYER_C,
    ]);
    const after = commit(project, transforms);

    const a = rectOf(after, LAYER_A);
    const b = rectOf(after, LAYER_B);
    const c = rectOf(after, LAYER_C);
    closeTo(b.left - a.right, c.left - b.right);
    // 272..528, 720..880, 1104..1296 -> 208px gaps keep the outer pair still.
    closeTo(b.left - a.right, 208);
    expect(layersOf(after).get(LAYER_A)).toEqual(before.get(LAYER_A));
    expect(layersOf(after).get(LAYER_C)).toEqual(before.get(LAYER_C));
    // Distribution never changes y or size.
    expect(layersOf(after).get(LAYER_B)).toMatchObject({
      y: before.get(LAYER_B)!.y,
      scaleX: before.get(LAYER_B)!.scaleX,
      scaleY: before.get(LAYER_B)!.scaleY,
    });
    // Four objects distribute as evenly as three.
    const four = commit(
      project,
      planOrThrow(project, 'distribute-horizontal', [
        LAYER_A,
        LAYER_B,
        LAYER_C,
        LAYER_D,
      ]),
    );
    const gaps = [LAYER_A, LAYER_B, LAYER_C, LAYER_D]
      .map((layerId) => rectOf(four, layerId))
      .map((rect, index, rects) =>
        index === 0 ? null : rect.left - rects[index - 1]!.right,
      )
      .slice(1);
    // Sub-hundredth pixel: saved values are rounded to 3 decimals.
    for (const gap of gaps) closeTo(gap!, gaps[0]!, 2);
  });

  it('refuses to overlap objects instead of squeezing them', () => {
    const project = fixture({
      a: { x: 400 },
      c: { x: 500 },
      b: { x: 600 },
    });
    const result = planLayerLayout(project, shotOf(project), {
      action: 'distribute-horizontal',
      layerIds: [LAYER_A, LAYER_C, LAYER_B],
    });

    expect(result).toMatchObject({ ok: false, reason: 'insufficient-space' });
  });
});

describe('EF-02 refusals keep the whole batch at zero changes', () => {
  const cases: {
    label: string;
    input: Parameters<typeof fixture>[0];
    action: LayoutAlignAction;
    layerIds: string[];
    reason: string;
  }[] = [
    {
      label: 'locked',
      input: { b: { locked: true } },
      action: 'align-left',
      layerIds: [LAYER_A, LAYER_B],
      reason: 'locked',
    },
    {
      label: 'hidden',
      input: { b: { visible: false } },
      action: 'align-left',
      layerIds: [LAYER_A, LAYER_B],
      reason: 'hidden',
    },
    {
      label: 'rotated',
      input: { b: { rotationDeg: 30 } },
      action: 'align-left',
      layerIds: [LAYER_A, LAYER_B],
      reason: 'rotated',
    },
    {
      label: 'position animation',
      input: {
        timelineEvents: [
          {
            id: MOVE_EVENT,
            layerId: LAYER_B,
            type: 'move',
            startMs: 0,
            endMs: 1000,
            from: { x: 800, y: 500 },
            to: { x: 900, y: 500 },
            easing: 'linear',
          },
        ],
      },
      action: 'equal-height',
      layerIds: [LAYER_A, LAYER_B],
      reason: 'position-animation',
    },
    {
      label: 'scale animation',
      input: {
        timelineEvents: [
          {
            id: SCALE_EVENT,
            layerId: LAYER_B,
            type: 'scale',
            startMs: 0,
            endMs: 1000,
            from: { x: 0.25, y: 0.25 },
            to: { x: 0.5, y: 0.5 },
            easing: 'linear',
          },
        ],
      },
      action: 'equal-height',
      layerIds: [LAYER_A, LAYER_B],
      reason: 'scale-animation',
    },
  ];

  for (const testCase of cases) {
    it(`refuses a ${testCase.label} object with a specific message`, () => {
      const project = fixture(testCase.input);
      const result = planLayerLayout(project, shotOf(project), {
        action: testCase.action,
        layerIds: testCase.layerIds,
      });

      expect(result).toMatchObject({ ok: false, reason: testCase.reason });
      if (result.ok) return;
      expect(result.message).toContain('李四');
    });
  }

  it('refuses a batch whose new position leaves the frame', () => {
    // A full-size background asset as a prop: aligning its left edge to 272
    // would push its right edge past 1920.
    const project = fixture({ c: { x: 960, scaleX: 1, scaleY: 1 } });
    const result = planLayerLayout(project, shotOf(project), {
      action: 'align-left',
      layerIds: [LAYER_A, LAYER_C],
    });

    expect(result).toMatchObject({ ok: false, reason: 'out-of-canvas' });
    if (result.ok) return;
    expect(result.message).toContain('桌子');
  });

  it('refuses an equal-height result outside the Layer scale range', () => {
    // A 21.6px tall reference would need a 0.0338 scale on a 640px Character.
    const project = fixture({ c: { scaleX: 0.02, scaleY: 0.02 } });
    const result = planLayerLayout(project, shotOf(project), {
      action: 'equal-height',
      layerIds: [LAYER_C, LAYER_B],
      referenceLayerId: LAYER_C,
    });

    expect(result).toMatchObject({ ok: false, reason: 'invalid-scale' });
  });

  it('refuses incomplete or too small a selection', () => {
    const project = fixture();
    const empty = planLayerLayout(project, shotOf(project), {
      action: 'align-left',
      layerIds: [],
    });
    const single = planLayerLayout(project, shotOf(project), {
      action: 'align-left',
      layerIds: [LAYER_A],
    });
    const twoForDistribution = planLayerLayout(project, shotOf(project), {
      action: 'distribute-horizontal',
      layerIds: [LAYER_A, LAYER_B],
    });

    expect(empty).toMatchObject({ ok: false, reason: 'incomplete' });
    expect(single).toMatchObject({ ok: false, reason: 'not-enough' });
    expect(twoForDistribution).toMatchObject({
      ok: false,
      reason: 'not-enough',
    });
    if (twoForDistribution.ok) return;
    expect(twoForDistribution.message).toContain('3');
  });

  it('refuses a reference that is not part of the selection', () => {
    const project = fixture();
    const result = planLayerLayout(project, shotOf(project), {
      action: 'align-left',
      layerIds: [LAYER_A, LAYER_B],
      referenceLayerId: LAYER_D,
    });

    expect(result).toMatchObject({ ok: false, reason: 'missing-reference' });
  });
});

describe('EF-02 planning is read-only', () => {
  it('never mutates the Project it reads', () => {
    const project = fixture();
    const before = JSON.stringify(project);

    for (const action of [
      'align-left',
      'align-center',
      'align-right',
      'align-bottom',
      'equal-height',
      'distribute-horizontal',
    ] as const) {
      planLayerLayout(project, shotOf(project), {
        action,
        layerIds: [LAYER_A, LAYER_B, LAYER_C],
      });
    }

    expect(JSON.stringify(project)).toBe(before);
  });
});

describe('EF-02 commit seam', () => {
  function harness(project: Project) {
    const editor = new EditorProjectStore();
    editor.open('D:/layer-align.pandastage', project);
    const shots = { getCurrentShotId: () => project.shots[0]!.id };
    const layers = new LayerStore(editor, shots, new LayerService());
    return { editor, layers };
  }

  it('records exactly one Undo for a whole arrangement', () => {
    const project = fixture();
    const { editor, layers } = harness(project);
    const before = layersOf(project);
    const result = planLayerLayout(project, shotOf(project), {
      action: 'equal-height',
      layerIds: [LAYER_A, LAYER_B, LAYER_C],
      referenceLayerId: LAYER_A,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    let notifications = 0;
    editor.subscribe(() => {
      notifications += 1;
    });

    layers.applyLayoutTransforms(result.plan.transforms, 'Arrange layers');

    expect(notifications).toBe(1);
    expect(editor.getSnapshot()).toMatchObject({ revision: 1, dirty: true });
    const after = layersOf(editor.getSnapshot()!.project);
    expect(after.get(LAYER_D)).toEqual(before.get(LAYER_D));
    expect(after.get(IDS.layerBg)).toEqual(before.get(IDS.layerBg));
    expect(after.get(LAYER_A)).toEqual(before.get(LAYER_A));

    expect(editor.undo()).toBe(true);
    const undone = layersOf(editor.getSnapshot()!.project);
    expect(undone.get(LAYER_B)).toEqual(before.get(LAYER_B));
    expect(undone.get(LAYER_C)).toEqual(before.get(LAYER_C));

    expect(editor.redo()).toBe(true);
    const redone = layersOf(editor.getSnapshot()!.project);
    expect(redone.get(LAYER_B)).toEqual(after.get(LAYER_B));
    expect(redone.get(LAYER_C)).toEqual(after.get(LAYER_C));
  });

  it('survives a save/reopen round trip with identical values', () => {
    const project = fixture();
    const { editor, layers } = harness(project);
    const result = planLayerLayout(project, shotOf(project), {
      action: 'distribute-horizontal',
      layerIds: [LAYER_A, LAYER_B, LAYER_C],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    layers.applyLayoutTransforms(result.plan.transforms);

    const committed = editor.getSnapshot()!.project;
    const reopened = ProjectSchema.parse(
      JSON.parse(JSON.stringify(committed)) as unknown,
    );

    expect(reopened).toEqual(committed);
  });

  it('is a no-op when the arrangement already holds', () => {
    const project = fixture();
    const { editor, layers } = harness(project);
    const result = planLayerLayout(project, shotOf(project), {
      action: 'align-left',
      layerIds: [LAYER_A, LAYER_B],
      referenceLayerId: LAYER_A,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    layers.applyLayoutTransforms(result.plan.transforms);
    const settled = editor.getSnapshot()!;

    const again = planLayerLayout(settled.project, shotOf(settled.project), {
      action: 'align-left',
      layerIds: [LAYER_A, LAYER_B],
      referenceLayerId: LAYER_A,
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    layers.applyLayoutTransforms(again.plan.transforms);

    expect(editor.getSnapshot()).toMatchObject({
      revision: settled.revision,
      project: settled.project,
    });
  });

  it('leaves AUTO-01 two-person position commits working as before', () => {
    const project = fixture();
    const { editor, layers } = harness(project);
    layers.updatePositions([
      { layerId: LAYER_A, position: { x: 652.8, y: 833.6 } },
      { layerId: LAYER_B, position: { x: 1267.2, y: 913.6 } },
    ]);

    expect(editor.getSnapshot()).toMatchObject({ revision: 1 });
    expect(layersOf(editor.getSnapshot()!.project).get(LAYER_A)).toMatchObject({
      x: 652.8,
      y: 833.6,
      scaleX: 0.4,
      scaleY: 0.4,
    });
    expect(CHARACTER_HALF * 0.4).toBeCloseTo(128, 6);
  });
});
