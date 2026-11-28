import { describe, expect, it } from 'vitest';
import {
  CharacterBoneService,
  CharacterVectorSkinService,
  LayerService,
  ProjectSchema,
  applyVectorSkinPoint,
  characterBonePoseMap,
  createCharacterPartAnimationClip,
  evaluateShotAtTime,
  measureFlaGraphicSubtreeBounds,
  resolveCharacterBoneTree,
  resolveLayerVisualParts,
  resolveVectorSkinWeights,
  transformPointByVisualPart,
  unionFlaShapeRegionBounds,
  vectorSkinBoneRestSegments,
  visualPartRenderTransform,
  type LayerVisualPart,
  type VectorSkinBoneSegment,
  type Project,
  type VectorSkinInfluence,
  type VisualLocalRect,
} from '../../src/domain';
import type { AffineMatrix2D } from '../../src/shared/affine-matrix';
import {
  VECTOR_SKIN_BONE_A_ID,
  VECTOR_SKIN_BONE_B_ID,
  VECTOR_SKIN_DEFINITION_ID,
  buildVectorSkinFixture,
  boneSegments,
  clipPointOfRegionPoint,
  evaluateVectorSkinVisual,
  firstContourAnchors,
  withVectorSkin,
  withVectorSkinClip,
  type VectorSkinFixture,
} from '../helpers/vectorSkinFixtures';

function posedProject(
  fixture: VectorSkinFixture,
  project: Project,
  poses: { readonly a?: number; readonly b?: number },
): Project {
  let next = withVectorSkinClip(project, fixture);
  const service = new CharacterBoneService();
  if (poses.a !== undefined) {
    next = service.applyBonePose(next, {
      shotId: fixture.shotId, layerId: fixture.layerId, boneId: VECTOR_SKIN_BONE_A_ID, timeMs: 1_000,
    }, { 'transform.rotationDeg': poses.a });
  }
  if (poses.b !== undefined) {
    next = service.applyBonePose(next, {
      shotId: fixture.shotId, layerId: fixture.layerId, boneId: VECTOR_SKIN_BONE_B_ID, timeMs: 1_000,
    }, { 'transform.rotationDeg': poses.b });
  }
  return next;
}

