import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  FLA_GRAPHIC_IDENTITY_ALIAS_ID_PATTERN,
  FlaGraphicStructureSchema,
  LayerService,
  ProjectSchema,
  clearFlaGraphicNodeIdentityAlias,
  composeAffineMatrix,
  evaluateFlaGraphicVisual,
  evaluateShotAtTime,
  listFlaGraphicIdentityAliasGroups,
  listFlaGraphicIdentityAmbiguities,
  resolveFlaGraphicInternalAuthoringState,
  resolveFlaGraphicStableNodeIdentity,
  resolveFlaGraphicTimelineTarget,
  resolveLayerAttachmentTargets,
  setFlaGraphicNodeIdentityAlias,
  type FlaGraphicDefinition,
  type FlaGraphicStructure,
  type FlaGraphicStructureNode,
  type Project,
} from '../../src/domain';
import type { AffineMatrix2D } from '../../src/shared/affine-matrix';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { FlaGraphicInternalTimelineBar } from '../../src/renderer/features/timeline/FlaGraphicInternalTimelineBar';
import { buildProjectWithAnimation } from './domain/testProject';

const FRAME_ASSET_IDS = [
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000006',
];
const FRAME_SHA256 = 'e'.repeat(64);
const IDENTITY: AffineMatrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const ARM_SPAN = 3;

function bitmapNode(
  id: string,
  sourceAddress: string | undefined,
  drawOrder: number,
  tx: number,
  bitmapRef = 'Library/arm.png',
): FlaGraphicStructureNode {
  return {
    type: 'bitmap',
    id,
    ...(sourceAddress ? { sourceAddress } : {}),
    drawOrder,
    localTransform: { ...IDENTITY, tx, ty: 20 },
    bitmapRef,
  };
}

/**
 * Multi-frame Graphic: `arm-a`/`arm-b` share one source address and stay
 * ambiguous; `leg` has a unique address and stays source-proven. Two shared
 * Symbol definitions hold source-less nodes so the proven `sym:` rule applies.
 */
function multiFrameStructure(): FlaGraphicStructure {
  return FlaGraphicStructureSchema.parse({
    version: 1,
    symbolDefinitions: {
      defA: {
        symbolRef: 'Library/SharedA',
        children: [bitmapNode('def-a-node', undefined, 0, 30)],
      },
      defB: {
        symbolRef: 'Library/SharedB',
        children: [bitmapNode('def-b-node', undefined, 0, 40)],
      },
    },
    frames: [
      {
        ordinal: 0,
        layers: [
          {
            name: 'L1',
            nodes: [
              bitmapNode('arm-a', 'Hero/arm', 0, 10),
              bitmapNode('arm-b', 'Hero/arm', 1, 500),
              bitmapNode('leg', 'Hero/leg', 2, 90),
              {
                type: 'opaque',
                id: 'lock-txt',
                sourceAddress: 'Hero/text',
                drawOrder: 3,
                localTransform: { ...IDENTITY },
                opaqueKind: 'text',
              },
              {
                type: 'symbol',
                id: 'inst-a',
                sourceAddress: 'Hero/inst-a',
                drawOrder: 4,
                localTransform: { ...IDENTITY },
                symbolRef: 'Library/SharedA',
                nestedDefinitionId: 'defA',
              },
              {
                type: 'symbol',
                id: 'inst-b',
                sourceAddress: 'Hero/inst-b',
                drawOrder: 5,
                localTransform: { ...IDENTITY },
                symbolRef: 'Library/SharedB',
                nestedDefinitionId: 'defB',
              },
            ],
          },
        ],
      },
      {
        ordinal: 1,
        layers: [
          {
            name: 'L1',
            nodes: [
              bitmapNode('arm-c', 'Hero/arm', 0, 10),
              bitmapNode('arm-d', 'Hero/arm', 1, 500),
              bitmapNode('leg-f1', 'Hero/leg', 2, 90),
            ],
          },
        ],
      },
      {
        ordinal: 2,
        layers: [
          {
            name: 'L1',
            nodes: [
              bitmapNode('arm-e', 'Hero/arm', 0, 10),
              bitmapNode('arm-f', 'Hero/arm', 1, 500),
              bitmapNode('leg-f2', 'Hero/leg', 2, 90),
            ],
          },
        ],
      },
    ],
  });
}

