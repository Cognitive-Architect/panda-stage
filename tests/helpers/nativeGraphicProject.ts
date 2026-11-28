import {
  FlaGraphicDefinitionSchema,
  LayerService,
  ProjectSchema,
  type FlaEditableShapeRegion,
  type FlaGraphicDefinition,
  type Project,
} from '../../src/domain';
import type { AnimationDefinition } from '../../src/domain';
import { buildProjectWithAnimation, IDS } from '../unit/domain/testProject';

export const SOURCE_GRAPHIC_ID = IDS.animation;
export const ISOLATED_SVG_ASSET_ID = '10000000-0000-4000-8000-000000000005';
export const UNUSED_MEDIA_ASSET_ID = '10000000-0000-4000-8000-000000000006';
export const SOURCE_CIRCLE_PATH = ['shape-circle'] as const;
export const SOURCE_RECT_PATH = ['shape-rect'] as const;
const ISOLATED_SVG_SHA = 'c'.repeat(64);
const UNUSED_MEDIA_SHA = 'd'.repeat(64);
const FRAME_DURATION_MS = 40;

/** Builds one solid rectangular editable vector region. */
export function editableRegion(
  regionRef: string,
  x: number,
  y: number,
  width: number,
  height: number,
  color = '#33aa66',
): FlaEditableShapeRegion {
  return {
    regionRef,
    fill: { kind: 'solid', color, opacity: 1, fillRule: 'nonzero' },
    contours: [{
      closed: true,
      commands: [
        { type: 'M', x, y },
        { type: 'L', x: x + width, y },
        { type: 'L', x: x + width, y: y + height },
        { type: 'L', x, y: y + height },
        { type: 'Z' },
      ],
    }],
    strokes: [],
    bounds: { x, y, width, height },
  };
}

export const CIRCLE_REGION = editableRegion('reg-circle', 0, 0, 100, 100, '#33aa66');
export const RECT_REGION = editableRegion('reg-rect', 0, 0, 80, 60, '#cc5533');

function isolatedAsset() {
  return {
    id: ISOLATED_SVG_ASSET_ID,
    kind: 'image' as const,
    name: 'isolated-shape.svg',
    relativePath: 'assets/isolated-shape.svg',
    mimeType: 'image/svg+xml',
    sha256: ISOLATED_SVG_SHA,
    width: 220,
    height: 180,
    usage: 'uncategorized' as const,
    keywords: [],
  };
}

function unusedMediaAsset() {
  return {
    id: UNUSED_MEDIA_ASSET_ID,
    kind: 'image' as const,
    name: '星形.png',
    relativePath: 'assets/star.png',
    mimeType: 'image/png',
    sha256: UNUSED_MEDIA_SHA,
    width: 40,
    height: 30,
    usage: 'uncategorized' as const,
    keywords: [],
  };
}

function buildSourceGraphicDefinition(): FlaGraphicDefinition {
  const base = buildProjectWithAnimation();
  const baseAnimation = base.animations[0] as AnimationDefinition;
  const baseFrame = baseAnimation.frames[0]!;
  return FlaGraphicDefinitionSchema.parse({
    id: SOURCE_GRAPHIC_ID,
    name: '来源元件',
    kind: 'fla-graphic',
    source: {
      ...baseAnimation.source,
      targetKind: 'graphic-symbol',
      targetName: 'SyntheticSourceGraphic',
      startFrameIndex: 0,
      endFrameIndex: 0,
      canvas: { width: 1000, height: 1000 },
      anchor: { x: 100, y: 100 },
    },
    durationMs: FRAME_DURATION_MS,
    frames: [{
      ...baseFrame,
      ordinal: 0,
      sourceFrameIndex: 0,
      sourceViewport: { x: 100, y: 100, width: 640, height: 640 },
      offset: { x: 0, y: 0 },
      startMs: 0,
      durationMs: FRAME_DURATION_MS,
      createdBySequenceImport: false,
    }],
    structure: {
      version: 1,
      frames: [{
        ordinal: 0,
        layers: [{
          name: '来源图层',
          nodes: [
            {
              type: 'opaque',
              id: SOURCE_CIRCLE_PATH[0],
              sourceAddress: 'graphic:source/frame-0/0',
              drawOrder: 0,
              localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 },
              opaqueKind: 'shape',
              sourceRef: 'fla-shape-circle',
              fallbackScope: 'subtree',
              fallbackAssetId: ISOLATED_SVG_ASSET_ID,
              fallbackViewBox: { x: 0, y: 0, width: 100, height: 100 },
            },
            {
              type: 'opaque',
              id: SOURCE_RECT_PATH[0],
              sourceAddress: 'graphic:source/frame-0/1',
              drawOrder: 1,
              localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 120, ty: 0 },
              opaqueKind: 'shape',
              sourceRef: 'fla-shape-rect',
              fallbackScope: 'subtree',
              fallbackAssetId: ISOLATED_SVG_ASSET_ID,
              fallbackViewBox: { x: 0, y: 0, width: 80, height: 60 },
            },
            {
              type: 'bitmap',
              id: 'media-star',
              drawOrder: 2,
              localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 220, ty: 40 },
              bitmapRef: 'star.png',
              assetId: UNUSED_MEDIA_ASSET_ID,
            },
            {
              type: 'opaque',
              id: 'readonly-caption',
              drawOrder: 3,
              localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 200 },
              opaqueKind: 'text',
            },
          ],
        }],
      }],
    },
    flaGraphicSharedShapeOverrides: {
      '0': {
        [JSON.stringify(SOURCE_CIRCLE_PATH)]: {
          baseViewBox: { x: 0, y: 0, width: 100, height: 100 },
          regions: [CIRCLE_REGION],
          excludedRegionRefs: [],
          extractedRegions: [],
        },
        [JSON.stringify(SOURCE_RECT_PATH)]: {
          baseViewBox: { x: 0, y: 0, width: 80, height: 60 },
          regions: [RECT_REGION],
          excludedRegionRefs: [],
          extractedRegions: [],
        },
      },
    },
  });
}

