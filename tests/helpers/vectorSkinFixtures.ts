import {
  CharacterVectorSkinService,
  FlaGraphicDefinitionSchema,
  LayerService,
  ProjectSchema,
  CharacterService,
  applyVectorSkinPoint,
  createCharacterPartAnimationClip,
  evaluateAnimationClipAtTime,
  evaluateCharacterBonePose,
  evaluateShotAtTime,
  resolveCharacterBoneTree,
  resolveLayerVisualParts,
  vectorSkinBoneRestSegments,
  vectorSkinClipDeltas,
  type AdaptivePartsCharacter,
  type CharacterBone,
  type CharacterPartTransform,
  type CharacterVectorSkin,
  type EvaluatedCharacterBonePose,
  type FlaEditableShapeRegion,
  type LayerVisualPart,
  type LayerVisualParts,
  type Project,
} from '../../src/domain';
import { adaptivePartsFixture } from './adaptivePartsFixtures';
import { IDS, buildProject } from '../unit/domain/testProject';
import { withBones } from './boneTreeFixtures';

/**
 * Fixture for the #1459 two-Bone vector skin slice: one native FLA Graphic
 * sleeve Shape (solid fill + solid stroke, optionally a gradient fill) plus one
 * untouched bitmap Part, driven by two Bones that span the sleeve vertically.
 *
 * Rest layout: the sleeve region lives in `0..100 x 0..100` in Part source
 * space, and the Part / Character root transforms are the identity, so a region
 * point is also its Character rest point. Bone A runs along `y = 20`, Bone B
 * along `y = 80`, so top anchors follow A, bottom anchors follow B, and middle
 * anchors blend both.
 */

export const VECTOR_SKIN_DEFINITION_ID = 'a1000000-0000-4000-8000-000000000001';
export const VECTOR_SKIN_SLEEVE_PART_ID = 'a2000000-0000-4000-8000-000000000001';
export const VECTOR_SKIN_BONE_A_ID = 'a3000000-0000-4000-8000-000000000001';
export const VECTOR_SKIN_BONE_B_ID = 'a3000000-0000-4000-8000-000000000002';
export const VECTOR_SKIN_IMAGE_PART_ID = adaptivePartsFixture(IDS.assetChar)[0]!.partId;

export type VectorSkinStyleVariant = 'solid' | 'gradient' | 'mixed-content';

const IDENTITY: CharacterPartTransform = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

/**
 * Sleeve outline: a closed polygon with mixed-weight anchors on both sides and
 * two quadratic hand-drawn edges so handle blending is exercised.
 */
export function vectorSleeveRegion(style: VectorSkinStyleVariant = 'solid'): FlaEditableShapeRegion {
  return {
    regionRef: 'reg-sleeve',
    fill: style === 'gradient'
      ? { kind: 'gradient-ref', opacity: 1, fillRule: 'nonzero', svgPaint: 'url(#sleeve-grad)' }
      : { kind: 'solid', color: '#33aa66', opacity: 1, fillRule: 'nonzero' },
    contours: [{
      closed: true,
      commands: [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 100, y: 0 },
        { type: 'L', x: 100, y: 50 },
        { type: 'Q', cx: 120, cy: 80, x: 100, y: 100 },
        { type: 'L', x: 0, y: 100 },
        { type: 'L', x: 0, y: 50 },
        { type: 'Q', cx: -20, cy: 80, x: 0, y: 0 },
        { type: 'Z' },
      ],
    }],
    strokes: [{
      color: '#112233',
      opacity: 1,
      lineWidth: 4,
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 4,
      closed: false,
      commands: [
        { type: 'M', x: 0, y: 50 },
        { type: 'L', x: 100, y: 50 },
      ],
    }],
    bounds: { x: -20, y: 0, width: 140, height: 100 },
  };
}

