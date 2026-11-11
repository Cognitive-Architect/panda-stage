import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { multiplyAffineMatrices } from '../../src/shared/affine-matrix';
import type { FlaGraphicGroupEditPreview } from '../../src/shared/fla-graphic-instance-api';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  buildEditorStageRenderModel,
  calculateViewportTransform,
  stageToScreen,
  migrateProject,
} from '../../src/domain';
import { SelectableLayer } from '../../src/renderer/features/canvas/SelectableLayer';
import { CanvasToolbar } from '../../src/renderer/features/canvas/CanvasToolbar';
import { isViewportChromePointerTarget } from '../../src/renderer/features/canvas/CanvasViewport';
import { mapClientPointToLayerPosition } from '../../src/renderer/features/canvas/useCanvasDrop';
import { parseLayerPositionDraft } from '../../src/renderer/features/properties/LayerPositionPanel';

function testGroupEditPreview(): FlaGraphicGroupEditPreview {
  const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const art = {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z" fill="#f03a55"/></svg>',
    viewBox: { x: 0, y: 0, width: 10, height: 10 },
  };
  return {
    version: 1,
    source: {
      sha256: 'a'.repeat(64),
      outerOccurrenceId: 'occ-0123456789abcdef01234567',
      outerSourceAddress: 'DOMDocument.xml/Scene/instance[0]',
      graphicSymbolName: 'Walk',
    },
    frameIndex: 0,
    frameOrigin: { x: 0, y: 0 },
    frameCanvas: { width: 20, height: 20 },
    group: {
      groupId: 'group-1',
      sourceAddress: 'LIBRARY/Walk/layer[0]/group[0]',
      worldTransform: identity,
      canvasTransform: identity,
    },
    background: null,
    foreground: null,
    children: [
      {
        sourceAddress: 'LIBRARY/Walk/layer[0]/group[0]/member[0]',
        parentGroupSourceAddress: 'LIBRARY/Walk/layer[0]/group[0]',
        kind: 'shape',
        sourceIdentity: 'shape-a',
        localTransform: { ...identity, tx: 3, ty: 4 },
        worldTransform: { ...identity, tx: 3, ty: 4 },
        artwork: art,
      },
      {
        sourceAddress: 'LIBRARY/Walk/layer[0]/group[0]/member[1]',
        parentGroupSourceAddress: 'LIBRARY/Walk/layer[0]/group[0]',
        kind: 'shape',
        sourceIdentity: 'shape-b',
        localTransform: { ...identity, tx: 11, ty: 5 },
        worldTransform: { ...identity, tx: 11, ty: 5 },
        artwork: art,
      },
    ],
  };
}

