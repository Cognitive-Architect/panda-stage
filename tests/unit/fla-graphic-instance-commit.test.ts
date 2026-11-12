import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FlaGraphicStructureSchema,
  LayerService,
  ProjectSchema,
  reconstructFlaGraphicStructure,
  type FlaGraphicStructure,
  type Project,
} from '../../src/domain';
import { FlaGraphicInstanceCommitService } from '../../src/main/services/FlaGraphicInstanceCommitService';
import { HashService } from '../../src/main/services/HashService';
import { ProjectService } from '../../src/main/services/ProjectService';
import type {
  FlaGraphicDefinitionFrameBatch,
  FlaPartPreviewService,
} from '../../src/main/services/FlaPartPreviewService';

const temporaryRoots: string[] = [];
const OPEN_INSTANCE_ID = 42;
const OCCURRENCE_ID = 'occ-0123456789abcdef01234567';
const SECOND_OCCURRENCE_ID = 'occ-abcdef0123456789abcdef01';
const THIRD_OCCURRENCE_ID = 'occ-00112233445566778899aabb';
const SECOND_UNIT_ID = 'part-1123456789abcdef';
const THIRD_UNIT_ID = 'part-2123456789abcdef';

function frameBatch(overrides: {
  occurrenceId?: string;
  sourceAddress?: string;
  drawOrder?: number;
  firstFrame?: string;
  lastFrame?: string | null;
} = {}): FlaGraphicDefinitionFrameBatch {
  const frames = [0, 1].map((ordinal) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><path d="M0 0h12v12H0z" fill="${ordinal ? '#2555aa' : '#f03a55'}"/></svg>`;
    const bytes = Buffer.from(svg, 'utf8');
    return {
      ordinal,
      sourceFrameIndex: ordinal,
      svg,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.byteLength,
      width: 12,
      height: 12,
      sourceViewport: { x: ordinal * 2, y: 0, width: 12, height: 12 },
    };
  });
  return {
    plan: {} as FlaGraphicDefinitionFrameBatch['plan'],
    unit: {
      occurrenceId: overrides.occurrenceId ?? OCCURRENCE_ID,
      sourceAddress: overrides.sourceAddress ?? 'DOMDocument.xml/timeline[0]/layer[0]/frame[0]/instance[0]',
      adapterIdentity: 'Walk',
      drawOrder: overrides.drawOrder ?? 3,
      sourceFrame: {
        firstFrame: overrides.firstFrame ?? '1',
        playbackMode: 'loop',
        lastFrame: overrides.lastFrame ?? null,
      },
      worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 4, ty: 2 },
    } as unknown as FlaGraphicDefinitionFrameBatch['unit'],
    source: { basename: 'walk.fla', rawSha256: 'a'.repeat(64), normalizedSha256: 'b'.repeat(64) },
    target: {
      renderTargetId: 'fla-render-target-graphic-0001',
      name: 'Walk',
      frameCount: frames.length,
      sourceFps: 12,
      stageWidth: 1_920,
      stageHeight: 1_080,
      documentWidth: 1_920,
      documentHeight: 1_080,
    },
    frames,
    groupEditPreview: {
      version: 1,
      source: {
        sha256: 'b'.repeat(64),
        outerOccurrenceId: overrides.occurrenceId ?? OCCURRENCE_ID,
        outerSourceAddress: overrides.sourceAddress ?? 'DOMDocument.xml/timeline[0]/layer[0]/frame[0]/instance[0]',
        graphicSymbolName: 'Walk',
      },
      frameIndex: 0,
      frameOrigin: { x: 0, y: 0 },
      frameCanvas: { width: 12, height: 12 },
      group: {
        groupId: 'group-1',
        sourceAddress: 'LIBRARY/Walk/layer[0]/frame[0]/group[0]',
        worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        canvasTransform: { a: 1, b: 0, c: 0, d: 1, tx: -6, ty: -6 },
      },
      background: null,
      foreground: null,
      children: [{
        sourceAddress: 'LIBRARY/Walk/layer[0]/frame[0]/group[0]/member[0]',
        parentGroupSourceAddress: 'LIBRARY/Walk/layer[0]/frame[0]/group[0]',
        kind: 'shape',
        sourceIdentity: 'shape-a',
        localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        artwork: {
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path d="M0 0h12v12H0z" fill="#f03a55"/></svg>',
          viewBox: { x: 0, y: 0, width: 12, height: 12 },
        },
      }],
    },
  };
}

interface Harness {
  projectRoot: string;
  projectService: ProjectService;
  current: { project: Project; revision: number; openInstanceId: number };
  service: FlaGraphicInstanceCommitService;
  batchStructure: { current: FlaGraphicStructure | undefined };
}

async function harness(
  hashService?: HashService,
  sourceLastFrame: string | null = null,
  sourceFirstFrame = '1',
): Promise<Harness> {
  const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-fla-graphic-'));
  temporaryRoots.push(parent);
  const projectRoot = path.join(parent, 'FLA Graphic Test.pandastage');
  let idIndex = 0;
  const createProjectId = () => `28000000-0000-4000-8000-${String(++idIndex).padStart(12, '0')}`;
  const current = { project: undefined as unknown as Project, revision: 0, openInstanceId: OPEN_INSTANCE_ID };
  const projectService = new ProjectService({
    createId: createProjectId,
    now: () => new Date('2026-08-19T04:00:00.000Z'),
    onProjectSaved: (root, project, revision) => {
      if (root === projectRoot && revision !== undefined) {
        current.project = project;
        current.revision = revision;
      }
    },
  });
  const created = await projectService.create(projectRoot, { name: 'FLA Graphic Test' });
  const project = ProjectSchema.parse({
    ...created.project,
    shots: [{
      id: randomUUID(),
      name: 'Graphic import shot',
      durationMs: 10_000,
      defaultSubtitleStyleId: created.project.subtitleStyles[0]!.id,
      dialogues: [],
      audioClips: [],
      timelineEvents: [],
      layers: [],
      backgroundLayerId: null,
    }],
  });
  await projectService.save(projectRoot, project, 0);
  current.project = project;
  current.revision = 0;
  const batchStructure: { current: FlaGraphicStructure | undefined } = { current: undefined };
  const withStructure = (batch: FlaGraphicDefinitionFrameBatch): FlaGraphicDefinitionFrameBatch =>
    batchStructure.current ? { ...batch, structure: batchStructure.current } : batch;
  const partPreviewService = {
    buildGraphicDefinitionFrameBatch: vi.fn(async (identity: { unitId: string }) => ({
      ok: true as const,
      batch: withStructure(identity.unitId === SECOND_UNIT_ID
        ? frameBatch({
            occurrenceId: SECOND_OCCURRENCE_ID,
            sourceAddress: 'DOMDocument.xml/timeline[0]/layer[0]/frame[0]/instance[1]',
            drawOrder: 1,
          })
        : identity.unitId === THIRD_UNIT_ID
          ? frameBatch({
              occurrenceId: THIRD_OCCURRENCE_ID,
              sourceAddress: 'DOMDocument.xml/timeline[0]/layer[0]/frame[0]/instance[2]',
              drawOrder: 2,
            })
          : frameBatch({ firstFrame: sourceFirstFrame, lastFrame: sourceLastFrame })),
    })),
  } as unknown as FlaPartPreviewService;
  const service = new FlaGraphicInstanceCommitService({
    projectService,
    partPreviewService,
    getCurrentProjectSnapshot: (root) => root === projectRoot ? current : null,
    ...(hashService ? { hashService } : {}),
  });
  return { projectRoot, projectService, current, service, batchStructure };
}

function commitRequest(h: Harness, baseRevision: number, unitId = 'part-0123456789abcdef') {
  const shot = h.current.project.shots[0]!;
  return {
    format: 'fla-graphic-instance-commit',
    version: 1,
    requestId: randomUUID(),
    projectRoot: h.projectRoot,
    projectId: h.current.project.id,
    baseRevision,
    openInstanceId: OPEN_INSTANCE_ID,
    shotId: shot.id,
    startTimeMs: 0,
    plan: {
      sessionId: '28000000-0000-4000-8000-000000000101',
      planId: '28000000-0000-4000-8000-000000000102',
      generation: 1,
      poseIdentity: 'c'.repeat(64),
      unitId,
    },
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('FLA Graphic instance commit', () => {
  it('saves one editable reusable Definition and layer, then reuses the same occurrence', async () => {
    const h = await harness();
    const first = await h.service.commit(commitRequest(h, 0));

    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error.message);
    expect(first.projectChanged).toBe(true);
    expect(first.groupEditPreview?.children).toHaveLength(1);
    expect(first.savedRevision).toBe(1);
    expect(first.project.animations).toHaveLength(1);
    expect(first.project.animations[0]).not.toHaveProperty('groupEditPreview');
    expect(first.project).not.toHaveProperty('groupEditPreview');
    expect(first.project.animations[0]).toMatchObject({ kind: 'fla-graphic' });
    expect(first.project.animations[0]?.frames.every((frame) => !frame.createdBySequenceImport)).toBe(true);
    expect(first.project.shots[0]?.layers.at(-1)).toMatchObject({
      source: {
        kind: 'animation',
        animationId: first.animationId,
        flaOccurrence: { occurrenceId: OCCURRENCE_ID, drawOrder: 3 },
      },
      animationFirstFrame: 1,
      animationPlayback: { mode: 'loop', endBehavior: 'hold' },
    });
    expect(first.project.assets.filter((asset) => asset.kind === 'image' && asset.flaGraphicFrame)).toHaveLength(2);
    const reopened = await h.projectService.open(h.projectRoot);
    expect(reopened.project).toEqual(first.project);
    const transformed = new LayerService().updateTransform(
      reopened.project,
      reopened.project.shots[0]!.id,
      first.layerId,
      { x: 1_000, y: 600, scale: 1.25, rotationDeg: 15, opacity: 0.9, flipX: false },
    );
    expect(transformed.shots[0]!.layers.at(-1)).toMatchObject({
      x: 1_000,
      y: 600,
      scaleX: 1.25,
      scaleY: 1.25,
      rotationDeg: 15,
      source: { flaOccurrence: { occurrenceId: OCCURRENCE_ID, drawOrder: 3 } },
    });

    const second = await h.service.commit(commitRequest(h, 1, SECOND_UNIT_ID));
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.error.message);
    expect(second.projectChanged).toBe(true);
    expect(second.project.shots[0]!.layers.find((layer) => layer.id === first.layerId)?.zIndex).toBe(0);
    expect(second.project.shots[0]!.layers.find((layer) => layer.id === second.layerId)?.zIndex).toBe(1);
    expect(second.project.shots[0]!.layers.find((layer) => layer.id === first.layerId)?.source)
      .toMatchObject({ kind: 'animation', flaOccurrence: { occurrenceId: OCCURRENCE_ID, drawOrder: 3 } });
    expect(second.project.shots[0]!.layers.find((layer) => layer.id === second.layerId)?.source)
      .toMatchObject({ kind: 'animation', flaOccurrence: { occurrenceId: SECOND_OCCURRENCE_ID, drawOrder: 1 } });
    expect(second.project.animations).toHaveLength(1);
    expect(second.project.shots[0]!.layers).toHaveLength(first.project.shots[0]!.layers.length + 1);

    const third = await h.service.commit(commitRequest(h, 2, SECOND_UNIT_ID));
    expect(third.ok).toBe(true);
    if (!third.ok) throw new Error(third.error.message);
    expect(third.projectChanged).toBe(false);
    expect(third.layerId).toBe(second.layerId);
    expect(third.project.animations).toHaveLength(1);
    expect(third.project.shots[0]!.layers).toHaveLength(second.project.shots[0]!.layers.length);
  });

  it('preserves manually reordered and interleaved existing layers when another occurrence is imported', async () => {
    const h = await harness();
    const layerService = new LayerService();
    const first = await h.service.commit(commitRequest(h, 0));
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error.message);
    const second = await h.service.commit(commitRequest(h, 1, SECOND_UNIT_ID));
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.error.message);

    const shot = second.project.shots[0]!;
    const interleaved = layerService.createFromAnimation(second.project, shot.id, {
      animationId: first.animationId,
      position: { x: 20, y: 20 },
      startTimeMs: 0,
      firstFrameIndex: 1,
      playback: { mode: 'loop', endBehavior: 'hold' },
    });
    const plainLayerId = interleaved.layer.id;
    const manuallyReordered = layerService.reorder(
      interleaved.project,
      shot.id,
      second.layerId,
      'back',
    );
    await h.projectService.save(h.projectRoot, manuallyReordered, 2);
    const orderBefore = h.current.project.shots[0]!.layers
      .slice()
      .sort((left, right) => left.zIndex - right.zIndex)
      .map((layer) => layer.id);
    expect(orderBefore).toEqual([second.layerId, first.layerId, plainLayerId]);

    const third = await h.service.commit(commitRequest(h, 2, THIRD_UNIT_ID));
    expect(third.ok).toBe(true);
    if (!third.ok) throw new Error(third.error.message);
    const afterLayers = third.project.shots[0]!.layers;
    const orderAfter = afterLayers
      .filter((layer) => layer.id !== third.layerId)
      .slice()
      .sort((left, right) => left.zIndex - right.zIndex)
      .map((layer) => layer.id);
    expect(orderAfter).toEqual(orderBefore);
    expect(afterLayers.find((layer) => layer.id === third.layerId)?.source)
      .toMatchObject({ kind: 'animation', flaOccurrence: { occurrenceId: THIRD_OCCURRENCE_ID, drawOrder: 2 } });
    expect(third.project.animations).toHaveLength(1);
  });

  it('rejects an explicitly truncated lastFrame at the Main commit boundary', async () => {
    const h = await harness(undefined, '0', '0');

    const result = await h.service.commit(commitRequest(h, 0));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('A truncated Graphic range must not be persisted.');
    expect(result.error.code).toBe('TRANSFORM_UNSUPPORTED');
    expect(h.current.revision).toBe(0);
    expect(h.current.project.animations).toHaveLength(0);
    expect(h.current.project.shots[0]!.layers).toHaveLength(0);
  });

  it('rolls the Project back before deleting newly generated frames after a post-save failure', async () => {
    const baseHashService = new HashService();
    const rejectingHashService = {
      hashBytes: (bytes: Uint8Array) => baseHashService.hashBytes(bytes),
      hashFile: async () => ({ algorithm: 'sha256' as const, hex: 'f'.repeat(64), bytes: 0 }),
    } as HashService;
    const h = await harness(rejectingHashService);
    const baselineProject = structuredClone(h.current.project);
    const baselineFiles = new Set(await readdir(path.join(h.projectRoot, 'assets')));

    const result = await h.service.commit(commitRequest(h, 0));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected post-save verification to fail');
    expect(result.error.code).toBe('ASSET_COMMIT_FAILED');
    expect(h.current.project).toEqual(baselineProject);
    expect(h.current.revision).toBe(0);
    const saved = await h.projectService.open(h.projectRoot);
    expect(saved.project).toEqual(baselineProject);
    expect((await readdir(path.join(h.projectRoot, 'assets'))).sort()).toEqual([...baselineFiles].sort());
  });
});

const M = (tx: number, ty: number, scale = 1) => ({ a: scale, b: 0, c: 0, d: scale, tx, ty });

function sampleStructure(extraShapeId = 'shape-a'): FlaGraphicStructure {
  return FlaGraphicStructureSchema.parse({
    version: 1,
    frames: [{
      ordinal: 0,
      layers: [{
        name: 'Body',
        nodes: [{
          type: 'group', id: 'g-outer', sourceAddress: 'LIBRARY/Walk/layer[0]/frame[0]/group[0]',
          drawOrder: 0, groupId: 'outer', localTransform: M(10, 5, 2),
          children: [
            {
              type: 'symbol', id: 'sym-1', sourceAddress: 'LIBRARY/Walk/layer[0]/frame[0]/group[0]/symbol[0]',
              drawOrder: 0, symbolRef: 'Arm', localTransform: M(3, 0), opacity: 0.5,
              children: [{
                type: 'bitmap', id: 'bmp-1', drawOrder: 0, bitmapRef: 'arm.png', localTransform: M(1, 1),
                clipPaths: [{ shapes: [{ shapeId: 'mask-1', worldTransform: M(0, 0) }] }],
              }],
            },
            {
              type: 'symbol', id: 'sym-2', drawOrder: 1, symbolRef: 'Arm', localTransform: M(-3, 0), children: [],
            },
            {
              type: 'opaque', id: 'shape-node', drawOrder: 2, opaqueKind: 'shape',
              sourceRef: extraShapeId, localTransform: M(0, 0),
            },
          ],
        }],
      }],
    }],
  });
}

describe('FLA Graphic structured Definition (E1)', () => {
  it('saves the authored tree with the Definition, reloads it, and recomposes parent-local matrices', async () => {
    const h = await harness();
    h.batchStructure.current = sampleStructure();
    const first = await h.service.commit(commitRequest(h, 0));
    if (!first.ok) throw new Error(first.error.message);
    const reopened = await h.projectService.open(h.projectRoot);
    const definition = reopened.project.animations[0]!;
    expect(definition).toMatchObject({ kind: 'fla-graphic' });
    if (!('structure' in definition) || !definition.structure) throw new Error('structure was not persisted');
    expect(definition.structure).toMatchObject({
      version: 1,
      frames: [{
        ordinal: 0,
        layers: [{
          name: 'Body',
          nodes: [{
            type: 'group',
            id: 'g-outer',
            children: [
              { type: 'symbol', id: 'sym-1', symbolRef: 'Arm' },
              { type: 'symbol', id: 'sym-2', symbolRef: 'Arm' },
              {
                type: 'opaque',
                id: 'shape-node',
                opaqueKind: 'shape',
                fallbackAssetId: definition.frames[0]!.assetId,
              },
            ],
          }],
        }],
      }],
    });
    const flat = reconstructFlaGraphicStructure(definition.structure);
    expect(flat.map((entry) => `${entry.parentId ?? '-'}>${entry.node.id}:${entry.node.type}`)).toEqual([
      '->g-outer:group', 'g-outer>sym-1:symbol', 'sym-1>bmp-1:bitmap',
      'g-outer>sym-2:symbol', 'g-outer>shape-node:opaque',
    ]);
    // Both Arm instances share one Symbol reference.
    expect(flat.filter((entry) => entry.node.type === 'symbol' && entry.node.symbolRef === 'Arm')).toHaveLength(2);
    // outer scale 2 at (10,5); sym-1 local x=3 -> world x = 10 + 2*3 = 16; no double transform.
    expect(flat.find((entry) => entry.node.id === 'sym-1')!.worldTransform).toMatchObject({ a: 2, tx: 16, ty: 5 });
    expect(flat.find((entry) => entry.node.id === 'bmp-1')!.worldTransform).toMatchObject({ a: 2, tx: 18, ty: 7 });
  });

  it('upgrades an SVG-only Definition in place instead of dropping the structure, without a second Layer', async () => {
    const h = await harness();
    const svgOnly = await h.service.commit(commitRequest(h, 0));
    if (!svgOnly.ok) throw new Error(svgOnly.error.message);
    expect(svgOnly.project.animations[0]).not.toHaveProperty('structure');
    const assetCount = svgOnly.project.assets.length;

    h.batchStructure.current = sampleStructure();
    const upgraded = await h.service.commit(commitRequest(h, 1));
    if (!upgraded.ok) throw new Error(upgraded.error.message);
    expect(upgraded.projectChanged).toBe(true);
    expect(upgraded.layerId).toBe(svgOnly.layerId);
    expect(upgraded.animationId).toBe(svgOnly.animationId);
    expect(upgraded.project.animations).toHaveLength(1);
    expect(upgraded.project.assets).toHaveLength(assetCount);
    expect(upgraded.project.shots[0]!.layers).toHaveLength(svgOnly.project.shots[0]!.layers.length);
    expect(upgraded.project.animations[0]).toMatchObject({ structure: { version: 1 } });
    expect((await h.projectService.open(h.projectRoot)).project).toEqual(upgraded.project);
  });

  it('does not merge Definitions whose structures differ even when pictures are identical', async () => {
    const h = await harness();
    h.batchStructure.current = sampleStructure('shape-a');
    const first = await h.service.commit(commitRequest(h, 0));
    if (!first.ok) throw new Error(first.error.message);
    h.batchStructure.current = sampleStructure('shape-b');
    const second = await h.service.commit(commitRequest(h, 1, SECOND_UNIT_ID));
    if (!second.ok) throw new Error(second.error.message);
    expect(second.animationId).not.toBe(first.animationId);
    expect(second.project.animations).toHaveLength(2);
    expect(second.project.animations.every((animation) => 'structure' in animation && animation.structure)).toBe(true);
  });

  it('keeps legacy SVG-only Definitions valid and rejects a duplicated node id', () => {
    const structure = sampleStructure();
    const duplicated = structuredClone(structure);
    const group = duplicated.frames[0]!.layers[0]!.nodes[0]!;
    if (group.type !== 'group') throw new Error('unexpected sample');
    group.children[1]!.id = 'sym-1';
    expect(FlaGraphicStructureSchema.safeParse(duplicated).success).toBe(false);
    expect(FlaGraphicStructureSchema.safeParse(structure).success).toBe(true);
  });
});
