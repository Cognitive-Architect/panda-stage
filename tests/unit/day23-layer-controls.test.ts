import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  CharacterService,
  LayerService,
  buildEditorStageRenderModel,
  migrateProject,
} from '../../src/domain';
import {
  isTransformerBoxAllowed,
  isTransformerOverlayVisible,
} from '../../src/renderer/features/canvas/LayerTransformer';
import { shouldDeleteSelectedLayer } from '../../src/renderer/features/properties/LayerOrderControls';
import {
  canRunTransformAction,
  parseLayerTransformDraft,
  shouldCommitTransformBlur,
} from '../../src/renderer/features/properties/LayerTransformPanel';

describe('Day 23 layer control adapters', () => {
  it('accepts valid property drafts and rejects non-finite or out-of-range values', () => {
    expect(
      parseLayerTransformDraft(
        {
          x: '960',
          y: '540',
          scale: '1.25',
          rotationDeg: '450',
          opacity: '0.75',
        },
        true,
      ),
    ).toEqual({
      x: 960,
      y: 540,
      scale: 1.25,
      rotationDeg: 450,
      opacity: 0.75,
      flipX: true,
    });
    for (const draft of [
      { x: '', y: '1', scale: '1', rotationDeg: '0', opacity: '1' },
      { x: 'NaN', y: '1', scale: '1', rotationDeg: '0', opacity: '1' },
      { x: '1', y: '1', scale: '0', rotationDeg: '0', opacity: '1' },
      { x: '1', y: '1', scale: '21', rotationDeg: '0', opacity: '1' },
      { x: '1', y: '1', scale: '1', rotationDeg: 'Infinity', opacity: '1' },
      { x: '1', y: '1', scale: '1', rotationDeg: '0', opacity: '1.1' },
    ]) {
      expect(() => parseLayerTransformDraft(draft, false)).toThrow();
    }
  });

  it('commits blur only when focus leaves the complete transform form', () => {
    const inputA = {} as EventTarget;
    const inputB = {} as EventTarget;
    const canvas = {} as EventTarget;
    const formTargets = new Set<EventTarget>([inputA, inputB]);
    const contains = (target: EventTarget) => formTargets.has(target);

    expect(shouldCommitTransformBlur(contains, inputB)).toBe(false);
    expect(shouldCommitTransformBlur(contains, canvas)).toBe(true);
    expect(shouldCommitTransformBlur(contains, null)).toBe(true);
  });

  it('runs internal layer actions only after a valid pending-draft result', () => {
    expect(canRunTransformAction('committed')).toBe(true);
    expect(canRunTransformAction('noop')).toBe(true);
    expect(canRunTransformAction('invalid')).toBe(false);
    expect(canRunTransformAction('locked')).toBe(false);
  });

  it('limits Transformer boxes using the model scale bounds', () => {
    expect(
      isTransformerBoxAllowed(
        { width: 100, height: 100 },
        { width: 200, height: 200 },
        1,
      ),
    ).toBe(true);
    expect(
      isTransformerBoxAllowed(
        { width: 100, height: 100 },
        { width: 1, height: 1 },
        1,
      ),
    ).toBe(false);
    expect(
      isTransformerBoxAllowed(
        { width: 100, height: 100 },
        { width: Number.NaN, height: 100 },
        1,
      ),
    ).toBe(false);
  });

  it('only exposes the overlay for a ready, selected, unlocked content layer', () => {
    const eligible = {
      selected: true,
      isBackground: false,
      locked: false,
      imageReady: true,
    };
    expect(isTransformerOverlayVisible(eligible)).toBe(true);
    expect(
      isTransformerOverlayVisible({ ...eligible, locked: true }),
    ).toBe(false);
    expect(
      isTransformerOverlayVisible({
        ...eligible,
        isBackground: true,
      }),
    ).toBe(false);
    expect(
      isTransformerOverlayVisible({ ...eligible, selected: false }),
    ).toBe(false);
    expect(
      isTransformerOverlayVisible({ ...eligible, imageReady: false }),
    ).toBe(false);
  });

  it('only handles Delete or Backspace when a layer is selected', () => {
    const selected = 'd2300000-0000-4000-8000-000000000001';
    expect(
      shouldDeleteSelectedLayer(
        { key: 'Delete', target: null, defaultPrevented: false },
        selected,
      ),
    ).toBe(true);
    expect(
      shouldDeleteSelectedLayer(
        { key: 'Delete', target: null, defaultPrevented: false },
        null,
      ),
    ).toBe(false);
    expect(
      shouldDeleteSelectedLayer(
        { key: 'Enter', target: null, defaultPrevented: false },
        selected,
      ),
    ).toBe(false);
  });

  it('renders explicit horizontal flip around the unchanged center', () => {
    const project = migrateProject(exampleProject);
    const shot = project.shots[0]!;
    const layer = shot.layers[1]!;
    const before = buildEditorStageRenderModel(project, shot).layers.find(
      (candidate) => candidate.layer.id === layer.id,
    )!;
    const flipped = new LayerService().toggleFlipX(
      project,
      shot.id,
      layer.id,
    );
    const afterShot = flipped.shots[0]!;
    const after = buildEditorStageRenderModel(
      flipped,
      afterShot,
    ).layers.find((candidate) => candidate.layer.id === layer.id)!;

    expect(after.render).toMatchObject({
      x: before.render.x,
      y: before.render.y,
      scaleX: -before.layer.scaleX,
      scaleY: before.layer.scaleY,
    });
    expect(after.layer).toMatchObject({
      x: layer.x,
      y: layer.y,
      flipX: true,
    });
  });

  it('keeps the same center across expression size changes and flip state', () => {
    const project = migrateProject(exampleProject);
    const character = project.characters[0]!;
    const center = { x: 812.5, y: 431.25 };
    const service = new CharacterService();
    const first = service.resolveAppearance(
      project,
      character.id,
      character.expressions[0]!.id,
      center,
    );
    const second = service.resolveAppearance(
      project,
      character.id,
      character.expressions[1]!.id,
      center,
    );

    expect(first.center).toEqual(center);
    expect(second.center).toEqual(center);
  });
});