/** Character-space blended delta for one weight list. */
function blendToMatrix(
  weights: readonly VectorSkinInfluence[],
  poses: ReturnType<typeof evaluateVectorSkinVisual>['poses'],
): AffineMatrix2D {
  let blend: AffineMatrix2D = { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 };
  let total = 0;
  for (const { boneId, weight } of weights) {
    const delta = poses.get(boneId)?.delta;
    if (!delta) continue;
    blend = {
      a: blend.a + weight * delta.a,
      b: blend.b + weight * delta.b,
      c: blend.c + weight * delta.c,
      d: blend.d + weight * delta.d,
      tx: blend.tx + weight * delta.tx,
      ty: blend.ty + weight * delta.ty,
    };
    total += weight;
  }
  return total > 0 ? {
    a: blend.a / total, b: blend.b / total, c: blend.c / total, d: blend.d / total,
    tx: blend.tx / total, ty: blend.ty / total,
  } : { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
}

/** Character-space blended delta the skin should apply to an anchor at rest. */
function expectedRestDeform(
  poses: ReturnType<typeof evaluateVectorSkinVisual>['poses'],
  segments: readonly VectorSkinBoneSegment[],
  point: { x: number; y: number },
): { point: { x: number; y: number }; weights: readonly VectorSkinInfluence[] } {
  const weights = resolveVectorSkinWeights({
    point,
    segments,
  });
  return { point: applyVectorSkinPoint(blendToMatrix(weights, poses), point), weights };
}

function expectClosePoint(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
  digits = 9,
): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

describe('two-Bone vector skin rest pose', () => {
  it('keeps the authored geometry exactly and reports the inspected anchors', () => {
    const fixture = buildVectorSkinFixture();
    const skinned = withVectorSkin(fixture);
    const project = withVectorSkinClip(skinned.project, fixture);
    const { part, sleeveRegion } = evaluateVectorSkinVisual(project, fixture, 0);
    expect(part.vectorSkin).toBeDefined();
    expect(part.vectorSkin!.deformed).toBe(false);
    // 7 contour anchors plus 2 stroke anchors, 2 quadratic controls.
    expect(part.vectorSkin!.anchorCount).toBe(9);
    expect(part.vectorSkin!.pointCount).toBe(11);
    expect(part.vectorSkin!.fallback).toBeUndefined();
    // Authored geometry is untouched bit for bit.
    expect(JSON.stringify(sleeveRegion)).toBe(JSON.stringify(fixture.region));
    // A rest-pose skin also leaves the untouched bitmap Part exactly as authored.
    const unskinned = withVectorSkinClip(fixture.project, fixture);
    const baseline = evaluateVectorSkinVisual(unskinned, fixture, 0);
    expect(baseline.part.flaGraphic).toBeDefined();
    expect(JSON.stringify(part.flaGraphic)).toBe(JSON.stringify(baseline.part.flaGraphic));
    expect(JSON.stringify(evaluateVectorSkinVisual(project, fixture, 0).imagePart.imageTransform))
      .toBe(JSON.stringify(baseline.imagePart.imageTransform));
  });
});

describe('two-Bone vector skin deformation', () => {
  it('deforms continuously between two Bone poses, both Bones influencing their anchors', () => {
    const fixture = buildVectorSkinFixture();
    const skinned = withVectorSkin(fixture);
    const project = posedProject(fixture, skinned.project, { a: 30, b: -10 });
    const segments = [...boneSegments(project, fixture).values()];
    const restRegion = fixture.region;

    const at0 = evaluateVectorSkinVisual(project, fixture, 0);
    expect(at0.part.vectorSkin!.deformed).toBe(false);

    const at1000 = evaluateVectorSkinVisual(project, fixture, 1_000);
    expect(at1000.part.vectorSkin!.deformed).toBe(true);
    const anchorsAt1000 = firstContourAnchors(at1000.sleeveRegion);
    const anchorsRest = firstContourAnchors(restRegion);
    expect(anchorsAt1000).toHaveLength(anchorsRest.length);
    // Every deformed anchor equals the weighted blend of the two Character-space
    // Bone deltas applied to the authored anchor.
    for (let index = 0; index < anchorsRest.length; index += 1) {
      const expected = expectedRestDeform(at1000.poses, segments, anchorsRest[index]!);
      expectClosePoint(anchorsAt1000[index]!, expected.point);
    }
    // Top anchors follow Bone A alone (Bone B is far below the faint threshold).
    expect(expectedRestDeform(at1000.poses, segments, { x: 100, y: 0 }).weights)
      .toEqual([{ boneId: VECTOR_SKIN_BONE_A_ID, weight: 1 }]);
    // Bottom anchors follow Bone B alone.
    expect(expectedRestDeform(at1000.poses, segments, { x: 0, y: 100 }).weights)
      .toEqual([{ boneId: VECTOR_SKIN_BONE_B_ID, weight: 1 }]);
    // Middle anchors blend both Bones, so both really do influence the outline.
    const middle = expectedRestDeform(at1000.poses, segments, { x: 1, y: 50 });
    expect(middle.weights).toHaveLength(2);
    expect(new Set(middle.weights.map(({ boneId }) => boneId)))
      .toEqual(new Set([VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_B_ID]));
    // Bone A's top anchors rotated by its authored 30 degrees around its joint.
    const topAnchor = anchorsAt1000[0]!;
    const rotated = applyVectorSkinPoint(at1000.poses.get(VECTOR_SKIN_BONE_A_ID)!.delta!, { x: 0, y: 0 });
    expectClosePoint(topAnchor, rotated);
    // Fully deforming Bone B moves its bottom anchors; a rest-only Bone A does not.
    const bottom = anchorsAt1000[3]!;
    expect(Math.hypot(bottom.x - 100, bottom.y - 100)).toBeGreaterThan(1);

    // Half way the outline sits between the two authored poses (continuous, not snapped).
    const at500 = evaluateVectorSkinVisual(project, fixture, 500);
    expect(at500.part.vectorSkin!.deformed).toBe(true);
    const halfTop = firstContourAnchors(at500.sleeveRegion)[0]!;
    const distanceRest = Math.hypot(halfTop.x - 0, halfTop.y - 0);
    const distanceFull = Math.hypot(topAnchor.x, topAnchor.y);
    expect(distanceRest).toBeGreaterThan(0.5);
    expect(distanceRest).toBeLessThan(distanceFull);
  });

  it('keeps curve handles on their anchors’ blended matrices', () => {
    const fixture = buildVectorSkinFixture();
    const skinned = withVectorSkin(fixture);
    const project = posedProject(fixture, skinned.project, { a: 30, b: -10 });
    const segments = [...boneSegments(project, fixture).values()];
    const at1000 = evaluateVectorSkinVisual(project, fixture, 1_000);
    const restCommands = fixture.region.contours[0]!.commands;
    const posedCommands = at1000.sleeveRegion.contours[0]!.commands;
    const quadIndex = restCommands.findIndex((command) => command.type === 'Q');
    expect(quadIndex).toBeGreaterThan(0);
    const quadRest = restCommands[quadIndex]!;
    if (quadRest.type !== 'Q') throw new Error('Expected a quadratic command.');
    const posedQuad = posedCommands[quadIndex]!;
    if (posedQuad.type !== 'Q') throw new Error('Expected a deformed quadratic command.');
    // The control follows the mean of the previous and the current anchor matrix,
    // so the handle is never resolved from its own position and cannot detach.
    const previousRest = restCommands[quadIndex - 1]!;
    if (previousRest.type === 'Z') throw new Error('Unexpected close command.');
    const restPoint = { x: quadRest.cx, y: quadRest.cy };
    const previousWeights = expectedRestDeform(
      at1000.poses, segments, { x: previousRest.x, y: previousRest.y }).weights;
    const currentWeights = expectedRestDeform(
      at1000.poses, segments, { x: quadRest.x, y: quadRest.y }).weights;
    const fromPrevious = applyVectorSkinPoint(blendToMatrix(previousWeights, at1000.poses), restPoint);
    const fromCurrent = applyVectorSkinPoint(blendToMatrix(currentWeights, at1000.poses), restPoint);
    const mean = { x: 0.5 * (fromPrevious.x + fromCurrent.x), y: 0.5 * (fromPrevious.y + fromCurrent.y) };
    expectClosePoint({ x: posedQuad.cx, y: posedQuad.cy }, mean);
    // The control's own position would weight differently, so resolving handles
    // independently would visibly detach them from the outline.
    const own = applyVectorSkinPoint(
      blendToMatrix(expectedRestDeform(at1000.poses, segments, restPoint).weights, at1000.poses),
      restPoint,
    );
    expect(Math.hypot(posedQuad.cx - own.x, posedQuad.cy - own.y)).toBeGreaterThan(1e-6);
    // Every anchor keeps matching counts so no segment can detach or collapse.
    expect(posedCommands).toHaveLength(restCommands.length);
    for (let index = 0; index < posedCommands.length; index += 1) {
      expect(posedCommands[index]!.type).toBe(restCommands[index]!.type);
    }
  });

  it('deforms two instances of the same Character independently', () => {
    const fixture = buildVectorSkinFixture();
    const skinned = withVectorSkin(fixture);
    const created = new LayerService().createFromAdaptiveCharacter(
      skinned.project,
      fixture.shotId,
      fixture.characterId,
      { x: 1_100, y: 450 },
    );
    const secondLayerId = created.layer.id;
    let project = withVectorSkinClip(created.project, fixture);
    const secondClip = createCharacterPartAnimationClip(project, fixture.shotId, secondLayerId);
    project = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) => shot.id === fixture.shotId
        ? {
            ...shot,
            layers: shot.layers.map((layer) => layer.id === secondLayerId
              ? { ...layer, animationClip: secondClip }
              : layer),
          }
        : shot),
    });
    project = posedProject(fixture, project, { a: 30 });
    project = new CharacterBoneService().applyBonePose(project, {
      shotId: fixture.shotId, layerId: secondLayerId, boneId: VECTOR_SKIN_BONE_A_ID, timeMs: 1_000,
    }, { 'transform.rotationDeg': -20 });

    const shot = project.shots[0]!;
    const firstEvaluated = evaluateShotAtTime(shot, 1_000, project)
      .layers.find(({ id }) => id === fixture.layerId)!;
    const secondEvaluated = evaluateShotAtTime(shot, 1_000, project)
      .layers.find(({ id }) => id === secondLayerId)!;
    const firstVisual = resolveLayerVisualParts(project, shot, firstEvaluated, 1_000);
    const secondVisual = resolveLayerVisualParts(project, shot, secondEvaluated, 1_000);
    const regionOf = (visual: typeof firstVisual) => visual.parts.find((candidate) =>
      candidate.source.kind === 'adaptive-part-fla-graphic' &&
      candidate.source.characterPartId === fixture.sleevePartId)!.flaGraphic!
      .layers!.flatMap((layer) => layer.nodes).find((node) => node.vectorVisual)!.vectorVisual!
      .regions[0]!;
    const firstAnchors = firstContourAnchors(regionOf(firstVisual));
    const secondAnchors = firstContourAnchors(regionOf(secondVisual));
    expect(JSON.stringify(firstAnchors)).not.toBe(JSON.stringify(secondAnchors));
    // Each instance keeps its own rigid Layer placement.
    const firstPart = firstVisual.parts.find((candidate) =>
      candidate.source.kind === 'adaptive-part-fla-graphic' &&
      candidate.source.characterPartId === fixture.sleevePartId)!;
    const secondPart = secondVisual.parts.find((candidate) =>
      candidate.source.kind === 'adaptive-part-fla-graphic' &&
      candidate.source.characterPartId === fixture.sleevePartId)!;
    expect(firstPart.ownerLayerId).toBe(fixture.layerId);
    expect(secondPart.ownerLayerId).toBe(secondLayerId);
  });

  it('is deterministic under random seek and survives save/reopen', () => {
    const fixture = buildVectorSkinFixture();
    const skinned = withVectorSkin(fixture);
    const project = posedProject(fixture, skinned.project, { a: 30, b: -10 });
    const regionAt = (source: Project, timeMs: number) =>
      JSON.stringify(evaluateVectorSkinVisual(source, fixture, timeMs).sleeveRegion);
    const firstSeek = [350, 700, 120].map((timeMs) => regionAt(project, timeMs));
    const secondSeek = [120, 350, 700].map((timeMs) => regionAt(project, timeMs));
    expect(secondSeek).toEqual([firstSeek[2], firstSeek[0], firstSeek[1]]);

    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(project)));
    expect(regionAt(reopened, 500)).toBe(regionAt(project, 500));
    expect(regionAt(reopened, 1_000)).toBe(regionAt(project, 1_000));
    // The persisted skin carries no rest geometry, only the binding.
    const character = reopened.characters.find(({ id }) => id === fixture.characterId)!;
    if (character.mode !== 'adaptive-parts') throw new Error('Expected adaptive parts.');
    expect(character.vectorSkins).toEqual([{
      id: skinned.skin.id,
      partId: fixture.sleevePartId,
      boneIds: [VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_B_ID],
    }]);
  });
});

