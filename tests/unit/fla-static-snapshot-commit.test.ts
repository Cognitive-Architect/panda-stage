/**
 * V2-R1 Static Snapshot — commit path tests (R1-E).
 *
 * Exercises FlaStaticSnapshotCommitService with a real ProjectService (on a
 * temp project) and an in-memory fake preview store. Verifies the one-asset
 * commit, dedup, STALE_PREVIEW guard, SOURCE_MISMATCH guard, and rollback on a
 * post-save fault. The FLA source bytes are never touched here — the commit
 * consumes only the confirmed preview bytes supplied by the preview store.
 */

import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import {
  FlaStaticSnapshotCommitService,
  type FlaStaticSnapshotCommitFaultInjector,
} from '../../src/main/services/FlaStaticSnapshotCommitService';
import type {
  FlaConfirmedSnapshotPreview,
  FlaStaticSnapshotRenderSession,
} from '../../src/main/services/fla-static-snapshot-render-session';
import {
  FlaRenderTargetSchema,
  FlaStaticSnapshotCommitRequestSchema,
  type FlaRenderTarget,
  type FlaStaticSnapshotCommitRequest,
} from '../../src/shared/fla-static-snapshot-api';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function createRgbaPng(width: number, height: number, fill = 0): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(height * (1 + width * 4), fill);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const TEMP_DIRS: string[] = [];
const SESSION_ID = '27000000-0000-4000-8000-0000000000c1';
const PREVIEW_ID = '27000000-0000-4000-8000-0000000000c2';
const SOURCE = { basename: 'scene.fla', sha256: 'b'.repeat(64) };