function singleFrameStructure(): FlaGraphicStructure {
  return FlaGraphicStructureSchema.parse({
    version: 1,
    frames: [
      {
        ordinal: 0,
        layers: [
          {
            name: 'L',
            nodes: [bitmapNode('only-node', undefined, 0, 15)],
          },
        ],
      },
    ],
  });
}

function buildIdentityProject(): {
  project: Project;
  shotId: string;
  layerAId: string;
  layerBId: string;
  service: LayerService;
} {
  const base = buildProjectWithAnimation();
  const baseAnim = base.animations[0]!;
  const frameDurationMs = 1_000 / baseAnim.source.sourceFps;
  const frameAssets = [0, 1, 2].map((ordinal) => ({
    id: FRAME_ASSET_IDS[ordinal]!,
    kind: 'image' as const,
    name: `Graphic frame ${ordinal}`,
    relativePath: `assets/graphic-frame-${ordinal}.svg`,
    mimeType: 'image/svg+xml',
    sha256: FRAME_SHA256,
    width: 640,
    height: 640,
    usage: 'uncategorized' as const,
    keywords: [],
    flaGraphicFrame: { definitionId: baseAnim.id, ordinal },
  }));
  const definition: FlaGraphicDefinition = {
    ...baseAnim,
    kind: 'fla-graphic',
    durationMs: ARM_SPAN * frameDurationMs,
    source: {
      ...baseAnim.source,
      endFrameIndex: baseAnim.source.startFrameIndex + ARM_SPAN - 1,
    },
    frames: Array.from({ length: ARM_SPAN }, (_, ordinal) => ({
      ...baseAnim.frames[ordinal]!,
      ordinal,
      sourceFrameIndex: baseAnim.source.startFrameIndex + ordinal,
      assetId: FRAME_ASSET_IDS[ordinal]!,
      sha256: FRAME_SHA256,
      createdBySequenceImport: false,
    })),
    structure: multiFrameStructure(),
  };
  let project = ProjectSchema.parse({
    ...base,
    assets: [...base.assets, ...frameAssets],
    animations: [definition],
  });
  const service = new LayerService();
  const shotId = project.shots[0]!.id;
  const createdA = service.createFromAsset(project, shotId, {
    version: 3,
    type: 'animation',
    animationId: definition.id,
    position: { x: 400, y: 300 },
    startTimeMs: 0,
  });
  project = createdA.project;
  const createdB = service.createFromAsset(project, shotId, {
    version: 3,
    type: 'animation',
    animationId: definition.id,
    position: { x: 900, y: 300 },
    startTimeMs: 0,
  });
  project = createdB.project;
  return {
    project,
    shotId,
    layerAId: createdA.layer.id,
    layerBId: createdB.layer.id,
    service,
  };
}

function definitionOf(project: Project): FlaGraphicDefinition {
  return project.animations[0] as FlaGraphicDefinition;
}

function evaluatedTransformAtPath(
  visual: ReturnType<typeof evaluateFlaGraphicVisual>,
  nodePath: readonly string[],
): AffineMatrix2D | null {
  if (!visual?.layers) return null;
  const visit = (
    nodes: NonNullable<NonNullable<typeof visual.layers>[number]>['nodes'],
  ): AffineMatrix2D | null => {
    for (const node of nodes) {
      if (
        node.path.length === nodePath.length &&
        node.path.every((part, index) => part === nodePath[index])
      ) {
        return node.localTransform;
      }
      const nested = visit(node.children);
      if (nested) return nested;
    }
    return null;
  };
  return visit(visual.layers.flatMap((layer) => layer.nodes));
}

function aliasIdAt(
  structure: FlaGraphicStructure,
  containerKey: string,
  nodeId: string,
): string {
  const aliasId = structure.nodeIdentityAliases?.[containerKey]?.[nodeId];
  if (!aliasId) throw new Error(`Missing alias for ${containerKey}/${nodeId}`);
  return aliasId;
}

