import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Konva from 'konva';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CharacterService,
  LayerService,
  ProjectSchema,
  PROJECT_SCHEMA_VERSION,
  adaptiveCharacterSourceAnchor,
  evaluateShotAtTime,
  frameTimeMs,
  migrateProject,
  resolveLayerVisualParts,
  visualPartRenderTransform,
  type CharacterPart,
  type CharacterPartTransform,
  type LayerVisualPart,
  type Project,
} from '../../src/domain';
import {
  affineDeterminant,
  applyPoseToImageTransform,
  cropToSourceTransform,
  interpolatePoseAtTime,
  inverseAffine,
  multiplyAffine,
  sourcePivotToAssetPixels,
  sourcePivotToCenteredCharacter,
  transformPoint,
  type ResearchKeyframe,
  type ResearchPoint,
} from '../../scripts/research/c5-kf-00/pose';
import { buildProject, IDS } from '../unit/domain/testProject';

const OUTPUT_DIR =
  process.env.PANDA_C5_KF00_OUTPUT_DIR ??
  'D:\\PandaStage-Acceptance\\issue-962-c5-kf00\\run';
const PRIVATE_PROJECT_DIR =
  process.env.PANDA_C5_KF00_REAL_PROJECT_DIR ?? '';
const PRIVATE_FLA_PATH = process.env.PANDA_C5_KF00_SOURCE_FLA ?? '';
const CORPUS_EVIDENCE_ID = 'F1V01-CORPUS-20261102-20';
const REAL_TARGET_PART_NAME = 'Part 4';
const REAL_PIVOT_SOURCE = { x: 823, y: 402 } satisfies ResearchPoint;
const TEST_FRAME_INDEXES = [0, 6, 12, 18, 24] as const;
const TEST_FRAME_TIMES = TEST_FRAME_INDEXES.map((index) => frameTimeMs(index));
const CONTACT_VIEW_BOX = '650 125 1000 850';
const ARTIFACT_DIR = path.resolve(
  process.cwd(),
  'docs/evidence/issue-962-c5-kf-00',
);
const PUBLIC_SYNTHETIC_SVG = path.join(
  ARTIFACT_DIR,
  'synthetic-contact-sheet.svg',
);

interface PartArt {
  width: number;
  height: number;
  svg: string;
}

interface SceneFrame {
  timeMs: number;
  pose: { offsetX: number; offsetY: number; rotationDeg: number; scale: number };
  innerSvg: string;
  matrices: ReadonlyMap<string, CharacterPartTransform>;
}

interface ResearchArtifacts {
  outputDir: string;
  publicSyntheticSvg: string;
  publicSyntheticPng: string;
  syntheticStaticSvg: string;
  syntheticNeutralSvg: string;
  privateRealSvg: string | null;
  privateRealShoulderSvg: string | null;
  receiptPath: string;
  realAsset: Record<string, unknown>;
  synthetic: Record<string, unknown>;
}

const bodyArt = `
  <circle cx="300" cy="83" r="42" fill="#f0c3a1" stroke="#263548" stroke-width="8" />
  <path d="M278 125 L322 125 L344 155 L402 183 L370 246 L356 397 L241 397 L226 250 L194 182 L255 153 Z"
    fill="#345c78" stroke="#203348" stroke-width="12" stroke-linejoin="round" />
  <path d="M270 149 L300 180 L330 149 L324 265 L300 306 L276 265 Z"
    fill="#d7e4df" stroke="#203348" stroke-width="8" stroke-linejoin="round" />
  <path d="M250 397 L296 397 L286 466 L242 466 Z M304 397 L350 397 L360 466 L316 466 Z"
    fill="#28384b" stroke="#203348" stroke-width="9" stroke-linejoin="round" />
  <path d="M200 185 L240 173 L253 229 L206 255 Z"
    fill="#345c78" stroke="#203348" stroke-width="10" stroke-linejoin="round" />
  <circle cx="350" cy="150" r="13" fill="#f3d49e" stroke="#203348" stroke-width="5" />
`;

const sleeveArt = `
  <path d="M40 40 C98 20 161 39 218 78 C272 116 316 181 354 238
    C381 278 413 306 465 327 L421 383 C358 357 326 325 293 279
    C253 223 225 171 176 134 C128 98 82 94 54 101 Z"
    fill="#5b3440" stroke="#382c36" stroke-width="16" stroke-linejoin="round" />
  <path d="M346 258 C386 283 417 304 465 327 L421 383 C382 364 353 340 324 310 Z"
    fill="#73505a" stroke="#382c36" stroke-width="9" stroke-linejoin="round" />
  <path d="M424 330 L478 312 L506 331 L486 354 L449 358 Z"
    fill="#f0c3a1" stroke="#263548" stroke-width="8" stroke-linejoin="round" />
  <circle cx="40" cy="40" r="7" fill="#39a873" stroke="#ffffff" stroke-width="3" />
`;

const staticPose: ResearchKeyframe = {
  timeMs: 0,
  offsetX: 0,
  offsetY: 0,
  rotationDeg: 0,
  scale: 1,
};
const syntheticGoalPose: ResearchKeyframe = {
  timeMs: 1_000,
  offsetX: 24,
  offsetY: -12,
  rotationDeg: -36,
  scale: 1.2,
};
const realGoalPose: ResearchKeyframe = {
  timeMs: 1_000,
  offsetX: 0,
  offsetY: 0,
  rotationDeg: -12,
  scale: 1,
};

let artifacts: ResearchArtifacts | null = null;

