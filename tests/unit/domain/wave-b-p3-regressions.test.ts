import { describe, expect, it } from 'vitest';
import {
  LayerMotionService,
  LayerService,
  ProjectSchema,
  evaluateShotAtTime,
  frameTimeMs,
  normalizeAngleDeg360,
  sampleRadialBurstInstances,
  type FlaGraphicDefinition,
  type Point,
  type Project,
} from '../../../src/domain';
import { NameSchema } from '../../../src/domain/models/common';
import { EditorProjectStore } from '../../../src/renderer/stores/EditorProjectStore';
import { LayerSelectionStore } from '../../../src/renderer/stores/selectionStore';
import { LayerStore } from '../../../src/renderer/stores/layerStore';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../../helpers/graphicFaceProject';
import { IDS } from './testProject';

const LONG_NAME_200 = '长名称素材'.repeat(40);
const SHORT_NAME = '剑气';

function createWaveBProject(sourceName: string): {
  readonly project: Project;
  readonly shotId: string;
  readonly sourceId: string;
  readonly refBackId: string;
  readonly refFrontId: string;
  readonly definitionId: string;
} {
  const base = graphicFaceProject();
  const definition = base.animations[0] as FlaGraphicDefinition;
  definition.source.sourceFps = 4;
  definition.durationMs = 1_000;
  definition.frames = definition.frames.map((frame, ordinal) => ({
    ...frame,
    startMs: ordinal * 250,
    durationMs: 250,
  }));

  const noCharProject = ProjectSchema.parse({
    ...base,
    characters: [],
    voiceProfiles: [],
    shots: base.shots.map((shot) => ({
      ...shot,
      durationMs: 3_000,
      dialogues: [],
      timelineEvents: [],
      layers: shot.layers.filter((l) => l.id === shot.backgroundLayerId),
    })),
  });

  const layerService = new LayerService();
  const placedSource = layerService.createFromAnimation(noCharProject, IDS.shot, {
    animationId: FACE_GRAPHIC_ID,
    position: { x: 400, y: 300 },
    startTimeMs: 0,
    playback: { mode: 'single-frame', endBehavior: 'hold' },
  });
  // Apply sourceName and scale the source so B02 background tiling fits cleanly within the tile limit.
  const scaledSourceProject = ProjectSchema.parse({
    ...placedSource.project,
    shots: placedSource.project.shots.map((shot) => ({
      ...shot,
      layers: shot.layers.map((layer) =>
        layer.id === placedSource.layer.id
          ? { ...layer, name: sourceName, scaleX: 3.2, scaleY: 2 }
          : layer,
      ),
    })),
  });

  const placedBack = layerService.createFromAnimation(scaledSourceProject, IDS.shot, {
    animationId: FACE_GRAPHIC_ID,
    position: { x: 960, y: 540 },
    startTimeMs: 0,
  });
  const placedFront = layerService.createFromAnimation(placedBack.project, IDS.shot, {
    animationId: FACE_GRAPHIC_ID,
    position: { x: 1020, y: 540 },
    startTimeMs: 0,
  });

  return {
    project: placedFront.project,
    shotId: IDS.shot,
    sourceId: placedSource.layer.id,
    refBackId: placedBack.layer.id,
    refFrontId: placedFront.layer.id,
    definitionId: FACE_GRAPHIC_ID,
  };
}

function createEditorHarness(project: Project, shotId: string, sourceId: string) {
  const editor = new EditorProjectStore();
  editor.open('D:/PandaStage-Acceptance/wave-b-p3-regression', project);
  const shots = { getCurrentShotId: () => shotId };
  const selection = new LayerSelectionStore(editor, {
    ...shots,
    subscribe: () => () => undefined,
  });
  selection.select(sourceId);
  const layers = new LayerStore(editor, shots, new LayerService(), selection);
  return { editor, layers, selection };
}

/**
 * Independent cubic Bézier evaluation using direct Bernstein basis expansion.
 * Does NOT call any production geometry helper from src/domain/geometry/cubicBezierPath.ts.
 */
function bernsteinCubicPoint(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  u: number,
): Point {
  const mu = 1 - u;
  const b0 = mu * mu * mu;
  const b1 = 3 * mu * mu * u;
  const b2 = 3 * mu * u * u;
  const b3 = u * u * u;
  return {
    x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
    y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y,
  };
}

/**
 * Independent dense polyline arc-length reference (N = 20,000 uniform parameter steps).
 */