function findElementByName(node: unknown, name: string): { props: Record<string, unknown> } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElementByName(child, name);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== 'object' || !('props' in node)) return null;
  const element = node as { props: Record<string, unknown> };
  if (element.props.name === name) return element;
  return findElementByName(element.props.children, name);
}

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
      label: 'actual 1:1',
      transform: calculateViewportTransform(
        { width: 1920, height: 1080 },
        'actual',
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

describe('CanvasViewport chrome pointer routing', () => {
  const logicalStage = { id: 'logical-stage' };
  const layerCanvas = { id: 'layer-canvas' };
  const viewportChrome = { id: 'viewport-chrome' };
  const isInsideLogicalStage = (target: { id: string }): boolean =>
    target === logicalStage || target === layerCanvas;

  it('leaves logical Stage and layer targets with their existing owners', () => {
    expect(
      isViewportChromePointerTarget(
        logicalStage,
        isInsideLogicalStage,
      ),
    ).toBe(false);
    expect(
      isViewportChromePointerTarget(
        layerCanvas,
        isInsideLogicalStage,
      ),
    ).toBe(false);
  });

  it('identifies viewport chrome without coordinate guessing', () => {
    expect(
      isViewportChromePointerTarget(
        viewportChrome,
        isInsideLogicalStage,
      ),
    ).toBe(true);
    expect(
      isViewportChromePointerTarget(null, isInsideLogicalStage),
    ).toBe(false);
  });

  it('wires only viewport chrome to the existing selection owner', () => {
    const viewport = readFileSync(
      'src/renderer/features/canvas/CanvasViewport.tsx',
      'utf8',
    );
    const stage = readFileSync(
      'src/renderer/features/canvas/CanvasStage.tsx',
      'utf8',
    );

    expect(viewport).toMatch(
      /querySelector\(\s*['"]\.canvas-logical-stage['"]\s*,?\s*\)/u,
    );
    expect(viewport).toContain('logicalStage.contains(candidate)');
    expect(viewport).toContain('onPointerDown={handlePointerDown}');
    expect(viewport).not.toContain('document.addEventListener');
    expect(stage).toMatch(
      /onViewportChromePointerDown=\{\(\) => selectionStore\.clear\(\)\}/u,
    );
  });

  it('rejects animation drops when their captured project, revision, or Shot context expired', () => {
    const drop = readFileSync(
      'src/renderer/features/canvas/useCanvasDrop.ts',
      'utf8',
    );
    const stage = readFileSync(
      'src/renderer/features/canvas/CanvasStage.tsx',
      'utf8',
    );

    expect(drop).toContain('isCurrentAnimationDropContext(');
    expect(drop).toContain('animationDropTarget');
    expect(drop).toContain('payload.animationId');
    expect(stage).toContain('projectRevision: snapshot.revision');
    expect(stage).toContain('shotId: shot.id');
  });
});

describe('CanvasStage permanent guide contract', () => {
  it('does not render or advertise permanent center guides', () => {
    const stage = readFileSync(
      'src/renderer/features/canvas/CanvasStage.tsx',
      'utf8',
    );

    expect(stage).not.toContain('data-center-guides');
    expect(stage).not.toContain('<Line');
    expect(stage).not.toContain(
      'PROJECT_WIDTH / 2, 0, PROJECT_WIDTH / 2',
    );
    expect(stage).not.toContain(
      '0, PROJECT_HEIGHT / 2, PROJECT_WIDTH',
    );
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
  const project = migrateProject(exampleProject);
  const shot = project.shots[0]!;
  const model = buildEditorStageRenderModel(project, shot);
  const ordinary = model.layers.find(
    ({ render }) => !render.isBackground,
  )!;
  const nodeRef = { current: null };

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
      nodeRef,
      render: ordinary.render,
      selected: true,
      onSelect: vi.fn(),
      onCommitPosition: commit,
      onCommitTransform: vi.fn(),
      onError: vi.fn(),
    });
    const props = element.props as {
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
      nodeRef,
      render: ordinary.render,
      selected: true,
      onSelect: vi.fn(),
      onCommitPosition: vi.fn(),
      onCommitTransform: commit,
      onError: vi.fn(),
    });
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
    const props = element.props as {
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

  it('keeps selection listening separate from the locked edit gate', () => {
    const locked = SelectableLayer({
      image: {} as HTMLImageElement,
      layer: { ...ordinary.layer, locked: true },
      nodeRef,
      render: ordinary.render,
      selected: true,
      onSelect: vi.fn(),
      onCommitPosition: vi.fn(),
      onCommitTransform: vi.fn(),
      onError: vi.fn(),
    });
    expect(
      (locked.props as { draggable: boolean }).draggable,
    ).toBe(false);
    expect(
      (locked.props as { listening: boolean }).listening,
    ).toBe(true);

    const background = model.layers.find(
      ({ render }) => render.isBackground,
    )!;
    const onSelect = vi.fn();
    const backgroundElement = SelectableLayer({
      image: {} as HTMLImageElement,
      layer: { ...background.layer, locked: true },
      nodeRef,
      render: background.render,
      selected: false,
      onSelect,
      onCommitPosition: vi.fn(),
      onCommitTransform: vi.fn(),
      onError: vi.fn(),
    });
    const backgroundProps = backgroundElement.props as {
      draggable: boolean;
      listening: boolean;
      onClick: (event: { cancelBubble: boolean }) => void;
      children: [{ props: { listening: boolean } }];
    };
    expect(backgroundProps.draggable).toBe(false);
    expect(backgroundProps.listening).toBe(true);
    expect(backgroundProps.children[0].props.listening).toBe(true);

    const event = { cancelBubble: false };
    backgroundProps.onClick(event);
    expect(event.cancelBubble).toBe(true);
    expect(onSelect).toHaveBeenCalledWith(background.layer.id);
  });

  it('keeps temporal inspection selectable but blocks drag and transform commits', () => {
    const commitPosition = vi.fn();
    const commitTransform = vi.fn();
    const position = { x: 700, y: 350 };
    let scaleX = 1.4;
    let scaleY = 1.4;
    const target = {
      x: () => position.x,
      y: () => position.y,
      position: (next?: { x: number; y: number }) => {
        if (next) Object.assign(position, next);
        return position;
      },
      scaleX: (value?: number) => {
        if (value !== undefined) scaleX = value;
        return scaleX;
      },
      scaleY: (value?: number) => {
        if (value !== undefined) scaleY = value;
        return scaleY;
      },
      scale: (next?: { x: number; y: number }) => {
        if (next) {
          scaleX = next.x;
          scaleY = next.y;
        }
      },
      rotation: () => 22,
    };
    const element = SelectableLayer({
      directEditingEnabled: false,
      image: {} as HTMLImageElement,
      layer: ordinary.layer,
      nodeRef,
      render: ordinary.render,
      selected: true,
      onSelect: vi.fn(),
      onCommitPosition: commitPosition,
      onCommitTransform: commitTransform,
      onError: vi.fn(),
    });
    const props = element.props as {
      draggable: boolean;
      listening: boolean;
      onDragEnd: (event: { target: typeof target }) => void;
      onTransformEnd: (event: { target: typeof target }) => void;
    };

    expect(props.draggable).toBe(false);
    expect(props.listening).toBe(true);
    props.onDragEnd({ target });
    props.onTransformEnd({ target });

    expect(commitPosition).not.toHaveBeenCalled();
    expect(commitTransform).not.toHaveBeenCalled();
    expect(position).toEqual({ x: ordinary.render.x, y: ordinary.render.y });
    expect(scaleX).toBe(ordinary.render.scaleX);
    expect(scaleY).toBe(ordinary.render.scaleY);
  });

  it('grants only Position drag to the scoped authoring capability', () => {
    const setDraft = vi.fn(() => ({ ok: true as const, snapshot: null! }));
    const commit = vi.fn(() => ({
      status: 'committed' as const,
      session: null!,
      snapshot: null!,
    }));
    const session = {
      sessionId: 1,
      generation: 0,
      getSnapshot: () => null,
      setDraft,
      commit,
      cancel: vi.fn(),
      exit: vi.fn(),
    } as unknown as import('../../src/renderer/stores/positionAuthoringSessionStore').PositionAuthoringSessionHandle;
    const position = { x: ordinary.render.x, y: ordinary.render.y };
    const target = {
      x: () => position.x,
      y: () => position.y,
      position: (next?: { x: number; y: number }) => {
        if (next) Object.assign(position, next);
        return position;
      },
      scaleX: () => ordinary.render.scaleX,
      scaleY: () => ordinary.render.scaleY,
      scale: vi.fn(),
      rotation: () => ordinary.render.rotationDeg,
    };
    const element = SelectableLayer({
      directEditingEnabled: false,
      image: {} as HTMLImageElement,
      layer: ordinary.layer,
      nodeRef,
      onCommitPosition: vi.fn(),
      onCommitTransform: vi.fn(),
      onError: vi.fn(),
      onSelect: vi.fn(),
      positionAuthoringSession: session,
      positionAuthoringShakeOffset: { x: 20, y: 10 },
      render: ordinary.render,
      selected: true,
    });
    const props = element.props as {
      draggable: boolean;
      onDragMove: (event: { target: typeof target }) => void;
      onDragEnd: (event: { target: typeof target }) => void;
      onTransformEnd: (event: { target: typeof target }) => void;
    };
    expect(props.draggable).toBe(true);
    position.x = 720;
    position.y = 360;
    props.onDragMove({ target });
    props.onDragEnd({ target });
    expect(setDraft).toHaveBeenCalledWith({ x: 700, y: 350 });
    expect(commit).toHaveBeenCalledWith({ x: 700, y: 350 });
    props.onTransformEnd({ target });
    expect(target.scale).toHaveBeenCalled();
  });

  it('renders content without an interleaved Transformer sibling', () => {
    const element = SelectableLayer({
      image: {} as HTMLImageElement,
      layer: ordinary.layer,
      nodeRef,
      render: ordinary.render,
      selected: true,
      onSelect: vi.fn(),
      onCommitPosition: vi.fn(),
      onCommitTransform: vi.fn(),
      onError: vi.fn(),
    });

    expect(element.type).not.toBe(Symbol.for('react.fragment'));
    expect(
      (element.props as { name: string }).name,
    ).toBe('selectable-canvas-layer');
  });

  it('enters the explicit Group scope only from a selected parent double-click', () => {
    const enter = vi.fn();
    const element = SelectableLayer({
      image: {} as HTMLImageElement,
      layer: ordinary.layer,
      nodeRef,
      render: ordinary.render,
      selected: true,
      flaGroupEditPreview: testGroupEditPreview(),
      onFlaGroupEditEnter: enter,
      onSelect: vi.fn(),
      onCommitPosition: vi.fn(),
      onCommitTransform: vi.fn(),
      onError: vi.fn(),
    });
    const props = element.props as {
      draggable: boolean;
      onDblClick: (event: { cancelBubble: boolean }) => void;
    };

    props.onDblClick({ cancelBubble: false });

    expect(enter).toHaveBeenCalledTimes(1);
    expect(props.draggable).toBe(true);
  });

  it.each([45, 90])(
    'passes a %s degree parent and child-local angle to rendered Konva Groups in degrees',
    (parentRotationDeg) => {
      const matrixAtRotation = (
        rotationDeg: number,
        tx: number,
        ty: number,
        scaleX = 1,
        scaleY = 1,
      ) => {
        const radians = rotationDeg * Math.PI / 180;
        return {
          a: Math.cos(radians) * scaleX,
          b: Math.sin(radians) * scaleX,
          c: -Math.sin(radians) * scaleY,
          d: Math.cos(radians) * scaleY,
          tx,
          ty,
        };
      };
      const basePreview = testGroupEditPreview();
      const preview: FlaGraphicGroupEditPreview = {
        ...basePreview,
        group: {
          ...basePreview.group,
          canvasTransform: matrixAtRotation(parentRotationDeg, 80, 35, 1.5, 0.75),
        },
        children: basePreview.children.map((child, index) => index === 0
          ? { ...child, localTransform: matrixAtRotation(30, 3, 4, 1.25, 0.8) }
          : child),
      };
      const element = SelectableLayer({
        image: {} as HTMLImageElement,
        layer: ordinary.layer,
        nodeRef,
        render: ordinary.render,
        selected: true,
        flaGroupEditPreview: preview,
        flaGroupEditScope: true,
        onSelect: vi.fn(),
        onCommitPosition: vi.fn(),
        onCommitTransform: vi.fn(),
        onError: vi.fn(),
      });
      const parent = findElementByName(element, 'fla-group-edit-parent');
      const child = findElementByName(element, 'fla-group-edit-child-shape');

      expect(parent).not.toBeNull();
      expect(child).not.toBeNull();
      expect(parent?.props.rotation).toBeCloseTo(parentRotationDeg, 8);
      expect(parent?.props.x).toBeCloseTo(80, 8);
      expect(parent?.props.y).toBeCloseTo(35, 8);
      expect(child?.props.rotation).toBeCloseTo(30, 8);
      expect(child?.props.x).toBeCloseTo(3, 8);
      expect(child?.props.y).toBeCloseTo(4, 8);
    },
  );

  it('drags only the selected direct Group child and localizes its absolute matrix without committing the parent', () => {
    const preview = testGroupEditPreview();
    const parentWorld = { a: 0, b: 2, c: -2, d: 0, tx: 100, ty: 50 };
    const draggedLocal = { a: 1, b: 0, c: 0, d: 1, tx: 9, ty: -4 };
    const childAbsolute = multiplyAffineMatrices(parentWorld, draggedLocal);
    const toArray = (matrix: typeof parentWorld) => [
      matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty,
    ];
    const parentRef = {
      current: {
        getAbsoluteTransform: () => ({ getMatrix: () => toArray(parentWorld) }),
      },
    } as never;
    const parentSelect = vi.fn();
    const positionCommit = vi.fn();
    const transformCommit = vi.fn();
    const childTransform = vi.fn();
    const element = SelectableLayer({
      image: {} as HTMLImageElement,
      layer: ordinary.layer,
      nodeRef,
      render: ordinary.render,
      selected: true,
      flaGroupEditPreview: preview,
      flaGroupEditScope: true,
      flaGroupEditParentNodeRef: parentRef,
      onFlaGroupEditChildTransform: childTransform,
      onSelect: parentSelect,
      onCommitPosition: positionCommit,
      onCommitTransform: transformCommit,
      onError: vi.fn(),
    });
    const child = findElementByName(element, 'fla-group-edit-child-shape');
    expect(child).not.toBeNull();
    if (!child) throw new Error('Expected a direct child Konva Group');
    const onDragEnd = child.props.onDragEnd as (event: {
      cancelBubble: boolean;
      target: {
        getAbsoluteTransform: () => { getMatrix: () => number[] };
        setAttrs: (attrs: Record<string, unknown>) => void;
      };
    }) => void;
    const setAttrs = vi.fn();

    onDragEnd({
      cancelBubble: false,
      target: {
        getAbsoluteTransform: () => ({ getMatrix: () => toArray(childAbsolute) }),
        setAttrs,
      },
    });

    expect(child.props.draggable).toBe(true);
    expect(child.props.listening).toBe(true);
    expect(childTransform).toHaveBeenCalledTimes(1);
    expect(childTransform).toHaveBeenCalledWith(preview.children[0]!.sourceAddress, draggedLocal);
    expect(parentSelect).not.toHaveBeenCalled();
    expect(positionCommit).not.toHaveBeenCalled();
    expect(transformCommit).not.toHaveBeenCalled();
    expect(setAttrs).not.toHaveBeenCalled();
    expect(preview.children[1]?.localTransform).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 11, ty: 5 });
  });

  it('renders the retained foreground after the Group children in source painter order', () => {
    const basePreview = testGroupEditPreview();
    const preview: FlaGraphicGroupEditPreview = {
      ...basePreview,
      foreground: {
        artwork: basePreview.children[0]!.artwork,
        position: { x: 7, y: 9 },
      },
    };
    const element = SelectableLayer({
      image: {} as HTMLImageElement,
      layer: ordinary.layer,
      nodeRef,
      render: ordinary.render,
      selected: true,
      flaGroupEditPreview: preview,
      onSelect: vi.fn(),
      onCommitPosition: vi.fn(),
      onCommitTransform: vi.fn(),
      onError: vi.fn(),
    });
    const editPreview = findElementByName(element, 'fla-group-edit-preview');
    expect(editPreview).not.toBeNull();
    const children = editPreview?.props.children as readonly (null | undefined | { props?: { name?: string } })[];
    const names = children
      .filter((child): child is { props?: { name?: string } } => Boolean(child))
      .map((child) => child.props?.name);

    expect(names.indexOf('fla-group-edit-parent')).toBeGreaterThan(-1);
    expect(names.indexOf('fla-group-edit-foreground')).toBeGreaterThan(
      names.indexOf('fla-group-edit-parent'),
    );
  });

  it('limits the non-edit parent hit area to transformed direct Child SVG bounds', () => {
    const preview = testGroupEditPreview();
    const element = SelectableLayer({
      image: {} as HTMLImageElement,
      layer: ordinary.layer,
      nodeRef,
      render: ordinary.render,
      selected: false,
      flaGroupEditPreview: preview,
      onSelect: vi.fn(),
      onCommitPosition: vi.fn(),
      onCommitTransform: vi.fn(),
      onError: vi.fn(),
    });
    const hitArea = findElementByName(element, 'fla-group-edit-parent-hit-area');

    expect(hitArea?.props.width).toBe(preview.children[0]?.artwork.viewBox.width);
    expect(hitArea?.props.height).toBe(preview.children[0]?.artwork.viewBox.height);
    expect(hitArea?.props.width).not.toBe(preview.frameCanvas.width);
    expect(hitArea?.props.height).not.toBe(preview.frameCanvas.height);
  });

  it('shows the group edit context action and temporary-save tooltip only for an eligible target', () => {
    const transform = calculateViewportTransform({ width: 960, height: 540 }, 'fit');
    const activeMarkup = renderToStaticMarkup(createElement(CanvasToolbar, {
      mode: 'fit',
      point: null,
      transform,
      groupEditAvailable: true,
      groupEditActive: true,
    }));
    const unavailableMarkup = renderToStaticMarkup(createElement(CanvasToolbar, {
      mode: 'fit',
      point: null,
      transform,
      groupEditAvailable: false,
    }));

    expect(activeMarkup).toContain('返回整体');
    expect(activeMarkup).toContain('临时编辑');
    expect(activeMarkup).toContain('当前分组调整尚不能保存到项目');
    expect(activeMarkup).toContain('aria-describedby=');
    expect(unavailableMarkup).not.toContain('编辑分组');
  });

  it('uses the original canvas-image API through the Canvas resource session', () => {
    const stage = readFileSync(
      'src/renderer/features/canvas/CanvasStage.tsx',
      'utf8',
    );
    const resources = readFileSync(
      'src/renderer/features/canvas/canvasImageResources.ts',
      'utf8',
    );
    const temporalModel = readFileSync(
      'src/renderer/features/canvas/editorTemporalCanvasModel.ts',
      'utf8',
    );

    expect(stage).toContain('CanvasImageResourceSession');
    expect(stage).toContain('projectContextKey');
    expect(stage).toContain('shotId');
    expect(resources).toContain('readCanvasImage');
    expect(resources).not.toContain('readThumbnail');
    expect(resources).toContain('new Blob([response.bytes]');
    expect(resources).toContain('URL.createObjectURL');
    expect(resources).toContain('URL.revokeObjectURL');
    expect(resources).toContain('projectRoot');
    expect(resources).toContain('assetId,');
    expect(resources).toContain('sha256: sourceKey');
    expect(resources).toContain('isCurrent');
    expect(resources).toContain('disposeResource');
    expect(stage).toContain('listShotRuntimeImageAssets');
    expect(stage).toContain('buildEditorTemporalCanvasModel');
    expect(temporalModel).toContain('evaluateShotAtTime(');
    expect(temporalModel).toContain('projectShotDialogueVisual(');
    expect(stage).toContain('data-temporal-inspection');
    expect(stage).toContain('dropDisabled={!snapshot || !shot}');
    expect(stage).toContain('dropInteractionDisabled={temporalInspection}');
    expect(stage).toContain("if (event.key !== 'Escape' || !groupEditScope) return;");
    expect(stage).toContain('setGroupScopeTargetKey(null);');
    expect(stage).toContain('setSelectedGroupChildAddress(null);');
    expect(stage).toContain('flaGroupEditTarget.projectId === snapshot.project.id');
    expect(stage).toContain('flaGroupEditTarget.shotId === shot.id');
    expect(stage).toContain('flaGroupEditTarget.projectInstanceId === projectInstanceId');
    expect(stage).toContain('groupEditTargetLayer.source.flaOccurrence');
    expect(stage).toContain('groupEditTargetAnimation.source.sha256 === flaGroupEditTarget.preview.source.sha256');
    expect(stage).not.toContain('flaGroupEditTarget.layerId === selectedLayerId\n    ?');
    expect(stage).toContain('groupEditTargetSelected');
    expect(stage).toContain('setGroupScopeTargetKey((current) =>');
    expect(stage).toContain('setGroupEditDraft(null);');
    const normalizedStage = stage.replace(/\r\n/gu, '\n');
    const targetResetStart = normalizedStage.indexOf(
      'useEffect(() => {\n    setGroupScopeTargetKey(null);',
    );
    const targetResetEnd = normalizedStage.indexOf(
      '}, [groupEditTargetKey]);',
      targetResetStart,
    ) + '}, [groupEditTargetKey]);'.length;
    const targetResetEffect = normalizedStage.slice(targetResetStart, targetResetEnd);
    expect(targetResetEffect).toContain('[groupEditTargetKey]');
    expect(targetResetEffect).not.toContain('selectedLayerId');
    const groupEditEscapeHandler = stage.slice(
      stage.indexOf('const handleGroupEditKeyDownCapture'),
      stage.indexOf('const activeOpacityPreview'),
    );
    expect(groupEditEscapeHandler).not.toContain('selectionStore.');
    const viewport = readFileSync(
      'src/renderer/features/canvas/CanvasViewport.tsx',
      'utf8',
    );
    const canvasDrop = readFileSync(
      'src/renderer/features/canvas/useCanvasDrop.ts',
      'utf8',
    );
    expect(viewport).toContain('disabled: dropDisabled,');
    expect(viewport).toContain('data-canvas-interactive-chrome="true"');
    expect(viewport).toContain(
      'interactionDisabled: dropInteractionDisabled,',
    );
    expect(canvasDrop).toContain(
      "interactionDisabled && payload.type !== 'animation'",
    );
  });
});
