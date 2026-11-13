import { describe, expect, it, vi } from 'vitest';
import type {
  FlaGraphicDefinition,
  FlaGraphicStructureFrame,
  FlaGraphicStructureNode,
  ImageAsset,
  Project,
} from '../../src/domain';
import {
  FlaGraphicDefinitionSchema,
  ProjectSchema,
  type FlaGraphicInstanceTransformOverrides,
  buildEditorStageRenderModel,
  migrateProject,
} from '../../src/domain';
import {
  multiplyAffineMatrices,
  type AffineMatrix2D,
} from '../../src/shared/affine-matrix';
import exampleProject from '../../demo-project/project-v1.example.json';
import { FlaGraphicStructureProjection } from '../../src/renderer/features/canvas/FlaGraphicStructureProjection';
import { SelectableLayer } from '../../src/renderer/features/canvas/SelectableLayer';
import {
  collectFlaGraphicStructureAssetIds,
  clearFlaGraphicEditDraft,
  clearFlaGraphicEditTargetDrafts,
  flaGraphicNodeCanSelect,
  flaGraphicNodeCanTransform,
  flaGraphicNodeHasReadyVisual,
  getFlaGraphicNodeAtPath,
  getFlaGraphicScopeNodes,
  isFlaGraphicNodeEnterable,
  parentFlaGraphicEditScopePath,
  recordFlaGraphicEditDraft,
  retainValidFlaGraphicEditDrafts,
  resolveFlaGraphicEditTarget,
  resolveFlaGraphicExitScopeTransition,
} from '../../src/renderer/features/canvas/flaGraphicEditScope';

const BITMAP_ASSET_ID = '10000000-0000-4000-8000-000000000003';
const FRAME_ASSET_ID = 'a1000000-0000-4000-8000-000000000000';
const SECOND_FRAME_ASSET_ID = 'a1000000-0000-4000-8000-000000000001';
const FRAME_ZERO_SHA = 'c'.repeat(64);
const FRAME_ONE_SHA = 'd'.repeat(64);
const identity: AffineMatrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function matrixAt(
  rotationDeg: number,
  scaleX: number,
  scaleY: number,
  tx: number,
  ty: number,
): AffineMatrix2D {
  const radians = rotationDeg * Math.PI / 180;
  return {
    a: Math.cos(radians) * scaleX,
    b: Math.sin(radians) * scaleX,
    c: -Math.sin(radians) * scaleY,
    d: Math.cos(radians) * scaleY,
    tx,
    ty,
  };
}

function bitmapNode(
  id: string,
  drawOrder: number,
  assetId = BITMAP_ASSET_ID,
): FlaGraphicStructureNode {
  return {
    type: 'bitmap',
    id,
    drawOrder,
    localTransform: identity,
    bitmapRef: id,
    assetId,
  };
}

function makeDefinition(): FlaGraphicDefinition {
  const grandchild = bitmapNode('bitmap-grandchild', 0);
  const symbol: FlaGraphicStructureNode = {
    type: 'symbol',
    id: 'symbol-b',
    drawOrder: 0,
    localTransform: matrixAt(12, 1, 1, 4, 8),
    symbolRef: 'library/symbol-b',
    children: [grandchild],
  };
  const children: FlaGraphicStructureNode[] = [
    symbol,
    bitmapNode('bitmap-one', 1),
    {
      type: 'opaque',
      id: 'opaque-safe',
      drawOrder: 2,
      localTransform: identity,
      opaqueKind: 'shape',
      fallbackScope: 'frame-crop',
      fallbackAssetId: FRAME_ASSET_ID,
      fallbackViewBox: { x: 110, y: 60, width: 20, height: 18 },
    },
    bitmapNode('bitmap-three', 3),
    {
      type: 'opaque',
      id: 'opaque-unsafe',
      drawOrder: 4,
      localTransform: identity,
      opaqueKind: 'filter',
    },
  ];
  const frame: FlaGraphicStructureFrame = {
    ordinal: 0,
    layers: [{ name: 'Graphic layer', nodes: [
      {
        type: 'group',
        id: 'group-a',
        drawOrder: 0,
        localTransform: matrixAt(30, 1.4, 0.8, 45, -12),
        groupId: 'group-A',
        children,
      },
      bitmapNode('root-bitmap', 1),
    ] }],
  };
  const frameDuration = 1_000 / 24;
  return FlaGraphicDefinitionSchema.parse({
    id: 'a0000000-0000-4000-8000-000000000001',
    kind: 'fla-graphic',
    name: 'Saved Graphic',
    source: {
      basename: 'saved-graphic.fla',
      sha256: 'a'.repeat(64),
      renderTargetId: 'saved-graphic-target',
      targetKind: 'graphic-symbol',
      targetName: 'Walk',
      startFrameIndex: 0,
      endFrameIndex: 1,
      sourceFps: 24,
      canvas: { width: 300, height: 200 },
      anchor: { x: 50, y: 40 },
      documentCanvas: { width: 1920, height: 1080 },
    },
    durationMs: frameDuration * 2,
    frames: [0, 1].map((ordinal) => ({
      ordinal,
      sourceFrameIndex: ordinal,
      assetId: ordinal === 0 ? FRAME_ASSET_ID : SECOND_FRAME_ASSET_ID,
      sha256: ordinal === 0 ? FRAME_ZERO_SHA : FRAME_ONE_SHA,
      sourceViewport: { x: 50, y: 40, width: 200, height: 100 },
      offset: { x: 0, y: 0 },
      startMs: ordinal * frameDuration,
      durationMs: frameDuration,
      createdBySequenceImport: false,
    })),
    structure: { version: 1, frames: [frame] },
  });
}

