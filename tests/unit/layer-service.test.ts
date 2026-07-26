import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  LayerService,
  LayerServiceError,
  ProjectSchema,
} from '../../src/domain';

const CREATED_LAYER_ID = 'd2200000-0000-4000-8000-000000000001';
const NOW = new Date('2026-07-26T01:00:00.000Z');

function fixture() {
  return ProjectSchema.parse(exampleProject);
}

function service() {
  return new LayerService({
    createId: () => CREATED_LAYER_ID,
    now: () => NOW,
  });
}

describe('LayerService', () => {
  it('creates a centered direct-asset layer with the next zIndex', () => {
    const project = fixture();
    const shot = project.shots[0]!;
    const asset = project.assets[0]!;
    const result = service().createFromAsset(project, shot.id, {
      assetId: asset.id,
      type: 'background-image',
      position: { x: 640, y: 360 },
    });

    expect(result.layer).toMatchObject({
      id: CREATED_LAYER_ID,
      name: asset.name,
      source: { kind: 'asset', assetId: asset.id },
      anchor: 'center',
      x: 640,
      y: 360,
      locked: false,
      zIndex: Math.max(...shot.layers.map((layer) => layer.zIndex)) + 1,
    });
    expect(result.project.shots[0]!.layers.at(-1)).toEqual(result.layer);
    expect(result.project.updatedAt).toBe(NOW.toISOString());
    expect(project.shots[0]!.layers).toHaveLength(2);
  });

  it('creates a character layer from the matching expression and default scale', () => {
    const project = fixture();
    const character = project.characters[0]!;
    const expression = character.expressions[1]!;
    const result = service().createFromAsset(
      project,
      project.shots[0]!.id,
      {
        assetId: expression.assetId,
        type: 'character-image',
        position: { x: 960, y: 540 },
      },
    );

    expect(result.layer).toMatchObject({
      source: {
        kind: 'character',
        characterId: character.id,
        expressionId: expression.id,
      },
      scaleX: character.defaultScale,
      scaleY: character.defaultScale,
    });
  });

  it('clamps a canvas-exterior drop to the logical stage', () => {
    const project = fixture();
    const result = service().createFromAsset(
      project,
      project.shots[0]!.id,
      {
        assetId: project.assets[0]!.id,
        type: 'background-image',
        position: { x: -80, y: 1200 },
      },
    );

    expect(result.layer).toMatchObject({ x: 0, y: 1080 });
  });

  it.each([
    {
      name: 'missing asset',
      input: {
        assetId: 'd2200000-0000-4000-8000-000000000099',
        type: 'background-image' as const,
        position: { x: 10, y: 20 },
      },
      code: 'ASSET_NOT_FOUND',
    },
    {
      name: 'audio',
      input: {
        assetId: '10000000-0000-4000-8000-000000000005',
        type: 'audio' as const,
        position: { x: 10, y: 20 },
      },
      code: 'ASSET_TYPE_MISMATCH',
    },
    {
      name: 'non-finite x',
      input: {
        assetId: '10000000-0000-4000-8000-000000000002',
        type: 'background-image' as const,
        position: { x: Number.NaN, y: 20 },
      },
      code: 'INVALID_POSITION',
    },
    {
      name: 'non-finite y',
      input: {
        assetId: '10000000-0000-4000-8000-000000000002',
        type: 'background-image' as const,
        position: { x: 20, y: Number.POSITIVE_INFINITY },
      },
      code: 'INVALID_POSITION',
    },
  ])('rejects $name without mutating the project', ({ input, code }) => {
    const project = fixture();
    const before = structuredClone(project);

    expect(() =>
      service().createFromAsset(
        project,
        project.shots[0]!.id,
        input,
      ),
    ).toThrow(expect.objectContaining({ code }));
    expect(project).toEqual(before);
  });

  it('updates an unlocked center position and treats an identical move as a no-op', () => {
    const project = fixture();
    const layer = project.shots[0]!.layers[1]!;
    const moved = service().updatePosition(
      project,
      project.shots[0]!.id,
      layer.id,
      { x: 777.5, y: 333.25 },
    );

    expect(moved.shots[0]!.layers[1]).toMatchObject({
      x: 777.5,
      y: 333.25,
    });
    expect(
      service().updatePosition(
        moved,
        moved.shots[0]!.id,
        layer.id,
        { x: 777.5, y: 333.25 },
      ),
    ).toBe(moved);
  });

  it('rejects out-of-stage property coordinates and locked movement', () => {
    const project = fixture();
    const shot = project.shots[0]!;
    const layer = shot.layers[1]!;

    expect(() =>
      service().updatePosition(project, shot.id, layer.id, {
        x: -1,
        y: 20,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_POSITION' }));

    const locked = service().setLocked(project, shot.id, layer.id, true);
    expect(locked.shots[0]!.layers[1]!.locked).toBe(true);
    expect(() =>
      service().updatePosition(locked, shot.id, layer.id, {
        x: 300,
        y: 400,
      }),
    ).toThrow(
      expect.objectContaining<Partial<LayerServiceError>>({
        code: 'LAYER_LOCKED',
      }),
    );
  });
});