function buildIndependentBezierArcReference(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  subdivisions = 20_000,
) {
  const xs = new Float64Array(subdivisions + 1);
  const ys = new Float64Array(subdivisions + 1);
  const cumArc = new Float64Array(subdivisions + 1);
  xs[0] = p0.x;
  ys[0] = p0.y;
  cumArc[0] = 0;

  for (let i = 1; i <= subdivisions; i += 1) {
    const pt = bernsteinCubicPoint(p0, p1, p2, p3, i / subdivisions);
    xs[i] = pt.x;
    ys[i] = pt.y;
    cumArc[i] = cumArc[i - 1]! + Math.hypot(pt.x - xs[i - 1]!, pt.y - ys[i - 1]!);
  }

  const totalLength = cumArc[subdivisions]!;

  function projectMonotonic(target: Point, minIndex: number) {
    let bestIdx = minIndex;
    let bestDist = Infinity;
    for (let i = minIndex; i <= subdivisions; i += 1) {
      const dist = Math.hypot(xs[i]! - target.x, ys[i]! - target.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return {
      index: bestIdx,
      arcLength: cumArc[bestIdx]!,
      distance: bestDist,
    };
  }

  return { totalLength, projectMonotonic };
}

function shortestAngleDeltaDeg(actualDeg: number, expectedDeg: number): number {
  const diff = normalizeAngleDeg360(actualDeg - expectedDeg + 180) - 180;
  return Math.abs(diff);
}

describe('Wave B P3-01: legal 200-char source layer names across B02–B05 (#1292)', () => {
  it('validates fixture precondition: 200-char source name is legal under NameSchema', () => {
    expect(LONG_NAME_200.length).toBe(200);
    expect(NameSchema.parse(LONG_NAME_200)).toBe(LONG_NAME_200);
  });

  interface WaveBCaseContext {
    readonly layers: LayerStore;
    readonly sourceId: string;
    readonly refBackId: string;
    readonly refFrontId: string;
  }

  const cases = [
    {
      id: 'B02 background tiles (loop)',
      expectedCount: 15,
      expectedSuffix: (index: number) => ` 铺排 ${index + 1}`,
      run: ({ layers, sourceId }: WaveBCaseContext) =>
        layers.generateBackgroundTiles(sourceId, {
          mode: 'loop',
          direction: 'left',
          periodFrames: 24,
        }),
    },
    {
      id: 'B03 orbit flight (2 references, 3 bands, 2 instances)',
      expectedCount: 6,
      expectedSuffix: (index: number) => {
        const bandLabels = ['后', '中', '前'] as const;
        const band = Math.floor(index / 2);
        const instance = (index % 2) + 1;
        return ` 环绕 ${instance} · ${bandLabels[band]}`;
      },
      run: ({ layers, sourceId, refBackId, refFrontId }: WaveBCaseContext) =>
        layers.generateOrbitFlight(sourceId, {
          referenceLayerIds: [refBackId, refFrontId],
          radiusX: 240,
          radiusY: 100,
          count: 2,
          startAngleDeg: 0,
          direction: 'clockwise',
          orientation: 'tangent',
          startFrame: 1,
          durationFrames: 24,
        }),
    },
    {
      id: 'B04 converging flight (12 instances)',
      expectedCount: 12,
      expectedSuffix: (index: number) => ` 汇聚 ${index + 1}`,
      run: ({ layers, sourceId }: WaveBCaseContext) =>
        layers.generateConvergingFlight(sourceId, {
          count: 12,
          target: { x: 960, y: 540 },
          radius: 360,
          bend: 100,
          startAngleDeg: 0,
          startFrame: 1,
          durationFrames: 12,
          staggerFrames: 1,
          seed: 42,
          orientation: 'tangent',
          hideAfterArrival: true,
        }),
    },
    {
      id: 'B05 diffusion ghosts (4 instances)',
      expectedCount: 4,
      expectedSuffix: (index: number) => ` 虚影 ${index + 1}`,
      run: ({ layers, sourceId }: WaveBCaseContext) =>
        layers.generateDiffusionGhosts(sourceId, {
          count: 4,
          startFrame: 1,
          durationFrames: 12,
          staggerFrames: 2,
          maxScale: 1.8,
          decay: 0.7,
        }),
    },
  ] as const;

  for (const testCase of cases) {
    it(`${testCase.id}: truncates base name to reserve full suffix, preserves source/ownership/order/history`, () => {
      const fixture = createWaveBProject(LONG_NAME_200);
      const { editor, layers } = createEditorHarness(
        fixture.project,
        fixture.shotId,
        fixture.sourceId,
      );
      const beforeProject = editor.getSnapshot()!.project;

      const created = testCase.run({
        layers,
        sourceId: fixture.sourceId,
        refBackId: fixture.refBackId,
        refFrontId: fixture.refFrontId,
      });
      const afterProject = ProjectSchema.parse(editor.getSnapshot()!.project);
      const shot = afterProject.shots[0]!;

      // Source layer name and definition refs are unmodified.
      const sourceLayer = shot.layers.find((layer) => layer.id === fixture.sourceId)!;
      expect(sourceLayer.name).toBe(LONG_NAME_200);
      expect(afterProject.animations).toEqual(beforeProject.animations);

      // Expected count, unique IDs, NameSchema compliance, and intact suffixes.
      expect(created).toHaveLength(testCase.expectedCount);
      const createdIds = new Set(created.map((layer) => layer.id));
      expect(createdIds.size).toBe(testCase.expectedCount);
      expect(createdIds.has(fixture.sourceId)).toBe(false);

      created.forEach((layer, index) => {
        const suffix = testCase.expectedSuffix(index);
        expect(NameSchema.parse(layer.name)).toBe(layer.name);
        expect(layer.name.length).toBeLessThanOrEqual(200);
        expect(layer.name.endsWith(suffix)).toBe(true);
        expect(layer.name.length).toBe(200);

        // Definition ref & animationClip ownership stay bound to each generated instance.
        expect(layer.source).toEqual({
          kind: 'animation',
          animationId: fixture.definitionId,
        });
        if (layer.animationClip?.version === 2) {
          expect(layer.animationClip.targetBases).toHaveLength(1);
          expect(layer.animationClip.targetBases[0]!.target).toEqual({
            kind: 'layer',
            layerId: layer.id,
          });
          for (const track of layer.animationClip.tracks) {
            expect(track.target).toEqual({ kind: 'layer', layerId: layer.id });
          }
        }
      });

      // Layer zIndex ordering is contiguous 0..N-1.
      const sorted = [...shot.layers].sort((a, b) => a.zIndex - b.zIndex);
      expect(sorted.map((layer) => layer.zIndex)).toEqual(
        sorted.map((_, zIndex) => zIndex),
      );

      // Single-History undo / redo round-trip.
      expect(editor.history.getSnapshot().undoCount).toBe(1);
      expect(editor.undo()).toBe(true);
      expect(editor.getSnapshot()!.project).toEqual(beforeProject);
      expect(
        editor.getSnapshot()!.project.shots[0]!.layers.find(
          (layer) => layer.id === fixture.sourceId,
        )!.name,
      ).toBe(LONG_NAME_200);
      expect(editor.redo()).toBe(true);
      expect(editor.getSnapshot()!.project).toEqual(afterProject);
    });

    it(`${testCase.id}: preserves exact short-name formatting without truncation`, () => {
      const fixture = createWaveBProject(SHORT_NAME);
      const { layers } = createEditorHarness(
        fixture.project,
        fixture.shotId,
        fixture.sourceId,
      );
      const created = testCase.run({
        layers,
        sourceId: fixture.sourceId,
        refBackId: fixture.refBackId,
        refFrontId: fixture.refFrontId,
      });

      expect(created).toHaveLength(testCase.expectedCount);
      created.forEach((layer, index) => {
        expect(layer.name).toBe(`${SHORT_NAME}${testCase.expectedSuffix(index)}`);
      });
    });
  }
});

describe('Wave B P3-02: B03 orbit flight counter-clockwise, multi-phase, non-center pivot (#1287/#1292)', () => {
  it('verifies position, tangent orientation, front/mid/back complementary visibility, and layer order across frames', () => {
    const fixture = createWaveBProject('飞剑');
    const motionService = new LayerMotionService();
    // Apply non-center pivot on the 200x200 Graphic source (center is 100,100).
    const withNonCenterPivot = motionService.recalibratePivot(
      fixture.project,
      { shotId: fixture.shotId, layerId: fixture.sourceId },
      { space: 'target-local', x: 140, y: 104 },
    );

    const layerService = new LayerService();
    const input = {
      referenceLayerIds: [fixture.refBackId, fixture.refFrontId],
      center: { x: 960, y: 540 },
      radiusX: 260,
      radiusY: 120,
      count: 3,
      startAngleDeg: 30,
      direction: 'counterclockwise' as const,
      orientation: 'tangent' as const,
      startFrame: 2,
      durationFrames: 48,
    };

    const result = layerService.generateOrbitFlight(
      withNonCenterPivot,
      fixture.shotId,
      fixture.sourceId,
      input,
    );
    const shot = result.project.shots[0]!;

    // 3 bands (后/中/前) x 3 instances = 9 generated layers.
    expect(result.layers).toHaveLength(9);

    // Group generated layers by instance (0..2) and band (0=后, 1=中, 2=前).
    // generateOrbitFlight returns bands.flat(): [band0_inst0..2, band1_inst0..2, band2_inst0..2].
    const byBand = [
      result.layers.slice(0, 3),
      result.layers.slice(3, 6),
      result.layers.slice(6, 9),
    ] as const;

    // Layer order contract: all 后 < refBack < all 中 < refFront < all 前.
    const refBackZ = shot.layers.find((l) => l.id === fixture.refBackId)!.zIndex;
    const refFrontZ = shot.layers.find((l) => l.id === fixture.refFrontId)!.zIndex;
    expect(refBackZ).toBeLessThan(refFrontZ);
    for (const backLayer of byBand[0]) {
      expect(backLayer.zIndex).toBeLessThan(refBackZ);
    }
    for (const midLayer of byBand[1]) {
      expect(midLayer.zIndex).toBeGreaterThan(refBackZ);
      expect(midLayer.zIndex).toBeLessThan(refFrontZ);
    }
    for (const frontLayer of byBand[2]) {
      expect(frontLayer.zIndex).toBeGreaterThan(refFrontZ);
    }

    // All generated layers hidden before startFrame and after endFrame.
    const generatedIds = new Set(result.layers.map((l) => l.id));
    const visibleBefore = evaluateShotAtTime(
      shot,
      frameTimeMs(input.startFrame - 1),
      result.project,
    ).layers.filter((l) => generatedIds.has(l.id) && l.visible);
    expect(visibleBefore).toHaveLength(0);

    const visibleAfter = evaluateShotAtTime(
      shot,
      frameTimeMs(input.startFrame + input.durationFrames + 1),
      result.project,
    ).layers.filter((l) => generatedIds.has(l.id) && l.visible);
    expect(visibleAfter).toHaveLength(0);

    // Verify representative frames (including boundaries, quarters, and midpoints).
    const representativeSteps = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48];
    const previousRotations: (number | undefined)[] = [undefined, undefined, undefined];

    for (const step of representativeSteps) {
      const frame = input.startFrame + step;
      const evaluated = evaluateShotAtTime(shot, frameTimeMs(frame), result.project);
      const evalById = new Map(evaluated.layers.map((l) => [l.id, l]));

      for (let instance = 0; instance < input.count; instance += 1) {
        const instanceBandLayers = [
          byBand[0][instance]!,
          byBand[1][instance]!,
          byBand[2][instance]!,
        ] as const;

        const theta =
          2 *
          Math.PI *
          (input.startAngleDeg / 360 +
            instance / input.count -
            step / input.durationFrames);
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);

        const expectedX = input.center.x + input.radiusX * cos;
        const expectedY = input.center.y + input.radiusY * sin;
        // Counter-clockwise derivative: d/dt (rx cos, ry sin) with dtheta/dt < 0
        // => (+rx sin, -ry cos).
        const expectedTangentDeg =
          (Math.atan2(-input.radiusY * cos, input.radiusX * sin) * 180) / Math.PI;
        const expectedBand =
          sin >= 0.5 - 1e-12 ? 2 : sin >= -0.5 - 1e-12 ? 1 : 0;

        // Complementary visibility: exactly 1 of the 3 band layers is visible.
        const visibleBands = instanceBandLayers
          .map((layer, band) => ({ band, evaluated: evalById.get(layer.id)! }))
          .filter((entry) => entry.evaluated.visible);
        expect(visibleBands).toHaveLength(1);
        expect(visibleBands[0]!.band).toBe(expectedBand);

        // Non-center pivot must be compensated so stage anchor hits the exact orbit point.
        const active = visibleBands[0]!.evaluated;
        expect(active.x).toBeCloseTo(expectedX, 4);
        expect(active.y).toBeCloseTo(expectedY, 4);

        // Tangent orientation matches CCW velocity vector.
        expect(shortestAngleDeltaDeg(active.rotationDeg, expectedTangentDeg)).toBeLessThan(
          1e-4,
        );

        // Unwrapped rotation continuity between sampled frames (4-frame step = 30° orbit step).
        const prevRot = previousRotations[instance];
        if (prevRot !== undefined) {
          expect(Math.abs(active.rotationDeg - prevRot)).toBeLessThan(65);
        }
        previousRotations[instance] = active.rotationDeg;
      }
    }

    // Verify all 3 bands are actually visited by each instance over a full revolution.
    for (let instance = 0; instance < input.count; instance += 1) {
      const seenBands = new Set<number>();
      for (let step = 0; step <= input.durationFrames; step += 1) {
        const evaluated = evaluateShotAtTime(
          shot,
          frameTimeMs(input.startFrame + step),
          result.project,
        );
        const evalById = new Map(evaluated.layers.map((l) => [l.id, l]));
        const visibleBands = [0, 1, 2].filter(
          (band) => evalById.get(byBand[band]![instance]!.id)!.visible,
        );
        expect(visibleBands).toHaveLength(1);
        seenBands.add(visibleBands[0]!);
      }
      expect(seenBands).toEqual(new Set([0, 1, 2]));
    }
  });
});

