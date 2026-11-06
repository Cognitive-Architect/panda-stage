import { describe, expect, it } from 'vitest';
import {
  LayerService,
  ProjectSchema,
  QUICK_LAYOUT_GROUND_Y,
  QUICK_LAYOUT_LEFT_X,
  QUICK_LAYOUT_RIGHT_X,
  listQuickLayoutCharacters,
  planQuickCharacterLayout,
  type Layer,
  type Project,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { buildProject, IDS } from './domain/testProject';

const LEFT_LAYER = '60000000-0000-4000-8000-0000000000a1';
const RIGHT_LAYER = '60000000-0000-4000-8000-0000000000a2';
const MOVE_EVENT = '80000000-0000-4000-8000-0000000000a1';
/** The fixture Character asset is 640x640, so its local visual is centered. */
const CHARACTER_HALF_HEIGHT = 320;

function characterLayer(
  id: string,
  name: string,
  scale: number,
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
    x: 200,
    y: 300,
    scaleX: scale,
    scaleY: scale,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    zIndex: 1,
    locked: false,
    flipX: false,
    ...overrides,
  };
}

function fixture(options: {
  leftScale?: number;
  rightScale?: number;
  left?: Partial<Layer>;
  right?: Partial<Layer>;
  extraLayers?: Layer[];
} = {}): Project {
  const base = buildProject();
  const shot = base.shots[0]!;
  const background = shot.layers.find((layer) => layer.id === IDS.layerBg)!;
  const prop = shot.layers.find((layer) => layer.id === IDS.layerAsset)!;
  return ProjectSchema.parse({
    ...base,
    shots: [
      {
        ...shot,
        layers: [
          background,
          prop,
          characterLayer(LEFT_LAYER, '张三', options.leftScale ?? 0.5, {
            zIndex: 2,
            ...options.left,
          }),
          characterLayer(RIGHT_LAYER, '李四', options.rightScale ?? 0.25, {
            zIndex: 3,
            ...options.right,
          }),
          ...(options.extraLayers ?? []),
        ],
      },
    ],
  });
}

function shotOf(project: Project) {
  return project.shots[0]!;
}

function layersOf(project: Project): Map<string, Layer> {
  return new Map(shotOf(project).layers.map((layer) => [layer.id, layer]));
}

describe('AUTO-01 quick character layout domain', () => {
  it('lists only the current Shot Character Layers as candidates', () => {
    const project = fixture();
    const options = listQuickLayoutCharacters(project, shotOf(project));

    expect(options.map((option) => option.layerId)).toEqual([
      LEFT_LAYER,
      RIGHT_LAYER,
    ]);
    expect(options.map((option) => option.label)).toEqual(['张三', '李四']);
    expect(options.every((option) => option.blocked === null)).toBe(true);
  });

  it('disambiguates duplicate Layer names without using them as identity', () => {
    const project = fixture({ right: { name: '张三' } });
    const options = listQuickLayoutCharacters(project, shotOf(project));

    expect(options.map((option) => option.label)).toEqual([
      '张三（1）',
      '张三（2）',
    ]);
    expect(new Set(options.map((option) => option.layerId)).size).toBe(2);
  });

  it('places the pair left/right and lands both visual bottoms on one ground line', () => {
    const project = fixture({ leftScale: 0.5, rightScale: 0.25 });
    const result = planQuickCharacterLayout(
      project,
      shotOf(project),
      LEFT_LAYER,
      RIGHT_LAYER,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.left.x).toBeCloseTo(QUICK_LAYOUT_LEFT_X, 6);
    expect(result.plan.right.x).toBeCloseTo(QUICK_LAYOUT_RIGHT_X, 6);
    expect(QUICK_LAYOUT_LEFT_X).toBeCloseTo(1920 * 0.34, 6);
    expect(QUICK_LAYOUT_RIGHT_X).toBeCloseTo(1920 * 0.66, 6);

    const leftBottom =
      result.plan.left.y + CHARACTER_HALF_HEIGHT * 0.5;
    const rightBottom =
      result.plan.right.y + CHARACTER_HALF_HEIGHT * 0.25;
    expect(leftBottom).toBeCloseTo(QUICK_LAYOUT_GROUND_Y, 6);
    expect(rightBottom).toBeCloseTo(QUICK_LAYOUT_GROUND_Y, 6);
    expect(QUICK_LAYOUT_GROUND_Y).toBeCloseTo(1080 * 0.92, 6);
    expect(result.plan.left.y).toBeCloseTo(993.6 - 160, 6);
    expect(result.plan.right.y).toBeCloseTo(993.6 - 80, 6);
  });

  it('rejects the same Layer in both slots', () => {
    const project = fixture();
    const result = planQuickCharacterLayout(
      project,
      shotOf(project),
      LEFT_LAYER,
      LEFT_LAYER,
    );

    expect(result).toMatchObject({ ok: false, reason: 'same-layer' });
  });

  it('rejects a locked Character without producing a position', () => {
    const project = fixture({ left: { locked: true } });
    const result = planQuickCharacterLayout(
      project,
      shotOf(project),
      LEFT_LAYER,
      RIGHT_LAYER,
    );

    expect(result).toMatchObject({ ok: false, reason: 'locked' });
    if (result.ok) return;
    expect(result.message).toContain('张三');
    expect(result.message).toContain('已锁定');
  });

  it('rejects a rotated Character', () => {
    const project = fixture({ right: { rotationDeg: 12 } });
    const result = planQuickCharacterLayout(
      project,
      shotOf(project),
      LEFT_LAYER,
      RIGHT_LAYER,
    );

    expect(result).toMatchObject({ ok: false, reason: 'rotated' });
    if (result.ok) return;
    expect(result.message).toContain('旋转');
  });

  it('rejects a Character that already owns a position animation', () => {
    const base = fixture();
    const shot = shotOf(base);
    const project = ProjectSchema.parse({
      ...base,
      shots: [
        {
          ...shot,
          timelineEvents: [
            {
              id: MOVE_EVENT,
              layerId: LEFT_LAYER,
              type: 'move',
              startMs: 0,
              endMs: 1000,
              from: { x: 200, y: 300 },
              to: { x: 400, y: 300 },
              easing: 'linear',
            },
          ],
        },
      ],
    });
    const result = planQuickCharacterLayout(
      project,
      shotOf(project),
      LEFT_LAYER,
      RIGHT_LAYER,
    );

    expect(result).toMatchObject({ ok: false, reason: 'position-animation' });
    if (result.ok) return;
    expect(result.message).toContain('位置动画');
  });

  it('rejects a non-Character Layer', () => {
    const project = fixture();
    const result = planQuickCharacterLayout(
      project,
      shotOf(project),
      LEFT_LAYER,
      IDS.layerAsset,
    );

    expect(result).toMatchObject({ ok: false, reason: 'not-character' });
  });
});

