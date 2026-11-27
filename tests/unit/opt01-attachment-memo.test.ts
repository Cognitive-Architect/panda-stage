import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateShotAtTime,
  evaluatedLayerWorldMatrix,
  isFlaGraphicDefinition,
  layerAttachmentWorldMatrix,
  LayerService,
  projectShotDialogueVisual,
  ProjectSchema,
  resolveLayerAttachmentLocalMatrix,
  resolveLayerAttachmentTargets,
  setLayerDepth,
  type LayerAttachmentTarget,
  type Project,
} from '../../src/domain';
import * as evaluateFlaGraphicModule from '../../src/domain/evaluate-fla-graphic';
import * as characterPartAnimationModule from '../../src/domain/character-part-animation';
import { evaluateEditorCanvasShot } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { projectProductPreviewDialogue } from '../../src/renderer/shell/productPreviewModel';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';
import { multiplyAffineMatrices, type AffineMatrix2D } from '../../src/shared/affine-matrix';
import { addTestAnimation, characterPartAnimationFixture } from '../helpers/characterPartAnimationFixture';
import { characterActionGraphicFixture } from '../helpers/characterActionGraphicFixture';
import { IDS } from './domain/testProject';

function expectMatrix(actual: AffineMatrix2D, expected: AffineMatrix2D) {
  for (const key of Object.keys(expected) as (keyof AffineMatrix2D)[]) {
    expect(actual[key]).toBeCloseTo(expected[key], 8);
  }
}

function buildMultiNodeGraphicProject(): {
  project: Project;
  graphicId: string;
} {
  const base = characterActionGraphicFixture(false);
  const graphic = base.animations[0]!;
  if (!isFlaGraphicDefinition(graphic) || !graphic.structure) {
    throw new Error('Expected structured Graphic fixture.');
  }
  const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const translate = (tx: number, ty: number) => ({ a: 1, b: 0, c: 0, d: 1, tx, ty });
  const baseFrame = graphic.frames[0]!;
  const frameDurationMs = 250;
  graphic.source.sourceFps = 4;
  graphic.source.startFrameIndex = 0;
  graphic.source.endFrameIndex = 3;
  graphic.durationMs = frameDurationMs * 4;
  graphic.frames = [0, 1, 2, 3].map((ordinal) => ({
    ...baseFrame,
    ordinal,
    sourceFrameIndex: ordinal,
    startMs: ordinal * frameDurationMs,
    durationMs: frameDurationMs,
  }));
  graphic.structure.symbolDefinitions = {
    'arm-def': {
      symbolRef: 'Arm',
      sourceFrameCount: 1,
      children: [
        { type: 'bitmap', id: 'hand', sourceAddress: 'Arm/hand', bitmapRef: 'Hand', assetId: IDS.assetChar2, drawOrder: 0, localTransform: identity },
        { type: 'bitmap', id: 'wrist', sourceAddress: 'Arm/wrist', bitmapRef: 'Wrist', assetId: IDS.assetChar2, drawOrder: 1, localTransform: translate(20, -10) },
      ],
    },
  };
  graphic.structure.frames = [
    {
      ordinal: 0,
      layers: [{
        name: 'Rig',
        nodes: [
          { type: 'symbol', id: 'f0-left', sourceAddress: 'Rig/LeftArm', symbolRef: 'Arm', nestedDefinitionId: 'arm-def', drawOrder: 0, localTransform: translate(100, 100) },
          { type: 'symbol', id: 'f0-right', sourceAddress: 'Rig/RightArm', symbolRef: 'Arm', nestedDefinitionId: 'arm-def', drawOrder: 1, localTransform: translate(400, 120) },
          { type: 'bitmap', id: 'f0-badge', sourceAddress: 'Rig/Badge', bitmapRef: 'Badge', assetId: IDS.assetChar2, drawOrder: 2, localTransform: translate(250, 80) },
        ],
      }],
    },
    {
      ordinal: 1,
      layers: [{
        name: 'Rig',
        nodes: [
          { type: 'symbol', id: 'f1-left', sourceAddress: 'Rig/LeftArm', symbolRef: 'Arm', nestedDefinitionId: 'arm-def', drawOrder: 0, localTransform: translate(180, 150) },
          { type: 'symbol', id: 'f1-right', sourceAddress: 'Rig/RightArm', symbolRef: 'Arm', nestedDefinitionId: 'arm-def', drawOrder: 1, localTransform: translate(460, 90) },
          { type: 'bitmap', id: 'f1-badge', sourceAddress: 'Rig/Badge', bitmapRef: 'Badge', assetId: IDS.assetChar2, drawOrder: 2, localTransform: translate(290, 60) },
        ],
      }],
    },
    {
      ordinal: 2,
      layers: [{
        name: 'Rig',
        nodes: [
          // LeftArm disappears on frame 2; RightArm & Badge remain.
          { type: 'symbol', id: 'f2-right', sourceAddress: 'Rig/RightArm', symbolRef: 'Arm', nestedDefinitionId: 'arm-def', drawOrder: 0, localTransform: translate(520, 70) },
          { type: 'bitmap', id: 'f2-badge', sourceAddress: 'Rig/Badge', bitmapRef: 'Badge', assetId: IDS.assetChar2, drawOrder: 1, localTransform: translate(310, 50) },
        ],
      }],
    },
    {
      ordinal: 3,
      layers: [{
        name: 'Rig',
        nodes: [
          // LeftArm reappears on frame 3.
          { type: 'symbol', id: 'f3-left', sourceAddress: 'Rig/LeftArm', symbolRef: 'Arm', nestedDefinitionId: 'arm-def', drawOrder: 0, localTransform: translate(260, 190) },
          { type: 'symbol', id: 'f3-right', sourceAddress: 'Rig/RightArm', symbolRef: 'Arm', nestedDefinitionId: 'arm-def', drawOrder: 1, localTransform: translate(560, 40) },
          { type: 'bitmap', id: 'f3-badge', sourceAddress: 'Rig/Badge', bitmapRef: 'Badge', assetId: IDS.assetChar2, drawOrder: 2, localTransform: translate(350, 40) },
        ],
      }],
    },
  ];

  return {
    project: ProjectSchema.parse(base),
    graphicId: graphic.id,
  };
}

