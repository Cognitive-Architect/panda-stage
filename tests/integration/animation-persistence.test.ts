import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetCanvasImageService } from '../../src/main/services/AssetCanvasImageService';
import {
  FlaFrameSequenceCommitService,
  type FlaFrameSequenceAnimationContext,
  type FlaFrameSequenceStore,
} from '../../src/main/services/FlaFrameSequenceCommitService';
import type { ConfirmedSequenceFrame } from '../../src/main/services/fla-frame-sequence-service';
import { ProjectService } from '../../src/main/services/ProjectService';
import {
  evaluateShotAtTime,
  LayerService,
  listShotRuntimeImageAssets,
  ShotService,
} from '../../src/domain';
import { FlaFrameSequenceCommitRequestSchema } from '../../src/shared/fla-frame-sequence-api';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { canvasImageResourceKey } from '../../src/renderer/features/canvas/canvasImageResources';

const temporaryParents: string[] = [];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SESSION_ID = '28000000-0000-4000-8000-0000000000d1';
const SEQUENCE_ID = '28000000-0000-4000-8000-0000000000d2';
const TARGET_ID = 'fla-render-target-0000000000000a01';

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function createPng(rgba: readonly [number, number, number, number] = [0, 0, 0, 0]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.from([0, ...rgba]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function confirmedFrame(
  frameIndex: number,
  bytes: Buffer,
  sourceViewport = { x: 0, y: 0, width: 1, height: 1 },
): ConfirmedSequenceFrame {
  return {
    frameIndex,
    sequenceOrdinal: frameIndex,
    sourceViewport,
    pngBytes: new Uint8Array(bytes),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    width: 1,
    height: 1,
    pixelCount: 1,
    byteLength: bytes.byteLength,
    frameWallClockMs: 1,
    receivedAt: frameIndex,
  };
}

function decodedSinglePixelPng(bytes: Buffer): number[] {
  const dataChunks: Buffer[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') dataChunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (type === 'IEND') break;
  }
  const scanline = inflateSync(Buffer.concat(dataChunks));
  if (scanline[0] !== 0) throw new Error('Expected an unfiltered synthetic PNG row.');
  return [...scanline.subarray(1, 5)];
}

const animationContext: FlaFrameSequenceAnimationContext = {
  source: { basename: 'walk.fla', sha256: 'a'.repeat(64) },
  sourceFps: 30,
  documentCanvas: { width: 550, height: 400 },
  target: {
    renderTargetId: TARGET_ID,
    kind: 'graphic-symbol',
    userLabel: 'Walk',
    frameCount: 2,
  },
};

const temporarySequenceStore = (frames: ConfirmedSequenceFrame[]): FlaFrameSequenceStore => ({
  isLatestAcceptedSequence: (sessionId, requestId) =>
    sessionId === SESSION_ID && requestId === SEQUENCE_ID,
  getConfirmedSequence: (requestId) => requestId === SEQUENCE_ID ? frames : null,
  releaseSequence: () => undefined,
});

afterEach(async () => {
  await Promise.all(temporaryParents.splice(0).map((parent) =>
    rm(parent, { recursive: true, force: true }),
  ));
});

describe('formal animation persistence', () => {
  it('saves one animation with repeated frame references and reopens a playable project', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-animation-persistence-'));
    temporaryParents.push(parent);
    const projectRoot = path.join(parent, 'animation.pandastage');
    let current: { project: Awaited<ReturnType<ProjectService['create']>>['project']; revision: number } | null = null;
    const projectService = new ProjectService({
      onProjectSaved: (root, project, revision) => {
        if (root === projectRoot && revision !== undefined) current = { project, revision };
      },
    });
    const created = await projectService.create(projectRoot, { name: 'Animation persistence' });
    current = { project: created.project, revision: 0 };

    const png = createPng();
    const frame = confirmedFrame(0, png);
    const frames = [frame, { ...frame, frameIndex: 1, sequenceOrdinal: 1, receivedAt: 2 }];
    const commitService = new FlaFrameSequenceCommitService({
      projectService,
      getCurrentProjectSnapshot: (root) => root === projectRoot ? current : null,
      getAnimationContext: async () => animationContext,
      sequenceStore: temporarySequenceStore(frames),
      createId: (() => {
        let index = 1;
        return () => `28000000-0000-4000-8000-${String(index++).padStart(12, '0')}`;
      })(),
    });
    const request = FlaFrameSequenceCommitRequestSchema.parse({
      format: 'fla-frame-sequence-commit',
      version: 1,
      projectRoot,
      project: created.project,
      baseRevision: 0,
      sessionId: SESSION_ID,
      confirmedSequenceRequestId: SEQUENCE_ID,
      importAsAnimation: true,
      animationName: 'Walk cycle',
      source: animationContext.source,
      range: { renderTargetId: TARGET_ID, startFrameIndex: 0, endFrameIndex: 1 },
      sequence: {
        requestId: SEQUENCE_ID,
        sha256EachFrame: frames.map((item) => item.sha256),
        widthEachFrame: frames.map((item) => item.width),
        heightEachFrame: frames.map((item) => item.height),
        byteLengthEachFrame: frames.map((item) => item.byteLength),
        targetRenderTargetIdEachFrame: frames.map(() => TARGET_ID),
      },
      confirmed: true,
    });

    const committed = await commitService.commit(request);
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(committed.project.animations).toHaveLength(1);
    expect(committed.project.animations[0]?.name).toBe('Walk cycle');
    expect(committed.project.animations[0]?.frames.map((item) => item.assetId)).toEqual([
      committed.project.animations[0]?.frames[0]?.assetId,
      committed.project.animations[0]?.frames[0]?.assetId,
    ]);

    const withShot = new ShotService().create(committed.project, {
      name: 'Animation shot',
      durationMs: 3_000,
    });
    await projectService.save(projectRoot, withShot, committed.savedRevision);
    if (!current) throw new Error('Expected the saved project snapshot.');
    const shot = current.project.shots[0]!;
    const placed = new LayerService({
      createId: () => '29000000-0000-4000-8000-000000000001',
    }).createFromAsset(current.project, shot.id, {
      version: 3,
      type: 'animation',
      animationId: committed.project.animations[0]!.id,
      position: { x: 320, y: 240 },
      startTimeMs: 500,
    });
    await projectService.save(projectRoot, placed.project, current.revision);
    if (!current) throw new Error('Expected the placed project revision.');
    const transformed = new LayerService().updateTransform(
      placed.project,
      shot.id,
      placed.layer.id,
      {
        x: 420,
        y: 330,
        scale: 1.25,
        rotationDeg: placed.layer.rotationDeg,
        opacity: placed.layer.opacity,
        flipX: placed.layer.flipX,
      },
    );
    await projectService.save(projectRoot, transformed, current.revision);

    const reopened = await new ProjectService().open(projectRoot);
    expect(reopened.migrated).toBe(false);
    expect(reopened.project.animations).toEqual(committed.project.animations);
    expect(reopened.project.animations[0]?.durationMs).toBe(2_000 / 30);
    expect(reopened.project.shots[0]?.layers.at(-1)).toMatchObject({
      source: {
        kind: 'animation',
        animationId: committed.project.animations[0]!.id,
      },
      startTimeMs: 500,
      x: 420,
      y: 330,
      scaleX: 1.25,
      scaleY: 1.25,
    });
    const reopenedShot = reopened.project.shots[0]!;
    const reopenedLayer = reopenedShot.layers.at(-1)!;
    for (const timeMs of [499, 500, 516, 550, 516, 500]) {
      const evaluated = evaluateShotAtTime(
        reopenedShot,
        timeMs,
        reopened.project,
      ).layers.find((candidate) => candidate.id === reopenedLayer.id)!;
      expect(evaluated).toMatchObject({
        x: 420,
        y: 330,
        scaleX: 1.25,
        scaleY: 1.25,
      });
      if (timeMs < 500) expect(evaluated.visible).toBe(false);
    }

    const asset = reopened.project.assets.find(
      (candidate) => candidate.id === reopened.project.animations[0]?.frames[0]?.assetId,
    );
    expect(asset?.kind).toBe('image');
    const imageRead = await new AssetCanvasImageService({
      getCurrentProjectSnapshot: (root) => root === projectRoot ? { project: reopened.project } : null,
    }).read({ projectRoot, assetId: asset!.id, sha256: asset!.sha256 });
    expect(imageRead.ok).toBe(true);
    if (imageRead.ok) expect(Buffer.from(imageRead.bytes)).toEqual(png);
  });

  it('loads three content-distinct PNG frames through Shot resources and the temporal Canvas render model', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-animation-distinct-frames-'));
    temporaryParents.push(parent);
    const projectRoot = path.join(parent, 'distinct-frames.pandastage');
    let current: { project: Awaited<ReturnType<ProjectService['create']>>['project']; revision: number } | null = null;
    const projectService = new ProjectService({
      onProjectSaved: (root, project, revision) => {
        if (root === projectRoot && revision !== undefined) current = { project, revision };
      },
    });
    const created = await projectService.create(projectRoot, { name: 'Distinct animation frames' });
    current = { project: created.project, revision: 0 };

    const colors = [
      [240, 20, 40, 255],
      [20, 220, 60, 255],
      [30, 80, 240, 255],
    ] as const;
    const pngs = colors.map((color) => createPng(color));
    const frames = pngs.map((bytes, index) =>
      confirmedFrame(index, bytes, {
        x: index,
        y: index === 2 ? 1 : 0,
        width: 1,
        height: 1,
      }),
    );
    const distinctContext: FlaFrameSequenceAnimationContext = {
      ...animationContext,
      target: { ...animationContext.target, frameCount: 3 },
    };
    let nextId = 1;
    const commitService = new FlaFrameSequenceCommitService({
      projectService,
      getCurrentProjectSnapshot: (root) => root === projectRoot ? current : null,
      getAnimationContext: async () => distinctContext,
      sequenceStore: temporarySequenceStore(frames),
      createId: () => `28100000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`,
    });
    const request = FlaFrameSequenceCommitRequestSchema.parse({
      format: 'fla-frame-sequence-commit',
      version: 1,
      projectRoot,
      project: created.project,
      baseRevision: 0,
      sessionId: SESSION_ID,
      confirmedSequenceRequestId: SEQUENCE_ID,
      importAsAnimation: true,
      animationName: 'Three distinct colors',
      source: distinctContext.source,
      range: { renderTargetId: TARGET_ID, startFrameIndex: 0, endFrameIndex: 2 },
      sequence: {
        requestId: SEQUENCE_ID,
        sha256EachFrame: frames.map((frame) => frame.sha256),
        widthEachFrame: frames.map((frame) => frame.width),
        heightEachFrame: frames.map((frame) => frame.height),
        byteLengthEachFrame: frames.map((frame) => frame.byteLength),
        targetRenderTargetIdEachFrame: frames.map(() => TARGET_ID),
      },
      confirmed: true,
    });
    const committed = await commitService.commit(request);
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;

    const withShot = new ShotService().create(committed.project, {
      name: 'Distinct animation shot',
      durationMs: 3_000,
    });
    await projectService.save(projectRoot, withShot, committed.savedRevision);
    if (!current) throw new Error('Expected the imported animation project.');
    const shot = current.project.shots[0]!;
    const placed = new LayerService({
      createId: () => '28100000-0000-4000-8000-000000000010',
    }).createFromAsset(current.project, shot.id, {
      version: 3,
      type: 'animation',
      animationId: committed.project.animations[0]!.id,
      position: { x: 320, y: 240 },
      startTimeMs: 0,
    });
    await projectService.save(projectRoot, placed.project, current.revision);
    const reopened = await new ProjectService().open(projectRoot);
    const animation = reopened.project.animations[0]!;
    const reopenedShot = reopened.project.shots[0]!;
    const animationLayer = reopenedShot.layers.find(
      (layer) => layer.id === placed.layer.id,
    )!;
    const frameAssetIds = animation.frames.map((frame) => frame.assetId);
    expect(new Set(frameAssetIds).size).toBe(3);
    expect(new Set(animation.frames.map((frame) => frame.sha256)).size).toBe(3);
    expect(animation.frames.map((frame) => frame.offset)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 1 },
    ]);

    const imageService = new AssetCanvasImageService({
      getCurrentProjectSnapshot: (root) => root === projectRoot ? { project: reopened.project } : null,
    });
    const loadedPixels: number[][] = [];
    for (let index = 0; index < animation.frames.length; index += 1) {
      const frame = animation.frames[index]!;
      const response = await imageService.read({
        projectRoot,
        assetId: frame.assetId,
        sha256: frame.sha256,
      });
      expect(response.ok).toBe(true);
      if (!response.ok) continue;
      const loadedBytes = Buffer.from(response.bytes);
      expect(loadedBytes).toEqual(pngs[index]);
      loadedPixels.push(decodedSinglePixelPng(loadedBytes));
    }
    expect(loadedPixels).toEqual(colors);
    expect(new Set(loadedPixels.map((pixel) => pixel.join(','))).size).toBe(3);

    const shotAssets = listShotRuntimeImageAssets(reopened.project, reopenedShot);
    expect(new Set(shotAssets.map((asset) => asset.id))).toEqual(new Set(frameAssetIds));
    const readyAssetIds = new Set(shotAssets.map((asset) => asset.id));
    const readyAssetSourceKeys = new Map(
      shotAssets.map((asset) => [asset.id, asset.sha256!]),
    );
    const readyResourceKeys = new Set(
      shotAssets.map((asset) => canvasImageResourceKey(asset.id, asset.sha256!)),
    );
    const models = new Map<number, ReturnType<typeof buildEditorTemporalCanvasModel>>();
    let previousVisuals = new Map();
    for (const timeMs of [0, 40, 80, 3_000, 40, 0]) {
      const model = buildEditorTemporalCanvasModel({
        project: reopened.project,
        shot: reopenedShot,
        currentTimeMs: timeMs,
        readyAssetIds,
        readyAssetSourceKeys,
        readyResourceKeys,
        previousVisuals,
      });
      models.set(timeMs, model);
      previousVisuals = new Map(model.lastValidVisuals);
    }
    const stageAssetId = (timeMs: number): string =>
      models.get(timeMs)!.stageModel.layers.find(
        (layer) => layer.layer.id === animationLayer.id,
      )!.visual.parts[0]!.assetId;
    expect([stageAssetId(0), stageAssetId(40), stageAssetId(80)]).toEqual(frameAssetIds);
    expect(stageAssetId(3_000)).toBe(frameAssetIds[2]);
    expect(stageAssetId(40)).toBe(frameAssetIds[1]);
    expect(stageAssetId(0)).toBe(frameAssetIds[0]);
    const frameRects = [0, 40, 80].map((timeMs) =>
      models.get(timeMs)!.stageModel.layers.find(
        (layer) => layer.layer.id === animationLayer.id,
      )!.visual.parts[0]!.localRect,
    );
    expect(new Set(frameRects.map((rect) => `${rect.x},${rect.y},${rect.width},${rect.height}`)).size).toBe(3);
    expect(models.get(40)!.visualStatusByLayer.get(animationLayer.id)).toBe('current-complete');

    const frameOneId = frameAssetIds[1]!;
    const pendingAssets = new Set(shotAssets.filter((asset) => asset.id !== frameOneId).map((asset) => asset.id));
    const pendingSourceKeys = new Map(
      shotAssets.filter((asset) => asset.id !== frameOneId).map((asset) => [asset.id, asset.sha256!]),
    );
    const pendingModel = buildEditorTemporalCanvasModel({
      project: reopened.project,
      shot: reopenedShot,
      currentTimeMs: 40,
      readyAssetIds: pendingAssets,
      readyAssetSourceKeys: pendingSourceKeys,
      readyResourceKeys: new Set(
        shotAssets.filter((asset) => asset.id !== frameOneId).map((asset) =>
          canvasImageResourceKey(asset.id, asset.sha256!),
        ),
      ),
      previousVisuals: models.get(0)!.lastValidVisuals,
    });
    expect(pendingModel.visualStatusByLayer.get(animationLayer.id)).toBe('previous-complete');
    expect(pendingModel.targetReadyLayerIds.has(animationLayer.id)).toBe(false);
  }, 20_000);
});