function projectWithSavedGraphic(): {
  project: Project;
  shot: Project['shots'][number];
  layerId: string;
  definition: FlaGraphicDefinition;
} {
  const project = migrateProject(exampleProject);
  const definition = makeDefinition();
  project.assets.push(
    ...[0, 1].map((ordinal) => ({
      id: ordinal === 0 ? FRAME_ASSET_ID : SECOND_FRAME_ASSET_ID,
      kind: 'image' as const,
      name: `Saved Graphic frame ${ordinal}`,
      relativePath: `assets/saved-graphic-${ordinal}.svg`,
      mimeType: 'image/svg+xml',
      width: 300,
      height: 200,
      sha256: ordinal === 0 ? FRAME_ZERO_SHA : FRAME_ONE_SHA,
      usage: 'prop' as const,
      keywords: [],
      flaGraphicFrame: { definitionId: definition.id, ordinal },
    })),
  );
  project.animations.push(definition);
  const shot = project.shots[0]!;
  const layerTemplate = shot.layers[0]!;
  const layerId = '60000000-0000-4000-8000-000000000003';
  shot.layers.push({
    ...layerTemplate,
    id: layerId,
    name: definition.name,
    source: { kind: 'animation', animationId: definition.id },
    startTimeMs: 0,
    animationPlayback: { mode: 'loop', endBehavior: 'hold' },
    zIndex: shot.layers.length,
  });
  return { project, shot, layerId, definition };
}

function treeElements(node: unknown): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(treeElements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as { type: unknown; props: Record<string, unknown> };
  return [element, ...treeElements(element.props.children)];
}

function namedElement(
  node: unknown,
  name: string,
): { type: unknown; props: Record<string, unknown> } | null {
  return treeElements(node).find((element) => element.props.name === name) ?? null;
}

function matrixArray(matrix: AffineMatrix2D): number[] {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty];
}