describe('Wave B P3-02: B04 converging flight independent arc-length verification (#1288/#1292)', () => {
  it('verifies equal arc-length spacing and endpoint precision via independent dense quadrature', () => {
    const fixture = createWaveBProject('飞剑');
    const motionService = new LayerMotionService();
    const withNonCenterPivot = motionService.recalibratePivot(
      fixture.project,
      { shotId: fixture.shotId, layerId: fixture.sourceId },
      { space: 'target-local', x: 140, y: 104 },
    );

    const layerService = new LayerService();
    const input = {
      count: 6,
      target: { x: 960, y: 540 },
      radius: 380,
      bend: 180,
      startAngleDeg: 15,
      startFrame: 2,
      durationFrames: 24,
      staggerFrames: 2,
      seed: 42,
      orientation: 'tangent' as const,
      hideAfterArrival: true,
    };

    const result = layerService.generateConvergingFlight(
      withNonCenterPivot,
      fixture.shotId,
      fixture.sourceId,
      input,
    );
    const shot = result.project.shots[0]!;
    expect(result.layers).toHaveLength(input.count);

    const distribution = sampleRadialBurstInstances({
      count: input.count,
      center: input.target,
      radius: input.radius,
      startAngleDeg: input.startAngleDeg,
      seed: input.seed,
      maxRotationDeg: 0,
    });

    for (const [index, layer] of result.layers.entries()) {
      const distSample = distribution[index]!;
      const origin = distSample.endPoint;
      const target = input.target;
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      const chord = Math.hypot(dx, dy);
      const signedBend = input.bend * (2 * distSample.w - 1);
      const normal = { x: (-dy / chord) * signedBend, y: (dx / chord) * signedBend };
      const p0 = origin;
      const p1 = { x: origin.x + dx / 3 + normal.x, y: origin.y + dy / 3 + normal.y };
      const p2 = {
        x: origin.x + (dx * 2) / 3 + normal.x,
        y: origin.y + (dy * 2) / 3 + normal.y,
      };
      const p3 = target;

      const reference = buildIndependentBezierArcReference(p0, p1, p2, p3, 20_000);
      const targetStepArc = reference.totalLength / input.durationFrames;
      // Same error contract as A02 arc-length verification: max(0.5 px, 2% of step arc).
      const stepTolerance = Math.max(0.5, targetStepArc * 0.02);

      const launchFrame = input.startFrame + index * input.staggerFrames;
      const sampledPositions: Point[] = [];
      for (let step = 0; step <= input.durationFrames; step += 1) {
        const evaluated = evaluateShotAtTime(
          shot,
          frameTimeMs(launchFrame + step),
          result.project,
        ).layers.find((entry) => entry.id === layer.id)!;
        expect(evaluated.visible).toBe(true);
        sampledPositions.push({ x: evaluated.x, y: evaluated.y });
      }

      // Endpoint precision contract.
      expect(sampledPositions[0]!.x).toBeCloseTo(p0.x, 5);
      expect(sampledPositions[0]!.y).toBeCloseTo(p0.y, 5);
      expect(sampledPositions[input.durationFrames]!.x).toBeCloseTo(p3.x, 5);
      expect(sampledPositions[input.durationFrames]!.y).toBeCloseTo(p3.y, 5);

      // Independent adjacent arc-length spacing & cumulative arc-length checks.
      let cursor = 0;
      let prevArc = 0;
      for (let step = 1; step <= input.durationFrames; step += 1) {
        const hit = reference.projectMonotonic(sampledPositions[step]!, cursor);
        expect(hit.distance).toBeLessThan(0.1);

        const stepArc = hit.arcLength - prevArc;
        expect(Math.abs(stepArc - targetStepArc)).toBeLessThanOrEqual(stepTolerance);
        expect(Math.abs(hit.arcLength - step * targetStepArc)).toBeLessThanOrEqual(
          stepTolerance,
        );

        cursor = hit.index;
        prevArc = hit.arcLength;
      }
      expect(Math.abs(prevArc - reference.totalLength)).toBeLessThanOrEqual(0.1);
    }
  });
});