function sha256(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function formatNumber(value: number): string {
  if (Object.is(value, -0)) return '0';
  return Number(value.toPrecision(15)).toString();
}

function matrixText(matrix: CharacterPartTransform): string {
  return `matrix(${[
    matrix.a,
    matrix.b,
    matrix.c,
    matrix.d,
    matrix.tx,
    matrix.ty,
  ].map(formatNumber).join(' ')})`;
}

function matrixClose(
  left: CharacterPartTransform,
  right: CharacterPartTransform,
  tolerance = 1e-10,
): boolean {
  return (
    Math.abs(left.a - right.a) <= tolerance &&
    Math.abs(left.b - right.b) <= tolerance &&
    Math.abs(left.c - right.c) <= tolerance &&
    Math.abs(left.d - right.d) <= tolerance &&
    Math.abs(left.tx - right.tx) <= tolerance &&
    Math.abs(left.ty - right.ty) <= tolerance
  );
}

function layerOwnerMatrix(owner: {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  flipX: boolean;
  rotationDeg: number;
}): CharacterPartTransform {
  const radians = (owner.rotationDeg * Math.PI) / 180;
  const scaleX = owner.scaleX * (owner.flipX ? -1 : 1);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    a: cosine * scaleX,
    b: sine * scaleX,
    c: -sine * owner.scaleY,
    d: cosine * owner.scaleY,
    tx: owner.x,
    ty: owner.y,
  };
}

function sceneInnerSvg(input: {
  parts: readonly LayerVisualPart[];
  matrices: ReadonlyMap<string, CharacterPartTransform>;
  artByAssetId: ReadonlyMap<string, PartArt>;
  ownerTransform: {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    flipX: boolean;
    rotationDeg: number;
  };
  pivotCharacter?: ResearchPoint;
  pivotPose?: { offsetX: number; offsetY: number };
}): string {
  const parts = [...input.parts].sort(
    (left, right) => left.drawOrder - right.drawOrder,
  );
  const partMarkup = parts
    .filter((part) => part.visible !== false)
    .map((part) => {
      const matrix = input.matrices.get(part.partId);
      const art = input.artByAssetId.get(part.assetId);
      if (!matrix || !art) {
        throw new Error(`Missing research art or transform for ${part.partId}.`);
      }
      return `<g transform="${matrixText(matrix)}"><svg x="0" y="0" width="${art.width}" height="${art.height}" viewBox="0 0 ${art.width} ${art.height}" overflow="hidden">${art.svg}</svg></g>`;
    })
    .join('');
  const pivotMarkup = input.pivotCharacter
    ? (() => {
        const offsetX = input.pivotPose?.offsetX ?? 0;
        const offsetY = input.pivotPose?.offsetY ?? 0;
        const worldPivot = transformPoint(
          layerOwnerMatrix(input.ownerTransform),
          {
            x: input.pivotCharacter!.x + offsetX,
            y: input.pivotCharacter!.y + offsetY,
          },
        );
        return `<g transform="translate(${formatNumber(worldPivot.x)} ${formatNumber(worldPivot.y)})"><circle r="10" fill="#f7d547" stroke="#163e30" stroke-width="4"/><path d="M-18 0H18M0 -18V18" stroke="#163e30" stroke-width="3"/></g>`;
      })()
    : '';
  return `<rect x="0" y="0" width="1920" height="1080" fill="#e9ece8"/><g transform="${matrixText(layerOwnerMatrix(input.ownerTransform))}">${partMarkup}</g>${pivotMarkup}`;
}

function sceneSvg(innerSvg: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="850" viewBox="${CONTACT_VIEW_BOX}">${innerSvg}</svg>`;
}

function contactSheetSvg(
  title: string,
  frames: readonly SceneFrame[],
  viewBox = CONTACT_VIEW_BOX,
): string {
  const width = 1_590;
  const height = 950;
  const cellWidth = 510;
  const cellHeight = 435;
  const xGap = 20;
  const yGap = 18;
  const xStart = 15;
  const yStart = 70;
  const panels = frames
    .map((frame, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = xStart + column * (cellWidth + xGap);
      const y = yStart + row * (cellHeight + yGap);
      const timeLabel = `${frame.timeMs} ms  |  ${formatNumber(frame.pose.rotationDeg)}°`;
      return `<g><rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" rx="12" fill="#f6f8f4" stroke="#aab8af" stroke-width="2"/><text x="${x + 16}" y="${y + 28}" font-family="Arial, sans-serif" font-size="19" font-weight="700" fill="#263548">${timeLabel}</text><svg x="${x + 6}" y="${y + 38}" width="${cellWidth - 12}" height="${cellHeight - 46}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${frame.innerSvg}</svg></g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#dde4df"/><text x="22" y="42" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#183d2d">${title}</text>${panels}</svg>`;
}

function imageAsset(input: {
  id: string;
  name: string;
  width: number;
  height: number;
}) {
  return {
    id: input.id,
    kind: 'image' as const,
    name: input.name,
    relativePath: `${input.name}.png`,
    mimeType: 'image/png',
    width: input.width,
    height: input.height,
    usage: 'uncategorized' as const,
    keywords: [],
  };
}

function syntheticRestTransform(): CharacterPartTransform {
  const radians = (6 * Math.PI) / 180;
  const matrix = {
    a: Math.cos(radians),
    b: Math.sin(radians),
    c: -Math.sin(radians) + 0.035,
    d: Math.cos(radians),
    tx: 0,
    ty: 0,
  };
  const pivot = { x: 60, y: 50 };
  const shoulder = { x: 350, y: 150 };
  matrix.tx = shoulder.x - matrix.a * pivot.x - matrix.c * pivot.y;
  matrix.ty = shoulder.y - matrix.b * pivot.x - matrix.d * pivot.y;
  return matrix;
}