export function buildVectorSkinDefinition(style: VectorSkinStyleVariant = 'solid') {
  const frameDurationMs = 1_000 / 24;
  const shapeNode = (id: string) => ({
    type: 'opaque',
    id,
    authored: 'native',
    drawOrder: 0,
    localTransform: IDENTITY,
    opaqueKind: 'shape',
    fallbackScope: 'subtree',
    fallbackViewBox: { x: 0, y: 0, width: 100, height: 100 },
  });
  const bitmapNode = {
    type: 'bitmap',
    id: 'sleeve-photo',
    authored: 'native',
    drawOrder: 1,
    localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 40, ty: 40 },
    bitmapRef: 'photo.png',
    assetId: IDS.assetChar,
  };
  // A mixed subtree wraps the Shape and a bitmap in one group so the isolated
  // Part visual really contains both leaf kinds.
  const nodes = style === 'mixed-content'
    ? [{
        type: 'group',
        id: 'sleeve',
        authored: 'native',
        drawOrder: 0,
        localTransform: IDENTITY,
        groupId: 'sleeve-group',
        children: [shapeNode('sleeve-shape'), bitmapNode],
      }]
    : style === 'solid'
      ? [shapeNode('sleeve')]
      : [shapeNode('sleeve'), bitmapNode];
  const shapePath = style === 'mixed-content' ? ['sleeve', 'sleeve-shape'] : ['sleeve'];
  return FlaGraphicDefinitionSchema.parse({
    id: VECTOR_SKIN_DEFINITION_ID,
    name: '矢量袖子',
    kind: 'fla-graphic',
    source: {
      origin: 'native',
      targetKind: 'graphic-symbol',
      targetName: '矢量袖子',
      startFrameIndex: 0,
      endFrameIndex: 0,
      sourceFps: 24,
      canvas: { width: 100, height: 100 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 100, height: 100 },
    },
    durationMs: frameDurationMs,
    frames: [{
      ordinal: 0,
      sourceFrameIndex: 0,
      sourceViewport: { x: 0, y: 0, width: 100, height: 100 },
      offset: { x: 0, y: 0 },
      startMs: 0,
      durationMs: frameDurationMs,
      createdBySequenceImport: false,
    }],
    structure: {
      version: 1,
      frames: [{ ordinal: 0, layers: [{ name: '袖子', nodes }] }],
    },
    flaGraphicSharedShapeOverrides: {
      '0': {
        [JSON.stringify(shapePath)]: {
          baseViewBox: { x: 0, y: 0, width: 100, height: 100 },
          regions: [vectorSleeveRegion(style)],
          excludedRegionRefs: [],
          extractedRegions: [],
          ...(style === 'gradient'
            ? {
                sourceDefsSvg:
                  '<linearGradient id="sleeve-grad" x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#112233"/><stop offset="1" stop-color="#44aaff"/></linearGradient>',
              }
            : {}),
        },
      },
    },
  });
}

/** Two-Bone tree: A across the top half, B across the bottom half of the sleeve. */
export function vectorSkinBones(): CharacterBone[] {
  return [
    {
      id: VECTOR_SKIN_BONE_A_ID,
      name: '上臂',
      parentBoneId: null,
      restLocal: { x: 0, y: 20, rotationDeg: 0 },
      length: 100,
    },
    {
      id: VECTOR_SKIN_BONE_B_ID,
      name: '前臂',
      parentBoneId: VECTOR_SKIN_BONE_A_ID,
      restLocal: { x: 0, y: 60, rotationDeg: 0 },
      length: 100,
    },
  ];
}

export interface VectorSkinFixture {
  readonly project: Project;
  readonly shotId: string;
  readonly layerId: string;
  readonly characterId: string;
  readonly sleevePartId: string;
  readonly imagePartId: string;
  readonly boneIds: readonly [string, string];
  readonly region: FlaEditableShapeRegion;
}

