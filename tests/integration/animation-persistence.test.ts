import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetCanvasImageService } from '../../src/main/services/AssetCanvasImageService';
import {
  FlaFrameSequenceCommitService,
  type FlaFrameSequenceAnimationContext,
  type FlaFrameSequenceStore,
} from '../../src/main/services/FlaFrameSequenceCommitService';
import type { ConfirmedSequenceFrame } from '../../src/main/services/fla-frame-sequence-service';
import { ProjectService } from '../../src/main/services/ProjectService';
import { FlaFrameSequenceCommitRequestSchema } from '../../src/shared/fla-frame-sequence-api';

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

function createPng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.alloc(5))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function confirmedFrame(
  frameIndex: number,
  bytes: Buffer,
): ConfirmedSequenceFrame {
  return {
    frameIndex,
    sequenceOrdinal: frameIndex,
    sourceViewport: { x: 0, y: 0, width: 1, height: 1 },
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

    const reopened = await new ProjectService().open(projectRoot);
    expect(reopened.migrated).toBe(false);
    expect(reopened.project.animations).toEqual(committed.project.animations);
    expect(reopened.project.animations[0]?.durationMs).toBe(2_000 / 30);

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
});