function makeSyntheticScene() {
  const bodyAssetId = '10000000-0000-4000-8000-000000000201';
  const sleeveAssetId = '10000000-0000-4000-8000-000000000202';
  const sourceRootTransform: CharacterPartTransform = {
    a: -0.96,
    b: 0.08,
    c: 0.16,
    d: 0.98,
    tx: 1_210,
    ty: 20,
  };
  const bodyMapping = {
    sourceWidth: 420,
    sourceHeight: 480,
    crop: { x: 0, y: 0, width: 420, height: 480 },
    exportScale: 1,
  };
  const sleeveMapping = {
    sourceWidth: 640,
    sourceHeight: 480,
    crop: { x: 40, y: 30, width: 260, height: 210 },
    exportScale: 2,
  };
  const restTransform = syntheticRestTransform();
  const parts: CharacterPart[] = [
    {
      partId: '71000000-0000-4000-8000-000000000201',
      assetId: bodyAssetId,
      source: { kind: 'manual', sourceId: 'synthetic:c5-kf-00:body' },
      sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      staticAdjustment: { offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0 },
      imageMapping: bodyMapping,
      drawOrder: 0,
      visible: true,
      displayName: 'Synthetic Body',
    },
    {
      partId: '71000000-0000-4000-8000-000000000202',
      assetId: sleeveAssetId,
      source: { kind: 'manual', sourceId: 'synthetic:c5-kf-00:sleeve' },
      sourceRestTransform: restTransform,
      restTransform,
      staticAdjustment: { offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0 },
      imageMapping: sleeveMapping,
      drawOrder: 1,
      visible: true,
      displayName: 'Synthetic Sleeve',
    },
  ];
  const base = buildProject();
  const withAssets = ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets,
      imageAsset({ id: bodyAssetId, name: 'c5-kf-00-synthetic-body', width: 420, height: 480 }),
      imageAsset({ id: sleeveAssetId, name: 'c5-kf-00-synthetic-sleeve', width: 520, height: 420 }),
    ],
  });
  const characterProject = new CharacterService().createAdaptiveParts(
    withAssets,
    {
      name: 'C5-KF-00 Synthetic Fixture',
      sourceRootTransform,
      parts,
    },
  );
  const character = characterProject.characters.at(-1);
  if (!character || character.mode !== 'adaptive-parts') {
    throw new Error('Synthetic fixture Character was not created.');
  }
  const placement = new LayerService().createFromAdaptiveCharacter(
    characterProject,
    IDS.shot,
    character.id,
    { x: 960, y: 540 },
  );
  const shot = placement.project.shots.find((item) => item.id === IDS.shot)!;
  const evaluated = evaluateShotAtTime(shot, 0, placement.project);
  const evaluatedLayer = evaluated.layers.find(
    (item) => item.id === placement.layer.id,
  )!;
  const visual = resolveLayerVisualParts(
    placement.project,
    shot,
    evaluatedLayer,
  );
  return {
    project: placement.project,
    character,
    visual,
    parts: visual.parts,
    pivotSource: { x: 60, y: 50 },
    sourceAnchor: adaptiveCharacterSourceAnchor(placement.project, character),
    artByAssetId: new Map<string, PartArt>([
      [bodyAssetId, { width: 420, height: 480, svg: bodyArt }],
      [sleeveAssetId, { width: 520, height: 420, svg: sleeveArt }],
    ]),
  };
}

function konvaCornerDeviation(
  part: LayerVisualPart,
  width: number,
  height: number,
): number {
  const source = part.imageTransform;
  if (!source) throw new Error(`Part ${part.partId} has no source affine.`);
  const render = visualPartRenderTransform(part);
  const node = new Konva.Group({
    x: render.x,
    y: render.y,
    offsetX: render.offsetX,
    offsetY: render.offsetY,
    rotation: render.rotation,
    scaleX: render.scaleX,
    scaleY: render.scaleY,
    skewX: render.skewX ?? 0,
    skewY: render.skewY ?? 0,
  });
  const actual = node.getTransform().getMatrix();
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  let maximumDeviation = 0;
  for (const corner of corners) {
    const expectedX = source.a * corner.x + source.c * corner.y + source.tx;
    const expectedY = source.b * corner.x + source.d * corner.y + source.ty;
    const actualX = actual[0]! * corner.x + actual[2]! * corner.y + actual[4]!;
    const actualY = actual[1]! * corner.x + actual[3]! * corner.y + actual[5]!;
    maximumDeviation = Math.max(
      maximumDeviation,
      Math.abs(actualX - expectedX),
      Math.abs(actualY - expectedY),
    );
  }
  node.destroy();
  return maximumDeviation;
}

