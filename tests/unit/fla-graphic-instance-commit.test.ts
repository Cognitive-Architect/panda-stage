import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LayerService, ProjectSchema, type Project } from '../../src/domain';
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

function frameBatch(overrides: {
  occurrenceId?: string;
  sourceAddress?: string;
  drawOrder?: number;
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
      sourceFrame: { firstFrame: '1', playbackMode: 'loop' },
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
  };
}

interface Harness {
  projectRoot: string;
  projectService: ProjectService;
  current: { project: Project; revision: number; openInstanceId: number };
  service: FlaGraphicInstanceCommitService;
}

async function harness(hashService?: HashService): Promise<Harness> {
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
  const partPreviewService = {
    buildGraphicDefinitionFrameBatch: vi.fn(async (identity: { unitId: string }) => ({
      ok: true as const,
      batch: identity.unitId === 'part-1123456789abcdef'
        ? frameBatch({
            occurrenceId: SECOND_OCCURRENCE_ID,
            sourceAddress: 'DOMDocument.xml/timeline[0]/layer[0]/frame[0]/instance[1]',
            drawOrder: 1,
          })
        : frameBatch(),
    })),
  } as unknown as FlaPartPreviewService;
  const service = new FlaGraphicInstanceCommitService({
    projectService,
    partPreviewService,
    getCurrentProjectSnapshot: (root) => root === projectRoot ? current : null,
    ...(hashService ? { hashService } : {}),
  });
  return { projectRoot, projectService, current, service };
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
    expect(first.savedRevision).toBe(1);
    expect(first.project.animations).toHaveLength(1);
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

    const second = await h.service.commit(commitRequest(h, 1, 'part-1123456789abcdef'));
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.error.message);
    expect(second.projectChanged).toBe(true);
    expect(second.project.shots[0]!.layers.find((layer) => layer.id === first.layerId)?.zIndex).toBe(1);
    expect(second.project.shots[0]!.layers.find((layer) => layer.id === second.layerId)?.zIndex).toBe(0);
    expect(second.project.animations).toHaveLength(1);
    expect(second.project.shots[0]!.layers).toHaveLength(first.project.shots[0]!.layers.length + 1);

    const third = await h.service.commit(commitRequest(h, 2, 'part-1123456789abcdef'));
    expect(third.ok).toBe(true);
    if (!third.ok) throw new Error(third.error.message);
    expect(third.projectChanged).toBe(false);
    expect(third.layerId).toBe(second.layerId);
    expect(third.project.animations).toHaveLength(1);
    expect(third.project.shots[0]!.layers).toHaveLength(second.project.shots[0]!.layers.length);
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