describe('two-Bone vector skin local fallback', () => {
  it('falls back locally when a Bone disappeared while other Parts stay correct', () => {
    const fixture = buildVectorSkinFixture();
    const skinned = withVectorSkin(fixture);
    const project = posedProject(fixture, skinned.project, { a: 30 });
    const character = project.characters.find(({ id }) => id === fixture.characterId)!;
    if (character.mode !== 'adaptive-parts') throw new Error('Expected adaptive parts.');
    // Simulate a dangling reference (only reachable through legacy/corrupt data).
    const broken = {
      ...project,
      characters: project.characters.map((candidate) => candidate.id === character.id
        ? { ...character, bones: character.bones!.filter(({ id }) => id !== VECTOR_SKIN_BONE_B_ID) }
        : candidate),
    } as Project;
    const { part, imagePart } = evaluateVectorSkinVisual(broken, fixture, 1_000);
    expect(part.vectorSkin!.fallback).toBe('missing-bone');
    expect(part.vectorSkin!.deformed).toBe(false);
    // The broken Part falls back to its authored visual, not the posed one.
    const restBaseline = evaluateVectorSkinVisual(withVectorSkinClip(fixture.project, fixture), fixture, 0);
    expect(JSON.stringify(part.flaGraphic)).toBe(JSON.stringify(restBaseline.part.flaGraphic));
    // The untouched bitmap Part still evaluates exactly like the unskinned Character.
    const unskinned = withVectorSkinClip(fixture.project, fixture);
    const baseline = evaluateVectorSkinVisual(unskinned, fixture, 1_000);
    expect(JSON.stringify(imagePart.imageTransform)).toBe(JSON.stringify(baseline.imagePart.imageTransform));
  });

  it('falls back locally when the Part visual has no vector content', () => {
    const fixture = buildVectorSkinFixture();
    const skinned = withVectorSkin(fixture);
    const project = posedProject(fixture, skinned.project, { a: 30 });
    // Simulate a Definition whose authored vector override disappeared, e.g. a
    // legacy or partially recovered import: the Part still resolves but renders
    // no vector leaf, so only this skin may degrade.
    const broken = {
      ...project,
      animations: project.animations.map((animation) =>
        animation.id === VECTOR_SKIN_DEFINITION_ID
          ? { ...animation, flaGraphicSharedShapeOverrides: undefined }
          : animation),
    } as Project;
    const shot = broken.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 1_000, broken)
      .layers.find(({ id }) => id === fixture.layerId)!;
    const visual = resolveLayerVisualParts(broken, shot, evaluated, 1_000);
    const part = visual.parts.find((candidate) =>
      candidate.source.kind === 'adaptive-part-fla-graphic' &&
      candidate.source.characterPartId === fixture.sleevePartId)!;
    const imagePart = visual.parts.find((candidate) =>
      candidate.source.kind === 'adaptive-part' &&
      candidate.source.characterPartId === fixture.imagePartId)!;
    expect(part.vectorSkin!.fallback).toBe('not-vector-content');
    expect(part.vectorSkin!.deformed).toBe(false);
    const baseline = withVectorSkinClip(fixture.project, fixture);
    expect(JSON.stringify(imagePart.imageTransform)).toBe(JSON.stringify(
      evaluateVectorSkinVisual(baseline, fixture, 0).imagePart.imageTransform));
  });

  it('falls back locally for gradient styles and reports the typed reason', () => {
    const fixture = buildVectorSkinFixture({ style: 'gradient' });
    // The schema accepts the binding; the style boundary degrades at evaluation time.
    const withSkin = ProjectSchema.parse({
      ...fixture.project,
      characters: fixture.project.characters.map((character) => character.id === fixture.characterId
        ? {
            ...character,
            vectorSkins: [{
              id: 'a5000000-0000-4000-8000-000000000001',
              partId: fixture.sleevePartId,
              boneIds: [VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_B_ID],
            }],
          }
        : character),
    });
    const project = posedProject(fixture, withSkin, { a: 30 });
    const { part, sleeveRegion } = evaluateVectorSkinVisual(project, fixture, 1_000);
    expect(part.vectorSkin!.fallback).toBe('non-solid-style');
    expect(part.vectorSkin!.deformed).toBe(false);
    expect(JSON.stringify(sleeveRegion)).toBe(JSON.stringify(fixture.region));
    // Creating the same binding through the service fails with the same reason locally.
    expect(() => new CharacterVectorSkinService({ createId: () => 'a5000000-0000-4000-8000-000000000003' }).create(
      removeVectorSkins(withSkin, fixture),
      fixture.characterId,
      { partId: fixture.sleevePartId, boneIds: [VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_B_ID] },
    )).toThrow('渐变或图案填充');
  });

  it('falls back locally for mixed bitmap content', () => {
    const fixture = buildVectorSkinFixture({ style: 'mixed-content' });
    const withSkin = ProjectSchema.parse({
      ...fixture.project,
      characters: fixture.project.characters.map((character) => character.id === fixture.characterId
        ? {
            ...character,
            vectorSkins: [{
              id: 'a5000000-0000-4000-8000-000000000002',
              partId: fixture.sleevePartId,
              boneIds: [VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_B_ID],
            }],
          }
        : character),
    });
    const { part } = evaluateVectorSkinVisual(posedProject(fixture, withSkin, { a: 30 }), fixture, 1_000);
    expect(part.vectorSkin!.fallback).toBe('mixed-content');
  });

  it('records LBS volume loss at large angles without non-finite geometry', () => {
    const fixture = buildVectorSkinFixture();
    const skinned = withVectorSkin(fixture);
    // Bone B inherits Bone A, so A=150 means the whole chain is twisted far past
    // the small-angle range the first slice targets.
    const project = posedProject(fixture, skinned.project, { a: 160, b: 160 });
    const at1000 = evaluateVectorSkinVisual(project, fixture, 1_000);
    const restAnchors = firstContourAnchors(fixture.region);
    const posedAnchors = firstContourAnchors(at1000.sleeveRegion);
    // Every number stays finite: a bad frame degrades visually, never numerically.
    for (const anchor of posedAnchors) {
      expect(Number.isFinite(anchor.x)).toBe(true);
      expect(Number.isFinite(anchor.y)).toBe(true);
    }
    // LBS collapses toward the averaged matrix at large relative angles; the
    // 50/50 middle anchors collapse hardest, which is the known slice boundary.
    const restMiddleA = restAnchors[2]!;
    const restMiddleB = restAnchors[5]!;
    const posedMiddleA = posedAnchors[2]!;
    const posedMiddleB = posedAnchors[5]!;
    const restSpan = Math.hypot(restMiddleB.x - restMiddleA.x, restMiddleB.y - restMiddleA.y);
    const posedSpan = Math.hypot(posedMiddleB.x - posedMiddleA.x, posedMiddleB.y - posedMiddleA.y);
    expect(restSpan).toBeCloseTo(100, 6);
    expect(posedSpan).toBeLessThan(restSpan * 0.5);
    expect(posedSpan).toBeGreaterThan(0);
  });

  it('keeps Parts without a skin byte-identical under a posed Bone tree', () => {
    const fixture = buildVectorSkinFixture();
    const project = posedProject(fixture, fixture.project, { a: 30, b: -10 });
    const { part, sleeveRegion } = evaluateVectorSkinVisual(project, fixture, 1_000);
    expect(part.vectorSkin).toBeUndefined();
    expect(JSON.stringify(sleeveRegion)).toBe(JSON.stringify(fixture.region));
    // Bone deltas of the (unskinned) Character never leak into a Part that has no skin.
    const rest = withVectorSkinClip(fixture.project, fixture);
    expect(JSON.stringify(evaluateVectorSkinVisual(project, fixture, 1_000).imagePart.imageTransform))
      .toBe(JSON.stringify(evaluateVectorSkinVisual(rest, fixture, 0).imagePart.imageTransform));
  });
});