function projectionProps(input: {
  frame: FlaGraphicStructureFrame;
  definition?: FlaGraphicDefinition;
  scopePath?: readonly string[];
  images?: ReadonlyMap<string, HTMLImageElement>;
  assets?: ReadonlyMap<string, Pick<ImageAsset, 'width' | 'height'>>;
  instanceTransformOverrides?: FlaGraphicInstanceTransformOverrides;
  parentMatrix?: AffineMatrix2D;
  onTransform?: (path: readonly string[], matrix: AffineMatrix2D) => void;
  onTransformPreview?: (path: readonly string[], matrix: AffineMatrix2D) => void;
}) {
  const definition = input.definition ?? makeDefinition();
  const image = { naturalWidth: 640, naturalHeight: 640 } as HTMLImageElement;
  const frameImage = { naturalWidth: 1920, naturalHeight: 1080 } as HTMLImageElement;
  const images = input.images ?? new Map([
    [BITMAP_ASSET_ID, image],
    [FRAME_ASSET_ID, frameImage],
  ]);
  const assets = input.assets ?? new Map([
    [BITMAP_ASSET_ID, { width: 640, height: 640 }],
    [FRAME_ASSET_ID, { width: 1920, height: 1080 }],
  ]);
  const parentMatrix = input.parentMatrix ?? identity;
  const parentRef = {
    current: {
      getAbsoluteTransform: () => ({ getMatrix: () => matrixArray(parentMatrix) }),
    },
  } as never;
  const selectedRef = { current: null } as never;
  return {
    definition,
    frame: input.frame,
    images,
    assets,
    scopePath: input.scopePath ?? [],
    selectedNodePathKey: null,
    ...(input.instanceTransformOverrides
      ? { instanceTransformOverrides: input.instanceTransformOverrides }
      : {}),
    draftMatrices: {},
    layerLocked: false,
    scopeParentNodeRef: parentRef,
    selectedNodeRef: selectedRef,
    onSelect: vi.fn(),
    onEnter: vi.fn(),
    onTransformPreview: input.onTransformPreview ?? vi.fn(),
    onCommitTransform: input.onTransform ?? vi.fn(),
    onError: vi.fn(),
  };
}