describe('AUTO-01 quick character layout commit', () => {
  function harness(project: Project) {
    const editor = new EditorProjectStore();
    editor.open('D:/quick-layout.pandastage', project);
    const shots = {
      getCurrentShotId: () => project.shots[0]!.id,
    };
    const layers = new LayerStore(editor, shots, new LayerService());
    return { editor, layers };
  }

  it('writes one Project update that only moves the two people, with one Undo/Redo', () => {
    const project = fixture({ leftScale: 0.5, rightScale: 0.25 });
    const { editor, layers } = harness(project);
    const before = layersOf(project);
    const plan = planQuickCharacterLayout(
      project,
      shotOf(project),
      LEFT_LAYER,
      RIGHT_LAYER,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    let notifications = 0;
    editor.subscribe(() => {
      notifications += 1;
    });

    layers.updatePositions(
      [
        { layerId: plan.plan.leftLayerId, position: plan.plan.left },
        { layerId: plan.plan.rightLayerId, position: plan.plan.right },
      ],
      'Quick layout characters',
    );

    expect(notifications).toBe(1);
    expect(editor.getSnapshot()).toMatchObject({ revision: 1, dirty: true });
    const after = layersOf(editor.getSnapshot()!.project);
    expect(after.get(LEFT_LAYER)).toMatchObject(plan.plan.left);
    expect(after.get(RIGHT_LAYER)).toMatchObject(plan.plan.right);
    for (const layerId of [IDS.layerBg, IDS.layerAsset]) {
      expect(after.get(layerId)).toEqual(before.get(layerId));
    }
    expect(after.get(LEFT_LAYER)).toMatchObject({
      scaleX: 0.5,
      scaleY: 0.5,
      rotationDeg: 0,
      flipX: false,
      zIndex: 2,
    });
    expect(after.get(RIGHT_LAYER)).toMatchObject({
      scaleX: 0.25,
      scaleY: 0.25,
      rotationDeg: 0,
      flipX: false,
      zIndex: 3,
    });

    expect(editor.undo()).toBe(true);
    const undone = layersOf(editor.getSnapshot()!.project);
    expect(undone.get(LEFT_LAYER)).toMatchObject({
      x: before.get(LEFT_LAYER)!.x,
      y: before.get(LEFT_LAYER)!.y,
    });
    expect(undone.get(RIGHT_LAYER)).toMatchObject({
      x: before.get(RIGHT_LAYER)!.x,
      y: before.get(RIGHT_LAYER)!.y,
    });

    expect(editor.redo()).toBe(true);
    const redone = layersOf(editor.getSnapshot()!.project);
    expect(redone.get(LEFT_LAYER)).toMatchObject(plan.plan.left);
    expect(redone.get(RIGHT_LAYER)).toMatchObject(plan.plan.right);
  });

  it('stays a no-op when both people already hold the planned stance', () => {
    const project = fixture();
    const { editor, layers } = harness(project);
    const plan = planQuickCharacterLayout(
      project,
      shotOf(project),
      LEFT_LAYER,
      RIGHT_LAYER,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    layers.updatePositions([
      { layerId: plan.plan.leftLayerId, position: plan.plan.left },
      { layerId: plan.plan.rightLayerId, position: plan.plan.right },
    ]);

    const settled = editor.getSnapshot()!;
    layers.updatePositions([
      { layerId: plan.plan.leftLayerId, position: plan.plan.left },
      { layerId: plan.plan.rightLayerId, position: plan.plan.right },
    ]);

    expect(editor.getSnapshot()).toMatchObject({
      revision: settled.revision,
      project: settled.project,
    });
  });
});