describe('OPT-01 (#1393): same-owner attachment target single-eval memo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('evaluates a Graphic owner once for 1 or 8 attached children (different targets, legacy nodePath, and missing targets with isolated fallbacks)', () => {
    const { project: seeded, graphicId } = buildMultiNodeGraphicProject();
    const service = new LayerService();
    const placed = service.createFromAnimation(seeded, IDS.shot, {
      animationId: graphicId,
      startTimeMs: 0,
      position: { x: 860, y: 500 },
      transform: { rotationDeg: 18, scaleX: 1.25, scaleY: 0.85, flipX: false },
    });
    const ownerId = placed.layer.id;
    let project = placed.project;

    const ownerAt0 = evaluateShotAtTime(project.shots[0]!, 0, project).layers.find(({ id }) => id === ownerId)!;
    const targets = resolveLayerAttachmentTargets(project, placed.layer, ownerAt0);
    const findTarget = (identityPath: string[]): LayerAttachmentTarget =>
      targets.find(
        ({ target }) =>
          target.kind === 'graphic-node' &&
          JSON.stringify(target.identityPath) === JSON.stringify(identityPath),
      )!.target;

    const leftHand = findTarget(['addr:Rig/LeftArm', 'addr:Arm/hand']);
    const leftWrist = findTarget(['addr:Rig/LeftArm', 'addr:Arm/wrist']);
    const rightHand = findTarget(['addr:Rig/RightArm', 'addr:Arm/hand']);
    const rightWrist = findTarget(['addr:Rig/RightArm', 'addr:Arm/wrist']);
    const badge = findTarget(['addr:Rig/Badge']);

    // 1-child baseline: bind IDS.layerAsset to leftHand.
    const oneChildProject = service.setParent(project, IDS.shot, IDS.layerAsset, ownerId, 0, leftHand);
    const graphicEvalSpy = vi.spyOn(evaluateFlaGraphicModule, 'evaluateFlaGraphicVisual');

    evaluateShotAtTime(oneChildProject.shots[0]!, 250, oneChildProject);
    expect(graphicEvalSpy).toHaveBeenCalledTimes(1);
    graphicEvalSpy.mockClear();

    // 8-child scenario on the SAME owner:
    // 5 valid identityPath targets, 1 legacy nodePath target (upgraded to addr:Rig/Badge),
    // and 2 missing-target children with distinct ownerLocalFallback matrices.
    project = oneChildProject;
    const childIds: string[] = [IDS.layerAsset];
    const extraTargets: Array<{ target: LayerAttachmentTarget; x: number; y: number }> = [
      { target: leftWrist, x: 300, y: 200 },
      { target: rightHand, x: 420, y: 240 },
      { target: rightWrist, x: 520, y: 280 },
      { target: badge, x: 600, y: 310 },
      { target: leftHand, x: 700, y: 350 }, // legacy nodePath will be injected on this child
      { target: rightHand, x: 760, y: 390 }, // missing target #1
      { target: leftWrist, x: 820, y: 430 }, // missing target #2
    ];
    for (const spec of extraTargets) {
      const dup = service.duplicateLayer(project, IDS.shot, IDS.layerAsset);
      const moved = service.updatePosition(dup.project, IDS.shot, dup.layer.id, { x: spec.x, y: spec.y });
      project = service.setParent(moved, IDS.shot, dup.layer.id, ownerId, 0, spec.target);
      childIds.push(dup.layer.id);
    }

    const legacyChildId = childIds[5]!;
    const missingChildAId = childIds[6]!;
    const missingChildBId = childIds[7]!;
    const fallbackA: AffineMatrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 111, ty: 22 };
    const fallbackB: AffineMatrix2D = { a: 1, b: 0, c: 0, d: 1, tx: -333, ty: 44 };

    project = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((layer) => {
          if (layer.id === legacyChildId && layer.parentAttachment) {
            return {
              ...layer,
              parentAttachment: {
                ...layer.parentAttachment,
                target: { kind: 'graphic-node' as const, nodePath: ['f0-badge'] },
              },
            };
          }
          if (layer.id === missingChildAId && layer.parentAttachment) {
            return {
              ...layer,
              parentAttachment: {
                ...layer.parentAttachment,
                target: { kind: 'graphic-node' as const, identityPath: ['addr:Rig/MissingA'] },
                ownerLocalFallback: fallbackA,
              },
            };
          }
          if (layer.id === missingChildBId && layer.parentAttachment) {
            return {
              ...layer,
              parentAttachment: {
                ...layer.parentAttachment,
                target: { kind: 'graphic-node' as const, identityPath: ['addr:Rig/MissingB'] },
                ownerLocalFallback: fallbackB,
              },
            };
          }
          return layer;
        }),
      })),
    });

    graphicEvalSpy.mockClear();
    const evaluatedAt250 = evaluateShotAtTime(project.shots[0]!, 250, project);
    // All 8 children share 1 single evaluateFlaGraphicVisual call for the owner!
    expect(graphicEvalSpy).toHaveBeenCalledTimes(1);

    // Verify world-matrix equivalence for every child against un-memoized reference resolution.
    const shot = project.shots[0]!;
    const authoredOwner = shot.layers.find(({ id }) => id === ownerId)!;
    const evalOwner = evaluatedAt250.layers.find(({ id }) => id === ownerId)!;
    for (const childId of childIds) {
      const authoredChild = shot.layers.find(({ id }) => id === childId)!;
      const evalChild = evaluatedAt250.layers.find(({ id }) => id === childId)!;
      const refTargetLocal = resolveLayerAttachmentLocalMatrix(
        project,
        authoredOwner,
        evalOwner,
        authoredChild.parentAttachment!.target,
      );
      const refTargetWorld = layerAttachmentWorldMatrix(
        evalOwner,
        refTargetLocal ?? authoredChild.parentAttachment!.ownerLocalFallback,
        evalOwner.parentSpace,
      );
      const refParentSpace = authoredChild.parentSpaceOffset
        ? multiplyAffineMatrices(refTargetWorld, authoredChild.parentSpaceOffset)
        : refTargetWorld;
      expectMatrix(evalChild.parentSpace!, refParentSpace);
    }

    // Legacy nodePath child resolved without fallback.
    expect(evaluatedAt250.layers.find(({ id }) => id === legacyChildId)?.parentAttachmentFallback).toBeUndefined();

    // Missing-target children each fell back to their OWN distinct ownerLocalFallback (never shared).
    const evalMissingA = evaluatedAt250.layers.find(({ id }) => id === missingChildAId)!;
    const evalMissingB = evaluatedAt250.layers.find(({ id }) => id === missingChildBId)!;
    expect(evalMissingA.parentAttachmentFallback).toBe(true);
    expect(evalMissingB.parentAttachmentFallback).toBe(true);
    expect(evalMissingA.parentSpace!.tx).not.toBeCloseTo(evalMissingB.parentSpace!.tx, 2);

    // Frame 2 (500ms): LeftArm disappears -> leftHand/leftWrist children fall back cleanly;
    // Frame 3 (750ms): LeftArm reappears -> tracking resumes accurately; 1 eval per frame.
    graphicEvalSpy.mockClear();
    const evalAt500 = evaluateShotAtTime(shot, 500, project);
    expect(graphicEvalSpy).toHaveBeenCalledTimes(1);
    expect(evalAt500.layers.find(({ id }) => id === IDS.layerAsset)?.parentAttachmentFallback).toBe(true);
    expect(evalAt500.layers.find(({ id }) => id === childIds[2]!)?.parentAttachmentFallback).toBeUndefined();

    graphicEvalSpy.mockClear();
    const evalAt750 = evaluateShotAtTime(shot, 750, project);
    expect(graphicEvalSpy).toHaveBeenCalledTimes(1);
    expect(evalAt750.layers.find(({ id }) => id === IDS.layerAsset)?.parentAttachmentFallback).toBeUndefined();
    expect(evaluatedLayerWorldMatrix(evalAt750.layers.find(({ id }) => id === IDS.layerAsset)!).tx).not.toBeCloseTo(
      evaluatedLayerWorldMatrix(evalAt500.layers.find(({ id }) => id === IDS.layerAsset)!).tx,
      2,
    );
  });

  it('keeps distinct owner Layer instances of the same Graphic asset completely isolated (1 eval per owner instance)', () => {
    const { project: seeded, graphicId } = buildMultiNodeGraphicProject();
    const service = new LayerService();

    // Owner A starts at 0ms (at t=250ms -> frame 1), hidden + explicit depth -200.
    const placedA = service.createFromAnimation(seeded, IDS.shot, {
      animationId: graphicId,
      startTimeMs: 0,
      position: { x: 500, y: 400 },
    });
    // Owner B references the SAME animationId, starts at 250ms (at t=250ms -> frame 0), different position/scale.
    const placedB = service.createFromAnimation(placedA.project, IDS.shot, {
      animationId: graphicId,
      startTimeMs: 250,
      position: { x: 1300, y: 600 },
      transform: { rotationDeg: -30, scaleX: 1.5, scaleY: 0.75, flipX: true },
    });
    let project = setLayerDepth(placedB.project, IDS.shot, placedA.layer.id, -200);
    // Hide Owner A to verify hidden-parent inheritance still works with per-owner lookup.
    project = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((layer) =>
          layer.id === placedA.layer.id ? { ...layer, visible: false } : layer,
        ),
      })),
    });

    const targetHand: LayerAttachmentTarget = {
      kind: 'graphic-node',
      identityPath: ['addr:Rig/LeftArm', 'addr:Arm/hand'],
    };
    const targetWrist: LayerAttachmentTarget = {
      kind: 'graphic-node',
      identityPath: ['addr:Rig/LeftArm', 'addr:Arm/wrist'],
    };

    // 2 children on Owner A, plus 1 grandchild under childA1; 2 children on Owner B.
    project = service.setParent(project, IDS.shot, IDS.layerAsset, placedA.layer.id, 250, targetHand);
    const childA2 = service.duplicateLayer(project, IDS.shot, IDS.layerAsset);
    project = service.setParent(childA2.project, IDS.shot, childA2.layer.id, placedA.layer.id, 250, targetWrist);
    const grandchildA = service.duplicateLayer(project, IDS.shot, IDS.layerAsset);
    project = service.setParent(grandchildA.project, IDS.shot, grandchildA.layer.id, IDS.layerAsset, 250);

    const childB1 = service.duplicateLayer(project, IDS.shot, IDS.layerAsset);
    project = service.setParent(childB1.project, IDS.shot, childB1.layer.id, placedB.layer.id, 250, targetHand);
    const childB2 = service.duplicateLayer(project, IDS.shot, IDS.layerAsset);
    project = service.setParent(childB2.project, IDS.shot, childB2.layer.id, placedB.layer.id, 250, targetWrist);

    const graphicEvalSpy = vi.spyOn(evaluateFlaGraphicModule, 'evaluateFlaGraphicVisual');
    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 250, project);

    // 2 distinct owners -> exactly 2 evaluateFlaGraphicVisual calls (NOT 1 shared by animationId, NOT 4 per child).
    expect(graphicEvalSpy).toHaveBeenCalledTimes(2);

    // Owner A is at frame 1 and Owner B is at frame 0; children move differently at t=500ms.
    graphicEvalSpy.mockClear();
    const at500 = evaluateShotAtTime(shot, 500, project);
    expect(graphicEvalSpy).toHaveBeenCalledTimes(2);

    const layerOf = (res: typeof evaluated, id: string) => res.layers.find((entry) => entry.id === id)!;
    // Hidden Owner A still propagates effectiveDepth -200 to child & grandchild.
    expect(layerOf(evaluated, IDS.layerAsset).effectiveDepth).toBe(-200);
    expect(layerOf(evaluated, grandchildA.layer.id).effectiveDepth).toBe(-200);
    // Owner A has LeftArm missing at frame 2 (t=500ms) while Owner B is on frame 1 (t=500ms) where LeftArm exists!
    expect(layerOf(at500, IDS.layerAsset).parentAttachmentFallback).toBe(true);
    expect(layerOf(at500, childB1.layer.id).parentAttachmentFallback).toBeUndefined();
  });

  it('preserves #1389 dynamic head attachment parity with separate caches before/after head motion and single part eval per owner', () => {
    const data = characterPartAnimationFixture();
    const service = new LayerService();
    const dialogueId = randomUUID();
    const animated = addTestAnimation(data.project, data.layerId, data.imagePartId, 'transform.offsetX', 80);

    const prop1 = service.updatePosition(animated, IDS.shot, IDS.layerAsset, { x: 500, y: 600 });
    const prop2 = service.duplicateLayer(prop1, IDS.shot, IDS.layerAsset);
    const prop3 = service.duplicateLayer(prop2.project, IDS.shot, IDS.layerAsset);
    const prop4 = service.duplicateLayer(prop3.project, IDS.shot, IDS.layerAsset);

    const voiceId = prop4.project.characters.find(({ id }) => id === data.characterId)!.defaultVoiceProfileId;
    let project = ProjectSchema.parse({
      ...prop4.project,
      characters: prop4.project.characters.map((character) =>
        character.id === data.characterId && character.mode === 'adaptive-parts'
          ? {
              ...character,
              headMotionBinding: { partIds: [data.imagePartId] },
              talkingHeadMotionIntensityPercent: 100,
            }
          : character,
      ),
      shots: prop4.project.shots.map((shot) =>
        shot.id === IDS.shot
          ? {
              ...shot,
              durationMs: 1_500,
              dialogues: [{
                id: dialogueId,
                characterId: data.characterId,
                voiceProfileId: voiceId,
                text: '头动多挂接测试',
                startMs: 0,
                endMs: 1_000,
                subtitleStyleId: shot.defaultSubtitleStyleId,
              }],
            }
          : shot,
      ),
    });

    const headTarget: LayerAttachmentTarget = { kind: 'character-part', partId: data.imagePartId };
    const nonHeadTarget: LayerAttachmentTarget = { kind: 'character-part', partId: data.graphicPartId };

    // Dynamic head attachments on 2 children + non-head attachment on 2 children (all on same character owner).
    project = service.setParentKey(project, IDS.shot, IDS.layerAsset, 250, data.layerId, { target: headTarget });
    project = service.setParentKey(project, IDS.shot, prop2.layer.id, 250, data.layerId, { target: headTarget });
    project = service.setParentKey(project, IDS.shot, prop3.layer.id, 250, data.layerId, { target: nonHeadTarget });
    project = service.setParentKey(project, IDS.shot, prop4.layer.id, 250, data.layerId, { target: nonHeadTarget });

    const partComposeSpy = vi.spyOn(characterPartAnimationModule, 'composeAnimatedCharacterPartTransform');
    const shot = project.shots[0]!;
    const character = project.characters.find(({ id }) => id === data.characterId)!;
    const partCount = character.mode === 'adaptive-parts' ? character.parts.length : 0;
    expect(partCount).toBeGreaterThan(0);

    // Single evaluateShotAtTime (pre-head-motion): evaluates character parts once for the owner, NOT 4x for 4 children.
    const base625 = evaluateShotAtTime(shot, 625, project);
    expect(partComposeSpy).toHaveBeenCalledTimes(partCount);
    partComposeSpy.mockClear();

    // projectShotDialogueVisual runs a second, independent applyLayerParenting with headGroupTransform (-4, -4).
    const projected625 = projectShotDialogueVisual(project, shot, base625, dialogueId);
    expect(partComposeSpy).toHaveBeenCalledTimes(partCount);

    const layerOf = (res: typeof projected625, id: string) => res.layers.find((entry) => entry.id === id)!;
    const headBaseWorld = evaluatedLayerWorldMatrix(layerOf(base625, IDS.layerAsset));
    const headBase2World = evaluatedLayerWorldMatrix(layerOf(base625, prop2.layer.id));
    const headProjWorld = evaluatedLayerWorldMatrix(layerOf(projected625, IDS.layerAsset));
    const headProj2World = evaluatedLayerWorldMatrix(layerOf(projected625, prop2.layer.id));
    const nonHeadBaseWorld = evaluatedLayerWorldMatrix(layerOf(base625, prop3.layer.id));
    const nonHeadProjWorld = evaluatedLayerWorldMatrix(layerOf(projected625, prop3.layer.id));

    // Head-attached children shift by (-4, -4) after head motion (proving pre-head cache was NOT reused).
    expect(headProjWorld.tx - headBaseWorld.tx).toBeCloseTo(-4, 6);
    expect(headProjWorld.ty - headBaseWorld.ty).toBeCloseTo(-4, 6);
    expect(headProj2World.tx - headBase2World.tx).toBeCloseTo(-4, 6);
    expect(headProj2World.ty - headBase2World.ty).toBeCloseTo(-4, 6);

    // Non-head-attached child does NOT shift with head motion.
    expectMatrix(nonHeadProjWorld, nonHeadBaseWorld);

    // Stage, Preview, and Export surfaces all agree identically.
    const editor625 = evaluateEditorCanvasShot(project, shot, 625, dialogueId);
    const preview625 = projectProductPreviewDialogue(project, shot, evaluateShotAtTime(shot, 625, project), dialogueId);
    const export625 = evaluateExportShotAtTime(project, shot, 625, dialogueId);
    for (const surface of [editor625, preview625, export625]) {
      expectMatrix(evaluatedLayerWorldMatrix(layerOf(surface, IDS.layerAsset)), headProjWorld);
      expectMatrix(evaluatedLayerWorldMatrix(layerOf(surface, prop3.layer.id)), nonHeadProjWorld);
    }

    // Random seek order yields identical matrices to sequential playback.
    const seq = [125, 250, 625, 875].map((t) =>
      evaluatedLayerWorldMatrix(layerOf(projectShotDialogueVisual(project, shot, evaluateShotAtTime(shot, t, project)), IDS.layerAsset)),
    );
    const rnd = [875, 125, 625, 250].map((t) =>
      evaluatedLayerWorldMatrix(layerOf(projectShotDialogueVisual(project, shot, evaluateShotAtTime(shot, t, project)), IDS.layerAsset)),
    );
    expectMatrix(rnd[1]!, seq[0]!);
    expectMatrix(rnd[3]!, seq[1]!);
    expectMatrix(rnd[2]!, seq[2]!);
    expectMatrix(rnd[0]!, seq[3]!);
  });
});