export interface SourceGraphicFixture {
  readonly project: Project;
  readonly shotId: string;
  readonly definitionId: string;
  readonly baseProject: Project;
}

/**
 * A valid source-backed FLA Graphic Definition with two editable vector shapes,
 * one bound bitmap, and one read-only text node, plus a second unreferenced
 * native Definition fixture helper below.
 */
export function buildSourceGraphicFixture(): SourceGraphicFixture {
  const base = buildProjectWithAnimation();
  const definition = buildSourceGraphicDefinition();
  const project = ProjectSchema.parse({
    ...base,
    assets: [...base.assets, isolatedAsset(), unusedMediaAsset()],
    animations: [definition],
  });
  return {
    project,
    shotId: project.shots[0]!.id,
    definitionId: definition.id,
    baseProject: base,
  };
}

export interface PlacedGraphicLayer {
  readonly project: Project;
  readonly layerId: string;
}

export function placeGraphicLayer(
  project: Project,
  shotId: string,
  animationId: string,
  position = { x: 500, y: 400 },
): PlacedGraphicLayer {
  const service = new LayerService();
  const created = service.createFromAnimation(project, shotId, {
    animationId,
    startTimeMs: 0,
    position,
  });
  return { project: created.project, layerId: created.layer.id };
}

/** Project with a hand-authored native Definition that only references existing media. */
export function buildNativeBitmapOnlyProject(): { project: Project; animationId: string } {
  const fixture = buildSourceGraphicFixture();
  const frameDurationMs = 1_000 / 24;
  const nativeDefinition = FlaGraphicDefinitionSchema.parse({
    id: '70000000-0000-4000-8000-0000000000aa',
    name: '原生媒体元件',
    kind: 'fla-graphic',
    source: {
      origin: 'native',
      targetKind: 'graphic-symbol',
      targetName: '原生媒体元件',
      startFrameIndex: 0,
      endFrameIndex: 0,
      sourceFps: 24,
      canvas: { width: 40, height: 30 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 40, height: 30 },
    },
    durationMs: frameDurationMs,
    frames: [{
      ordinal: 0,
      sourceFrameIndex: 0,
      sourceViewport: { x: 0, y: 0, width: 40, height: 30 },
      offset: { x: 0, y: 0 },
      startMs: 0,
      durationMs: frameDurationMs,
      createdBySequenceImport: false,
    }],
    structure: {
      version: 1,
      frames: [{
        ordinal: 0,
        layers: [{
          name: '原生内容',
          nodes: [{
            type: 'bitmap',
            id: 'native-media-node',
            authored: 'native',
            drawOrder: 0,
            localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
            bitmapRef: '星形.png',
            assetId: UNUSED_MEDIA_ASSET_ID,
          }],
        }],
      }],
    },
  });
  // The source Definition that previously owned the same media is removed so
  // deleting the native Definition really releases the media reference.
  const project = ProjectSchema.parse({
    ...fixture.project,
    animations: [nativeDefinition],
  });
  return { project, animationId: nativeDefinition.id };
}