function removeVectorSkins(project: Project, fixture: VectorSkinFixture): Project {
  return ProjectSchema.parse({
    ...project,
    characters: project.characters.map((character) => character.id === fixture.characterId
      ? { ...character, vectorSkins: undefined }
      : character),
  });
}

describe('two-Bone vector skin handle attachment helpers', () => {
  it('maps a deformed region point to the same Clip point the renderer contract expects', () => {
    const fixture = buildVectorSkinFixture();
    const skinned = withVectorSkin(fixture);
    const project = posedProject(fixture, skinned.project, { a: 30, b: -10 });
    const { part, sleeveRegion } = evaluateVectorSkinVisual(project, fixture, 1_000);
    const restPart = evaluateVectorSkinVisual(withVectorSkinClip(fixture.project, fixture), fixture, 0).part;
    const posedAnchor = firstContourAnchors(sleeveRegion)[0]!;
    const restAnchor = firstContourAnchors(fixture.region)[0]!;
    // The renderer draws region -> Clip through the Part transform; at rest this is
    // a pure translation by the frozen Character center, so the deformed Clip point
    // is the Character-space delta applied to the rest Character point.
    const posedClip = clipPointOfRegionPoint(part, posedAnchor);
    const restClip = clipPointOfRegionPoint(restPart, restAnchor);
    const clip = project.shots[0]!.layers.find(({ id }) => id === fixture.layerId)!.animationClip;
    if (clip?.version !== 1) throw new Error('Expected a Character Clip v1.');
    const center = clip.fixedCharacterCenter;
    const poses = new Map(
      evaluateShotAtTime(project.shots[0]!, 1_000, project)
        .layers.find(({ id }) => id === fixture.layerId)!.characterBonePose!
        .map((pose) => [pose.boneId, pose]),
    );
    const delta = poses.get(VECTOR_SKIN_BONE_A_ID)!.delta;
    const restCharacterPoint = { x: restClip.x + center.x, y: restClip.y + center.y };
    const posedCharacterPoint = applyVectorSkinPoint(delta, restCharacterPoint);
    const expected = { x: posedCharacterPoint.x - center.x, y: posedCharacterPoint.y - center.y };
    expectClosePoint(posedClip, expected);
    expect(part.vectorSkin!.deformed).toBe(true);
    // Sanity: the Character pose map is serialized exactly once per Layer.
    expect(characterBonePoseMap([...poses.values()]).size).toBe(2);
    expect(resolveCharacterBoneTree(adaptiveCharacter(project, fixture)).ok).toBe(true);
    expect(vectorSkinBoneRestSegments(adaptiveCharacter(project, fixture), poses).size).toBe(2);
  });
});