/** Fixture with the sleeve + image Part Character and its two-Bone tree. */
export function buildVectorSkinFixture(options: {
  readonly style?: VectorSkinStyleVariant;
  readonly sourceRootTransform?: CharacterPartTransform;
  readonly sleeveRestTransform?: CharacterPartTransform;
  readonly withBones?: boolean;
} = {}): VectorSkinFixture {
  const style = options.style ?? 'solid';
  const sourceRootTransform = options.sourceRootTransform ?? IDENTITY;
  const sleeveRestTransform = options.sleeveRestTransform ?? IDENTITY;
  const base = buildProject();
  const project = ProjectSchema.parse({
    ...base,
    animations: [...base.animations, buildVectorSkinDefinition(style)],
  });
  const imageParts = adaptivePartsFixture(IDS.assetChar);
  const created = new CharacterService().createAdaptiveParts(project, {
    name: '蒙皮角色',
    sourceRootTransform,
    parts: [
      {
        partId: VECTOR_SKIN_SLEEVE_PART_ID,
        source: { kind: 'manual', sourceId: 'manual:sleeve' },
        visualSource: {
          kind: 'fla-graphic',
          animationId: VECTOR_SKIN_DEFINITION_ID,
          nodePath: ['sleeve'],
          poseFrameOrdinal: 0,
        },
        restTransform: sleeveRestTransform,
        sourceRestTransform: sleeveRestTransform,
        drawOrder: 0,
        visible: true,
        displayName: '袖子',
      },
      {
        ...imageParts[0]!,
        partId: VECTOR_SKIN_IMAGE_PART_ID,
        restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 300, ty: 0 },
        sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: 300, ty: 0 },
        drawOrder: 1,
      },
    ],
  });
  const character = created.characters.find(
    (candidate): candidate is AdaptivePartsCharacter =>
      candidate.mode === 'adaptive-parts' && candidate.name === '蒙皮角色',
  )!;
  const placement = new LayerService().createFromAdaptiveCharacter(
    created,
    IDS.shot,
    character.id,
    { x: 650, y: 450 },
  );
  const projectWithBones = options.withBones === false
    ? placement.project
    : withBones(placement.project, character.id, vectorSkinBones());
  return {
    project: projectWithBones,
    shotId: IDS.shot,
    layerId: placement.layer.id,
    characterId: character.id,
    sleevePartId: VECTOR_SKIN_SLEEVE_PART_ID,
    imagePartId: VECTOR_SKIN_IMAGE_PART_ID,
    boneIds: [VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_B_ID],
    region: vectorSleeveRegion(style),
  };
}

/** Fixture that additionally carries one persisted vector skin. */
export function withVectorSkin(
  fixture: VectorSkinFixture,
  boneIds: readonly [string, string] = fixture.boneIds,
): { readonly project: Project; readonly skin: CharacterVectorSkin } {
  const project = new CharacterVectorSkinService({
    createId: () => 'a4000000-0000-4000-8000-000000000001',
  }).create(
    fixture.project,
    fixture.characterId,
    { partId: fixture.sleevePartId, boneIds },
  );
  const character = adaptiveCharacterOfProject(project, fixture.characterId);
  return { project, skin: character.vectorSkins![0]! };
}

export function adaptiveCharacterOfProject(
  project: Project,
  characterId: string,
): AdaptivePartsCharacter {
  const character = project.characters.find((candidate) => candidate.id === characterId);
  if (!character || character.mode !== 'adaptive-parts') {
    throw new Error('Expected an adaptive-parts fixture Character.');
  }
  return character;
}

/** Adds the Character Animation Clip required for Bone pose evaluation. */
export function withVectorSkinClip(project: Project, fixture: VectorSkinFixture): Project {
  const clip = createCharacterPartAnimationClip(project, fixture.shotId, fixture.layerId);
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((shot) => shot.id === fixture.shotId
      ? {
          ...shot,
          layers: shot.layers.map((layer) =>
            layer.id === fixture.layerId ? { ...layer, animationClip: clip } : layer),
        }
      : shot),
  });
}

/** Evaluated Bone poses and visual Parts for one Shot time. */
export function evaluateVectorSkinVisual(
  project: Project,
  fixture: VectorSkinFixture,
  timeMs: number,
): {
  readonly visual: LayerVisualParts;
  readonly part: LayerVisualPart;
  readonly imagePart: LayerVisualPart;
  readonly poses: ReadonlyMap<string, EvaluatedCharacterBonePose>;
  readonly sleeveRegion: FlaEditableShapeRegion;
} {
  const shot = project.shots.find((candidate) => candidate.id === fixture.shotId)!;
  const evaluated = evaluateShotAtTime(shot, timeMs, project)
    .layers.find((candidate) => candidate.id === fixture.layerId)!;
  const visual = resolveLayerVisualParts(project, shot, evaluated, timeMs);
  const part = visual.parts.find((candidate) =>
    candidate.source.kind === 'adaptive-part-fla-graphic' &&
    candidate.source.characterPartId === fixture.sleevePartId);
  const imagePart = visual.parts.find((candidate) =>
    candidate.source.kind === 'adaptive-part' &&
    candidate.source.characterPartId === fixture.imagePartId);
  if (!part || !imagePart) throw new Error('Expected both fixture Parts to resolve.');
  const clip = shot.layers.find((candidate) => candidate.id === fixture.layerId)!.animationClip;
  if (!clip || clip.version !== 1) throw new Error('Expected a Character Clip v1.');
  const poses = evaluateCharacterBonePose({
    character: adaptiveCharacterOfProject(project, fixture.characterId),
    values: evaluateAnimationClipAtTime(clip, timeMs),
    layerId: fixture.layerId,
  });
  const vectorNode = (nodes: readonly { vectorVisual?: unknown; children: readonly unknown[] }[] | undefined): unknown => {
    for (const node of nodes ?? []) {
      if (node.vectorVisual) return node;
      const nested = vectorNode(node.children as readonly { vectorVisual?: unknown; children: readonly unknown[] }[]);
      if (nested) return nested;
    }
    return undefined;
  };
  const node = vectorNode(part.flaGraphic?.layers?.flatMap((layer) => layer.nodes)) as
    | { vectorVisual?: { regions: FlaEditableShapeRegion[] } }
    | undefined;
  const region = node?.vectorVisual?.regions[0];
  if (!region) throw new Error('Expected a deformed vector region.');
  return { visual, part, imagePart, poses, sleeveRegion: region };
}

