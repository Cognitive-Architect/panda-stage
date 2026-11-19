import { describe, expect, it } from 'vitest';
import {
  CHARACTER_PART_MAX_SCALE,
  CHARACTER_PART_MIN_SCALE,
  CHARACTER_NODE_MOTION_CAPABILITIES,
  CharacterNodeMotionService,
  NO_CHARACTER_NODE_TRANSFORM_CAPABILITIES,
  characterNodeCompositeKeyEasing,
  characterNodeCompositeKeyTimes,
  characterNodeMotionResetValues,
  characterNodeMotionScaleBounds,
  characterNodeMotionValues,
  characterNodeRelativeMotionValues,
  characterNodeTransformCapabilities,
  createCharacterNodeBasisForFace,
  createCharacterNodeFaceAnimationClip,
  evaluateShotAtTime,
  hasAuthoredCharacterNodeMotion,
  hasCharacterNodeCompositeKeyOutgoingInterval,
  ProjectSchema,
  resolveCharacterNodeBasis,
  resolveLayerVisualParts,
  targetTracks,
  type Project,
} from '../../../src/domain';
import { evaluateExportShotAtTime } from '../../../src/export-renderer/evaluateExportShotAtTime';
import { buildEditorTemporalCanvasModel } from '../../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { projectProductPreviewDialogue } from '../../../src/renderer/shell/productPreviewModel';
import { FACE_GRAPHIC_ID, faceSource, graphicFaceProject } from '../../helpers/graphicFaceProject';
import { buildProject, IDS } from './testProject';

const MOUTH_ASSET_ID = '10000000-0000-4000-8000-000000000098';
const BODY_ASSET_ID = IDS.assetChar2;
const HEAD_ASSET_ID = '10000000-0000-4000-8000-000000000097';

function compositeMotionProject(options: {
  faceKind?: 'image' | 'graphic';
  head?: boolean;
  locked?: boolean;
  scale?: number;
} = {}): { project: Project; shotId: string; layerId: string; characterId: string } {
  const base = options.faceKind === 'graphic' ? graphicFaceProject() : buildProject();
  const scale = options.scale ?? 1.2;
  const project = ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets,
      {
        id: HEAD_ASSET_ID,
        kind: 'image',
        name: '头部',
        relativePath: 'head.png',
        mimeType: 'image/png',
        width: 320,
        height: 320,
        usage: 'character',
        keywords: [],
      },
      {
        id: MOUTH_ASSET_ID,
        kind: 'image',
        name: '张嘴',
        relativePath: 'mouth.png',
        mimeType: 'image/png',
        width: 120,
        height: 80,
        usage: 'character',
        keywords: [],
      },
    ],
    characters: base.characters.map((character) =>
      character.id !== IDS.character || character.mode === 'adaptive-parts'
        ? character
        : {
            id: character.id,
            name: character.name,
            mode: 'composite' as const,
            ...(options.faceKind === 'graphic'
              ? { baseAssetId: undefined }
              : { baseAssetId: character.baseAssetId }),
            bodyAssetId: BODY_ASSET_ID,
            bodyPlacement: { offsetX: 0, offsetY: 40, scale: 1 },
            facePlacement: {
              offsetX: 12,
              offsetY: -8,
              scale,
              rotationDeg: 15,
              flipX: false,
            },
            ...(options.head
              ? {
                  head: {
                    assetId: HEAD_ASSET_ID,
                    placement: { offsetX: 0, offsetY: -60, scale: 1, rotationDeg: 0, flipX: false },
                    pivot: { x: 0, y: 20 },
                  },
                }
              : {}),
            defaultVoiceProfileId: character.defaultVoiceProfileId,
            mouthOpenAssetId: MOUTH_ASSET_ID,
            defaultExpressionId: IDS.expressionNormal,
            expressions:
              options.faceKind === 'graphic'
                ? [
                    { id: IDS.expressionNormal, name: '平静', visualSource: faceSource(0) },
                    { id: IDS.expressionAngry, name: '生气', visualSource: faceSource(2) },
                  ]
                : character.expressions,
            defaultScale: character.defaultScale,
            defaultFlipX: character.defaultFlipX,
          },
    ),
    shots: base.shots.map((shot) => ({
      ...shot,
      durationMs: 2_000,
      layers: shot.layers.map((layer) =>
        layer.id === IDS.layerChar
          ? { ...layer, locked: options.locked ?? false }
          : layer,
      ),
    })),
  });
  return {
    project,
    shotId: IDS.shot,
    layerId: IDS.layerChar,
    characterId: IDS.character,
  };
}

