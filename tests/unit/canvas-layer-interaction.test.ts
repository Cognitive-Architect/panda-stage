import { describe, expect, it, vi } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  ProjectSchema,
  buildEditorStageRenderModel,
  calculateViewportTransform,
  stageToScreen,
} from '../../src/domain';
import { SelectableLayer } from '../../src/renderer/features/canvas/SelectableLayer';
import { mapClientPointToLayerPosition } from '../../src/renderer/features/canvas/useCanvasDrop';
import { parseLayerPositionDraft } from '../../src/renderer/features/properties/LayerPositionPanel';

describe('canvas drop coordinate mapping', () => {
  it.each([
    {
      label: '1.0',
      transform: calculateViewportTransform(
        { width: 1920, height: 1080 },
        'actual',
      ),
      point: { x: 640, y: 360 },
      scroll: { x: 0, y: 0 },
    },
    {
      label: '0.5',
      transform: calculateViewportTransform(
        { width: 800, height: 600 },
        'half',
      ),
      point: { x: 1280, y: 720 },
      scroll: { x: 0, y: 0 },
    },
    {
      label: 'fit letterbox',
      transform: calculateViewportTransform(
        { width: 1000, height: 700 },
        'fit',
      ),
      point: { x: 960, y: 540 },
      scroll: { x: 0, y: 0 },
    },
    {
      label: 'actual with scroll',
      transform: calculateViewportTransform(
        { width: 800, height: 600 },
        'actual',
      ),
      point: { x: 1100, y: 700 },
      scroll: { x: 300, y: 100 },
    },
  ])('maps a $label client drop to the logical center point', (input) => {
    const origin = { x: 75, y: 125 };
    const screen = stageToScreen(input.point, input.transform);
    const client = {
      x: origin.x + screen.x - input.scroll.x,
      y: origin.y + screen.y - input.scroll.y,
    };

    const mapped = mapClientPointToLayerPosition({
      client,
      viewportOrigin: origin,
      scroll: input.scroll,
      transform: input.transform,
    });

    expect(mapped?.x).toBeCloseTo(input.point.x, 10);
    expect(mapped?.y).toBeCloseTo(input.point.y, 10);
  });

  it('clamps a letterbox or exterior drop to the logical canvas edge', () => {
    const transform = calculateViewportTransform(
      { width: 1000, height: 700 },
      'fit',
    );

    expect(
      mapClientPointToLayerPosition({
        client: { x: 0, y: 0 },
        viewportOrigin: { x: 0, y: 0 },
        scroll: { x: 0, y: 0 },
        transform,
      }),
    ).toEqual({ x: 0, y: 0 });
  });
});

describe('layer position input', () => {
  it('accepts finite decimal coordinates', () => {
    expect(parseLayerPositionDraft(' 10.5 ', '20.25')).toEqual({
      x: 10.5,
      y: 20.25,
    });
  });

  it.each([
    ['', '20'],
    ['10', ' '],
    ['NaN', '20'],
    ['Infinity', '20'],
    ['10', '-Infinity'],
  ])('rejects empty and non-finite drafts', (x, y) => {
    expect(() => parseLayerPositionDraft(x, y)).toThrow();
  });
});

describe('SelectableLayer interaction adapter', () => {
  const project = ProjectSchema.parse(exampleProject);
  const shot = project.shots[0]!;
  const model = buildEditorStageRenderModel(project, shot);
  const ordinary = model.layers.find(
    ({ render }) => !render.isBackground,
  )!;

  it('keeps drag move local and commits exactly once on drag end', () => {
    const commit = vi.fn();
    const position = { x: ordinary.render.x, y: ordinary.render.y };
    const target = {
      x: () => position.x,
      y: () => position.y,
      position: (next?: { x: number; y: number }) => {
        if (next) Object.assign(position, next);
        return position;
      },
    };
    const element = SelectableLayer({
      image: {} as HTMLImageElement,
      layer: ordinary.layer,
      render: ordinary.render,
      selected: true,
      onSelect: vi.fn(),
      onCommitPosition: commit,
      onCommitTransform: vi.fn(),
      onError: vi.fn(),
    });
    const group = (
      element.props as { children: React.JSX.Element[] }
    ).children[0]!;
    const props = group.props as {
      draggable: boolean;
      onDragMove: (event: { target: typeof target }) => void;
      onDragEnd: (event: { target: typeof target }) => void;
    };

    position.x = 700;
    position.y = 350;
    props.onDragMove({ target });
    expect(commit).not.toHaveBeenCalled();
    props.onDragEnd({ target });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(ordinary.layer.id, {
      x: 700,
      y: 350,
    });
    expect(props.draggable).toBe(true);
  });

  it('commits a Transformer gesture once using uniform positive model scale', () => {
    const commit = vi.fn();
    const element = SelectableLayer({
      image: {} as HTMLImageElement,
      layer: ordinary.layer,
      render: ordinary.render,
      selected: true,
      onSelect: vi.fn(),
      onCommitPosition: vi.fn(),
      onCommitTransform: commit,
      onError: vi.fn(),
    });
    const group = (
      element.props as { children: React.JSX.Element[] }
    ).children[0]!;
    let scaleX = 1.4;
    let scaleY = 1.39;
    const target = {
      x: () => 810,
      y: () => 420,
      scaleX: (value?: number) => {
        if (value !== undefined) scaleX = value;
        return scaleX;
      },
      scaleY: (value?: number) => {
        if (value !== undefined) scaleY = value;
        return scaleY;
      },
      rotation: () => 405,
      position: vi.fn(),
      scale: vi.fn(),
    };
    const props = group.props as {
      onTransformEnd: (event: { target: typeof target }) => void;
    };

    props.onTransformEnd({ target });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(ordinary.layer.id, {
      x: 810,
      y: 420,
      scale: 1.4,
      rotationDeg: 405,
      opacity: ordinary.layer.opacity,
      flipX: ordinary.layer.flipX,
    });
    expect(scaleX).toBe(1.4);
    expect(scaleY).toBe(1.4);
  });

  it('makes a locked layer non-draggable and a background non-listening', () => {
    const locked = SelectableLayer({
      image: {} as HTMLImageElement,
      layer: { ...ordinary.layer, locked: true },
      render: ordinary.render,
      selected: true,
      onSelect: vi.fn(),
      onCommitPosition: vi.fn(),
      onCommitTransform: vi.fn(),
      onError: vi.fn(),
    });
    const lockedGroup = (
      locked.props as { children: React.JSX.Element[] }
    ).children[0]!;
    expect(
      (lockedGroup.props as { draggable: boolean }).draggable,
    ).toBe(false);

    const background = model.layers.find(
      ({ render }) => render.isBackground,
    )!;
    const backgroundElement = SelectableLayer({
      image: {} as HTMLImageElement,
      layer: background.layer,
      render: background.render,
      selected: false,
      onSelect: vi.fn(),
      onCommitPosition: vi.fn(),
      onCommitTransform: vi.fn(),
      onError: vi.fn(),
    });
    expect(
      (backgroundElement.props as { listening: boolean }).listening,
    ).toBe(false);
  });
});