/** Character-space rest head/end of both fixture Bones. */
export function boneSegments(project: Project, fixture: VectorSkinFixture) {
  const character = adaptiveCharacterOfProject(project, fixture.characterId);
  const clip = project.shots
    .find((candidate) => candidate.id === fixture.shotId)!
    .layers.find((candidate) => candidate.id === fixture.layerId)!.animationClip;
  if (!clip || clip.version !== 1) throw new Error('Expected a Character Clip v1.');
  const poses = evaluateCharacterBonePose({
    character,
    values: evaluateAnimationClipAtTime(clip, 0),
    layerId: fixture.layerId,
  });
  return vectorSkinBoneRestSegments(character, poses);
}

/** Clip-space delta of both fixture Bones at one Shot time. */
export function boneClipDeltas(
  project: Project,
  fixture: VectorSkinFixture,
  timeMs: number,
) {
  const { poses } = evaluateVectorSkinVisual(project, fixture, timeMs);
  const clip = project.shots
    .find((candidate) => candidate.id === fixture.shotId)!
    .layers.find((candidate) => candidate.id === fixture.layerId)!.animationClip;
  if (!clip || clip.version !== 1) throw new Error('Expected a Character Clip v1.');
  return vectorSkinClipDeltas(poses, clip.fixedCharacterCenter);
}

/**
 * The exact region -> Clip mapping the renderer uses for a Part:
 * `part.imageTransform * translate(-anchor) * node.worldTransform * translate(-baseViewBox)`.
 */
export function clipPointOfRegionPoint(
  part: LayerVisualPart,
  point: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
  const node = part.flaGraphic?.layers
    ?.flatMap((layer) => layer.nodes)
    .find((candidate) => candidate.vectorVisual);
  if (!part.imageTransform || !node?.vectorVisual || !part.flaGraphic) {
    throw new Error('Expected a structured vector Part.');
  }
  const world = node.worldTransform;
  const baseViewBox = node.vectorVisual.baseViewBox;
  const anchor = part.flaGraphic.anchor;
  const source = {
    x: point.x - baseViewBox.x,
    y: point.y - baseViewBox.y,
  };
  const worldPoint = {
    x: world.a * source.x + world.c * source.y + world.tx,
    y: world.b * source.x + world.d * source.y + world.ty,
  };
  const anchored = { x: worldPoint.x - anchor.x, y: worldPoint.y - anchor.y };
  return applyVectorSkinPoint(part.imageTransform, anchored);
}

/** First anchor point of the first contour of the resolved sleeve region. */
export function firstContourAnchors(region: FlaEditableShapeRegion): { x: number; y: number }[] {
  return region.contours[0]!.commands.flatMap((command) =>
    command.type === 'Z' ? [] : [{ x: command.x, y: command.y }]);
}

export function rotationOfBoneRest(
  project: Project,
  fixture: VectorSkinFixture,
  boneId: string,
): number {
  const character = adaptiveCharacterOfProject(project, fixture.characterId);
  const tree = resolveCharacterBoneTree(character);
  if (!tree.ok) throw new Error('Expected a valid Bone tree.');
  return tree.byId.get(boneId)!.restLocal.rotationDeg;
}