describe('Character Node face motion domain & service (#1158)', () => {
  const service = new CharacterNodeMotionService();

  it('exposes minimal structure-derived transform capabilities without generic registries', () => {
    expect(characterNodeTransformCapabilities({ mode: 'composite' }, 'face')).toEqual(
      CHARACTER_NODE_MOTION_CAPABILITIES,
    );
    expect(characterNodeTransformCapabilities({ mode: 'composite' }, 'body')).toEqual(
      NO_CHARACTER_NODE_TRANSFORM_CAPABILITIES,
    );
    expect(characterNodeTransformCapabilities({ mode: 'composite' }, 'head')).toEqual(
      NO_CHARACTER_NODE_TRANSFORM_CAPABILITIES,
    );
    expect(characterNodeTransformCapabilities({ mode: 'composite' }, 'root')).toEqual(
      NO_CHARACTER_NODE_TRANSFORM_CAPABILITIES,
    );
    expect(characterNodeTransformCapabilities({ mode: 'single-image' }, 'face')).toEqual(
      NO_CHARACTER_NODE_TRANSFORM_CAPABILITIES,
    );
    expect(
      characterNodeTransformCapabilities(
        { mode: 'adaptive-parts' },
        'part:71000000-0000-4000-8000-000000000001',
      ),
    ).toEqual(CHARACTER_NODE_MOTION_CAPABILITIES);
  });

  it('creates pure Basis from FacePlacement without Visual/Expression IDs and stays lazy until edit', () => {
    const { project, shotId, layerId } = compositeMotionProject();
    const character = project.characters[0]!;
    if (character.mode !== 'composite') throw new Error('expected composite');

    const basis = createCharacterNodeBasisForFace(character, layerId);
    expect(basis).toEqual({
      target: { kind: 'character-node', layerId, nodeId: 'face' },
      baseTransform: {
        x: 12,
        y: -8,
        scaleX: 1.2,
        scaleY: 1.2,
        rotationDeg: 15,
      },
      pivot: { space: 'target-local', x: 0, y: 0 },
    });
    expect(Object.keys(basis)).toEqual(['target', 'baseTransform', 'pivot']);

    const clip = createCharacterNodeFaceAnimationClip(project, shotId, layerId);
    expect(clip.version).toBe(3);
    expect(resolveCharacterNodeBasis(clip, { kind: 'character-node', layerId, nodeId: 'face' })).toEqual(basis);

    // Reading or applying a no-op change with Auto-Key ON must NOT materialize Clip v3.
    const unchanged = service.apply(
      project,
      { shotId, layerId, nodeId: 'face', timeMs: 500, autoKey: true },
      { 'transform.offsetX': 12 },
    );
    expect(unchanged).toBe(project);
    expect(unchanged.shots[0]!.layers.find((l) => l.id === layerId)!.animationClip).toBeUndefined();
  });

  it('writes static FacePlacement in Auto-Key OFF without creating Clip v3 or Shot changes', () => {
    const { project, shotId, layerId } = compositeMotionProject();
    const input = { shotId, layerId, nodeId: 'face' as const, timeMs: 500, autoKey: false };
    const updated = service.apply(project, input, {
      'transform.offsetX': 28,
      'transform.rotationDeg': 200,
      'transform.scaleX': 1.5,
      'transform.scaleY': 1.5,
    });
    const layer = updated.shots[0]!.layers.find((l) => l.id === layerId)!;
    const character = updated.characters[0]!;
    expect(layer.animationClip).toBeUndefined();
    expect(updated.shots).toEqual(project.shots);
    expect(character.mode === 'composite' && character.facePlacement).toEqual({
      offsetX: 28,
      offsetY: -8,
      scale: 1.5,
      rotationDeg: -160,
      flipX: false,
    });
    expect(() =>
      service.apply(project, input, { 'transform.scaleX': 1.2, 'transform.scaleY': 1.8 }),
    ).toThrow('等比');
  });

  it('back-solves sparse relative Clip v3 keys in Auto-Key ON, enforces uniform scale bounds, and isolates Basis', () => {
    const { project, shotId, layerId } = compositeMotionProject({ scale: 1.4 });
    const bounds = characterNodeMotionScaleBounds(project, {
      shotId,
      layerId,
      nodeId: 'face',
      autoKey: true,
    });
    expect(bounds.min).toBeCloseTo(1.4 * CHARACTER_PART_MIN_SCALE, 10);
    expect(bounds.max).toBeCloseTo(1.4 * CHARACTER_PART_MAX_SCALE, 10);

    // Edit ONLY offsetX and uniform scale at 500 ms -> sparse tracks (only 3 properties created).
    const step1 = service.apply(
      project,
      { shotId, layerId, nodeId: 'face', timeMs: 500, autoKey: true },
      {
        'transform.offsetX': 42,
        'transform.scaleX': 2.1,
        'transform.scaleY': 2.1,
      },
    );
    const layer = step1.shots[0]!.layers.find((l) => l.id === layerId)!;
    const clip = layer.animationClip!;
    expect(clip.version).toBe(3);
    if (clip.version !== 3) throw new Error('expected v3');
    const tracks = targetTracks(clip.tracks, { kind: 'character-node', layerId, nodeId: 'face' });
    expect(tracks.map((t) => t.property).sort()).toEqual([
      'transform.offsetX',
      'transform.scaleX',
      'transform.scaleY',
    ]);
    // Relative delta: offsetX = 42 - 12 = 30; scaleX/Y = 2.1 / 1.4 = 1.5.
    expect(characterNodeRelativeMotionValues(step1, { shotId, layerId, nodeId: 'face', timeMs: 0 })).toEqual({
      'transform.offsetX': 0,
      'transform.offsetY': 0,
      'transform.rotationDeg': 0,
      'transform.scaleX': 1,
      'transform.scaleY': 1,
    });
    const rel500 = characterNodeRelativeMotionValues(step1, { shotId, layerId, nodeId: 'face', timeMs: 500 });
    expect(rel500['transform.offsetX']).toBe(30);
    expect(rel500['transform.offsetY']).toBe(0);
    expect(rel500['transform.rotationDeg']).toBe(0);
    expect(rel500['transform.scaleX']).toBeCloseTo(1.5, 10);
    expect(rel500['transform.scaleY']).toBeCloseTo(1.5, 10);
    // UI evaluated pose matches authored world values cleanly at 0ms, 250ms midpoint, and 500ms.
    expect(characterNodeMotionValues(step1, { shotId, layerId, nodeId: 'face', timeMs: 250, autoKey: true })).toEqual({
      'transform.offsetX': 27,
      'transform.offsetY': -8,
      'transform.rotationDeg': 15,
      'transform.scaleX': 1.75,
      'transform.scaleY': 1.75,
    });

    // Exact IEEE-754 tricky boundary: 1.4 * 0.05 = 0.07 -> 0.07 / 1.4 = 0.049999999999999996 must snap cleanly.
    const atMinBound = service.apply(
      step1,
      { shotId, layerId, nodeId: 'face', timeMs: 500, autoKey: true },
      { 'transform.scaleX': bounds.min, 'transform.scaleY': bounds.min },
    );
    expect(characterNodeRelativeMotionValues(atMinBound, { shotId, layerId, nodeId: 'face', timeMs: 500 })['transform.scaleX']).toBe(CHARACTER_PART_MIN_SCALE);

    // Out-of-bounds scale, non-uniform scale, and reset to basis work cleanly.
    expect(() =>
      service.apply(step1, { shotId, layerId, nodeId: 'face', timeMs: 500, autoKey: true }, {
        'transform.scaleX': bounds.max + 1,
        'transform.scaleY': bounds.max + 1,
      }),
    ).toThrow('脸部缩放范围');
    expect(() =>
      service.apply(step1, { shotId, layerId, nodeId: 'face', timeMs: 500, autoKey: true }, {
        'transform.scaleX': 1.4,
        'transform.scaleY': 2.0,
      }),
    ).toThrow('等比');

    expect(characterNodeMotionResetValues(step1, { shotId, layerId, nodeId: 'face', autoKey: true })).toEqual({
      'transform.offsetX': 12,
      'transform.offsetY': -8,
      'transform.rotationDeg': 15,
      'transform.scaleX': 1.4,
      'transform.scaleY': 1.4,
    });
  });

  it('enforces layer lock, frame grid, shot bounds, and node capability guards', () => {
    const locked = compositeMotionProject({ locked: true });
    expect(() =>
      service.apply(locked.project, { shotId: locked.shotId, layerId: locked.layerId, nodeId: 'face', timeMs: 0, autoKey: true }, { 'transform.offsetX': 20 }),
    ).toThrow('锁定');

    const { project, shotId, layerId } = compositeMotionProject();
    expect(() =>
      service.apply(project, { shotId, layerId, nodeId: 'body', timeMs: 0, autoKey: true }, { 'transform.offsetX': 20 }),
    ).toThrow('脸部节点');
    expect(() =>
      service.apply(project, { shotId, layerId, nodeId: 'face', timeMs: 123, autoKey: true }, { 'transform.offsetX': 20 }),
    ).toThrow('有效帧');
    expect(() =>
      service.apply(project, { shotId, layerId, nodeId: 'face', timeMs: 5_000, autoKey: true }, { 'transform.offsetX': 20 }),
    ).toThrow('有效帧');
  });

  it('reuses animation-track-ops for key times, delete, retime, batch retime, copy/paste pose, and easing', () => {
    const { project, shotId, layerId } = compositeMotionProject();
    let current = service.apply(
      project,
      { shotId, layerId, nodeId: 'face', timeMs: 500, autoKey: true },
      { 'transform.offsetX': 52, 'transform.rotationDeg': 45, 'transform.scaleX': 1.8, 'transform.scaleY': 1.8 },
    );
    current = service.apply(
      current,
      { shotId, layerId, nodeId: 'face', timeMs: 1_000, autoKey: true },
      { 'transform.offsetX': 92 },
    );

    let layer = current.shots[0]!.layers.find((l) => l.id === layerId)!;
    expect(hasAuthoredCharacterNodeMotion(layer, 'face')).toBe(true);
    expect(characterNodeCompositeKeyTimes(layer, 'face')).toEqual([0, 500, 1_000]);
    expect(hasCharacterNodeCompositeKeyOutgoingInterval(layer, 'face', 0)).toBe(true);
    expect(hasCharacterNodeCompositeKeyOutgoingInterval(layer, 'face', 1_000)).toBe(false);
    expect(characterNodeCompositeKeyEasing(layer, 'face', 0)).toBe('linear');

    // Easing change to step and back
    current = service.setCompositeKeyEasing(current, {
      shotId,
      layerId,
      nodeId: 'face',
      timeMs: 0,
      interpolationToNext: 'step',
    });
    layer = current.shots[0]!.layers.find((l) => l.id === layerId)!;
    expect(characterNodeCompositeKeyEasing(layer, 'face', 0)).toBe('step');
    expect(
      characterNodeMotionValues(current, { shotId, layerId, nodeId: 'face', timeMs: 250, autoKey: true })['transform.offsetX'],
    ).toBe(12);

    // Terminal key cannot set easing
    expect(() =>
      service.setCompositeKeyEasing(current, {
        shotId,
        layerId,
        nodeId: 'face',
        timeMs: 1_000,
        interpolationToNext: 'ease-in',
      }),
    ).toThrow('补间');

    // Batch retime atomic validation: crossing unselected / target 0ms / out-of-shot rejected atomically
    expect(() =>
      service.retimeCompositeKeys(current, {
        shotId,
        layerId,
        nodeId: 'face',
        fromTimesMs: [1_000],
        deltaMs: -750,
      }),
    ).toThrow('越过');
    expect(() =>
      service.retimeCompositeKeys(current, {
        shotId,
        layerId,
        nodeId: 'face',
        fromTimesMs: [500, 1_000],
        deltaMs: -500,
      }),
    ).toThrow('0 秒');

    // Valid batch shift of [500, 1000] by +250ms -> [750, 1250]
    current = service.retimeCompositeKeys(current, {
      shotId,
      layerId,
      nodeId: 'face',
      fromTimesMs: [500, 1_000],
      deltaMs: 250,
    });
    layer = current.shots[0]!.layers.find((l) => l.id === layerId)!;
    expect(characterNodeCompositeKeyTimes(layer, 'face')).toEqual([0, 750, 1_250]);

    // Copy pose at 750ms and paste at 1500ms -> evaluated pose matches identically
    const copied = characterNodeMotionValues(current, {
      shotId,
      layerId,
      nodeId: 'face',
      timeMs: 750,
      autoKey: true,
    });
    current = service.pasteCompositePose(current, {
      shotId,
      layerId,
      nodeId: 'face',
      targetTimeMs: 1_500,
      pose: copied,
    });
    expect(
      characterNodeMotionValues(current, { shotId, layerId, nodeId: 'face', timeMs: 1_500, autoKey: true }),
    ).toEqual(copied);

    // 0ms protected from deletion; non-0ms deletes cleanly
    expect(() =>
      service.deleteCompositeKey(current, { shotId, layerId, nodeId: 'face', timeMs: 0 }),
    ).toThrow('0 秒');
    current = service.deleteCompositeKey(current, { shotId, layerId, nodeId: 'face', timeMs: 1_500 });
    layer = current.shots[0]!.layers.find((l) => l.id === layerId)!;
    expect(characterNodeCompositeKeyTimes(layer, 'face')).toEqual([0, 750, 1_250]);
  });

  it.each(['image', 'graphic'] as const)(
    'renders %s Face identically across Editor, Product Preview, Export, Expression switch, Mouth, and HeadGroup',
    (faceKind) => {
      const { project: baseProject, shotId, layerId, characterId } = compositeMotionProject({
        faceKind,
        head: true,
      });
const AUDIO_ASSET_ID = '10000000-0000-4000-8000-000000000096';
const AUDIO_CLIP_ID = '83000000-0000-4000-8000-000000000001';
const DIALOGUE_ID = '82000000-0000-4000-8000-000000000001';

      // Add audio asset/clip, Expression switch [400ms, 2000ms], and active Dialogue [300ms, 900ms].
      // At 500ms: (500 - 300) % 320 = 200 >= 160 -> mouth closed (shows Expression switch).
      // At 650ms: (650 - 300) % 320 = 30 < 160 -> mouth OPEN!
      const withExpression = ProjectSchema.parse({
        ...baseProject,
        assets: [
          ...baseProject.assets,
          {
            id: AUDIO_ASSET_ID,
            kind: 'audio' as const,
            name: '对白音频',
            relativePath: 'voice.wav',
            mimeType: 'audio/wav',
            durationMs: 600,
          },
        ],
        shots: baseProject.shots.map((shot) => ({
          ...shot,
          audioClips: [
            {
              id: AUDIO_CLIP_ID,
              name: '对白',
              assetId: AUDIO_ASSET_ID,
              role: 'dialogue' as const,
              startMs: 300,
              endMs: 900,
              offsetMs: 0,
              volume: 1,
            },
          ],
          timelineEvents: [
            {
              id: '81000000-0000-4000-8000-000000000001',
              layerId,
              type: 'expression' as const,
              startMs: 400,
              endMs: 2_000,
              expressionId: IDS.expressionAngry,
            },
          ],
          dialogues: [
            {
              id: DIALOGUE_ID,
              characterId,
              voiceProfileId: IDS.voiceProfile,
              subtitleStyleId: IDS.subtitle,
              audioClipId: AUDIO_CLIP_ID,
              text: '你好世界',
              startMs: 300,
              endMs: 900,
            },
          ],
        })),
      });

      const authored = service.apply(
        withExpression,
        { shotId, layerId, nodeId: 'face', timeMs: 500, autoKey: true },
        {
          'transform.offsetX': 48,
          'transform.offsetY': -28,
          'transform.rotationDeg': 35,
          'transform.scaleX': 1.8,
          'transform.scaleY': 1.8,
        },
      );
      const shot = authored.shots[0]!;

      for (const seekMs of [0, 500] as const) {
        const activeDialogueId = seekMs === 500 ? DIALOGUE_ID : null;
        const readyIds = new Set(authored.assets.map((asset) => asset.id));
        const editorModel = buildEditorTemporalCanvasModel({
          project: authored,
          shot,
          currentTimeMs: seekMs,
          activeDialogueId,
          readyAssetIds: readyIds,
          missingAssetIds: new Set(),
          previousVisuals: new Map(),
        });
        const editorVisual = editorModel.visualsByLayer.get(layerId)!;

        const previewShot = projectProductPreviewDialogue(
          authored,
          shot,
          evaluateShotAtTime(shot, seekMs, authored),
          activeDialogueId,
        );
        const previewEvaluated = previewShot.layers.find((entry) => entry.id === layerId)!;
        const previewVisual = resolveLayerVisualParts(authored, shot, previewEvaluated, seekMs);

        const exportShot = evaluateExportShotAtTime(authored, shot, seekMs, activeDialogueId);
        const exportEvaluated = exportShot.layers.find((entry) => entry.id === layerId)!;
        const exportVisual = resolveLayerVisualParts(authored, shot, exportEvaluated, seekMs);

        expect(previewVisual).toEqual(exportVisual);
        if (seekMs > 0) {
          expect(editorVisual).toEqual(exportVisual);
        } else {
          // At 0:00 Editor keeps base Face without Mouth/HeadGroup dialogue oscillation, with exact 0ms pose.
          expect(editorVisual.facePlacement).toEqual({
            offsetX: 12,
            offsetY: -8,
            scale: 1.2,
            rotationDeg: 15,
            flipX: false,
          });
        }

        const facePart = exportVisual.parts.find((part) => part.slot === 'face')!;
        expect(exportVisual.headGroup?.partIds).toContain(facePart.partId);
        if (seekMs === 500) {
          // Expression switched at 400ms; mouth closed at 500ms while headGroup animates.
          expect(exportVisual.activeFace?.currentExpressionId).toBe(IDS.expressionAngry);
          expect(exportVisual.facePlacement).toMatchObject({
            offsetX: 48,
            offsetY: -28,
            rotationDeg: 35,
            flipX: false,
          });
          expect(exportVisual.facePlacement?.scale).toBeCloseTo(1.8, 10);
          expect(exportVisual.headGroup?.transform).toBeDefined();
          if (faceKind === 'graphic') {
            expect(facePart.source).toEqual({
              kind: 'character-face-fla-graphic',
              animationId: FACE_GRAPHIC_ID,
              firstFrame: 2,
            });
          } else {
            expect(facePart.source).toEqual({
              kind: 'character-expression',
              expressionId: IDS.expressionAngry,
              assetId: IDS.assetChar2,
            });
          }
        } else if (faceKind === 'graphic') {
          expect(facePart.source.kind).toBe('character-face-fla-graphic');
          if (facePart.source.kind === 'character-face-fla-graphic') {
            expect(facePart.source.animationId).toBe(FACE_GRAPHIC_ID);
          }
          expect(facePart.imageTransform).toBeDefined();
        }
      }

      // Verify Dialogue Mouth Open at 650ms preserves animated Face Pose identically across Editor, Preview, and Export.
      {
        const timeMs = 650;
        const readyIds = new Set(authored.assets.map((asset) => asset.id));
        const editorMouthModel = buildEditorTemporalCanvasModel({
          project: authored,
          shot,
          currentTimeMs: timeMs,
          activeDialogueId: DIALOGUE_ID,
          readyAssetIds: readyIds,
          missingAssetIds: new Set(),
          previousVisuals: new Map(),
        });
        const previewMouthShot = projectProductPreviewDialogue(
          authored,
          shot,
          evaluateShotAtTime(shot, timeMs, authored),
          DIALOGUE_ID,
        );
        const previewMouthVisual = resolveLayerVisualParts(authored, shot, previewMouthShot.layers.find((e) => e.id === layerId)!, timeMs);
        const exportMouthShot = evaluateExportShotAtTime(authored, shot, timeMs, DIALOGUE_ID);
        const exportMouthVisual = resolveLayerVisualParts(authored, shot, exportMouthShot.layers.find((e) => e.id === layerId)!, timeMs);
        expect(previewMouthVisual).toEqual(exportMouthVisual);
        expect(editorMouthModel.visualsByLayer.get(layerId)).toEqual(exportMouthVisual);
        expect(exportMouthVisual.activeFace?.source).toBe('mouth');
        const mouthPart = exportMouthVisual.parts.find((part) => part.slot === 'face')!;
        expect(mouthPart.source).toEqual({ kind: 'character-mouth', assetId: MOUTH_ASSET_ID });
        expect(mouthPart.rotationDeg).toBeCloseTo(35, 8);
        expect(mouthPart.localRect.width).toBeCloseTo(120 * 1.8, 8);
        expect(mouthPart.localRect.height).toBeCloseTo(80 * 1.8, 8);
        expect(mouthPart.localRect.x + mouthPart.localRect.width / 2).toBeCloseTo(48, 8);
        expect(mouthPart.localRect.y + mouthPart.localRect.height / 2).toBeCloseTo(-28, 8);
      }

      // Check FLA Graphic Expression at 500ms WITHOUT mouth open projects animated affine transform on Graphic Face.
      if (faceKind === 'graphic') {
        const quietDialogueShot = { ...shot, dialogues: [] };
        const quietProject = { ...authored, shots: [quietDialogueShot] };
        const evaluated = evaluateShotAtTime(quietDialogueShot, 500, quietProject);
        const visual = resolveLayerVisualParts(
          quietProject,
          quietDialogueShot,
          evaluated.layers.find((entry) => entry.id === layerId)!,
          500,
        );
        const facePart = visual.parts.find((part) => part.slot === 'face')!;
        expect(visual.activeFace?.currentExpressionId).toBe(IDS.expressionAngry);
        expect(facePart.source).toEqual({
          kind: 'character-face-fla-graphic',
          animationId: FACE_GRAPHIC_ID,
          firstFrame: 2,
        });
        expect(visual.facePlacement).toMatchObject({
          offsetX: 48,
          offsetY: -28,
          rotationDeg: 35,
          flipX: false,
        });
        expect(visual.facePlacement?.scale).toBeCloseTo(1.8, 10);
        expect(facePart.imageTransform?.tx).toBeDefined();
      }
    },
  );
});