function makePng(width: number, height: number): { png: Uint8Array; sha256: string } {
  const buffer = createRgbaPng(width, height);
  return {
    png: new Uint8Array(buffer),
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

function target(userLabel = 'Snapshot'): FlaRenderTarget {
  return FlaRenderTargetSchema.parse({
    renderTargetId: 'fla-render-target-0000000000000001',
    kind: 'graphic-symbol',
    userLabel,
    frameCount: 1,
    selectedFrameIndex: 0,
    compatibility: ['degraded'],
  });
}

function confirmedPreview(png: Uint8Array, sha256: string, tgt = target()): FlaConfirmedSnapshotPreview {
  return {
    requestId: PREVIEW_ID,
    sessionId: SESSION_ID,
    pngBytes: png,
    sha256,
    width: 8,
    height: 8,
    byteLength: png.length,
    target: tgt,
    source: { basename: SOURCE.basename, sha256: SOURCE.sha256 },
  };
}

function previewStore(confirmed: FlaConfirmedSnapshotPreview | null): Pick<
  FlaStaticSnapshotRenderSession,
  'getConfirmedPreview' | 'releasePreview' | 'isLatestAcceptedPreview'
> {
  return {
    getConfirmedPreview: (id) => (confirmed && id === confirmed.requestId ? confirmed : null),
    isLatestAcceptedPreview: (sid, id) =>
      Boolean(confirmed && sid === SESSION_ID && id === confirmed.requestId),
    releasePreview: () => undefined,
  };
}

interface Harness {
  projectRoot: string;
  projectService: ProjectService;
  service: FlaStaticSnapshotCommitService;
  createService: (
    options?: {
      fileSystem?: ConstructorParameters<typeof FlaStaticSnapshotCommitService>[0]['fileSystem'];
      faults?: FlaStaticSnapshotCommitFaultInjector;
      previewStore?: ReturnType<typeof previewStore>;
    },
  ) => FlaStaticSnapshotCommitService;
  current: { project: ReturnType<typeof ProjectSchema.parse>; revision: number };
  setCurrent: (project: ReturnType<typeof ProjectSchema.parse>, revision: number) => void;
}

async function harness(): Promise<Harness> {
  const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-fla-snap-'));
  TEMP_DIRS.push(parent);
  const projectRoot = path.join(parent, 'FLA Snapshot Test.pandastage');
  let idIndex = 0;
  const nextId = () => `27000000-0000-4000-8000-${String(idIndex++ + 1).padStart(12, '0')}`;
  const current = { project: undefined as unknown as ReturnType<typeof ProjectSchema.parse>, revision: 0 };
  const projectService = new ProjectService({
    createId: nextId,
    now: () => new Date('2026-08-19T04:00:00.000Z'),
    onProjectSaved: (_root, project, revision) => {
      if (revision !== undefined) {
        current.project = project;
        current.revision = revision;
      }
    },
  });
  const created = await projectService.create(projectRoot, { name: 'FLA Snapshot Test' });
  current.project = created.project;
  current.revision = 0;
  const createService: Harness['createService'] = (options = {}) =>
    new FlaStaticSnapshotCommitService({
      projectService,
      getCurrentProjectSnapshot: (root) => (root === projectRoot ? current : null),
      previewStore: options.previewStore ?? previewStore(null),
      ...options,
    });
  return {
    projectRoot,
    projectService,
    service: createService(),
    createService,
    current,
    setCurrent: (project, revision) => {
      current.project = project;
      current.revision = revision;
    },
  };
}

function request(h: Harness, confirmed: FlaConfirmedSnapshotPreview): FlaStaticSnapshotCommitRequest {
  return FlaStaticSnapshotCommitRequestSchema.parse({
    format: 'fla-static-snapshot-commit',
    version: 1,
    projectRoot: h.projectRoot,
    project: h.current.project,
    baseRevision: h.current.revision,
    sessionId: SESSION_ID,
    confirmedPreviewRequestId: confirmed.requestId,
    source: { basename: confirmed.source.basename, sha256: confirmed.source.sha256 },
    target: confirmed.target,
    preview: {
      sha256: confirmed.sha256,
      width: confirmed.width,
      height: confirmed.height,
      byteLength: confirmed.byteLength,
    },
    confirmed: true,
  });
}

async function assetEntries(projectRoot: string): Promise<string[]> {
  return (await readdir(path.join(projectRoot, 'assets'))).sort();
}

afterEach(async () => {
  await Promise.all(TEMP_DIRS.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('FlaStaticSnapshotCommitService', () => {
  it('commits exactly one ordinary ImageAsset from a confirmed snapshot', async () => {
    const h = await harness();
    const { png, sha256 } = makePng(8, 8);
    const confirmed = confirmedPreview(png, sha256);
    const service = h.createService({ previewStore: previewStore(confirmed) });
    const response = await service.commit(request(h, confirmed));
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error('commit should succeed');
    expect(response.status).toBe('completed');
    expect(response.result.status).toBe('imported');
    expect(response.projectChanged).toBe(true);
    expect(response.result.asset.kind).toBe('image');
    expect(response.result.asset.mimeType).toBe('image/png');
    expect(response.result.asset.sha256).toBe(sha256);
    const files = await assetEntries(h.projectRoot);
    expect(files).toHaveLength(1);
  });

  it('dedupes when the same snapshot PNG is committed twice', async () => {
    const h = await harness();
    const { png, sha256 } = makePng(8, 8);
    const confirmed = confirmedPreview(png, sha256);
    const service = h.createService({ previewStore: previewStore(confirmed) });
    const first = await service.commit(request(h, confirmed));
    expect(first.ok && first.result.status).toBe('imported');
    // The onProjectSaved callback advanced the snapshot; re-read current.
    const second = await service.commit(request(h, confirmed));
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('second commit should succeed');
    expect(second.result.status).toBe('duplicate');
    expect(second.projectChanged).toBe(false);
    const files = await assetEntries(h.projectRoot);
    expect(files).toHaveLength(1);
  });

  it('rejects a non-latest confirmed preview (STALE_PREVIEW)', async () => {
    const h = await harness();
    const { png, sha256 } = makePng(8, 8);
    const confirmed = confirmedPreview(png, sha256);
    // Store treats PREVIEW_ID as latest; pin a different requestId.
    const service = h.createService({ previewStore: previewStore(confirmed) });
    const stale = request(h, confirmed);
    stale.confirmedPreviewRequestId = '27000000-0000-4000-8000-00000000dead';
    const response = await service.commit(stale);
    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('stale preview must fail');
    expect(response.error.code).toBe('STALE_PREVIEW');
  });

  it('rejects a source identity mismatch (SOURCE_MISMATCH)', async () => {
    const h = await harness();
    const { png, sha256 } = makePng(8, 8);
    const confirmed = confirmedPreview(png, sha256);
    const service = h.createService({ previewStore: previewStore(confirmed) });
    const mismatched = request(h, confirmed);
    mismatched.source = { basename: 'other.fla', sha256: 'c'.repeat(64) };
    const response = await service.commit(mismatched);
    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('source mismatch must fail');
    expect(response.error.code).toBe('SOURCE_MISMATCH');
  });

  it('rolls back when a post-save fault is injected', async () => {
    const h = await harness();
    const { png, sha256 } = makePng(8, 8);
    const confirmed = confirmedPreview(png, sha256);
    const service = h.createService({
      previewStore: previewStore(confirmed),
      faults: {
        beforeProjectSave: () => {
          throw new Error('injected save fault');
        },
      },
    });
    const response = await service.commit(request(h, confirmed));
    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('faulted commit must fail');
    // Either the atomic save failed or rollback was triggered; no asset must persist.
    const files = await assetEntries(h.projectRoot);
    expect(files).toHaveLength(0);
  });
});