function transformedBounds(
  parts: readonly LayerVisualPart[],
  matrices: ReadonlyMap<string, CharacterPartTransform>,
) {
  const points: ResearchPoint[] = [];
  for (const part of parts) {
    const matrix = matrices.get(part.partId);
    if (!matrix) throw new Error(`Missing bounds matrix for ${part.partId}.`);
    points.push(
      transformPoint(matrix, { x: 0, y: 0 }),
      transformPoint(matrix, { x: part.localRect.width, y: 0 }),
      transformPoint(matrix, { x: part.localRect.width, y: part.localRect.height }),
      transformPoint(matrix, { x: 0, y: part.localRect.height }),
    );
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function matricesFor(parts: readonly LayerVisualPart[]) {
  return new Map(
    parts.map((part) => {
      if (!part.imageTransform) {
        throw new Error(`Adaptive Part ${part.partId} lacks a static transform.`);
      }
      return [part.partId, { ...part.imageTransform }] as const;
    }),
  );
}

function sceneFrames(input: {
  parts: readonly LayerVisualPart[];
  baseMatrices: ReadonlyMap<string, CharacterPartTransform>;
  targetPart: LayerVisualPart;
  pivot: ResearchPoint;
  ownerTransform: {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    flipX: boolean;
    rotationDeg: number;
  };
  artByAssetId: ReadonlyMap<string, PartArt>;
  showPivotMarker?: boolean;
  goal: ResearchKeyframe;
}): SceneFrame[] {
  return TEST_FRAME_TIMES.map((timeMs) => {
    const pose = interpolatePoseAtTime(staticPose, input.goal, timeMs);
    const matrices = new Map(input.baseMatrices);
    const base = input.baseMatrices.get(input.targetPart.partId)!;
    matrices.set(
      input.targetPart.partId,
      applyPoseToImageTransform(base, input.pivot, pose),
    );
    return {
      timeMs,
      pose,
      matrices,
      innerSvg: sceneInnerSvg({
        parts: input.parts,
        matrices,
        artByAssetId: input.artByAssetId,
        ownerTransform: input.ownerTransform,
        ...(input.showPivotMarker === false
          ? {}
          : { pivotCharacter: input.pivot, pivotPose: pose }),
      }),
    };
  });
}

function readAssetArt(
  projectDir: string,
  project: Project,
  character: Extract<Project['characters'][number], { mode: 'adaptive-parts' }>,
): Map<string, PartArt> {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const result = new Map<string, PartArt>();
  for (const part of character.parts) {
    const asset = assets.get(part.assetId);
    if (!asset || asset.kind !== 'image') {
      throw new Error(`Missing image metadata for real Part ${part.displayName}.`);
    }
    const relativePath = asset.relativePath.replace(/[\\/]+/g, path.sep);
    const assetPath = path.resolve(projectDir, relativePath);
    const projectPrefix = `${path.resolve(projectDir)}${path.sep}`;
    if (!assetPath.startsWith(projectPrefix)) {
      throw new Error('Real project asset path escaped its private project root.');
    }
    const png = fs.readFileSync(assetPath);
    result.set(asset.id, {
      width: asset.width,
      height: asset.height,
      svg: `<image x="0" y="0" width="${asset.width}" height="${asset.height}" href="data:image/png;base64,${png.toString('base64')}"/>`,
    });
  }
  return result;
}

function createSyntheticArtifacts() {
  const scene = makeSyntheticScene();
  const parts = scene.parts;
  const targetPart = parts.find(
    (part) =>
      part.source.kind === 'adaptive-part' &&
      part.source.characterPartId === '71000000-0000-4000-8000-000000000202',
  )!;
  const baseMatrices = matricesFor(parts);
  const sourcePivotCharacter = sourcePivotToCenteredCharacter(
    scene.character.sourceRootTransform,
    scene.character.parts[1]!.restTransform,
    scene.sourceAnchor,
    scene.pivotSource,
  );
  const zeroPoseMatrices = new Map(baseMatrices);
  const baseTargetMatrix = baseMatrices.get(targetPart.partId)!;
  zeroPoseMatrices.set(
    targetPart.partId,
    applyPoseToImageTransform(baseTargetMatrix, sourcePivotCharacter, staticPose),
  );
  const staticSvg = sceneSvg(
    sceneInnerSvg({
      parts,
      matrices: baseMatrices,
      artByAssetId: scene.artByAssetId,
      ownerTransform: scene.visual.ownerTransform,
      pivotCharacter: sourcePivotCharacter,
      pivotPose: staticPose,
    }),
  );
  const neutralSvg = sceneSvg(
    sceneInnerSvg({
      parts,
      matrices: zeroPoseMatrices,
      artByAssetId: scene.artByAssetId,
      ownerTransform: scene.visual.ownerTransform,
      pivotCharacter: sourcePivotCharacter,
      pivotPose: staticPose,
    }),
  );
  const frames = sceneFrames({
    parts,
    baseMatrices,
    targetPart,
    pivot: sourcePivotCharacter,
    ownerTransform: scene.visual.ownerTransform,
    artByAssetId: scene.artByAssetId,
    goal: syntheticGoalPose,
  });
  const contact = contactSheetSvg('Original segmented sleeve fixture', frames);
  return {
    scene,
    targetPart,
    baseMatrices,
    pivot: sourcePivotCharacter,
    staticSvg,
    neutralSvg,
    frames,
    contact,
  };
}

function createRealArtifacts() {
  if (!fs.existsSync(PRIVATE_FLA_PATH) || !fs.existsSync(PRIVATE_PROJECT_DIR)) {
    return {
      status: 'REAL_ASSET_NOT_RUN',
      reason: 'PATH_UNAVAILABLE',
      sourcePathAvailable: fs.existsSync(PRIVATE_FLA_PATH),
      projectPathAvailable: fs.existsSync(PRIVATE_PROJECT_DIR),
    };
  }

  const sourceShaBefore = sha256(PRIVATE_FLA_PATH);
  const savedProject = JSON.parse(
    fs.readFileSync(path.join(PRIVATE_PROJECT_DIR, 'project.json'), 'utf8'),
  ) as { schemaVersion?: number } & Record<string, unknown>;
  const project = ProjectSchema.parse(migrateProject(savedProject));
  const sourceHashFromFla = sourceShaBefore.toLowerCase();
  const character = project.characters.find(
    (candidate): candidate is Extract<Project['characters'][number], { mode: 'adaptive-parts' }> =>
      candidate.mode === 'adaptive-parts' &&
      candidate.parts.length === 6 &&
      candidate.parts.some(
        (part) =>
          part.source.kind === 'source-instance' &&
          part.source.sourceId.toLowerCase().includes(sourceHashFromFla),
      ),
  );
  if (!character) {
    return {
      status: 'ASSET_LIMITED',
      reason: 'SAVED_PROJECT_SOURCE_ID_MISMATCH',
      sourceSha256: sourceShaBefore,
      corpusEvidenceId: CORPUS_EVIDENCE_ID,
    };
  }
  const target = character.parts.find(
    (part) => part.displayName === REAL_TARGET_PART_NAME && part.drawOrder === 3,
  );
  if (!target) {
    return {
      status: 'ASSET_LIMITED',
      reason: 'TARGET_PART_NOT_FOUND',
      sourceSha256: sourceShaBefore,
      corpusEvidenceId: CORPUS_EVIDENCE_ID,
    };
  }
  const shot = project.shots.find((candidate) =>
    candidate.layers.some(
      (layer) =>
        layer.source.kind === 'character' &&
        layer.source.characterId === character.id,
    ),
  );
  const layer = shot?.layers.find(
    (candidate) =>
      candidate.source.kind === 'character' &&
      candidate.source.characterId === character.id,
  );
  if (!shot || !layer) {
    return {
      status: 'ASSET_LIMITED',
      reason: 'SAVED_PROJECT_HAS_NO_CHARACTER_SHOT',
      sourceSha256: sourceShaBefore,
      corpusEvidenceId: CORPUS_EVIDENCE_ID,
    };
  }

  const realTargetPng = path.resolve(
    PRIVATE_PROJECT_DIR,
    project.assets.find((asset) => asset.id === target.assetId)!.relativePath,
  );
  const realTargetPngSha256 = sha256(realTargetPng);
  const projectBefore = JSON.stringify(project);
  const evaluated = evaluateShotAtTime(shot, 0, project);
  const evaluatedLayer = evaluated.layers.find((candidate) => candidate.id === layer.id)!;
  const visual = resolveLayerVisualParts(project, shot, evaluatedLayer);
  const targetVisual = visual.parts.find(
    (part) =>
      part.source.kind === 'adaptive-part' &&
      part.source.characterPartId === target.partId,
  );
  if (!targetVisual?.imageTransform) {
    return {
      status: 'ASSET_LIMITED',
      reason: 'CURRENT_STATIC_VISUAL_MISSING_TARGET_PART',
      sourceSha256: sourceShaBefore,
      corpusEvidenceId: CORPUS_EVIDENCE_ID,
    };
  }

  const sourceAnchor = adaptiveCharacterSourceAnchor(project, character);
  const pivot = sourcePivotToCenteredCharacter(
    character.sourceRootTransform,
    target.restTransform,
    sourceAnchor,
    REAL_PIVOT_SOURCE,
  );
  const baseMatrices = matricesFor(visual.parts);
  const artByAssetId = readAssetArt(PRIVATE_PROJECT_DIR, project, character);
  const neutralMatrices = new Map(baseMatrices);
  neutralMatrices.set(
    targetVisual.partId,
    applyPoseToImageTransform(
      baseMatrices.get(targetVisual.partId)!,
      pivot,
      staticPose,
    ),
  );
  const staticSvg = sceneSvg(
    sceneInnerSvg({
      parts: visual.parts,
      matrices: baseMatrices,
      artByAssetId,
      ownerTransform: visual.ownerTransform,
      pivotCharacter: pivot,
      pivotPose: staticPose,
    }),
  );
  const neutralSvg = sceneSvg(
    sceneInnerSvg({
      parts: visual.parts,
      matrices: neutralMatrices,
      artByAssetId,
      ownerTransform: visual.ownerTransform,
      pivotCharacter: pivot,
      pivotPose: staticPose,
    }),
  );
  const frames = sceneFrames({
    parts: visual.parts,
    baseMatrices,
    targetPart: targetVisual,
    pivot,
    ownerTransform: visual.ownerTransform,
    artByAssetId,
    showPivotMarker: false,
    goal: realGoalPose,
  });
  const contact = contactSheetSvg('Private real sleeve | Part 4', frames);
  const shoulderContact = contactSheetSvg(
    'Private shoulder seam detail | Part 4',
    frames,
    '720 300 220 220',
  );
  const sourceShaAfter = sha256(PRIVATE_FLA_PATH);
  const siblingParts = visual.parts.filter(
    (part) => part.partId !== targetVisual.partId,
  );
  const unchangedPartMatrices = frames.every((frame) =>
    siblingParts.every((part) =>
      matrixClose(
        baseMatrices.get(part.partId)!,
        frame.matrices.get(part.partId)!,
      ),
    ),
  );
  const neutralMatrixExact = matrixClose(
    baseMatrices.get(targetVisual.partId)!,
    neutralMatrices.get(targetVisual.partId)!,
    0,
  );

  return {
    status: 'READY_FOR_PRIVATE_VISUAL_REVIEW',
    sourceFilePath: PRIVATE_FLA_PATH,
    sourceSha256: sourceShaBefore,
    sourceShaMatchesImportedIdentity: true,
    sourceFileUnchanged: sourceShaBefore === sourceShaAfter,
    neutralMatrixExact,
    sourceShaAfter,
    corpusRow: 20,
    corpusEvidenceId: CORPUS_EVIDENCE_ID,
    projectSchemaVersionAtImport: savedProject.schemaVersion,
    projectSchemaVersionAfterCurrentMigration: project.schemaVersion,
    currentProjectSchemaVersion: PROJECT_SCHEMA_VERSION,
    partName: REAL_TARGET_PART_NAME,
    sourceCategory: 'Independent sleeve/arm Part in the six-Part character; owner-confirmed movable.',
    partDrawOrder: target.drawOrder,
    sourceKind: target.source.kind,
    sourcePoseFrame: target.source.kind === 'source-instance' ? target.source.sourcePoseFrame : null,
    sourcePartPngSha256: realTargetPngSha256,
    sourcePartImageMapping: target.imageMapping,
    sourceRootTransform: character.sourceRootTransform,
    restTransform: target.restTransform,
    sourceAnchor,
    pivotSource: REAL_PIVOT_SOURCE,
    pivotCharacter: pivot,
    angleRangeTestedDeg: [0, -12],
    frameTimesMs: frames.map((frame) => frame.timeMs),
    frameAnglesDeg: frames.map((frame) => frame.pose.rotationDeg),
    oneCalibrationAttempt: 1,
    pivotCalibrationMethod:
      'Center of the Part 4 alpha top band, confirmed against the already completed #923 Part preview; source coordinates are uncropped original-image pixels.',
    ownerTransformFixed: true,
    siblingTransformsUnchanged: unchangedPartMatrices,
    projectSnapshotUnchanged: projectBefore === JSON.stringify(project),
    staticSvg,
    neutralSvg,
    contact,
    shoulderContact,
  };
}

describe('C5-KF-00 bounded Part pivot and two-key interpolation experiment', () => {
  it('keeps the neutral synthetic pose identical and maps source/root/crop once', () => {
    const synthetic = createSyntheticArtifacts();
    const matrices = synthetic.baseMatrices;
    const targetMatrix = matrices.get(synthetic.targetPart.partId)!;
    const neutralMatrix = applyPoseToImageTransform(
      targetMatrix,
      synthetic.pivot,
      staticPose,
    );
    expect(neutralMatrix).toEqual(targetMatrix);
    expect(synthetic.scene.visual.ownerTransform.anchor).toBe('center');
    expect(synthetic.scene.character.sourceRootTransform).toEqual({
      a: -0.96,
      b: 0.08,
      c: 0.16,
      d: 0.98,
      tx: 1_210,
      ty: 20,
    });
    expect(affineDeterminant(synthetic.scene.character.sourceRootTransform)).toBeLessThan(0);

    const staticSvg = synthetic.staticSvg;
    const neutralSvg = synthetic.neutralSvg;
    expect(neutralSvg).toBe(staticSvg);
    expect(neutralSvg).not.toContain('data:image/png;base64');
    expect(synthetic.frames.map((frame) => frame.timeMs)).toEqual([
      0, 250, 500, 750, 1_000,
    ]);
    expect(synthetic.frames.map((frame) => frame.pose.rotationDeg)).toEqual([
      0, -9, -18, -27, -36,
    ]);
    expect(synthetic.frames[2]!.pose).toEqual({
      offsetX: 12,
      offsetY: -6,
      rotationDeg: -18,
      scale: 1.1,
    });

    const mapping = synthetic.scene.character.parts[1]!.imageMapping;
    const outsideCropPivot = { x: 20, y: 10 };
    const assetPoint = sourcePivotToAssetPixels(outsideCropPivot, mapping);
    expect(assetPoint).toEqual({ x: -40, y: -40 });
    expect(transformPoint(cropToSourceTransform(mapping), assetPoint)).toEqual(
      outsideCropPivot,
    );

    const rest = synthetic.scene.character.parts[1]!.restTransform;
    const sourceRoot = synthetic.scene.character.sourceRootTransform;
    const crop = cropToSourceTransform(mapping);
    const independentlyComposed = multiplyAffine(
      { a: 1, b: 0, c: 0, d: 1, tx: -synthetic.scene.sourceAnchor.x, ty: -synthetic.scene.sourceAnchor.y },
      multiplyAffine(sourceRoot, multiplyAffine(rest, crop)),
    );
    expect(matrixClose(targetMatrix, independentlyComposed, 1e-9)).toBe(true);

    const realVisualPart: LayerVisualPart = {
      ...synthetic.targetPart,
      imageTransform: neutralMatrix,
    };
    expect(
      konvaCornerDeviation(
        realVisualPart,
        realVisualPart.localRect.width,
        realVisualPart.localRect.height,
      ),
    ).toBeLessThan(1e-8);

    const firstMatrix = applyPoseToImageTransform(
      targetMatrix,
      synthetic.pivot,
      interpolatePoseAtTime(staticPose, syntheticGoalPose, 0),
    );
    const lastMatrix = applyPoseToImageTransform(
      targetMatrix,
      synthetic.pivot,
      interpolatePoseAtTime(staticPose, syntheticGoalPose, 1_000),
    );
    const middleMatrix = applyPoseToImageTransform(
      targetMatrix,
      synthetic.pivot,
      interpolatePoseAtTime(staticPose, syntheticGoalPose, 500),
    );
    const coefficientAverage = {
      a: (firstMatrix.a + lastMatrix.a) / 2,
      b: (firstMatrix.b + lastMatrix.b) / 2,
      c: (firstMatrix.c + lastMatrix.c) / 2,
      d: (firstMatrix.d + lastMatrix.d) / 2,
      tx: (firstMatrix.tx + lastMatrix.tx) / 2,
      ty: (firstMatrix.ty + lastMatrix.ty) / 2,
    };
    expect(matrixClose(middleMatrix, coefficientAverage, 1e-4)).toBe(false);

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    fs.writeFileSync(PUBLIC_SYNTHETIC_SVG, synthetic.contact, 'utf8');
    const generatedArtifacts: ResearchArtifacts = {
      outputDir: path.resolve(OUTPUT_DIR),
      publicSyntheticSvg: PUBLIC_SYNTHETIC_SVG,
      publicSyntheticPng: path.join(ARTIFACT_DIR, 'synthetic-contact-sheet.png'),
      syntheticStaticSvg: path.join(OUTPUT_DIR, 'synthetic-static.svg'),
      syntheticNeutralSvg: path.join(OUTPUT_DIR, 'synthetic-neutral.svg'),
      privateRealSvg: null,
      privateRealShoulderSvg: null,
      receiptPath: path.join(OUTPUT_DIR, 'receipt.json'),
      synthetic: {
        status: 'TECH_PASS',
        fixture: 'Original two-part body and sleeve vector art; off-center fixed pivot.',
        sourceRootDeterminant: affineDeterminant(synthetic.scene.character.sourceRootTransform),
        sourceRootHasMirror: true,
        sourceRestHasRotationAndShear: true,
        crop: mapping.crop,
        exportScale: mapping.exportScale,
        pivotSource: synthetic.scene.pivotSource,
        pivotCharacter: synthetic.pivot,
        frameIndexes: [...TEST_FRAME_INDEXES],
        frameTimesMs: synthetic.frames.map((frame) => frame.timeMs),
        frameAnglesDeg: synthetic.frames.map((frame) => frame.pose.rotationDeg),
        neutralMatrixExact: true,
        neutralSvgExact: true,
        neutralPixelComparison: 'PENDING_ELECTRON_CAPTURE',
        matrixCoefficientAverageRejected: true,
      },
      realAsset: {},
    };
    artifacts = generatedArtifacts;
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(generatedArtifacts.syntheticStaticSvg, staticSvg, 'utf8');
    fs.writeFileSync(generatedArtifacts.syntheticNeutralSvg, neutralSvg, 'utf8');
  });

  it('returns a deterministic absolute-time pose and keeps the fixed pivot stationary', () => {
    const synthetic = createSyntheticArtifacts();
    const goal = syntheticGoalPose;
    const orderA = [0, 250, 500, 750, 1_000];
    const orderB = [750, 250, 1_000, 0, 500];
    const sample = (timeMs: number) =>
      applyPoseToImageTransform(
        synthetic.baseMatrices.get(synthetic.targetPart.partId)!,
        synthetic.pivot,
        interpolatePoseAtTime(staticPose, goal, timeMs),
      );
    const reference = new Map(orderA.map((timeMs) => [timeMs, sample(timeMs)]));
    for (const timeMs of orderB) {
      expect(sample(timeMs)).toEqual(reference.get(timeMs));
      expect(sample(timeMs)).toEqual(reference.get(timeMs));
    }
    const snapshotBefore = JSON.stringify(synthetic.scene.project);
    for (const timeMs of [...orderB, ...orderA]) sample(timeMs);
    expect(JSON.stringify(synthetic.scene.project)).toBe(snapshotBefore);

    const pose = { offsetX: 0, offsetY: 0, rotationDeg: 42, scale: 1.35 };
    const movedPivot = transformPoint(
      // Apply just D(t), using a dummy identity base transform.
      applyPoseToImageTransform(
        { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        synthetic.pivot,
        pose,
      ),
      synthetic.pivot,
    );
    expect(movedPivot.x).toBeCloseTo(synthetic.pivot.x, 10);
    expect(movedPivot.y).toBeCloseTo(synthetic.pivot.y, 10);
    const offsetPose = { ...pose, offsetX: 7, offsetY: -5 };
    const translatedPivot = transformPoint(
      applyPoseToImageTransform(
        { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        synthetic.pivot,
        offsetPose,
      ),
      synthetic.pivot,
    );
    expect(translatedPivot.x).toBeCloseTo(synthetic.pivot.x + 7, 10);
    expect(translatedPivot.y).toBeCloseTo(synthetic.pivot.y - 5, 10);

    const baseBounds = transformedBounds(synthetic.scene.parts, synthetic.baseMatrices);
    const dynamicMatrices = new Map(synthetic.baseMatrices);
    dynamicMatrices.set(
      synthetic.targetPart.partId,
      sample(1_000),
    );
    const dynamicBounds = transformedBounds(synthetic.scene.parts, dynamicMatrices);
    expect(dynamicBounds).not.toEqual(baseBounds);
    expect(synthetic.scene.visual.ownerTransform.x).toBe(960);
    expect(synthetic.scene.visual.ownerTransform.y).toBe(540);

    if (artifacts) {
      artifacts.synthetic = {
        ...artifacts.synthetic,
        deterministicRandomReverseSeek: true,
        projectSnapshotUnchanged: true,
        pivotStationaryAtRotationAndScale: true,
        pivotOffsetOnlyTranslation: true,
        dynamicBoundsChanged: true,
        ownerPositionUnchanged: {
          x: synthetic.scene.visual.ownerTransform.x,
          y: synthetic.scene.visual.ownerTransform.y,
        },
      };
    }
  });

  it('preserves explicit full turns, crosses +/-180 continuously, and rejects invalid inputs', () => {
    const fullTurn = interpolatePoseAtTime(
      staticPose,
      { ...staticPose, timeMs: 1_000, rotationDeg: 360 },
      500,
    );
    expect(fullTurn.rotationDeg).toBe(180);
    const positiveBoundaryCrossing = interpolatePoseAtTime(
      { ...staticPose, rotationDeg: 170 },
      { ...staticPose, timeMs: 1_000, rotationDeg: -170 },
      500,
    );
    expect(positiveBoundaryCrossing.rotationDeg).toBe(180);
    const negativeBoundaryCrossing = interpolatePoseAtTime(
      { ...staticPose, rotationDeg: -170 },
      { ...staticPose, timeMs: 1_000, rotationDeg: 170 },
      500,
    );
    expect(negativeBoundaryCrossing.rotationDeg).toBe(-180);
    expect(() =>
      interpolatePoseAtTime(
        { ...staticPose, rotationDeg: Number.NaN },
        syntheticGoalPose,
        500,
      ),
    ).toThrow(/finite/u);
    expect(() => interpolatePoseAtTime(staticPose, staticPose, 0)).toThrow(/after/u);
    expect(() =>
      interpolatePoseAtTime(
        staticPose,
        { ...syntheticGoalPose, scale: 0 },
        500,
      ),
    ).toThrow(/scale/u);
    expect(() =>
      applyPoseToImageTransform(
        { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        { x: 0, y: 0 },
        { offsetX: 0, offsetY: 0, rotationDeg: 0, scale: 0 },
      ),
    ).toThrow(/invalid/u);
    expect(() =>
      inverseAffine({ a: 1, b: 2, c: 2, d: 4, tx: 0, ty: 0 }),
    ).toThrow(/singular/u);
    expect(() =>
      transformPoint({ a: Number.NaN, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, { x: 1, y: 1 }),
    ).toThrow(/finite/u);

    if (artifacts) {
      artifacts.synthetic = {
        ...artifacts.synthetic,
        fullTurn0To360MidpointDeg: fullTurn.rotationDeg,
        boundaryCrossingsDeg: [
          positiveBoundaryCrossing.rotationDeg,
          negativeBoundaryCrossing.rotationDeg,
        ],
        invalidFiniteScaleDegenerateCasesRejected: true,
      };
    }
  });

  it('renders one private real Part through the current v16 static geometry', () => {
    const real = createRealArtifacts();
    if (real.status !== 'READY_FOR_PRIVATE_VISUAL_REVIEW') {
      artifacts = {
        outputDir: path.resolve(OUTPUT_DIR),
        publicSyntheticSvg: PUBLIC_SYNTHETIC_SVG,
        publicSyntheticPng: path.join(ARTIFACT_DIR, 'synthetic-contact-sheet.png'),
        syntheticStaticSvg: path.join(OUTPUT_DIR, 'synthetic-static.svg'),
        syntheticNeutralSvg: path.join(OUTPUT_DIR, 'synthetic-neutral.svg'),
        privateRealSvg: null,
        privateRealShoulderSvg: null,
        receiptPath: path.join(OUTPUT_DIR, 'receipt.json'),
        synthetic: artifacts?.synthetic ?? {},
        realAsset: real,
      };
      expect(real.status).toMatch(/REAL_ASSET_NOT_RUN|ASSET_LIMITED/u);
      return;
    }

    const staticSvg = real.staticSvg as string;
    const neutralSvg = real.neutralSvg as string;
    const contact = real.contact as string;
    const shoulderContact = real.shoulderContact as string;
    expect(staticSvg).toContain('data:image/png;base64');
    // Each image is embedded only in the private contact sheet and private run folder.
    expect(contact).toContain('data:image/png;base64');
    expect(real.sourceFileUnchanged).toBe(true);
    expect(real.sourceShaMatchesImportedIdentity).toBe(true);
    expect(real.projectSchemaVersionAfterCurrentMigration).toBe(PROJECT_SCHEMA_VERSION);
    expect(real.currentProjectSchemaVersion).toBe(16);
    expect(real.partName).toBe(REAL_TARGET_PART_NAME);
    expect(real.sourceCategory).toContain('Independent sleeve/arm Part');
    expect(real.ownerTransformFixed).toBe(true);
    expect(real.siblingTransformsUnchanged).toBe(true);
    expect(real.projectSnapshotUnchanged).toBe(true);
    expect(real.neutralMatrixExact).toBe(true);
    expect((real.frameTimesMs as number[])).toEqual([0, 250, 500, 750, 1_000]);
    expect((real.frameAnglesDeg as number[])).toEqual([0, -3, -6, -9, -12]);
    expect((real.sourcePartImageMapping as { crop: { x: number; y: number; width: number; height: number }; exportScale: number }).crop).toEqual({
      x: 0,
      y: 0,
      width: 1_920,
      height: 1_080,
    });
    expect((real.sourcePartImageMapping as { exportScale: number }).exportScale).toBe(1);

    const dir = path.resolve(OUTPUT_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const privateRealSvg = path.join(dir, 'private-real-contact-sheet.svg');
    const privateRealShoulderSvg = path.join(
      dir,
      'private-real-shoulder-contact-sheet.svg',
    );
    const staticPath = path.join(dir, 'private-real-static.svg');
    const neutralPath = path.join(dir, 'private-real-neutral.svg');
    fs.writeFileSync(privateRealSvg, contact, 'utf8');
    fs.writeFileSync(privateRealShoulderSvg, shoulderContact, 'utf8');
    fs.writeFileSync(staticPath, staticSvg, 'utf8');
    fs.writeFileSync(neutralPath, neutralSvg, 'utf8');
    artifacts = {
      outputDir: dir,
      publicSyntheticSvg: PUBLIC_SYNTHETIC_SVG,
      publicSyntheticPng: path.join(ARTIFACT_DIR, 'synthetic-contact-sheet.png'),
      syntheticStaticSvg: path.join(dir, 'synthetic-static.svg'),
      syntheticNeutralSvg: path.join(dir, 'synthetic-neutral.svg'),
      privateRealSvg,
      privateRealShoulderSvg,
      receiptPath: path.join(dir, 'receipt.json'),
      synthetic: artifacts?.synthetic ?? {},
      realAsset: {
        status: 'READY_FOR_PRIVATE_VISUAL_REVIEW',
        corpusEvidenceId: CORPUS_EVIDENCE_ID,
        partName: REAL_TARGET_PART_NAME,
        pivotSource: REAL_PIVOT_SOURCE,
        pivotCharacter: real.pivotCharacter,
        angleRangeTestedDeg: real.angleRangeTestedDeg,
        frameTimesMs: real.frameTimesMs,
        frameAnglesDeg: real.frameAnglesDeg,
        projectSchemaVersionAtImport: real.projectSchemaVersionAtImport,
        projectSchemaVersionAfterCurrentMigration: real.projectSchemaVersionAfterCurrentMigration,
        sourceSha256: real.sourceSha256,
        sourceCategory: real.sourceCategory,
        sourceShaMatchesImportedIdentity: real.sourceShaMatchesImportedIdentity,
        sourceFileUnchanged: real.sourceFileUnchanged,
        sourcePartPngSha256: real.sourcePartPngSha256,
        sourcePartImageMapping: real.sourcePartImageMapping,
        sourceRootTransform: real.sourceRootTransform,
        restTransform: real.restTransform,
        sourceAnchor: real.sourceAnchor,
        pivotCalibrationMethod: real.pivotCalibrationMethod,
        oneCalibrationAttempt: real.oneCalibrationAttempt,
        ownerTransformFixed: real.ownerTransformFixed,
        siblingTransformsUnchanged: real.siblingTransformsUnchanged,
        projectSnapshotUnchanged: real.projectSnapshotUnchanged,
        neutralMatrixExact: real.neutralMatrixExact,
        visualReview: 'PENDING_LOCAL_CONTACT_SHEET_REVIEW',
      },
    };
  });

  afterAll(() => {
    if (!artifacts) return;
    fs.mkdirSync(artifacts.outputDir, { recursive: true });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();
    const receipt = {
      schema: 'c5-kf-00-research-receipt/v1',
      generatedAt: new Date().toISOString(),
      baselineHead: 'c5da50a7c32f77c01676b4ac0e295ccf3ccda659',
      experimentHead: head,
      branch: execFileSync('git', ['branch', '--show-current'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      }).trim(),
      command: 'pnpm research:c5-kf-00',
      process: {
        projectSave: 'NOT_RUN',
        productionUi: 'NOT_RUN',
        productTimer: 'NOT_RUN',
        formalExport: 'NOT_RUN',
      },
      synthetic: artifacts.synthetic,
      realAsset: artifacts.realAsset,
      outputs: {
        publicSyntheticSvg: artifacts.publicSyntheticSvg,
        publicSyntheticPng: artifacts.publicSyntheticPng,
        privateRealSvg: artifacts.privateRealSvg,
        privateRealShoulderSvg: artifacts.privateRealShoulderSvg,
      },
      capturePending: true,
    };
    fs.writeFileSync(artifacts.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    fs.writeFileSync(
      path.join(artifacts.outputDir, 'visual-manifest.json'),
      `${JSON.stringify({
        publicSyntheticSvg: artifacts.publicSyntheticSvg,
        publicSyntheticPng: artifacts.publicSyntheticPng,
        syntheticStaticSvg: artifacts.syntheticStaticSvg,
        syntheticNeutralSvg: artifacts.syntheticNeutralSvg,
        privateRealSvg: artifacts.privateRealSvg,
        privateRealStaticSvg:
          artifacts.privateRealSvg === null
            ? null
            : path.join(artifacts.outputDir, 'private-real-static.svg'),
        privateRealNeutralSvg:
          artifacts.privateRealSvg === null
            ? null
            : path.join(artifacts.outputDir, 'private-real-neutral.svg'),
        privateRealShoulderSvg: artifacts.privateRealShoulderSvg,
        receiptPath: artifacts.receiptPath,
      }, null, 2)}\n`,
      'utf8',
    );
    console.log(`C5_KF_00_RECEIPT ${artifacts.receiptPath}`);
  });
});