function adaptiveCharacter(project: Project, fixture: VectorSkinFixture) {
  const character = project.characters.find(({ id }) => id === fixture.characterId)!;
  if (character.mode !== 'adaptive-parts') throw new Error('Expected adaptive parts.');
  return character;
}

function rectContainsRect(outer: VisualLocalRect, inner: VisualLocalRect): boolean {
  const epsilon = 1e-6;
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.width <= outer.x + outer.width + epsilon &&
    inner.y + inner.height <= outer.y + outer.height + epsilon
  );
}

/**
 * Clip-space bounds of the drawable vector leaves, computed exactly like the
 * raster adapter: region bounds relative to the leaf base view box, through the
 * node world transform, the Graphic anchor, and the Part image transform.
 */
function vectorContentClipRect(part: LayerVisualPart): VisualLocalRect {
  const node = part.flaGraphic?.layers
    ?.flatMap((layer) => layer.nodes)
    .find((candidate) => candidate.vectorVisual);
  if (!part.flaGraphic || !part.imageTransform || !node?.vectorVisual) {
    throw new Error('Expected a structured vector Part.');
  }
  const bounds = unionFlaShapeRegionBounds(
    node.vectorVisual.regions,
    node.vectorVisual.residueStrokes,
  );
  if (!bounds) throw new Error('Expected drawable vector bounds.');
  const baseViewBox = node.vectorVisual.baseViewBox;
  const anchor = part.flaGraphic.anchor;
  const world = node.worldTransform;
  const transform = part.imageTransform;
  const left = bounds.x - baseViewBox.x;
  const top = bounds.y - baseViewBox.y;
  const points = [
    [left, top],
    [left + bounds.width, top],
    [left, top + bounds.height],
    [left + bounds.width, top + bounds.height],
  ].map(([x, y]) => {
    const graphicX = world.a * x! + world.c * y! + world.tx - anchor.x;
    const graphicY = world.b * x! + world.d * y! + world.ty - anchor.y;
    return {
      x: transform.a * graphicX + transform.c * graphicY + transform.tx,
      y: transform.b * graphicX + transform.d * graphicY + transform.ty,
    };
  });
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

describe('two-Bone vector skin deformed runtime bounds (#1471 R2)', () => {
  /** Sleeve + untouched bitmap Character with one skin and two authored Bone poses. */
  function deformedCharacter() {
    const fixture = buildVectorSkinFixture();
    const skinned = withVectorSkin(fixture);
    const project = posedProject(fixture, skinned.project, { a: 45, b: -30 });
    // Same Character/Clip without the skin: the pre-fix rest bounds baseline.
    const baselineProject = withVectorSkinClip(fixture.project, fixture);
    return { fixture, skinned, project, baselineProject };
  }

  function frameAt(
    project: Project,
    fixture: VectorSkinFixture,
    timeMs: number,
  ) {
    const shot = project.shots.find((candidate) => candidate.id === fixture.shotId)!;
    const evaluated = evaluateShotAtTime(shot, timeMs, project).layers.find(
      (candidate) => candidate.id === fixture.layerId,
    )!;
    const visual = resolveLayerVisualParts(project, shot, evaluated, timeMs);
    const part = visual.parts.find((candidate) =>
      candidate.source.kind === 'adaptive-part-fla-graphic' &&
      candidate.source.characterPartId === fixture.sleevePartId);
    const imagePart = visual.parts.find((candidate) =>
      candidate.source.kind === 'adaptive-part' &&
      candidate.source.characterPartId === fixture.imagePartId);
    if (!part || !imagePart) throw new Error('Expected both fixture Parts to resolve.');
    return { shot, evaluated, visual, part, imagePart };
  }

  function clipOf(project: Project, fixture: VectorSkinFixture) {
    const clip = project.shots
      .find((candidate) => candidate.id === fixture.shotId)!
      .layers.find((candidate) => candidate.id === fixture.layerId)!.animationClip;
    if (!clip || clip.version !== 1) throw new Error('Expected a Character Clip v1.');
    return clip;
  }

  it('threads the current deformed bounds into the composite bounds instead of clipping the sleeve', () => {
    const { fixture, project, baselineProject } = deformedCharacter();
    const rest = frameAt(project, fixture, 0);
    const baselineRest = frameAt(baselineProject, fixture, 0);

    // Deformed bounds update per frame, while every rest frame and the untouched
    // Part stay byte-identical to the pre-skin evaluation.
    expect(rest.part.vectorSkin!.deformed).toBe(false);
    expect(JSON.stringify(rest.part.localRect))
      .toBe(JSON.stringify(baselineRest.part.localRect));
    expect(JSON.stringify(rest.visual.combinedLocalBounds))
      .toBe(JSON.stringify(baselineRest.visual.combinedLocalBounds));

    for (const timeMs of [500, 750, 1_000]) {
      const frame = frameAt(project, fixture, timeMs);
      expect(frame.part.vectorSkin!.deformed).toBe(true);
      const measured = measureFlaGraphicSubtreeBounds(
        frame.part.flaGraphic!,
        project.assets,
      );
      expect(measured).not.toBeNull();
      const localRect = frame.part.localRect;
      expect(localRect.x).toBeCloseTo(measured!.x, 9);
      expect(localRect.y).toBeCloseTo(measured!.y, 9);
      expect(localRect.width).toBeCloseTo(measured!.width, 9);
      expect(localRect.height).toBeCloseTo(measured!.height, 9);
      // The swinging sleeve really leaves its authored rest box on two sides.
      expect(localRect.x).toBeLessThan(baselineRest.part.localRect.x);
      expect(localRect.y + localRect.height).toBeGreaterThan(
        baselineRest.part.localRect.y + baselineRest.part.localRect.height,
      );
      // The swinging sleeve really leaves its authored rest box in clip space.
      const content = vectorContentClipRect(frame.part);
      expect(content.x).toBeLessThan(baselineRest.visual.combinedLocalBounds.x);
      // The composite/effect bounds used by Stage, Preview, Export and Canvas
      // cover the complete deformed shape...
      expect(rectContainsRect(frame.visual.combinedLocalBounds, content)).toBe(true);
      // ...whereas the pre-fix rest-only bounds would have clipped it.
      expect(rectContainsRect(baselineRest.visual.combinedLocalBounds, content)).toBe(false);
      // The untouched bitmap Part keeps authored bounds and placement.
      expect(JSON.stringify(frame.imagePart.localRect))
        .toBe(JSON.stringify(baselineRest.imagePart.localRect));
      expect(JSON.stringify(frame.imagePart.imageTransform))
        .toBe(JSON.stringify(baselineRest.imagePart.imageTransform));
      // Fixed Character center, Part placement, and the hit/coordinate origin
      // stay exactly the authored ones: only the runtime bounds grow.
      expect(JSON.stringify(clipOf(project, fixture).fixedCharacterCenter))
        .toBe(JSON.stringify(clipOf(baselineProject, fixture).fixedCharacterCenter));
      expect(frame.evaluated.x).toBe(baselineRest.evaluated.x);
      expect(frame.evaluated.y).toBe(baselineRest.evaluated.y);
      expect(JSON.stringify(frame.part.imageTransform))
        .toBe(JSON.stringify(baselineRest.part.imageTransform));
      expect(JSON.stringify(visualPartRenderTransform(frame.part)))
        .toBe(JSON.stringify(visualPartRenderTransform(baselineRest.part)));
      expect(JSON.stringify(transformPointByVisualPart({ x: 0, y: 0 }, frame.part)))
        .toBe(JSON.stringify(transformPointByVisualPart({ x: 0, y: 0 }, baselineRest.part)));
    }
  });

  it('keeps rest data and the persisted definition unchanged across evaluation', () => {
    const { fixture, skinned, project } = deformedCharacter();
    const persisted = JSON.stringify(project);
    const characterBefore = JSON.stringify(adaptiveCharacter(project, fixture));
    const evaluatedFrames = [0, 500, 1_000].map((timeMs) => frameAt(project, fixture, timeMs));
    expect(evaluatedFrames.every((frame) => frame.visual.parts.length === 2)).toBe(true);
    // Evaluation is pure: it never rewrites persisted rest data or bindings.
    expect(JSON.stringify(project)).toBe(persisted);
    expect(JSON.stringify(adaptiveCharacter(project, fixture))).toBe(characterBefore);
    expect(adaptiveCharacter(project, fixture).vectorSkins).toEqual([{
      id: skinned.skin.id,
      partId: fixture.sleevePartId,
      boneIds: [VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_B_ID],
    }]);
    // A rest-pose frame without any Bone animation still keeps the authored
    // bounds bit for bit, so non-deformed frames cannot drift.
    const restFrame = frameAt(project, fixture, 0);
    expect(JSON.stringify(restFrame.part.localRect))
      .toBe(JSON.stringify(measureFlaGraphicSubtreeBounds(
        restFrame.part.flaGraphic!,
        project.assets,
      )));
  });

  it('keeps the deformed bounds deterministic under random seek and save/reopen', () => {
    const { fixture, project } = deformedCharacter();
    const times = [0, 250, 500, 750, 1_000];
    const boundsAt = (source: Project, order: readonly number[]) => new Map(
      order.map((timeMs) => {
        const frame = frameAt(source, fixture, timeMs);
        return [timeMs, JSON.stringify({
          localRect: frame.part.localRect,
          combined: frame.visual.combinedLocalBounds,
        })] as const;
      }),
    );
    const direct = boundsAt(project, times);
    const reversed = boundsAt(project, [...times].reverse());
    for (const timeMs of times) {
      expect(reversed.get(timeMs)).toBe(direct.get(timeMs));
    }
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(project)));
    const reopenedAt1000 = frameAt(reopened, fixture, 1_000);
    const originalAt1000 = frameAt(project, fixture, 1_000);
    expect(JSON.stringify(reopenedAt1000.part.localRect))
      .toBe(JSON.stringify(originalAt1000.part.localRect));
    expect(JSON.stringify(reopenedAt1000.visual.combinedLocalBounds))
      .toBe(JSON.stringify(originalAt1000.visual.combinedLocalBounds));
    expect(JSON.stringify(adaptiveCharacter(reopened, fixture).vectorSkins))
      .toBe(JSON.stringify(adaptiveCharacter(project, fixture).vectorSkins));
  });
});