describe('saved Fla Graphic edit scope', () => {
  it('resolves entry from persisted structure and allows a multi-frame Definition', () => {
    const { project, shot, layerId, definition } = projectWithSavedGraphic();
    const reopenedProject = ProjectSchema.parse(JSON.parse(JSON.stringify(project)));
    const reopenedShot = reopenedProject.shots.find((candidate) => candidate.id === shot.id)!;
    const target = resolveFlaGraphicEditTarget({
      project: reopenedProject,
      projectRoot: 'D:\\PandaStage-Acceptance\\saved-graphic.pandastage',
      projectInstanceId: 41,
      shot: reopenedShot,
      layerId,
    });

    expect(definition.frames).toHaveLength(2);
    expect(target?.animation.id).toBe(definition.id);
    expect(target?.frameOrdinal).toBe(0);
    expect(target?.frame.ordinal).toBe(0);
    expect(target?.frame.layers[0]?.nodes[0]?.id).toBe('group-a');
  });

  it('does not resolve an edit target when the persisted Definition has no structure', () => {
    const { project, shot, layerId, definition } = projectWithSavedGraphic();
    const legacyDefinition = { ...definition };
    delete legacyDefinition.structure;
    project.animations[0] = legacyDefinition;

    expect(resolveFlaGraphicEditTarget({
      project,
      projectRoot: 'D:\\PandaStage-Acceptance\\saved-graphic.pandastage',
      projectInstanceId: 41,
      shot,
      layerId,
    })).toBeNull();
  });

  it('exposes four-plus direct children in authored order and walks nested node paths', () => {
    const frame = makeDefinition().structure!.frames[0]!;
    const group = getFlaGraphicNodeAtPath(frame, ['group-a']);
    expect(group?.type).toBe('group');
    if (group?.type !== 'group') throw new Error('Expected the authored Group.');
    expect(group.children).toHaveLength(5);
    expect(getFlaGraphicScopeNodes(frame, ['group-a']).map((node) => node.id)).toEqual([
      'symbol-b',
      'bitmap-one',
      'opaque-safe',
      'bitmap-three',
      'opaque-unsafe',
    ]);
    expect(getFlaGraphicNodeAtPath(frame, ['group-a', 'symbol-b', 'bitmap-grandchild'])?.id)
      .toBe('bitmap-grandchild');
    expect(getFlaGraphicScopeNodes(frame, ['group-a', 'symbol-b']).map((node) => node.id))
      .toEqual(['bitmap-grandchild']);
  });

  it('returns one scope level at a time and exits only from the instance root', () => {
    const nested = parentFlaGraphicEditScopePath(['group-a', 'symbol-b']);
    expect(nested).toEqual(['group-a']);
    const group = parentFlaGraphicEditScopePath(nested!);
    expect(group).toEqual([]);
    expect(parentFlaGraphicEditScopePath(group!)).toBeNull();
    expect(isFlaGraphicNodeEnterable(getFlaGraphicNodeAtPath(
      makeDefinition().structure!.frames[0]!, ['group-a'],
    )!)).toBe(true);
    expect(isFlaGraphicNodeEnterable(getFlaGraphicNodeAtPath(
      makeDefinition().structure!.frames[0]!, ['group-a', 'symbol-b'],
    )!)).toBe(true);

    // F6: ExitScope restores selection of the just-exited Group/Symbol, and clears stale nodes safely
    const frame = makeDefinition().structure!.frames[0]!;
    const popInner = resolveFlaGraphicExitScopeTransition(frame, ['group-a', 'symbol-b']);
    expect(popInner).toEqual({
      nextScopePath: ['group-a'],
      nextSelectedNodePath: ['group-a', 'symbol-b'],
    });
    const popOuter = resolveFlaGraphicExitScopeTransition(frame, popInner.nextScopePath!);
    expect(popOuter).toEqual({
      nextScopePath: [],
      nextSelectedNodePath: ['group-a'],
    });
    const exitRoot = resolveFlaGraphicExitScopeTransition(frame, popOuter.nextScopePath!);
    expect(exitRoot).toEqual({
      nextScopePath: null,
      nextSelectedNodePath: null,
    });
    const stalePop = resolveFlaGraphicExitScopeTransition(frame, ['group-a', 'missing-symbol']);
    expect(stalePop).toEqual({
      nextScopePath: ['group-a'],
      nextSelectedNodePath: null,
    });
  });

  it('keeps safe opaque children read-only and only retains bitmap and safe fallback assets', () => {
    const frame = makeDefinition().structure!.frames[0]!;
    const group = getFlaGraphicNodeAtPath(frame, ['group-a']);
    if (group?.type !== 'group') throw new Error('Expected the authored Group.');
    const safe = group.children.find((node) => node.id === 'opaque-safe')!;
    const unsafe = group.children.find((node) => node.id === 'opaque-unsafe')!;
    const bitmap = group.children.find((node) => node.id === 'bitmap-one')!;

    expect(flaGraphicNodeCanTransform(bitmap)).toBe(true);
    expect(flaGraphicNodeCanTransform(group)).toBe(true);
    expect(flaGraphicNodeCanSelect(safe)).toBe(true);
    expect(flaGraphicNodeCanTransform(safe)).toBe(false);
    expect(flaGraphicNodeCanSelect(unsafe)).toBe(false);
    expect(flaGraphicNodeCanTransform(unsafe)).toBe(false);
    expect(collectFlaGraphicStructureAssetIds(frame)).toEqual([
      BITMAP_ASSET_ID,
      FRAME_ASSET_ID,
    ]);
    expect(flaGraphicNodeHasReadyVisual(bitmap, new Map([[BITMAP_ASSET_ID, {} as HTMLImageElement]]),
      new Map([[BITMAP_ASSET_ID, { width: 640, height: 640 }]]))).toBe(true);
    expect(flaGraphicNodeHasReadyVisual(unsafe, new Map(), new Map())).toBe(false);
  });

  it('renders one shared canvas and keeps direct-child hit areas without drawing duplicate leaf images', () => {
    const definition = makeDefinition();
    const frame = definition.structure!.frames[0]!;
    const props = projectionProps({ frame, definition, scopePath: ['group-a'] });
    const projection = FlaGraphicStructureProjection(props);
    const symbol = namedElement(projection, 'fla-structure-node-symbol-b');
    const grandchild = namedElement(projection, 'fla-structure-node-bitmap-grandchild');
    const bitmap = namedElement(projection, 'fla-structure-node-bitmap-one');
    const safeOpaque = namedElement(projection, 'fla-structure-node-opaque-safe');
    const unsafeOpaque = namedElement(projection, 'fla-structure-node-opaque-unsafe');

    expect(symbol?.props.listening).toBe(true);
    expect(symbol?.props.draggable).toBe(true);
    expect(grandchild?.props.listening).toBe(true);
    expect(grandchild?.props.draggable).toBe(false);
    expect(grandchild?.props.onClick).toBeUndefined();
    expect(bitmap?.props.listening).toBe(true);
    expect(bitmap?.props.draggable).toBe(true);
    expect(safeOpaque?.props.listening).toBe(true);
    expect(safeOpaque?.props.draggable).toBe(false);
    expect(unsafeOpaque?.props.listening).toBe(false);
    expect(unsafeOpaque?.props.draggable).toBe(false);
    expect(namedElement(projection, 'fla-structure-bitmap-bitmap-one')).toBeNull();
    expect(namedElement(projection, 'fla-structure-opaque-fallback-opaque-safe')).toBeNull();
    expect(namedElement(projection, 'fla-structure-hit-opaque-safe')).not.toBeNull();
    expect(namedElement(projection, 'fla-structure-hit-opaque-unsafe')).toBeNull();
    expect(namedElement(projection, 'fla-structure-hit-bitmap-one')).not.toBeNull();

    const doubleClick = { cancelBubble: false };
    const onDoubleClick = symbol?.props.onDblClick as
      | ((event: typeof doubleClick) => void)
      | undefined;
    expect(onDoubleClick).toBeTypeOf('function');
    onDoubleClick?.(doubleClick);
    expect(doubleClick.cancelBubble).toBe(true);
    expect(props.onSelect).toHaveBeenCalledWith(['group-a', 'symbol-b']);
    expect(props.onEnter).toHaveBeenCalledWith(['group-a', 'symbol-b']);
  });

  it('routes Group selection through a transparent bounds hit rect behind nested children', () => {
    const definition = makeDefinition();
    const frame = definition.structure!.frames[0]!;
    const projection = FlaGraphicStructureProjection(projectionProps({
      frame,
      definition,
      scopePath: [],
    }));
    const group = namedElement(projection, 'fla-structure-node-group-a');
    const descendantBitmap = namedElement(projection, 'fla-structure-bitmap-bitmap-one');

    expect(group?.props.listening).toBe(true);
    expect(namedElement(projection, 'fla-structure-hit-group-a')).not.toBeNull();
    expect(descendantBitmap).toBeNull();
    expect(namedElement(projection, 'fla-structure-hit-root-bitmap')).not.toBeNull();
  });

  it('projects saved instance-local matrices over the shared authored Definition', () => {
    const definition = makeDefinition();
    const frame = definition.structure!.frames[0]!;
    const override = matrixAt(0, 2, 3, 17, -9);
    const projection = FlaGraphicStructureProjection(projectionProps({
      frame,
      definition,
      scopePath: ['group-a'],
      instanceTransformOverrides: {
        '0': { '["group-a","bitmap-one"]': override },
      },
    }));
    const child = namedElement(projection, 'fla-structure-node-bitmap-one');

    expect(child?.props).toMatchObject({ x: 17, y: -9, scaleX: 2, scaleY: 3 });
    expect(definition.structure!.frames[0]!.layers[0]!.nodes[0]!.localTransform)
      .toEqual(matrixAt(30, 1.4, 0.8, 45, -12));
  });

  it.each([
    ['move', { ...identity, tx: 13, ty: -8 }],
    ['scale', { ...identity, a: 1.35, d: 0.72 }],
    ['rotate', matrixAt(37, 1, 1, 0, 0)],
  ] as const)(
    'converts a %s into the current transformed parent local matrix',
    (_operation, childLocal) => {
      const definition = makeDefinition();
      const frame = definition.structure!.frames[0]!;
      const parentWorld = matrixAt(31, 1.7, 0.65, 120, -55);
      const childAbsolute = multiplyAffineMatrices(parentWorld, childLocal);
      const onTransform = vi.fn();
      const props = projectionProps({
        frame,
        definition,
        scopePath: ['group-a'],
        parentMatrix: parentWorld,
        onTransform,
      });
      const projection = FlaGraphicStructureProjection(props);
      const child = namedElement(projection, 'fla-structure-node-bitmap-one');
      const onTransformEnd = child?.props.onTransformEnd as ((event: {
        cancelBubble: boolean;
        target: {
          getAbsoluteTransform: () => { getMatrix: () => number[] };
          setAttrs: (attrs: Record<string, unknown>) => void;
        };
      }) => void) | undefined;
      expect(onTransformEnd).toBeTypeOf('function');
      if (!onTransformEnd) throw new Error('Expected transform support on the direct bitmap.');

      onTransformEnd({
        cancelBubble: false,
        target: {
          getAbsoluteTransform: () => ({ getMatrix: () => matrixArray(childAbsolute) }),
          setAttrs: vi.fn(),
        },
      });

      expect(onTransform).toHaveBeenCalledTimes(1);
      const [path, saved] = onTransform.mock.calls[0]!;
      expect(path).toEqual(['group-a', 'bitmap-one']);
      for (const key of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const) {
        expect(saved[key]).toBeCloseTo(childLocal[key], 8);
      }
    },
  );

  it('preserves the child-local matrix under a flipped parent transform', () => {
    const definition = makeDefinition();
    const frame = definition.structure!.frames[0]!;
    const parentWorld = matrixAt(-19, -1.6, 0.7, 85, -42);
    const childLocal = matrixAt(33, 1.25, 0.9, 12, -6);
    const childAbsolute = multiplyAffineMatrices(parentWorld, childLocal);
    const onTransform = vi.fn();
    const projection = FlaGraphicStructureProjection(projectionProps({
      frame,
      definition,
      scopePath: ['group-a'],
      parentMatrix: parentWorld,
      onTransform,
    }));
    const child = namedElement(projection, 'fla-structure-node-bitmap-one');
    const onTransformEnd = child?.props.onTransformEnd as ((event: {
      cancelBubble: boolean;
      target: {
        getAbsoluteTransform: () => { getMatrix: () => number[] };
        setAttrs: (attrs: Record<string, unknown>) => void;
      };
    }) => void) | undefined;
    expect(onTransformEnd).toBeTypeOf('function');
    if (!onTransformEnd) throw new Error('Expected transform support on the direct bitmap.');

    onTransformEnd({
      cancelBubble: false,
      target: {
        getAbsoluteTransform: () => ({ getMatrix: () => matrixArray(childAbsolute) }),
        setAttrs: vi.fn(),
      },
    });

    expect(onTransform).toHaveBeenCalledTimes(1);
    const saved = onTransform.mock.calls[0]![1];
    for (const key of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const) {
      expect(saved[key]).toBeCloseTo(childLocal[key], 8);
    }
  });

  it('keeps pointer movement in a transient preview until gesture completion commits once', () => {
    const definition = makeDefinition();
    const frame = definition.structure!.frames[0]!;
    const parentWorld = matrixAt(18, 2, 3, 80, -20);
    const childLocal = matrixAt(40, 0.8, 1.2, 25, 30);
    const childAbsolute = multiplyAffineMatrices(parentWorld, childLocal);
    const onTransformPreview = vi.fn();
    const onCommitTransform = vi.fn();
    const projection = FlaGraphicStructureProjection(projectionProps({
      frame,
      definition,
      scopePath: ['group-a'],
      parentMatrix: parentWorld,
      onTransformPreview,
      onTransform: onCommitTransform,
    }));
    const child = namedElement(projection, 'fla-structure-node-bitmap-one');
    const event = {
      cancelBubble: false,
      target: {
        getAbsoluteTransform: () => ({ getMatrix: () => matrixArray(childAbsolute) }),
        setAttrs: vi.fn(),
      },
    };
    const onDragMove = child?.props.onDragMove as ((value: typeof event) => void) | undefined;
    const onDragEnd = child?.props.onDragEnd as ((value: typeof event) => void) | undefined;
    expect(onDragMove).toBeTypeOf('function');
    expect(onDragEnd).toBeTypeOf('function');
    if (!onDragMove || !onDragEnd) throw new Error('Expected drag preview and commit handlers.');

    onDragMove(event);
    expect(onTransformPreview).toHaveBeenCalledTimes(1);
    expect(onCommitTransform).not.toHaveBeenCalled();
    onDragEnd(event);
    expect(onTransformPreview).toHaveBeenCalledTimes(1);
    expect(onCommitTransform).toHaveBeenCalledTimes(1);
    expect(onCommitTransform.mock.calls[0]?.[0]).toEqual(['group-a', 'bitmap-one']);
  });

  it('stores gesture previews by instance and full path and prunes completed or replaced drafts', () => {
    const { project, shot, layerId } = projectWithSavedGraphic();
    const target = resolveFlaGraphicEditTarget({
      project,
      projectRoot: 'D:\\PandaStage-Acceptance\\saved-graphic.pandastage',
      projectInstanceId: 41,
      shot,
      layerId,
    })!;
    const matrix = matrixAt(25, 1.2, 0.8, 14, -3);
    const path = ['group-a', 'symbol-b', 'bitmap-grandchild'];
    const drafts = recordFlaGraphicEditDraft({}, target.key, path, matrix);

    expect(drafts[target.key]?.[JSON.stringify(path)]).toEqual(matrix);
    expect(retainValidFlaGraphicEditDrafts(drafts, new Set([target.key]))).toBe(drafts);
    expect(clearFlaGraphicEditDraft(drafts, target.key, path)).toEqual({});
    expect(clearFlaGraphicEditTargetDrafts(drafts, target.key)).toEqual({});

    const differentInstance = resolveFlaGraphicEditTarget({
      project,
      projectRoot: 'D:\\PandaStage-Acceptance\\saved-graphic.pandastage',
      projectInstanceId: 42,
      shot,
      layerId,
    })!;
    expect(differentInstance.key).not.toBe(target.key);
    expect(retainValidFlaGraphicEditDrafts(drafts, new Set([differentInstance.key]))).toEqual({});

    const group = getFlaGraphicNodeAtPath(target.frame, ['group-a']);
    if (group?.type !== 'group') throw new Error('Expected the authored Group.');
    const revisedDefinition = FlaGraphicDefinitionSchema.parse({
      ...target.animation,
      structure: {
        version: 1,
        frames: [{
          ...target.frame,
          layers: [{
            ...target.frame.layers[0]!,
            nodes: [
              {
                ...group,
                localTransform: {
                  ...group.localTransform,
                  tx: group.localTransform.tx + 1,
                },
              },
              ...target.frame.layers[0]!.nodes.slice(1),
            ],
          }],
        }],
      },
    });
    project.animations[0] = revisedDefinition;
    const revisedTarget = resolveFlaGraphicEditTarget({
      project,
      projectRoot: 'D:\\PandaStage-Acceptance\\saved-graphic.pandastage',
      projectInstanceId: 41,
      shot,
      layerId,
    })!;
    expect(revisedTarget.key).not.toBe(target.key);
    expect(retainValidFlaGraphicEditDrafts(drafts, new Set([revisedTarget.key]))).toEqual({});
    expect(retainValidFlaGraphicEditDrafts(drafts, new Set())).toEqual({});

    const layer = shot.layers.find((candidate) => candidate.id === layerId)!;
    layer.source = {
      kind: 'animation',
      animationId: revisedTarget.animation.id,
      flaOccurrence: {
        occurrenceId: `occ-${'a'.repeat(24)}`,
        sourceAddress: 'root/instance-1',
        adapterIdentity: 'fla-graphic-structure-v1',
        drawOrder: 0,
      },
    };
    const replacedOccurrenceTarget = resolveFlaGraphicEditTarget({
      project,
      projectRoot: 'D:\\PandaStage-Acceptance\\saved-graphic.pandastage',
      projectInstanceId: 41,
      shot,
      layerId,
    })!;
    expect(replacedOccurrenceTarget.key).not.toBe(revisedTarget.key);
    expect(retainValidFlaGraphicEditDrafts(
      drafts,
      new Set([replacedOccurrenceTarget.key]),
    )).toEqual({});
  });

  it('projects the structured editor layer without the legacy animation hit area', () => {
    const project = migrateProject(exampleProject);
    const shot = project.shots[0]!;
    const stageLayer = buildEditorStageRenderModel(project, shot).layers.find(
      ({ render }) => !render.isBackground,
    )!;
    const definition = makeDefinition();
    const projection = projectionProps({
      definition,
      frame: definition.structure!.frames[0]!,
      scopePath: [],
    });
    const layer = SelectableLayer({
      image: {} as HTMLImageElement,
      images: new Map(),
      layer: stageLayer.layer,
      nodeRef: { current: null },
      render: stageLayer.render,
      selected: true,
      flaGraphicEditProjection: projection,
      onSelect: vi.fn(),
      onCommitPosition: vi.fn(),
      onCommitTransform: vi.fn(),
      onError: vi.fn(),
    });
    const elements = treeElements(layer.props.children);
    const names = elements.map((element) => element.props.name);

    expect(elements.some((element) => element.type === FlaGraphicStructureProjection)).toBe(true);
    expect(names).not.toContain('selectable-canvas-visual');
    expect(names).not.toContain('selectable-animation-canvas-hit-area');
  });
});
