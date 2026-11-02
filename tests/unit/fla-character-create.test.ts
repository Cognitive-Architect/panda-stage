import { deflateSync } from 'node:zlib';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectService } from '../../src/main/services/ProjectService';
import { FlaCharacterCreateService, type FlaCharacterCreateProjectSnapshot } from '../../src/main/services/FlaCharacterCreateService';
import type { FlaPartPlan } from '../../src/shared/fla-part-preview-api';
import { flaPreparedPartBatchMetadata, type FlaPreparedPartBatch } from '../../src/main/services/FlaPartPreviewService';
import { FlaPartPreviewService } from '../../src/main/services/FlaPartPreviewService';
import { HashService } from '../../src/main/services/HashService';
import { AssetImportFileSystemService } from '../../src/main/services/AssetImportFileSystemService';
import { FlaCharacterCreateJournalService } from '../../src/main/services/FlaCharacterCreateJournalService';
import { ProjectFileSystemService } from '../../src/main/services/ProjectFileSystemService';
import type { FlaCharacterCreateOutcome, FlaCharacterCreateResult } from '../../src/shared/fla-character-create-api';

const TEMP_DIRS: string[] = [];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PLAN_ID = '90800000-0000-4000-8000-000000000001';
const SESSION_ID = '90800000-0000-4000-8000-000000000002';
const REQUEST_ID = '90800000-0000-4000-8000-000000000003';
const OPERATION_ID = '90800000-0000-4000-8000-000000000004';
const SECOND_OPERATION_ID = '90800000-0000-4000-8000-000000000005';
const OPEN_INSTANCE_ID = 17;
const RENDER_TARGET_ID = 'fla-render-target-908000000001';