describe('FLA Graphic cross-frame node identity aliases (#1450)', () => {
  it('preserves the proven addr:/sym:/node: rules and reports only genuinely ambiguous nodes', () => {
    const structure = multiFrameStructure();
    const frame0Nodes = structure.frames[0]!.layers.flatMap((layer) => layer.nodes);
    const defANodes = structure.symbolDefinitions!.defA!.children;

    expect(
      resolveFlaGraphicTimelineTarget(structure, 0, ['arm-a']),
    ).toMatchObject({
      trackId: null,
      authoringCapability: 'readonly-identity',
      identitySource: null,
      identityAliasId: null,
    });
    expect(
      resolveFlaGraphicTimelineTarget(structure, 0, ['leg']),
    ).toMatchObject({
      trackId: 'addr:Hero/leg',
      authoringCapability: 'editable',
      identitySource: 'addr',
    });
    expect(
      resolveFlaGraphicTimelineTarget(structure, 0, ['lock-txt'])
        ?.authoringCapability,
    ).toBe('readonly-opaque');
    expect(
      resolveFlaGraphicTimelineTarget(structure, 0, ['inst-a', 'def-a-node']),
    ).toMatchObject({
      trackId: 'sym:defA:def-a-node',
      identitySource: 'sym',
      ownerKind: 'symbol',
    });

    // Direct resolver calls keep the exact proven rules.
    expect(
      resolveFlaGraphicStableNodeIdentity(
        frame0Nodes[0]!,
        structure,
        'frame',
        null,
        frame0Nodes,
        0,
      ),
    ).toBeNull();
    expect(
      resolveFlaGraphicStableNodeIdentity(
        defANodes[0]!,
        structure,
        'symbol',
        'defA',
        defANodes,
      ),
    ).toBe('sym:defA:def-a-node');

    const singleFrame = singleFrameStructure();
    expect(
      resolveFlaGraphicStableNodeIdentity(
        singleFrame.frames[0]!.layers[0]!.nodes[0]!,
        singleFrame,
        'frame',
        null,
        singleFrame.frames[0]!.layers[0]!.nodes,
        0,
      ),
    ).toBe('node:only-node');

    expect(
      listFlaGraphicIdentityAmbiguities(structure, 0).map(
        (entry) => entry.nodeId,
      ),
    ).toEqual(['arm-a', 'arm-b']);
    expect(
      listFlaGraphicIdentityAmbiguities(structure, 0).every(
        (entry) => entry.trsSafe,
      ),
    ).toBe(true);
    expect(listFlaGraphicIdentityAmbiguities(structure, 9)).toEqual([]);
  });

  it('keeps the authoring capability and reason honest for unaliased, aliased, and TRS-unsafe nodes', () => {
    const structure = multiFrameStructure();
    const ambiguousState = resolveFlaGraphicInternalAuthoringState({
      structure,
      frameOrdinal: 0,
      nodePath: ['arm-a'],
      internalTimeMs: 0,
      timelineAuthoringActive: true,
    });
    expect(ambiguousState.authoringCapability).toBe('readonly-identity');
    expect(ambiguousState.reason).toBe('identity-readonly');
    expect(ambiguousState.canEditTransform).toBe(false);
    expect(ambiguousState.canAddKeyframe).toBe(false);

    const aliased = setFlaGraphicNodeIdentityAlias(
      structure,
      0,
      ['arm-a'],
      'alias-one',
    );
    const aliasedState = resolveFlaGraphicInternalAuthoringState({
      structure: aliased,
      frameOrdinal: 0,
      nodePath: ['arm-a'],
      internalTimeMs: 0,
      timelineAuthoringActive: true,
    });
    expect(aliasedState.authoringCapability).toBe('editable');
    expect(aliasedState.reason).toBe('no-key-readonly');
    expect(aliasedState.canAddKeyframe).toBe(true);
    expect(aliasedState.target?.identitySource).toBe('alias');

    const shearStructure = FlaGraphicStructureSchema.parse({
      version: 1,
      frames: [
        {
          ordinal: 0,
          layers: [
            {
              name: 'L',
              nodes: [
                {
                  type: 'bitmap',
                  id: 'shear-a',
                  sourceAddress: 'Hero/shear',
                  drawOrder: 0,
                  localTransform: { a: 1, b: 0, c: 0.45, d: 1, tx: 5, ty: 5 },
                  bitmapRef: 'Library/a.png',
                },
                {
                  type: 'bitmap',
                  id: 'shear-b',
                  sourceAddress: 'Hero/shear',
                  drawOrder: 1,
                  localTransform: { ...IDENTITY },
                  bitmapRef: 'Library/a.png',
                },
              ],
            },
          ],
        },
        {
          ordinal: 1,
          layers: [
            {
              name: 'L',
              nodes: [
                {
                  type: 'bitmap',
                  id: 'shear-c',
                  sourceAddress: 'Hero/shear',
                  drawOrder: 0,
                  localTransform: { ...IDENTITY },
                  bitmapRef: 'Library/a.png',
                },
              ],
            },
          ],
        },
      ],
    });
    const aliasedShear = setFlaGraphicNodeIdentityAlias(
      shearStructure,
      0,
      ['shear-a'],
      'shear-alias',
    );
    const shearState = resolveFlaGraphicInternalAuthoringState({
      structure: aliasedShear,
      frameOrdinal: 0,
      nodePath: ['shear-a'],
      internalTimeMs: 0,
      timelineAuthoringActive: true,
    });
    expect(shearState.authoringCapability).toBe('readonly-trs-unsafe');
    expect(shearState.reason).toBe('trs-unsafe-readonly');
    expect(shearState.canAddKeyframe).toBe(false);
    expect(shearState.target?.identitySource).toBe('alias');
  });

  it('adds, joins across frames, and clears aliases with pure immutable helpers', () => {
    const structure = multiFrameStructure();
    const aliased = setFlaGraphicNodeIdentityAlias(
      structure,
      0,
      ['arm-a'],
      'alias-one',
    );
    expect(aliased).not.toBe(structure);
    expect(structure.nodeIdentityAliases).toBeUndefined();
    expect(aliased.nodeIdentityAliases).toEqual({
      'frame:0': { 'arm-a': 'alias-one' },
    });

    const target = resolveFlaGraphicTimelineTarget(aliased, 0, ['arm-a']);
    expect(target).toMatchObject({
      trackId: 'alias:alias-one',
      authoringCapability: 'editable',
      identitySource: 'alias',
      identityAliasId: 'alias-one',
    });
    expect(
      listFlaGraphicIdentityAmbiguities(aliased, 0).map(
        (entry) => entry.nodeId,
      ),
    ).toEqual(['arm-b']);

    // Proven identities can never be replaced by an author alias.
    expect(
      setFlaGraphicNodeIdentityAlias(structure, 0, ['leg'], 'alias-one'),
    ).toBe(structure);
    // Opaque nodes have no identity to alias.
    expect(
      setFlaGraphicNodeIdentityAlias(structure, 0, ['lock-txt'], 'alias-one'),
    ).toBe(structure);

    // Two distinct nodes in the same frame must never merge.
    expect(() =>
      setFlaGraphicNodeIdentityAlias(aliased, 0, ['arm-b'], 'alias-one'),
    ).toThrow(/must not merge/u);
    expect(() =>
      setFlaGraphicNodeIdentityAlias(
        structure,
        0,
        ['arm-a'],
        'not a valid id!',
      ),
    ).toThrow(/bounded identifiers/u);

    // The same alias may be joined from a different source frame.
    const joined = setFlaGraphicNodeIdentityAlias(
      aliased,
      1,
      ['arm-c'],
      'alias-one',
    );
    expect(joined.nodeIdentityAliases).toEqual({
      'frame:0': { 'arm-a': 'alias-one' },
      'frame:1': { 'arm-c': 'alias-one' },
    });
    expect(
      resolveFlaGraphicTimelineTarget(joined, 1, ['arm-c'])?.trackId,
    ).toBe('alias:alias-one');

    const groups = listFlaGraphicIdentityAliasGroups(joined);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.assignments.map((entry) => entry.nodeId)).toEqual([
      'arm-a',
      'arm-c',
    ]);

    const clearedOneFrame = clearFlaGraphicNodeIdentityAlias(joined, 1, [
      'arm-c',
    ]);
    expect(clearedOneFrame.nodeIdentityAliases).toEqual({
      'frame:0': { 'arm-a': 'alias-one' },
    });
    expect(clearFlaGraphicNodeIdentityAlias(clearedOneFrame, 1, ['arm-c'])).toBe(
      clearedOneFrame,
    );
    const clearedAll = clearFlaGraphicNodeIdentityAlias(clearedOneFrame, 0, [
      'arm-a',
    ]);
    expect(clearedAll.nodeIdentityAliases).toBeUndefined();
    expect(clearedAll).toEqual(structure);
    // Clearing a node without an alias is a no-op.
    expect(clearFlaGraphicNodeIdentityAlias(structure, 0, ['arm-b'])).toBe(
      structure,
    );
  });

  it('validates persisted aliases while ignoring dangling entries safely', () => {
    const structure = multiFrameStructure();
    const withAliases = setFlaGraphicNodeIdentityAlias(
      structure,
      0,
      ['arm-a'],
      'alias-one',
    );
    const reloaded = FlaGraphicStructureSchema.parse(
      JSON.parse(JSON.stringify(withAliases)),
    );
    expect(reloaded).toEqual(withAliases);

    expect(() =>
      FlaGraphicStructureSchema.parse({
        ...structure,
        nodeIdentityAliases: { 'frame:0': { 'arm-a': 'bad id' } },
      }),
    ).toThrow();
    expect(() =>
      FlaGraphicStructureSchema.parse({
        ...structure,
        nodeIdentityAliases: {
          'frame:0': { 'arm-a': 'duplicate', 'arm-b': 'duplicate' },
        },
      }),
    ).toThrow();
    expect(() =>
      FlaGraphicStructureSchema.parse({
        ...structure,
        nodeIdentityAliases: { 'frame:x': { 'arm-a': 'alias-one' } },
      }),
    ).toThrow();
    expect(() =>
      FlaGraphicStructureSchema.parse({
        ...structure,
        nodeIdentityAliases: { 'other:1': { 'arm-a': 'alias-one' } },
      }),
    ).toThrow();

    // Same alias id in different frames is an intentional cross-frame join.
    expect(() =>
      FlaGraphicStructureSchema.parse({
        ...structure,
        nodeIdentityAliases: {
          'frame:0': { 'arm-a': 'joined' },
          'frame:1': { 'arm-c': 'joined' },
        },
      }),
    ).not.toThrow();

    // An alias for a node that no longer exists is ignored, not fatal.
    const dangling = FlaGraphicStructureSchema.parse({
      ...structure,
      nodeIdentityAliases: {
        'frame:0': { 'missing-node': 'orphan-alias' },
      },
    });
    expect(
      resolveFlaGraphicTimelineTarget(dangling, 0, ['arm-a'])?.trackId,
    ).toBeNull();
    expect(
      listFlaGraphicIdentityAmbiguities(dangling, 0).map(
        (entry) => entry.nodeId,
      ),
    ).toEqual(['arm-a', 'arm-b']);
    expect(
      evaluateFlaGraphicVisual({
        definition: {
          ...definitionOf(buildIdentityProject().project),
          structure: dangling,
        },
        frameOrdinal: 0,
        mode: 'definition',
      }),
    ).not.toBeNull();
  });

  it('keeps shared Symbol definition aliases scoped away from other definitions and frames', () => {
    const scoped = FlaGraphicStructureSchema.parse({
      ...multiFrameStructure(),
      nodeIdentityAliases: {
        'sym:defA': {
          'def-a-node': 'shared-alias',
          // Same node id would exist in the frame container; this entry must stay
          // scoped to the shared definition and never resolve the frame node.
          'arm-a': 'symbol-only-alias',
        },
        'sym:defB': { 'def-b-node': 'shared-alias' },
      },
    });

    const defATarget = resolveFlaGraphicTimelineTarget(scoped, 0, [
      'inst-a',
      'def-a-node',
    ]);
    const defBTarget = resolveFlaGraphicTimelineTarget(scoped, 0, [
      'inst-b',
      'def-b-node',
    ]);
    expect(defATarget?.trackId).toBe('sym:defA:def-a-node');
    expect(defBTarget?.trackId).toBe('sym:defB:def-b-node');
    expect(defATarget?.trackId).not.toBe(defBTarget?.trackId);
    expect(defATarget?.identitySource).toBe('sym');

    // A Symbol-scoped alias must never leak into the concrete frame container.
    expect(
      resolveFlaGraphicTimelineTarget(scoped, 0, ['arm-a'])?.trackId,
    ).toBeNull();
    expect(
      listFlaGraphicIdentityAmbiguities(scoped, 0).map(
        (entry) => entry.nodeId,
      ),
    ).toEqual(['arm-a', 'arm-b']);
  });

  it('associates two nodes sharing one sourceAddress to distinct identities and evaluates their tracks after save/reopen', () => {
    const fixture = buildIdentityProject();
    let project = fixture.project;
    const [firstFrame] = definitionOf(project).structure!.frames;

    expect(
      resolveFlaGraphicTimelineTarget(
        definitionOf(project).structure!,
        0,
        ['arm-a'],
      )?.authoringCapability,
    ).toBe('readonly-identity');

    project = fixture.service.setFlaGraphicNodeIdentityAlias(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-a'],
    );
    const aliasA = aliasIdAt(
      definitionOf(project).structure!,
      'frame:0',
      'arm-a',
    );
    expect(aliasA).toMatch(FLA_GRAPHIC_IDENTITY_ALIAS_ID_PATTERN);
    project = fixture.service.setFlaGraphicNodeIdentityAlias(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-b'],
    );
    const aliasB = aliasIdAt(
      definitionOf(project).structure!,
      'frame:0',
      'arm-b',
    );
    expect(aliasB).not.toBe(aliasA);

    const structure = definitionOf(project).structure!;
    expect(resolveFlaGraphicTimelineTarget(structure, 0, ['arm-a'])).toMatchObject(
      {
        trackId: `alias:${aliasA}`,
        authoringCapability: 'editable',
        identitySource: 'alias',
      },
    );
    expect(resolveFlaGraphicTimelineTarget(structure, 0, ['arm-b'])).toMatchObject(
      { trackId: `alias:${aliasB}`, authoringCapability: 'editable' },
    );
    expect(firstFrame).toBeDefined();

    // Author a track on the aliased identity and persist through ProjectSchema.
    project = fixture.service.addFlaGraphicTimelineKeyframe(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-a'],
      0,
    );
    project = fixture.service.addFlaGraphicTimelineKeyframe(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-a'],
      1_000,
    );
    project = fixture.service.updateFlaGraphicTimelineKeyframeTransform(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-a'],
      1_000,
      composeAffineMatrix({
        tx: 410,
        ty: 20,
        rotationDeg: 0,
        scaleX: 1,
        scaleY: 1,
      }),
    );

    const reloaded = ProjectSchema.parse(JSON.parse(JSON.stringify(project)));
    const reloadedStructure = definitionOf(reloaded).structure!;
    expect(
      resolveFlaGraphicTimelineTarget(reloadedStructure, 0, ['arm-a'])?.trackId,
    ).toBe(`alias:${aliasA}`);
    const midpoint = evaluateFlaGraphicVisual({
      definition: definitionOf(reloaded),
      frameOrdinal: 0,
      mode: 'definition',
      internalTimeMs: 500,
    });
    expect(evaluatedTransformAtPath(midpoint, ['arm-a'])!.tx).toBeCloseTo(
      210,
      5,
    );
    // The distinct alias never inherits the other node's track.
    expect(evaluatedTransformAtPath(midpoint, ['arm-b'])!.tx).toBeCloseTo(
      500,
      5,
    );
  });

  it('joins the same part across three source frames through one shared identity', () => {
    const fixture = buildIdentityProject();
    let project = fixture.service.setFlaGraphicNodeIdentityAlias(
      fixture.project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-a'],
    );
    const aliasA = aliasIdAt(
      definitionOf(project).structure!,
      'frame:0',
      'arm-a',
    );
    project = fixture.service.setFlaGraphicNodeIdentityAlias(
      project,
      fixture.shotId,
      fixture.layerAId,
      1,
      ['arm-c'],
      aliasA,
    );
    project = fixture.service.setFlaGraphicNodeIdentityAlias(
      project,
      fixture.shotId,
      fixture.layerAId,
      2,
      ['arm-e'],
      aliasA,
    );
    project = fixture.service.addFlaGraphicTimelineKeyframe(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-a'],
      0,
    );
    project = fixture.service.addFlaGraphicTimelineKeyframe(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-a'],
      1_000,
    );
    project = fixture.service.updateFlaGraphicTimelineKeyframeTransform(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-a'],
      1_000,
      composeAffineMatrix({
        tx: 410,
        ty: 20,
        rotationDeg: 0,
        scaleX: 1,
        scaleY: 1,
      }),
    );

    const reloaded = ProjectSchema.parse(JSON.parse(JSON.stringify(project)));
    const definition = definitionOf(reloaded);
    for (const [frameOrdinal, nodeId] of [
      [0, 'arm-a'],
      [1, 'arm-c'],
      [2, 'arm-e'],
    ] as const) {
      expect(
        resolveFlaGraphicTimelineTarget(definition.structure!, frameOrdinal, [
          nodeId,
        ])?.trackId,
      ).toBe(`alias:${aliasA}`);
      const visual = evaluateFlaGraphicVisual({
        definition,
        frameOrdinal,
        mode: 'definition',
        internalTimeMs: 500,
      });
      expect(
        evaluatedTransformAtPath(visual, [nodeId])!.tx,
        `frame ${frameOrdinal}`,
      ).toBeCloseTo(210, 5);
      // The sibling that was not associated keeps its authored transform.
      expect(
        evaluatedTransformAtPath(visual, [
          frameOrdinal === 0 ? 'arm-b' : frameOrdinal === 1 ? 'arm-d' : 'arm-f',
        ])!.tx,
      ).toBeCloseTo(500, 5);
    }
    // The unassociated arm-b stays ambiguous and out of the shared identity.
    expect(
      resolveFlaGraphicTimelineTarget(definition.structure!, 0, ['arm-b'])
        ?.trackId,
    ).toBeNull();
  });

  it('rejects clearing an association that still owns keyframes and never corrupts sibling associations', () => {
    const fixture = buildIdentityProject();
    let project = fixture.service.setFlaGraphicNodeIdentityAlias(
      fixture.project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-a'],
    );
    const aliasA = aliasIdAt(
      definitionOf(project).structure!,
      'frame:0',
      'arm-a',
    );
    project = fixture.service.setFlaGraphicNodeIdentityAlias(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-b'],
    );
    const aliasB = aliasIdAt(
      definitionOf(project).structure!,
      'frame:0',
      'arm-b',
    );
    project = fixture.service.addFlaGraphicTimelineKeyframe(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-a'],
      0,
    );
    project = fixture.service.addFlaGraphicTimelineKeyframe(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-a'],
      1_000,
    );

    expect(() =>
      fixture.service.clearFlaGraphicNodeIdentityAlias(
        project,
        fixture.shotId,
        fixture.layerAId,
        0,
        ['arm-a'],
      ),
    ).toThrow(/关键帧轨道/u);

    project = fixture.service.deleteFlaGraphicTimelineKeyframe(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-a'],
      0,
    );
    project = fixture.service.deleteFlaGraphicTimelineKeyframe(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-a'],
      1_000,
    );
    project = fixture.service.clearFlaGraphicNodeIdentityAlias(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-a'],
    );
    const structure = definitionOf(project).structure!;
    expect(resolveFlaGraphicTimelineTarget(structure, 0, ['arm-a'])).toMatchObject(
      {
        trackId: null,
        authoringCapability: 'readonly-identity',
        identitySource: null,
      },
    );
    expect(aliasIdAt(structure, 'frame:0', 'arm-b')).toBe(aliasB);
    expect(resolveFlaGraphicTimelineTarget(structure, 0, ['arm-b'])?.trackId).toBe(
      `alias:${aliasB}`,
    );
    expect(structure.nodeIdentityAliases?.['frame:0']?.['arm-a']).toBeUndefined();
    expect(structure.timeline?.tracks ?? []).toHaveLength(0);
    expect(aliasA.length).toBeGreaterThan(0);
  });

  it('records one undo entry per association and restores the exact prior identity state', () => {
    const fixture = buildIdentityProject();
    const editor = new EditorProjectStore();
    editor.open('D:\\PandaStage-Acceptance\\issue-1450.pandastage', fixture.project);
    const store = new LayerStore(
      editor,
      { getCurrentShotId: () => fixture.shotId },
      fixture.service,
    );
    const undoBefore = editor.history.getSnapshot().undoCount;

    store.setFlaGraphicNodeIdentityAlias(fixture.layerAId, 0, ['arm-a']);
    expect(editor.history.getSnapshot().undoCount).toBe(undoBefore + 1);
    expect(
      resolveFlaGraphicTimelineTarget(
        definitionOf(editor.getSnapshot()!.project).structure!,
        0,
        ['arm-a'],
      )?.trackId,
    ).toMatch(/^alias:/u);

    expect(editor.undo()).toBe(true);
    expect(
      resolveFlaGraphicTimelineTarget(
        definitionOf(editor.getSnapshot()!.project).structure!,
        0,
        ['arm-a'],
      ),
    ).toMatchObject({ trackId: null, authoringCapability: 'readonly-identity' });
    expect(
      definitionOf(editor.getSnapshot()!.project).structure!.nodeIdentityAliases,
    ).toBeUndefined();

    expect(editor.redo()).toBe(true);
    expect(
      resolveFlaGraphicTimelineTarget(
        definitionOf(editor.getSnapshot()!.project).structure!,
        0,
        ['arm-a'],
      )?.trackId,
    ).toMatch(/^alias:/u);
  });

  it('resolves aliased identities through layer attachment targets and keeps instance overrides valid', () => {
    const fixture = buildIdentityProject();
    const overrideMatrix: AffineMatrix2D = {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      tx: 333,
      ty: 444,
    };
    let project = fixture.service.updateFlaGraphicInstanceTransform(
      fixture.project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-a'],
      overrideMatrix,
    );
    project = fixture.service.setFlaGraphicNodeIdentityAlias(
      project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-a'],
    );
    const aliasA = aliasIdAt(
      definitionOf(project).structure!,
      'frame:0',
      'arm-a',
    );
    const shot = project.shots[0]!;
    const ownerLayer = shot.layers.find((layer) => layer.id === fixture.layerAId)!;
    expect(
      ownerLayer.flaGraphicInstanceTransformOverrides?.['0']?.[
        JSON.stringify(['arm-a'])
      ],
    ).toEqual(overrideMatrix);

    const evaluated = evaluateShotAtTime(shot, 0, project).layers.find(
      (layer) => layer.id === fixture.layerAId,
    )!;
    const targets = resolveLayerAttachmentTargets(project, ownerLayer, evaluated);
    const identityPaths = targets.flatMap((entry) =>
      entry.target.kind === 'graphic-node' ? [entry.target.identityPath] : [],
    );
    expect(identityPaths).toContainEqual([`alias:${aliasA}`]);

    const instanceVisual = evaluateFlaGraphicVisual({
      definition: definitionOf(project),
      frameOrdinal: 0,
      mode: 'instance',
      instanceTransformOverrides:
        ownerLayer.flaGraphicInstanceTransformOverrides,
      internalTimeMs: 0,
    });
    expect(
      evaluatedTransformAtPath(instanceVisual, ['arm-a'])!.tx,
    ).toBeCloseTo(333, 5);
  });

  it('renders manual association actions for ambiguous nodes and a clear action for aliased nodes', () => {
    const fixture = buildIdentityProject();
    const definition = definitionOf(fixture.project);
    const context = {
      layerId: fixture.layerAId,
      animationId: definition.id,
      frameOrdinal: 0,
      selectedNodePath: ['arm-a'],
      internalTimeMs: 500,
      fps: 24,
      timelineAuthoringActive: true,
    } as const;
    const ambiguousMarkup = renderToStaticMarkup(
      createElement(FlaGraphicInternalTimelineBar, {
        context,
        project: fixture.project,
      }),
    );
    expect(ambiguousMarkup).toContain('当前节点无稳定身份（只读）');
    expect(ambiguousMarkup).toContain(
      'data-testid="fla-internal-associate-identity-open"',
    );
    expect(ambiguousMarkup).toContain('建立节点关联');
    expect(ambiguousMarkup).not.toContain(
      'data-testid="fla-internal-clear-identity-association"',
    );

    const aliasedProject = fixture.service.setFlaGraphicNodeIdentityAlias(
      fixture.project,
      fixture.shotId,
      fixture.layerAId,
      0,
      ['arm-a'],
    );
    const aliasedMarkup = renderToStaticMarkup(
      createElement(FlaGraphicInternalTimelineBar, {
        context,
        project: aliasedProject,
      }),
    );
    expect(aliasedMarkup).toContain('已建立节点关联');
    expect(aliasedMarkup).toContain(
      'data-testid="fla-internal-clear-identity-association"',
    );
    expect(aliasedMarkup).toContain('data-testid="fla-internal-add-key"');
  });
});
