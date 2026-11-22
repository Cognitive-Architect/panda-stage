import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CharacterService,
  LayerService,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  evaluateShotAtTime,
  projectShotDialogueVisual,
  resolveLayerVisualParts,
  resolveTalkingHeadMotionTransform,
  upsertExpressionEventAtTime,
  upsertMouthCueEventAtTime,
  type AdaptivePartsCharacter,
  type ImageAsset,
  type Project,
} from '../../src/domain';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';
import { ProjectService } from '../../src/main/services/ProjectService';
import {
  preflightFlaBytes,
  readFlaSourceBytes,
} from '../../src/main/services/fla-import-preflight-service';
import {
  classifyForFlaRecovery,
  normalizeRecoveryCandidate,
} from '../../src/main/services/fla-recovery-classifier.js';
import {
  prepareFlaStaticSnapshotDisplaySource,
  stableRenderTargetId,
} from '../../src/main/services/fla-static-snapshot-svg-builder';
import type { FlaImportService } from '../../src/main/services/FlaImportService';
import { FlaPartPreviewService } from '../../src/main/services/FlaPartPreviewService';
import type { FlaStaticSnapshotRasterizer } from '../../src/main/services/fla-static-snapshot-render-session';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { FlaPartPreviewRequestSchema } from '../../src/shared/fla-part-preview-api';
import { faceSource, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from '../unit/domain/testProject';

const REAL_XIAOSHIMEI_FLA_PATH = 'F:\\素材\\唉小师妹唉.fla';
const temporaryParents: string[] = [];

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function makeSolidPng(width: number, height: number): Buffer {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(safeWidth, 0);
  ihdr.writeUInt32BE(safeHeight, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = safeWidth * 4 + 1;
  const raw = Buffer.alloc(stride * safeHeight);
  const idat = deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function imageAsset(id: string, name: string, width: number, height: number): ImageAsset {
  return {
    id,
    kind: 'image',
    name,
    relativePath: `assets/${name}.png`,
    mimeType: 'image/png',
    width,
    height,
    usage: 'character',
    keywords: [],
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('Phase A lifecycle: AdaptiveParts face binding & expressions save/reopen (#1211)', () => {
  it('persists faceBinding, PNG/Graphic expressions, defaultExpressionId, and alignment across save and reopen', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-phase-a-'));
    temporaryParents.push(parent);
    const projectRoot = path.join(parent, 'PhaseA.pandastage');

    const projectService = new ProjectService();
    const created = await projectService.create(projectRoot, { name: 'Phase A Roundtrip' });
    const seed = graphicFaceProject(true);
    const backAssetId = 'c1000000-0000-4000-8000-000000000001';
    const facePartAssetId = 'c1000000-0000-4000-8000-000000000002';
    const smileAssetId = 'c1000000-0000-4000-8000-000000000003';
    const partBackId = 'd1000000-0000-4000-8000-000000000001';
    const partFaceId = 'd1000000-0000-4000-8000-000000000002';

    const charService = new CharacterService();
    let project: Project = ProjectSchema.parse({
      ...seed,
      id: created.project.id,
      name: created.project.name,
      createdAt: created.project.createdAt,
      updatedAt: created.project.updatedAt,
      assets: [
        ...seed.assets,
        imageAsset(backAssetId, '后发', 160, 200),
        imageAsset(facePartAssetId, '原脸', 80, 60),
        imageAsset(smileAssetId, '笑脸', 200, 150),
      ],
    });
    project = charService.createAdaptiveParts(project, {
      name: '元件测试角色',
      parts: [
        {
          partId: partBackId,
          source: { kind: 'manual', sourceId: 'm-back' },
          assetId: backAssetId,
          imageMapping: { sourceWidth: 160, sourceHeight: 200, crop: { x: 0, y: 0, width: 160, height: 200 }, exportScale: 1 },
          restTransform: { a: 1, b: 0, c: 0, d: 1, tx: -80, ty: -100 },
          sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: -80, ty: -100 },
          drawOrder: 0,
          visible: true,
          displayName: '后发',
        },
        {
          partId: partFaceId,
          source: { kind: 'manual', sourceId: 'm-face' },
          assetId: facePartAssetId,
          imageMapping: { sourceWidth: 80, sourceHeight: 60, crop: { x: 0, y: 0, width: 80, height: 60 }, exportScale: 1 },
          restTransform: { a: 1, b: 0, c: 0, d: 1, tx: -40, ty: -60 },
          sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: -40, ty: -60 },
          drawOrder: 1,
          visible: true,
          displayName: '脸部',
        },
      ],
    });
    const charId = project.characters.at(-1)!.id;
    project = charService.setAdaptivePartsFaceBinding(project, charId, {
      targetPartId: partFaceId,
      placement: { offsetX: 5, offsetY: -3, scale: 1.1, rotationDeg: 0, flipX: false },
    });
    project = charService.addExpression(project, charId, {
      name: 'PNG笑脸',
      assetId: smileAssetId,
    });
    project = charService.addExpression(project, charId, {
      name: 'Graphic生气',
      visualSource: faceSource(1),
    });
    const graphicExprId = (
      project.characters.find((c) => c.id === charId) as AdaptivePartsCharacter
    ).expressions![1]!.id;
    project = charService.setDefaultExpression(project, charId, graphicExprId);
    const layerRes = new LayerService().createFromAdaptiveCharacter(
      project,
      IDS.shot,
      charId,
      { x: 960, y: 540 },
    );
    project = layerRes.project;
    project = charService.setAdaptivePartsHeadMotionBinding(project, charId, [partBackId, partFaceId]);

    await projectService.save(projectRoot, project, 1);
    const reopened = await projectService.open(projectRoot);
    expect(reopened.sourceVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(reopened.project).toStrictEqual(project);
    expect(reopened.project.characters.find(({ id }) => id === charId)).toMatchObject({
      headMotionBinding: { partIds: [partBackId, partFaceId] },
    });

    const shot = reopened.project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 0, reopened.project);
    const layer = evaluated.layers.find((entry) => entry.id === layerRes.layer.id)!;
    expect(layer.currentExpressionId).toBe(graphicExprId);
    const visual = resolveLayerVisualParts(reopened.project, shot, layer);
    expect(visual.parts[1]!.flaGraphic?.frameOrdinal).toBe(1);
    expect(visual.parts[1]!.drawOrder).toBe(1);

    project = charService.setMouthOpenAsset(project, charId, smileAssetId);
    project = upsertExpressionEventAtTime(project, shot.id, layerRes.layer.id, graphicExprId, 200);
    project = upsertMouthCueEventAtTime(project, shot.id, layerRes.layer.id, 'open', 400);
    const unbound = charService.setAdaptivePartsFaceBinding(project, charId, null);
    await projectService.save(projectRoot, unbound, 2);
    const reopenedUnbound = await projectService.open(projectRoot);
    expect(reopenedUnbound.project).toStrictEqual(unbound);
    expect(reopenedUnbound.project.shots).toEqual(project.shots);
  });

  it.skipIf(!existsSync(REAL_XIAOSHIMEI_FLA_PATH))(
    'imports F:\\素材\\唉小师妹唉.fla 36-part character locally, binds a face part, switches PNG & Graphic expressions cleanly without altering remaining vector parts',
    async () => {
      const sourceRead = await readFlaSourceBytes(REAL_XIAOSHIMEI_FLA_PATH);
      let sourceBytes = sourceRead.bytes;
      const originalSha256 = sourceRead.sha256;
      try {
        preflightFlaBytes(sourceBytes, sourceRead.basename, sourceRead.sourcePath);
      } catch {
        const classification = classifyForFlaRecovery(sourceBytes);
        expect(classification.state).toBe('RECOVERY_CANDIDATE');
        const normalized = normalizeRecoveryCandidate(sourceBytes, classification);
        expect(normalized.applied).toBe(true);
        if (normalized.applied) sourceBytes = normalized.bytes;
      }
      const sha256 = createHash('sha256').update(sourceBytes).digest('hex');
      const prepared = await prepareFlaStaticSnapshotDisplaySource(sourceBytes, 'preview');
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) throw new Error(prepared.message);

      const zip = await JSZip.loadAsync(sourceBytes);
      const domDocXml = await zip.file('DOMDocument.xml')?.async('string');
      const docWidthMatch = domDocXml?.match(/\bwidth="(\d+(?:\.\d+)?)"/u);
      const docHeightMatch = domDocXml?.match(/\bheight="(\d+(?:\.\d+)?)"/u);
      const docFpsMatch = domDocXml?.match(/\bframeRate="(\d+(?:\.\d+)?)"/u);
      const scene = prepared.source.sceneTimelines[0]!;
      const sessionId = randomUUID();
      const requestId = randomUUID();
      const targetId = stableRenderTargetId(sourceBytes, `scene\u0000timeline\u0000${scene.index}`);
      const flaImportService = {
        getSession: (id: string) =>
          id === sessionId
            ? {
                sessionId,
                ir: {
                  source: { basename: sourceRead.basename, sha256 },
                  document: {
                    width: docWidthMatch ? Number(docWidthMatch[1]) : prepared.source.stageWidth,
                    height: docHeightMatch ? Number(docHeightMatch[1]) : prepared.source.stageHeight,
                    frameRate: docFpsMatch ? Number(docFpsMatch[1]) : 24,
                  },
                  media: [],
                },
                originalSourceSha256: originalSha256,
                sourceBytes,
              }
            : null,
      } as unknown as FlaImportService;
    const renderSession = {
      prepareDisplaySourceForPartPreview: async () => ({
        ok: true as const,
        source: prepared.source,
        xmlByteLength: prepared.xmlByteLength,
        cacheHit: false,
      }),
    };
    const rasterizer: FlaStaticSnapshotRasterizer = {
      async rasterize(input) {
        return {
          pngBytes: makeSolidPng(input.width, input.height),
          width: input.width,
          height: input.height,
          pixelCount: input.pixelCount,
        };
      },
      cancel: () => true,
      close: () => undefined,
    };
    const previewService = new FlaPartPreviewService({
      flaImportService,
      renderSession: renderSession as never,
      rasterizer,
      wallTimeMs: 30_000,
    });
    const preview = await previewService.preview(
      FlaPartPreviewRequestSchema.parse({
        format: 'fla-part-preview',
        version: 1,
        requestId,
        sessionId,
        generation: 1,
        purpose: 'graphic-instance',
        target: { renderTargetId: targetId, selectedFrameIndex: 0 },
      }),
    );
    if (!preview.ok || preview.capability !== 'GRAPHIC_INSTANCES_READY') {
      throw new Error(`Expected GRAPHIC_INSTANCES_READY, got ${JSON.stringify(preview)}`);
    }

    const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-xiaoshimei-phase-a-'));
    temporaryParents.push(parent);
    const projectRoot = path.join(parent, 'Xiaoshimei.pandastage');
    const projectService = new ProjectService();
    const created = await projectService.create(projectRoot, { name: 'Xiaoshimei Phase A' });

    const faceGraphicSeed = graphicFaceProject(true);
    const smilePngId = 'e1000000-0000-4000-8000-000000000001';
    const seedProject = ProjectSchema.parse({
      ...faceGraphicSeed,
      id: created.project.id,
      name: created.project.name,
      createdAt: created.project.createdAt,
      updatedAt: created.project.updatedAt,
      assets: [
        ...faceGraphicSeed.assets,
        imageAsset(smilePngId, '小师妹笑脸PNG', 180, 140),
      ],
    });
    const { createAdaptiveCharacterFromFlaGraphic } = await import('../../src/renderer/features/fla-import/createAdaptiveCharacterFromGraphic');
    const { EditorProjectStore } = await import('../../src/renderer/stores/EditorProjectStore');
    const { CharacterStore } = await import('../../src/renderer/stores/characterStore');
    const { FlaGraphicInstanceCommitService } = await import('../../src/main/services/FlaGraphicInstanceCommitService');
    const heroPreview = { ...preview, sessionId, generation: 1 };
    const heroUnit = heroPreview.partPreviews[0]!;
    await projectService.save(projectRoot, seedProject, 1);
    const store = new EditorProjectStore();
    store.open(projectRoot, seedProject);
    store.markSaved(seedProject, 0);
    const snapshotState = {
      project: seedProject,
      revision: store.getSnapshot()!.revision,
      openInstanceId: store.getProjectInstanceId()!,
    };
    const commitProjectService = new ProjectService({
      onProjectSaved: (root, savedProject, savedRevision) => {
        if (root === projectRoot && savedRevision !== undefined) {
          snapshotState.project = savedProject;
          snapshotState.revision = savedRevision;
        }
      },
    });
    const commitService = new FlaGraphicInstanceCommitService({
      projectService: commitProjectService,
      partPreviewService: previewService,
      getCurrentProjectSnapshot: (root) => (root === projectRoot ? snapshotState : null),
    });
    const characters = new CharacterStore(store, new CharacterService());
    const createdEntry = await createAdaptiveCharacterFromFlaGraphic({
      preview: heroPreview,
      unitId: heroUnit.unitId,
      characterName: '小师妹',
      poseFrameOrdinal: 0,
      api: { commitGraphicInstance: (req) => commitService.commit(req) },
      store,
      characters,
      ensureMainSnapshot: async (snap) => {
        snapshotState.project = snap.project;
        snapshotState.revision = snap.revision;
        snapshotState.openInstanceId = store.getProjectInstanceId()!;
      },
    });
    expect(createdEntry.ok).toBe(true);
    if (!createdEntry.ok) throw new Error(createdEntry.message);
    expect(createdEntry.partCount).toBeGreaterThanOrEqual(30);

    const charSvc = new CharacterService();
    let project = store.getSnapshot()!.project;
    const xiaoshimei = project.characters.find((c) => c.id === createdEntry.characterId) as AdaptivePartsCharacter;
    const backHairPart = xiaoshimei.parts[0]!;
    const bodyMiddlePart = xiaoshimei.parts[Math.floor(xiaoshimei.parts.length / 4)]!;
    const targetFacePart = xiaoshimei.parts[Math.floor(xiaoshimei.parts.length / 2)]!;
    const frontHairPart = xiaoshimei.parts[xiaoshimei.parts.length - 1]!;

    project = charSvc.setAdaptivePartsFaceBinding(project, xiaoshimei.id, {
      targetPartId: targetFacePart.partId,
    });
    project = charSvc.addExpression(project, xiaoshimei.id, {
      name: '笑脸PNG',
      assetId: smilePngId,
    });
    project = charSvc.addExpression(project, xiaoshimei.id, {
      name: 'Graphic表情',
      visualSource: faceSource(1),
    });
    const boundChar = project.characters.find((c) => c.id === xiaoshimei.id) as AdaptivePartsCharacter;
    const pngExprId = boundChar.expressions![0]!.id;
    const graphicExprId = boundChar.expressions![1]!.id;
    project = charSvc.setDefaultExpression(project, xiaoshimei.id, graphicExprId);
    project = charSvc.setMouthOpenAsset(project, xiaoshimei.id, smilePngId);
    project = charSvc.setAdaptivePartsHeadMotionBinding(project, xiaoshimei.id, [
      backHairPart.partId,
      targetFacePart.partId,
      frontHairPart.partId,
    ]);
    project = charSvc.setTalkingHeadMotionIntensityPercent(project, xiaoshimei.id, 150);

    const added = new LayerService().createFromAdaptiveCharacter(
      project,
      IDS.shot,
      xiaoshimei.id,
      { x: 960, y: 540 },
    );
    project = added.project;
    const xiaoAudioAssetId = 'e1000000-0000-4000-8000-000000000088';
    const xiaoAudioClipId = 'e1000000-0000-4000-8000-000000000089';
    const xiaoDialogueId = 'e1000000-0000-4000-8000-000000000090';
    const xiaoVoiceId = 'e1000000-0000-4000-8000-000000000091';
    const baseVoice = project.voiceProfiles[0]!;
    project = ProjectSchema.parse({
      ...project,
      assets: [
        ...project.assets,
        {
          id: xiaoAudioAssetId,
          kind: 'audio',
          name: '小师妹台词',
          relativePath: 'assets/xiao.wav',
          mimeType: 'audio/wav',
          durationMs: 1200,
        },
      ],
      voiceProfiles: [
        ...project.voiceProfiles,
        { ...baseVoice, id: xiaoVoiceId, characterId: xiaoshimei.id, name: '小师妹声线' },
      ],
      shots: project.shots.map((s) => ({
        ...s,
        durationMs: 2000,
        audioClips: [
          {
            id: xiaoAudioClipId,
            name: '台词',
            assetId: xiaoAudioAssetId,
            role: 'dialogue',
            startMs: 100,
            endMs: 1300,
            offsetMs: 0,
            volume: 1,
          },
        ],
        dialogues: [
          {
            id: xiaoDialogueId,
            characterId: xiaoshimei.id,
            voiceProfileId: xiaoVoiceId,
            subtitleStyleId: IDS.subtitle,
            audioClipId: xiaoAudioClipId,
            text: '小师妹',
            startMs: 100,
            endMs: 1300,
          },
        ],
      })),
    });
    project = upsertExpressionEventAtTime(project, IDS.shot, added.layer.id, pngExprId, 0);
    project = upsertMouthCueEventAtTime(project, IDS.shot, added.layer.id, 'rest', 0);

    await projectService.save(projectRoot, project, snapshotState.revision);
    const reopened = await projectService.open(projectRoot);
    const reopenedChar = reopened.project.characters.find((c) => c.id === xiaoshimei.id) as AdaptivePartsCharacter;
    expect(reopenedChar.parts.length).toBe(xiaoshimei.parts.length);
    expect(reopenedChar.headMotionBinding?.partIds).toEqual([
      backHairPart.partId,
      targetFacePart.partId,
      frontHairPart.partId,
    ]);
    expect(reopenedChar.talkingHeadMotionIntensityPercent).toBe(150);
    // All non-target parts retain vector fla-graphic nodePath provenance
    const otherPart = reopenedChar.parts.find((p) => p.partId !== targetFacePart.partId)!;
    expect(otherPart.visualSource?.kind).toBe('fla-graphic');

    const shot = reopened.project.shots[0]!;
    const layerPng = resolveLayerVisualParts(reopened.project, shot, {
      id: added.layer.id,
      assetId: '',
      currentExpressionId: pngExprId,
      mouthOverrideAssetId: null,
      anchor: 'center',
      x: added.layer.x,
      y: added.layer.y,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      zIndex: added.layer.zIndex,
    });
    const replacedPartPng = layerPng.parts.find(
      (p) => p.partId === `${added.layer.id}:${targetFacePart.partId}`,
    )!;
    expect(replacedPartPng.drawOrder).toBe(targetFacePart.drawOrder);
    expect(replacedPartPng.assetId).toBe(smilePngId);

    const assetUrls = Object.fromEntries(
      reopened.project.assets
        .filter((asset) => asset.kind === 'image')
        .map((asset) => [asset.id, `file:///assets/${asset.id}.png`]),
    );
    // Mid-dialogue (225ms -> elapsed 125ms): Stage & Export parity + head motion delta + preserved backHair drawOrder < body < frontHair
    const evalNeutral = projectShotDialogueVisual(reopened.project, shot, evaluateShotAtTime(shot, 0, reopened.project));
    const evalTalk = projectShotDialogueVisual(reopened.project, shot, evaluateShotAtTime(shot, 225, reopened.project));
    const evalExportTalk = evaluateExportShotAtTime(reopened.project, shot, 225);
    const stageNeutral = buildStageRenderModel(reopened.project, evalNeutral, assetUrls);
    const stageTalk = buildStageRenderModel(reopened.project, evalTalk, assetUrls);
    const exportStageTalk = buildStageRenderModel(reopened.project, evalExportTalk, assetUrls);
    const renderedLayer = stageTalk.layers.find((entry) => entry.id === added.layer.id)!;
    expect(renderedLayer.parts).toHaveLength(xiaoshimei.parts.length);
    expect(renderedLayer).toEqual(exportStageTalk.layers.find((entry) => entry.id === added.layer.id)!);

    const neutralLayerParts = stageNeutral.layers.find((entry) => entry.id === added.layer.id)!.parts;
    const expectedDelta = resolveTalkingHeadMotionTransform(125, 1200, 150);
    // BackHair (drawOrder 0) stays strictly ahead of Body in array order (behind in paint order) AND moves with head
    const backIdx = renderedLayer.parts.findIndex((p) => p.id === `${added.layer.id}:${backHairPart.partId}`);
    const bodyIdx = renderedLayer.parts.findIndex((p) => p.id === `${added.layer.id}:${bodyMiddlePart.partId}`);
    const frontIdx = renderedLayer.parts.findIndex((p) => p.id === `${added.layer.id}:${frontHairPart.partId}`);
    expect(backIdx).toBeLessThan(bodyIdx);
    expect(bodyIdx).toBeLessThan(frontIdx);
    expect(renderedLayer.parts[bodyIdx]!.render.x).toBe(neutralLayerParts[bodyIdx]!.render.x);
    expect(renderedLayer.parts[bodyIdx]!.render.y).toBe(neutralLayerParts[bodyIdx]!.render.y);
    expect(renderedLayer.parts[backIdx]!.render.x - neutralLayerParts[backIdx]!.render.x).toBeCloseTo(
      expectedDelta.translateX,
      5,
    );
    expect(renderedLayer.parts[frontIdx]!.render.x - neutralLayerParts[frontIdx]!.render.x).toBeCloseTo(
      expectedDelta.translateX,
      5,
    );
  });
});