function fullResult(result: FlaCharacterCreateOutcome): FlaCharacterCreateResult {
  if (!('project' in result)) throw new Error('Expected a committed result with its exact Project snapshot.');
  return result as FlaCharacterCreateResult;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function png(fill: number): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(2 * (1 + 2 * 4));
  for (let row = 0; row < 2; row += 1) {
    scanlines[row * 9] = 0;
    scanlines.fill(fill, row * 9 + 1, (row + 1) * 9);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function id(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function partUnit(index: number) {
  return {
    unitId: `part-unit-test-${String(index + 1).padStart(4, '0')}`,
    occurrenceId: `occ-${String(index + 1).padStart(24, '0')}`,
    drawOrder: index,
    stageMapping: {
      coordinateSpace: 'root-scene-stage-pixels' as const,
      stageOrigin: { x: 0 as const, y: 0 as const },
      crop: null,
      outputScale: 1 as const,
      transformApplication: 'resolved-once-in-main; reassembly-uses-stage-identity' as const,
    },
    sourceFrame: { effectiveChildFrameIndex: index + 3 },
  };
}

function plan(partCount: number, capability: 'EDITABLE_PARTS_READY' | 'WHOLE_IMAGE_ONLY' = 'EDITABLE_PARTS_READY'): FlaPartPlan {
  const units = Array.from({ length: partCount }, (_, index) => partUnit(index));
  return {
    format: 'panda-fla-part-plan',
    version: 1,
    planId: PLAN_ID,
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    generation: 1,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    source: { basename: 'sample-a.fla', rawSha256: 'a'.repeat(64), normalizedSha256: 'b'.repeat(64) },
    target: {
      renderTargetId: RENDER_TARGET_ID,
      kind: 'scene',
      userLabel: 'Scene 1',
      sceneIndex: 0,
      frameCount: 20,
      selectedFrameIndex: 2,
      frameSelectionBasis: 'authored Scene frame selected through Main prepared source',
    },
    poseIdentity: 'c'.repeat(64),
    stage: { width: 2, height: 2, pixelCount: 4, coordinateSpace: 'root-scene-stage-pixels' },
    capability,
    capabilityReason: capability === 'EDITABLE_PARTS_READY' ? null : 'Only one native image is available.',
    units,
  } as unknown as FlaPartPlan;
}

function preparedBatch(rawPlan: FlaPartPlan, partsBytes: readonly Uint8Array[]): FlaPreparedPartBatch {
  const parts = partsBytes.map((bytes, index) => {
    const unit = rawPlan.units[index]!;
    const image = Buffer.from(bytes);
    return {
      unitId: unit.unitId,
      occurrenceId: unit.occurrenceId,
      drawOrder: index,
      stageMapping: structuredClone(unit.stageMapping),
      image: {
        width: 2,
        height: 2,
        pixelCount: 4,
        sha256: new HashService().hashBytes(image).hex,
        byteLength: image.byteLength,
        bytes: Uint8Array.from(image),
      },
    };
  });
  return {
    plan: rawPlan,
    identity: {
      planId: rawPlan.planId,
      sessionId: rawPlan.sessionId,
      requestId: rawPlan.requestId,
      generation: rawPlan.generation,
      rawSourceSha256: rawPlan.source.rawSha256,
      normalizedSourceSha256: rawPlan.source.normalizedSha256,
      poseIdentity: rawPlan.poseIdentity,
      target: {
        renderTargetId: rawPlan.target.renderTargetId,
        sceneIndex: rawPlan.target.sceneIndex,
        selectedFrameIndex: rawPlan.target.selectedFrameIndex,
      },
    },
    parts,
    partPngBytes: parts.reduce((sum, part) => sum + part.image.byteLength, 0),
  } as FlaPreparedPartBatch;
}

interface Harness {
  projectRoot: string;
  projectService: ProjectService;
  current: FlaCharacterCreateProjectSnapshot;
  setPreviewAvailable: (available: boolean) => void;
  invalidateAtNextAtomicReplace: () => void;
  createService: (options?: {
    files?: AssetImportFileSystemService;
    faults?: ConstructorParameters<typeof FlaCharacterCreateService>[0]['faults'];
    plan?: FlaPartPlan;
    batch?: FlaPreparedPartBatch;
  }) => FlaCharacterCreateService;
  request: (changes?: Partial<{ operationId: string; name: string; baseRevision: number; openInstanceId: number }>) => unknown;
}

async function harness(options: {
  bytes?: readonly Uint8Array[];
  planCapability?: 'EDITABLE_PARTS_READY' | 'WHOLE_IMAGE_ONLY';
} = {}): Promise<Harness> {
  const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-fla-character-create-'));
  TEMP_DIRS.push(parent);
  const projectRoot = path.join(parent, 'Character Create.pandastage');
  const current = { projectRoot, project: undefined as never, revision: 0, openInstanceId: OPEN_INSTANCE_ID } as FlaCharacterCreateProjectSnapshot;
  let projectIdIndex = 0;
  let serviceIdIndex = 0;
  const activePlan = plan(options.bytes?.length ?? 2, options.planCapability);
  const batch = preparedBatch(activePlan, options.bytes ?? [png(1), png(2)]);
  let activeService: FlaCharacterCreateService | null = null;
  let previewAvailable = true;
  let invalidatePreviewAtAtomicReplace = false;
  const projectService = new ProjectService({
    fileSystem: new ProjectFileSystemService({
      beforeAtomicReplace: () => {
        if (invalidatePreviewAtAtomicReplace) {
          invalidatePreviewAtAtomicReplace = false;
          previewAvailable = false;
        }
      },
    }),
    createId: () => id('90810000', ++projectIdIndex),
    now: () => new Date('2026-11-01T00:00:00.000Z'),
    onProjectSaved: (_root, project, revision) => {
      current.project = project;
      if (revision !== undefined) current.revision = revision;
    },
    onProjectOpened: async (root, project) => {
      await activeService?.recoverProjectArtifacts(root, project);
    },
  });
  const created = await projectService.create(projectRoot, { name: 'Character Create' });
  current.project = created.project;
  const createService: Harness['createService'] = (overrides = {}) => {
    const service = new FlaCharacterCreateService({
      projectService,
      partPreviewService: {
        getPlan: () => previewAvailable ? overrides.plan ?? activePlan : null,
        getPreparedBatch: () => previewAvailable ? overrides.batch ?? batch : null,
        getPreparedBatchMetadata: () => previewAvailable
          ? flaPreparedPartBatchMetadata(overrides.batch ?? batch)
          : null,
      } as unknown as FlaPartPreviewService,
      getCurrentProjectSnapshot: (root) => root.toLocaleLowerCase() === projectRoot.toLocaleLowerCase() ? current : null,
      createId: () => id('90820000', ++serviceIdIndex),
      now: () => new Date('2026-11-01T00:00:00.000Z'),
      ...(overrides.files ? { fileSystem: overrides.files } : {}),
      ...(overrides.faults ? { faults: overrides.faults } : {}),
    });
    activeService = service;
    return service;
  };
  return {
    projectRoot,
    projectService,
    current,
    setPreviewAvailable: (available) => { previewAvailable = available; },
    invalidateAtNextAtomicReplace: () => { invalidatePreviewAtAtomicReplace = true; },
    createService,
    request: (changes: Partial<{ operationId: string; name: string; baseRevision: number; openInstanceId: number }> = {}) => ({
      format: 'panda-fla-character-create',
      version: 1,
      operationId: changes.operationId ?? OPERATION_ID,
      projectRoot,
      projectId: current.project.id,
      baseRevision: changes.baseRevision ?? current.revision,
      openInstanceId: changes.openInstanceId ?? current.openInstanceId,
      name: changes.name ?? 'Sample Character',
      confirmation: {
        confirmed: true,
        capability: 'EDITABLE_PARTS_READY',
        planId: activePlan.planId,
        sessionId: activePlan.sessionId,
        requestId: activePlan.requestId,
        generation: activePlan.generation,
        poseIdentity: activePlan.poseIdentity,
        target: {
          renderTargetId: activePlan.target.renderTargetId,
          selectedFrameIndex: activePlan.target.selectedFrameIndex,
        },
      },
    }),
  };
}

afterEach(async () => {
  await Promise.all(TEMP_DIRS.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('F1-03 FLA Part Character commit', () => {
  it('persists the Main-held batch once, deduplicates bytes, and returns the same outcome on retry', async () => {
    const h = await harness({ bytes: [png(7), png(7)] });
    const service = h.createService();
    const request = h.request();

    const result = fullResult(await service.commit(request));

    expect(result.savedRevision).toBe(1);
    expect(result.project.characters).toHaveLength(1);
    expect(result.project.characters[0]).toMatchObject({ mode: 'adaptive-parts', name: 'Sample Character' });
    expect(result.project.voiceProfiles).toHaveLength(1);
    expect(result.project.voiceProfiles[0]?.characterId).toBe(result.characterId);
    expect(result.project.shots).toEqual(h.current.project.shots);
    expect(result.assets).toHaveLength(2);
    expect(result.createdAssetCount).toBe(1);
    expect(result.reusedAssetCount).toBe(1);
    expect(result.assets[0]?.assetId).toBe(result.assets[1]?.assetId);
    const character = result.project.characters[0];
    expect(character?.mode).toBe('adaptive-parts');
    if (character?.mode !== 'adaptive-parts') throw new Error('Expected adaptive-parts Character.');
    expect(new Set(character.parts.map((part) => part.partId)).size).toBe(2);
    expect(new Set(character.parts.map((part) => part.source.sourceId)).size).toBe(2);
    expect(h.current.revision).toBe(1);
    const files = await readdir(path.join(h.projectRoot, 'assets'));
    expect(files).toHaveLength(1);
    const saved = await h.projectService.open(h.projectRoot);
    expect(saved.project).toEqual(result.project);
    expect(await service.commit(request)).toEqual(result);
    expect(h.current.revision).toBe(1);

    const recoveredByFreshService = h.createService();
    const status = await recoveredByFreshService.getStatus({
      format: 'panda-fla-character-create-status',
      version: 1,
      operationId: OPERATION_ID,
      projectRoot: h.projectRoot,
      projectId: result.projectId,
    });
    if (!status.ok) throw new Error(JSON.stringify(status));
    expect(status).toMatchObject({ ok: true, status: 'COMMITTED', result: { operationId: OPERATION_ID, savedRevision: 1 } });
  });

  it('revalidates the held batch at the atomic Project replacement boundary and rolls back owned files', async () => {
    const h = await harness();
    const service = h.createService();
    h.invalidateAtNextAtomicReplace();

    await expect(service.commit(h.request())).rejects.toMatchObject({ code: 'PLAN_EXPIRED' });

    expect(h.current.revision).toBe(0);
    expect(h.current.project.characters).toHaveLength(0);
    expect(h.current.project.voiceProfiles).toHaveLength(0);
    expect(await readdir(path.join(h.projectRoot, 'assets'))).toEqual([]);
    const journal = new FlaCharacterCreateJournalService();
    expect(await journal.read(h.projectRoot, OPERATION_ID)).toBeNull();
    expect(await service.getStatus({ operationId: OPERATION_ID, projectRoot: h.projectRoot, projectId: h.current.project.id }))
      .toMatchObject({ ok: true, status: 'FAILED', error: { code: 'PLAN_EXPIRED' } });
  });

  it('keeps committed history queryable after a later Project edit without returning the old Project snapshot', async () => {
    const h = await harness();
    const service = h.createService();
    const request = h.request();
    const result = fullResult(await service.commit(request));
    const editedProject = { ...h.current.project, name: 'Character Create Edited' };
    await h.projectService.save(h.projectRoot, editedProject, h.current.revision + 1);
    const editedRevision = h.current.revision;

    const restartedService = h.createService();
    const status = await restartedService.getStatus({
      operationId: OPERATION_ID,
      projectRoot: h.projectRoot,
      projectId: result.projectId,
    });
    expect(status).toMatchObject({
      ok: true,
      status: 'COMMITTED',
      result: { operationId: OPERATION_ID, characterId: result.characterId, savedRevision: result.savedRevision },
    });
    if (!status.ok || status.status !== 'COMMITTED') throw new Error('Expected the committed operation history.');
    expect('project' in status.result).toBe(false);
    expect(h.current.project.name).toBe('Character Create Edited');
    expect(h.current.revision).toBe(editedRevision);

    const replay = await restartedService.commit(request);
    expect('project' in replay).toBe(false);
    expect(h.current.project.name).toBe('Character Create Edited');
    expect(h.current.revision).toBe(editedRevision);
    expect(h.current.project.characters).toHaveLength(1);
  });

  it('keeps uncertain non-committed journals recovery-required when their Project SHA no longer matches', async () => {
    const h = await harness();
    const service = h.createService();
    const result = fullResult(await service.commit(h.request()));
    const editedProject = { ...h.current.project, name: 'Changed before recovery' };
    await h.projectService.save(h.projectRoot, editedProject, h.current.revision + 1);
    const journalStore = new FlaCharacterCreateJournalService();
    const journal = await journalStore.read(h.projectRoot, OPERATION_ID);
    if (!journal) throw new Error('Expected a durable Character creation journal.');
    await journalStore.write(h.projectRoot, { ...journal, phase: 'saving' });

    const status = await service.getStatus({
      operationId: OPERATION_ID,
      projectRoot: h.projectRoot,
      projectId: result.projectId,
    });
    expect(status).toMatchObject({ ok: false, status: 'ERROR', error: { code: 'RECOVERY_REQUIRED' } });
    expect(h.current.project.name).toBe('Changed before recovery');
  });

  it('keeps the successful-operation cache empty while durable status remains queryable across many commits', async () => {
    const h = await harness();
    const service = h.createService();
    const firstOperationId = '90930000-0000-4000-8000-000000000001';
    for (let index = 1; index <= 20; index += 1) {
      const operationId = `90930000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      await service.commit(h.request({ operationId, name: `Character ${index}` }));
      expect((service as unknown as { activeOperations: Map<string, unknown> }).activeOperations.size).toBe(0);
    }

    const status = await service.getStatus({
      operationId: firstOperationId,
      projectRoot: h.projectRoot,
      projectId: h.current.project.id,
    });
    expect(status).toMatchObject({ ok: true, status: 'COMMITTED', result: { operationId: firstOperationId } });
    if (!status.ok || status.status !== 'COMMITTED') throw new Error('Expected the first operation to remain queryable.');
    expect('project' in status.result).toBe(false);
    expect(h.current.project.characters).toHaveLength(20);
  }, 15_000);

  it('rejects a stale or unsupported confirmation before creating files', async () => {
    const stale = await harness();
    const staleService = stale.createService();
    stale.current.revision = 1;
    await expect(staleService.commit(stale.request({ baseRevision: 0 }))).rejects.toMatchObject({ code: 'STALE_PROJECT' });
    expect(await readdir(path.join(stale.projectRoot, 'assets'))).toEqual([]);
    expect(await staleService.getStatus({ operationId: OPERATION_ID, projectRoot: stale.projectRoot, projectId: stale.current.project.id }))
      .toMatchObject({ ok: true, status: 'FAILED', error: { code: 'STALE_PROJECT' } });

    const wrongInstance = await harness();
    const wrongInstanceService = wrongInstance.createService();
    await expect(wrongInstanceService.commit(wrongInstance.request({ openInstanceId: OPEN_INSTANCE_ID + 1 })))
      .rejects.toMatchObject({ code: 'STALE_PROJECT' });
    expect(await readdir(path.join(wrongInstance.projectRoot, 'assets'))).toEqual([]);

    const unsupported = await harness({ planCapability: 'WHOLE_IMAGE_ONLY' });
    const unsupportedService = unsupported.createService();
    await expect(unsupportedService.commit(unsupported.request())).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
    expect(await readdir(path.join(unsupported.projectRoot, 'assets'))).toEqual([]);
    expect(unsupported.current.revision).toBe(0);
  });

  it('rejects expired plans and tampered held identity before writing any Project Assets', async () => {
    const expired = await harness();
    const expiredPlan = { ...plan(2), expiresAt: '2026-10-31T23:59:00.000Z' } as FlaPartPlan;
    const expiredBatch = preparedBatch(expiredPlan, [png(1), png(2)]);
    const expiredService = expired.createService({ plan: expiredPlan, batch: expiredBatch });
    await expect(expiredService.commit(expired.request())).rejects.toMatchObject({ code: 'PLAN_EXPIRED' });
    expect(await readdir(path.join(expired.projectRoot, 'assets'))).toEqual([]);

    const tampered = await harness();
    const held = preparedBatch(plan(2), [png(1), png(2)]);
    const tamperedBatch = {
      ...held,
      identity: {
        ...held.identity,
        rawSourceSha256: 'd'.repeat(64),
        target: { ...held.identity.target, sceneIndex: held.identity.target.sceneIndex + 1 },
      },
    } as FlaPreparedPartBatch;
    const tamperedService = tampered.createService({ batch: tamperedBatch });
    await expect(tamperedService.commit(tampered.request())).rejects.toMatchObject({ code: 'PLAN_EXPIRED' });
    expect(await readdir(path.join(tampered.projectRoot, 'assets'))).toEqual([]);
  });

  it('uses one asset file but distinct occurrence Parts across two operation IDs', async () => {
    const h = await harness({ bytes: [png(7), png(7)] });
    const service = h.createService();
    const first = await service.commit(h.request({ name: 'First Character' }));
    const second = await service.commit(h.request({ operationId: SECOND_OPERATION_ID, name: 'Second Character' }));

    expect(first.createdAssetCount).toBe(1);
    expect(first.reusedAssetCount).toBe(1);
    expect(second.createdAssetCount).toBe(0);
    expect(second.reusedAssetCount).toBe(2);
    expect(second.assets.map((asset) => asset.assetId)).toEqual(first.assets.map((asset) => asset.assetId));
    expect(h.current.project.characters).toHaveLength(2);
    expect(h.current.project.voiceProfiles).toHaveLength(2);
    expect(h.current.project.assets).toHaveLength(1);
    const firstCharacter = h.current.project.characters.find((item) => item.id === first.characterId);
    const secondCharacter = h.current.project.characters.find((item) => item.id === second.characterId);
    expect(firstCharacter?.name).toBe('First Character');
    expect(secondCharacter?.name).toBe('Second Character');
    if (firstCharacter?.mode !== 'adaptive-parts' || secondCharacter?.mode !== 'adaptive-parts') throw new Error('Expected two adaptive-parts Characters.');
    expect(new Set(firstCharacter.parts.map((part) => part.partId)).size).toBe(2);
    expect(new Set(secondCharacter.parts.map((part) => part.partId)).size).toBe(2);
    expect(firstCharacter.parts.map((part) => part.partId)).not.toEqual(secondCharacter.parts.map((part) => part.partId));
    expect(await readdir(path.join(h.projectRoot, 'assets'))).toHaveLength(1);
  });

  it('returns a durable FAILED receipt for a duplicate Character name without changing the Project', async () => {
    const h = await harness();
    const service = h.createService();
    const first = await service.commit(h.request({ name: 'Existing Name' }));

    await expect(service.commit(h.request({ operationId: SECOND_OPERATION_ID, name: 'Existing Name' })))
      .rejects.toMatchObject({ code: 'DUPLICATE_CHARACTER_NAME' });
    expect(h.current.revision).toBe(first.savedRevision);
    expect(h.current.project.characters.map((item) => item.id)).toEqual([first.characterId]);
    expect(h.current.project.voiceProfiles).toHaveLength(1);
    expect(await readdir(path.join(h.projectRoot, 'assets'))).toHaveLength(2);

    const restartedService = h.createService();
    const status = await restartedService.getStatus({
      format: 'panda-fla-character-create-status',
      version: 1,
      operationId: SECOND_OPERATION_ID,
      projectRoot: h.projectRoot,
      projectId: h.current.project.id,
    });
    expect(status).toMatchObject({ ok: true, status: 'FAILED', error: { code: 'DUPLICATE_CHARACTER_NAME' } });
    await expect(restartedService.commit(h.request({ operationId: SECOND_OPERATION_ID, name: 'Existing Name' })))
      .rejects.toMatchObject({ code: 'DUPLICATE_CHARACTER_NAME' });
  });

  it('keeps a truthful FAILED status after an Nth PNG write or pre-save failure', async () => {
    const h = await harness();
    const secondWriteFailure = h.createService({
      faults: {
        beforeAssetTemporaryWrite(index) {
          if (index === 1) throw new Error('injected second PNG write failure');
        },
      },
    });
    await expect(secondWriteFailure.commit(h.request())).rejects.toMatchObject({ code: 'COMMIT_FAILED' });
    expect(await readdir(path.join(h.projectRoot, 'assets'))).toEqual([]);
    expect((await h.projectService.open(h.projectRoot)).project.characters).toHaveLength(0);
    expect(await secondWriteFailure.getStatus({ operationId: OPERATION_ID, projectRoot: h.projectRoot, projectId: h.current.project.id }))
      .toMatchObject({ ok: true, status: 'FAILED', error: { code: 'COMMIT_FAILED' } });

    const beforeSave = await harness();
    const saveFailure = beforeSave.createService({
      faults: {
        beforeProjectSave() {
          throw new Error('injected project save failure');
        },
      },
    });
    await expect(saveFailure.commit(beforeSave.request())).rejects.toMatchObject({ code: 'COMMIT_FAILED' });
    expect(await readdir(path.join(beforeSave.projectRoot, 'assets'))).toEqual([]);
    expect((await beforeSave.projectService.open(beforeSave.projectRoot)).project.characters).toHaveLength(0);
    expect(await saveFailure.getStatus({ operationId: OPERATION_ID, projectRoot: beforeSave.projectRoot, projectId: beforeSave.current.project.id }))
      .toMatchObject({ ok: true, status: 'FAILED', error: { code: 'COMMIT_FAILED' } });
  });

  it('rolls back finalized Part files when Project saving has not started', async () => {
    const h = await harness();
    const service = h.createService({
      faults: {
        beforeAssetFinalize(index) {
          if (index === 0) throw new Error('injected finalize failure');
        },
      },
    });

    await expect(service.commit(h.request())).rejects.toMatchObject({ code: 'COMMIT_FAILED' });
    expect(h.current.revision).toBe(0);
    expect((await h.projectService.open(h.projectRoot)).project.characters).toHaveLength(0);
    expect(await readdir(path.join(h.projectRoot, 'assets'))).toEqual([]);
    const status = await service.getStatus({ operationId: OPERATION_ID, projectRoot: h.projectRoot, projectId: h.current.project.id });
    expect(status).toMatchObject({ ok: true, status: 'FAILED', error: { code: 'COMMIT_FAILED' } });
  });

  it('keeps the committed Project when preview cancellation and response loss happen after the atomic save', async () => {
    const h = await harness();
    const service = h.createService({
      faults: {
        afterProjectSave() {
          h.setPreviewAvailable(false);
          throw new Error('injected response-loss window');
        },
      },
    });

    const result = fullResult(await service.commit(h.request()));
    expect(result.savedRevision).toBe(1);
    expect(h.current.project.characters).toHaveLength(1);
    expect(await readdir(path.join(h.projectRoot, 'assets'))).toHaveLength(2);
    const status = await service.getStatus({
      format: 'panda-fla-character-create-status',
      version: 1,
      operationId: OPERATION_ID,
      projectRoot: h.projectRoot,
      projectId: h.current.project.id,
    });
    expect(status).toMatchObject({ ok: true, status: 'COMMITTED', result: { project: result.project } });
  });

  it('recovers a saved operation after a process interruption before the journal commit marker', async () => {
    const h = await harness();
    const result = fullResult(await h.createService().commit(h.request()));
    const journalStore = new FlaCharacterCreateJournalService();
    const committedJournal = await journalStore.read(h.projectRoot, OPERATION_ID);
    if (!committedJournal) throw new Error('Expected a durable Character creation journal.');
    await journalStore.write(h.projectRoot, { ...committedJournal, phase: 'saving' });

    const restartedService = h.createService();
    const reopened = await h.projectService.open(h.projectRoot);
    expect(reopened.project).toEqual(result.project);
    expect(await journalStore.read(h.projectRoot, OPERATION_ID)).toMatchObject({ phase: 'committed' });
    expect(await restartedService.getStatus({
      operationId: OPERATION_ID,
      projectRoot: h.projectRoot,
      projectId: result.projectId,
    })).toMatchObject({ ok: true, status: 'COMMITTED', result: { project: result.project } });
  });

  it('removes finalized orphan files after a process interruption before Project save', async () => {
    const source = await harness();
    await source.createService().commit(source.request());
    const journalStore = new FlaCharacterCreateJournalService();
    const committedJournal = await journalStore.read(source.projectRoot, OPERATION_ID);
    if (!committedJournal) throw new Error('Expected a durable Character creation journal.');

    const reopenedProject = await harness();
    expect(reopenedProject.current.project.id).toBe(committedJournal.projectId);
    await Promise.all(committedJournal.files.map((file) => copyFile(
      path.join(source.projectRoot, 'assets', file.targetFileName),
      path.join(reopenedProject.projectRoot, 'assets', file.targetFileName),
    )));
    await journalStore.write(reopenedProject.projectRoot, { ...committedJournal, phase: 'finalized' });

    reopenedProject.createService();
    const reopened = await reopenedProject.projectService.open(reopenedProject.projectRoot);
    expect(reopened.project.characters).toHaveLength(0);
    expect(await readdir(path.join(reopenedProject.projectRoot, 'assets'))).toEqual([]);
    expect(await journalStore.read(reopenedProject.projectRoot, OPERATION_ID)).toBeNull();
  });

  it('rejects reuse of an operation ID with a different request identity', async () => {
    const h = await harness();
    const service = h.createService();
    await service.commit(h.request());
    await expect(service.commit(h.request({ name: 'A different name' }))).rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
  });
});
