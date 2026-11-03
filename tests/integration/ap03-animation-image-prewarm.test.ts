import { describe, expect, it, vi } from 'vitest';
import {
  evaluateShotAtTime,
  ProjectSchema,
  type Project,
} from '../../src/domain';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { buildProductPreviewImagePlan } from '../../src/renderer/shell/productPreviewModel';
import {
  buildStageImageSourceKey,
  isStageFrameReady,
  StageImageResourceSession,
  type StageImageLayerSource,
} from '../../src/renderer/stage/stageImageResourceSession';
import { buildProjectWithAnimation, IDS } from '../unit/domain/testProject';

const LAYER_A = '70000000-0000-4000-8000-000000000021';
const LAYER_B = '70000000-0000-4000-8000-000000000022';

interface FakeImage {
  onload: ((event: Event) => unknown) | null;
  onerror: ((event: Event | string) => unknown) | null;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  succeed(): void;
}

function createImage(): FakeImage {
  return {
    onload: null,
    onerror: null,
    src: '',
    naturalWidth: 640,
    naturalHeight: 640,
    succeed() {
      this.onload?.({} as Event);
    },
  };
}

function animationLayer(
  id: string,
  options: {
    startTimeMs: number;
    mode: 'once' | 'loop';
    endBehavior: 'hold' | 'hide';
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotationDeg: number;
    opacity: number;
    zIndex: number;
    flipX: boolean;
  },
) {
  const {
    startTimeMs,
    mode,
    endBehavior,
    x,
    y,
    scaleX,
    scaleY,
    rotationDeg,
    opacity,
    zIndex,
    flipX,
  } = options;
  return {
    id,
    name: id === LAYER_A ? 'A' : 'B',
    source: { kind: 'animation' as const, animationId: IDS.animation },
    anchor: 'center' as const,
    startTimeMs,
    animationPlayback: { mode, endBehavior },
    x,
    y,
    scaleX,
    scaleY,
    rotationDeg,
    opacity,
    zIndex,
    flipX,
    visible: true,
    locked: false,
  };
}

function build21FrameProject(
  options: { includeSecond?: boolean; secondEndBehavior?: 'hold' | 'hide' } = {},
): Project {
  const base = buildProjectWithAnimation();
  const sourceAnimation = base.animations[0]!;
  const frameAssets = sourceAnimation.frames.map((frame, ordinal) => {
    const id = `81000000-0000-4000-8000-${String(ordinal + 1).padStart(12, '0')}`;
    const sha256 = ordinal.toString(16).padStart(64, '0');
    return {
      id,
      kind: 'image' as const,
      name: `synthetic-walk-${ordinal}`,
      relativePath: `assets/synthetic-walk-${ordinal}.png`,
      mimeType: 'image/png',
      width: 640,
      height: 640,
      sha256,
      usage: 'uncategorized' as const,
      keywords: ['synthetic', 'issue947'],
      frame: {
        ...frame,
        assetId: id,
        sha256,
        sourceViewport: {
          x: 100 + ordinal * 3,
          y: 100 + ordinal,
          width: 640,
          height: 640,
        },
        offset: { x: ordinal * 3, y: ordinal },
      },
    };
  });
  const animation = {
    ...sourceAnimation,
    frames: frameAssets.map((asset) => asset.frame),
  };
  const layerA = animationLayer(LAYER_A, {
    startTimeMs: 0,
    mode: 'loop',
    endBehavior: 'hold',
    x: 300,
    y: 400,
    scaleX: 1,
    scaleY: 0.9,
    rotationDeg: 7,
    opacity: 0.8,
    zIndex: 3,
    flipX: false,
  });
  const layers = [layerA];
  if (options.includeSecond ?? true) {
    layers.push(animationLayer(LAYER_B, {
      startTimeMs: 1_000,
      mode: 'once',
      endBehavior: options.secondEndBehavior ?? 'hold',
      x: 900,
      y: 600,
      scaleX: 1.5,
      scaleY: 1.25,
      rotationDeg: -11,
      opacity: 0.6,
      zIndex: 4,
      flipX: true,
    }));
  }

  return ProjectSchema.parse({
    ...base,
    assets: [...base.assets, ...frameAssets.map(({ frame, ...asset }) => {
      void frame;
      return asset;
    })],
    animations: [animation],
    shots: base.shots.map((shot) => ({
      ...shot,
      durationMs: 3_000,
      backgroundLayerId: null,
      layers,
      timelineEvents: [],
    })),
  });
}

function buildAssetUrls(project: Project): Record<string, string> {
  return Object.fromEntries(
    project.animations[0]!.frames.map((frame) => [
      frame.assetId,
      `blob:issue947-${frame.assetId}-${frame.sha256}`,
    ]),
  );
}

function makeHarness(): { session: StageImageResourceSession; images: FakeImage[] } {
  const images: FakeImage[] = [];
  const session = new StageImageResourceSession({
    createImage: () => {
      const image = createImage();
      images.push(image);
      return image as unknown as HTMLImageElement;
    },
  });
  return { session, images };
}

function buildSources(
  project: Project,
  evaluatedShot: ReturnType<typeof evaluateShotAtTime>,
  assetUrls: Readonly<Record<string, string>>,
): { current: StageImageLayerSource[]; upcoming: StageImageLayerSource[]; model: ReturnType<typeof buildStageRenderModel> } {
  const model = buildStageRenderModel(project, evaluatedShot, assetUrls);
  const current = model.layers.flatMap((layer) =>
    layer.parts.map((part) => ({
      id: part.id,
      assetId: part.asset.id,
      projectId: project.id,
      sha256: part.asset.sha256,
      sourceUrl: part.sourceUrl,
    })),
  );
  const plan = buildProductPreviewImagePlan(
    project,
    project.shots.find((shot) => shot.id === evaluatedShot.shotId)!,
    evaluatedShot,
  );
  const upcoming = plan.recentAnimationAssetIds.flatMap((assetId) => {
    const frame = project.animations[0]!.frames.find(
      (candidate) => candidate.assetId === assetId,
    );
    const sourceUrl = assetUrls[assetId];
    if (!frame || !sourceUrl) return [];
    return [{
      id: `prewarm:${assetId}`,
      assetId,
      projectId: project.id,
      sha256: frame.sha256,
      sourceUrl,
    }];
  });
  return { current, upcoming, model };
}

function settleImageLoads(images: readonly FakeImage[]): void {
  for (let turn = 0; turn < 100; turn += 1) {
    const loading = images.filter((image) => image.onload !== null);
    if (loading.length === 0) return;
    loading.forEach((image) => image.succeed());
  }
  throw new Error('Synthetic Stage image queue did not settle.');
}

interface ControlledImageLoadRecord {
  sourceUrl: string;
  submittedAtMs: number;
  roleAtSubmit: 'required' | 'optional';
  requiredAtMs: number | null;
  decodeStartedAtMs: number | null;
  readyAtMs: number | null;
  cancelledAtMs: number | null;
}

interface ControlledImageTask {
  image: FakeImage;
  record: ControlledImageLoadRecord;
  status: 'queued' | 'running' | 'complete' | 'cancelled';
  timer: ReturnType<typeof setTimeout> | null;
}

/** Models a test-only shared two-slot decode budget under deterministic latency. */
class ControlledImageDecodePool {
  readonly records: ControlledImageLoadRecord[] = [];

  private readonly queue: ControlledImageTask[] = [];
  private readonly tasksByUrl = new Map<string, ControlledImageTask[]>();
  private readonly tasksByImage = new WeakMap<object, ControlledImageTask>();
  private requiredSourceUrls = new Set<string>();
  private activeCount = 0;

  constructor(
    private readonly delayMs: number,
    private readonly concurrency = 2,
  ) {}

  setRequiredSourceUrls(sourceUrls: readonly string[]): void {
    this.requiredSourceUrls = new Set(sourceUrls);
    for (const sourceUrl of this.requiredSourceUrls) {
      const task = this.latestTask(sourceUrl);
      if (task && task.record.requiredAtMs === null) {
        task.record.requiredAtMs = Date.now();
      }
    }
  }

  createImage(): HTMLImageElement {
    const cancelTask = (queuedTask: ControlledImageTask) =>
      this.cancel(queuedTask);
    const submitTask = (image: FakeImage, sourceUrl: string) =>
      this.submit(image, sourceUrl);
    let sourceUrl = '';
    let task: ControlledImageTask | null = null;
    const image: FakeImage = {
      onload: null,
      onerror: null,
      naturalWidth: 640,
      naturalHeight: 640,
      get src() {
        return sourceUrl;
      },
      set src(nextSourceUrl: string) {
        if (task) cancelTask(task);
        sourceUrl = nextSourceUrl;
        task = nextSourceUrl ? submitTask(image, nextSourceUrl) : null;
      },
      succeed() {
        this.onload?.({} as Event);
      },
    };
    return image as unknown as HTMLImageElement;
  }

  latestRecord(sourceUrl: string): ControlledImageLoadRecord | null {
    return this.latestTask(sourceUrl)?.record ?? null;
  }

  private latestTask(sourceUrl: string): ControlledImageTask | null {
    const tasks = this.tasksByUrl.get(sourceUrl);
    return tasks?.[tasks.length - 1] ?? null;
  }

  private submit(image: FakeImage, sourceUrl: string): ControlledImageTask {
    const now = Date.now();
    const required = this.requiredSourceUrls.has(sourceUrl);
    const record: ControlledImageLoadRecord = {
      sourceUrl,
      submittedAtMs: now,
      roleAtSubmit: required ? 'required' : 'optional',
      requiredAtMs: required ? now : null,
      decodeStartedAtMs: null,
      readyAtMs: null,
      cancelledAtMs: null,
    };
    const task: ControlledImageTask = {
      image,
      record,
      status: 'queued',
      timer: null,
    };
    this.records.push(record);
    const tasks = this.tasksByUrl.get(sourceUrl) ?? [];
    tasks.push(task);
    this.tasksByUrl.set(sourceUrl, tasks);
    this.tasksByImage.set(image as object, task);
    this.queue.push(task);
    this.pump();
    return task;
  }

  private pump(): void {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task || task.status !== 'queued') continue;
      task.status = 'running';
      task.record.decodeStartedAtMs = Date.now();
      this.activeCount += 1;
      task.timer = setTimeout(() => {
        if (task.status !== 'running') return;
        task.status = 'complete';
        task.timer = null;
        task.record.readyAtMs = Date.now();
        this.activeCount -= 1;
        task.image.onload?.({} as Event);
        this.pump();
      }, this.delayMs);
    }
  }

  private cancel(task: ControlledImageTask): void {
    if (task.status === 'complete' || task.status === 'cancelled') return;
    if (task.status === 'running') {
      if (task.timer !== null) clearTimeout(task.timer);
      task.timer = null;
      this.activeCount -= 1;
    } else {
      const queuedIndex = this.queue.indexOf(task);
      if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1);
    }
    task.status = 'cancelled';
    task.record.cancelledAtMs = Date.now();
    this.pump();
  }
}

interface StageFrameTimingRow {
  frameIndex: number;
  requestedAtMs: number;
  sourceUrl: string;
  decodeSubmittedAtMs: number | null;
  decodeStartedAtMs: number | null;
  requiredAtMs: number | null;
  requiredReadyAtMs: number | null;
  stageCommitAtMs: number | null;
  displayedFrameAtRequest: number;
}

type StageTimingEvent =
  | { kind: 'target'; frameIndex: number; atMs: number; sequence: number }
  | { kind: 'display'; frameIndex: number; atMs: number; sequence: number };

async function runControlledStageTimingScenario(
  delayMs: number,
  stagePrewarmEnabled: boolean,
  legacyPartScopedIdentity = false,
): Promise<{
  delayMs: number;
  stagePrewarmEnabled: boolean;
  legacyPartScopedIdentity: boolean;
  skippedTargetFrames: number[];
  maximumOldFrameHoldMs: number;
  oldFrameHoldIntervals: Array<{
    frameIndex: number;
    startedAtMs: number;
    endedAtMs: number;
    durationMs: number;
  }>;
  displayedTargetFrames: number[];
  rows: StageFrameTimingRow[];
}> {
  vi.clearAllTimers();
  vi.setSystemTime(-delayMs);
  const project = build21FrameProject({ includeSecond: false });
  const shot = project.shots[0]!;
  const assetUrls = buildAssetUrls(project);
  const pool = new ControlledImageDecodePool(delayMs, 2);
  const session = new StageImageResourceSession({
    createImage: () => pool.createImage(),
  });
  const rows: StageFrameTimingRow[] = [];
  const events: StageTimingEvent[] = [];
  let eventSequence = 0;
  let targetFrameIndex = 0;
  let displayedFrameIndex = -1;
  let desiredSourceKey = '';
  let targetRow: StageFrameTimingRow | null = null;
  let playStartedAtMs = 0;

  const elapsedMs = (): number => Date.now() - playStartedAtMs;
  const onStageState = (): void => {
    const state = session.getSnapshot();
    if (!state.ready || state.desiredSourceKey !== desiredSourceKey) return;
    if (targetRow && targetRow.stageCommitAtMs === null) {
      targetRow.stageCommitAtMs = elapsedMs();
      const load = pool.latestRecord(targetRow.sourceUrl);
      targetRow.decodeSubmittedAtMs = load
        ? load.submittedAtMs - playStartedAtMs
        : null;
      targetRow.decodeStartedAtMs = load?.decodeStartedAtMs === null || !load
        ? null
        : load.decodeStartedAtMs - playStartedAtMs;
      targetRow.requiredAtMs = load?.requiredAtMs === null || !load
        ? null
        : load.requiredAtMs - playStartedAtMs;
      targetRow.requiredReadyAtMs = load?.readyAtMs === null || !load
        ? null
        : load.readyAtMs - playStartedAtMs;
    }
    if (displayedFrameIndex !== targetFrameIndex) {
      displayedFrameIndex = targetFrameIndex;
      events.push({
        kind: 'display',
        frameIndex: targetFrameIndex,
        atMs: elapsedMs(),
        sequence: eventSequence++,
      });
    }
  };

  const initial = evaluateShotAtTime(shot, 0, project);
  const initialBuild = buildSources(project, initial, assetUrls);
  const normalizeSources = (sources: readonly StageImageLayerSource[]) =>
    legacyPartScopedIdentity
      ? sources.map(({ id, sourceUrl }) => ({ id, sourceUrl }))
      : sources;
  const initialSources = {
    ...initialBuild,
    current: normalizeSources(initialBuild.current),
    upcoming: normalizeSources(initialBuild.upcoming),
  };
  desiredSourceKey = buildStageImageSourceKey(initialSources.current);
  pool.setRequiredSourceUrls(initialSources.current.map((source) => source.sourceUrl));
  session.reconcile(initialSources.current, onStageState);
  await vi.advanceTimersByTimeAsync(delayMs);
  expect(session.getSnapshot().ready).toBe(true);
  expect(displayedFrameIndex).toBe(0);

  playStartedAtMs = Date.now();
  targetRow = null;
  if (stagePrewarmEnabled) session.prewarm(initialSources.upcoming);

  for (let frameIndex = 1; frameIndex < 21; frameIndex += 1) {
    await vi.advanceTimersByTimeAsync(40);
    targetFrameIndex = frameIndex;
    const requestedAtMs = elapsedMs();
    const evaluated = evaluateShotAtTime(shot, frameIndex * 40, project);
    const builtSources = buildSources(project, evaluated, assetUrls);
    const sources = {
      ...builtSources,
      current: normalizeSources(builtSources.current),
      upcoming: normalizeSources(builtSources.upcoming),
    };
    const source = sources.current[0];
    if (!source) throw new Error(`Frame ${frameIndex} has no required image source.`);
    desiredSourceKey = buildStageImageSourceKey(sources.current);
    const row: StageFrameTimingRow = {
      frameIndex,
      requestedAtMs,
      sourceUrl: source.sourceUrl,
      decodeSubmittedAtMs: null,
      decodeStartedAtMs: null,
      requiredAtMs: null,
      requiredReadyAtMs: null,
      stageCommitAtMs: null,
      displayedFrameAtRequest: displayedFrameIndex,
    };
    targetRow = row;
    rows.push(row);
    events.push({
      kind: 'target',
      frameIndex,
      atMs: requestedAtMs,
      sequence: eventSequence++,
    });
    pool.setRequiredSourceUrls(sources.current.map((current) => current.sourceUrl));
    session.reconcile(sources.current, onStageState);
    if (stagePrewarmEnabled) session.prewarm(sources.upcoming);
    const load = pool.latestRecord(source.sourceUrl);
    if (load) {
      row.decodeSubmittedAtMs = load.submittedAtMs - playStartedAtMs;
      row.decodeStartedAtMs = load.decodeStartedAtMs === null
        ? null
        : load.decodeStartedAtMs - playStartedAtMs;
      row.requiredAtMs = load.requiredAtMs === null
        ? null
        : load.requiredAtMs - playStartedAtMs;
      row.requiredReadyAtMs = load.readyAtMs === null
        ? null
        : load.readyAtMs - playStartedAtMs;
    }
  }

  // A 21-frame, 25fps loop returns to frame 0 at 840ms; do not credit
  // frame 20 with a completion after the next loop target has arrived.
  await vi.advanceTimersByTimeAsync(40);
  const finalTimeMs = elapsedMs();
  const skippedTargetFrames = rows
    .filter((row) => row.stageCommitAtMs === null)
    .map((row) => row.frameIndex);
  const orderedEvents = [...events].sort(
    (left, right) => left.atMs - right.atMs || left.sequence - right.sequence,
  );
  let visibleFrame = 0;
  let staleStartedAtMs: number | null = null;
  let maximumOldFrameHoldMs = 0;
  const oldFrameHoldIntervals: Array<{
    frameIndex: number;
    startedAtMs: number;
    endedAtMs: number;
    durationMs: number;
  }> = [];
  for (const event of orderedEvents) {
    if (event.kind === 'target') {
      if (visibleFrame < event.frameIndex && staleStartedAtMs === null) {
        staleStartedAtMs = event.atMs;
      }
      continue;
    }
    if (event.frameIndex > visibleFrame) {
      if (staleStartedAtMs !== null) {
        const durationMs = event.atMs - staleStartedAtMs;
        oldFrameHoldIntervals.push({
          frameIndex: visibleFrame,
          startedAtMs: staleStartedAtMs,
          endedAtMs: event.atMs,
          durationMs,
        });
        maximumOldFrameHoldMs = Math.max(maximumOldFrameHoldMs, durationMs);
        staleStartedAtMs = null;
      }
      visibleFrame = event.frameIndex;
    }
  }
  if (staleStartedAtMs !== null) {
    const durationMs = finalTimeMs - staleStartedAtMs;
    oldFrameHoldIntervals.push({
      frameIndex: visibleFrame,
      startedAtMs: staleStartedAtMs,
      endedAtMs: finalTimeMs,
      durationMs,
    });
    maximumOldFrameHoldMs = Math.max(maximumOldFrameHoldMs, durationMs);
  }
  session.dispose();
  return {
    delayMs,
    stagePrewarmEnabled,
    legacyPartScopedIdentity,
    skippedTargetFrames,
    maximumOldFrameHoldMs,
    oldFrameHoldIntervals,
    displayedTargetFrames: events
      .filter((event) => event.kind === 'display')
      .map((event) => event.frameIndex),
    rows,
  };
}

function evaluateLayer(
  project: Project,
  timeMs: number,
  layerId: string,
) {
  const shot = project.shots[0]!;
  return evaluateShotAtTime(shot, timeMs, project).layers.find(
    (layer) => layer.id === layerId,
  )!;
}

describe('Issue #947 AP-03 decoded image prewarm integration', () => {
  it('measures 21-frame target-to-display timing for the pre-AP03 path, current C, and C-only isolation', async () => {
    vi.useFakeTimers();
    try {
      const comparisons = [];
      const summarize = (result: Awaited<ReturnType<typeof runControlledStageTimingScenario>>) => ({
        path: result.legacyPartScopedIdentity
          ? 'pre-AP03-stage-contract'
          : result.stagePrewarmEnabled
            ? 'current-HEAD-C-on'
            : 'current-HEAD-C-isolated',
        skippedTargetFrames: result.skippedTargetFrames,
        displayedTargetFrames: result.displayedTargetFrames,
        maximumOldFrameHoldMs: result.maximumOldFrameHoldMs,
        oldFrameHoldIntervals: result.oldFrameHoldIntervals,
        frameTimings: result.rows.map((row) => [
          row.frameIndex,
          row.decodeStartedAtMs === null
            ? null
            : row.decodeStartedAtMs - row.requestedAtMs,
          row.requiredAtMs === null
            ? null
            : row.requiredAtMs - row.requestedAtMs,
          row.requiredReadyAtMs === null
            ? null
            : row.requiredReadyAtMs - row.requestedAtMs,
          row.stageCommitAtMs === null
            ? null
            : row.stageCommitAtMs - row.requestedAtMs,
          row.displayedFrameAtRequest,
        ]),
      });
      for (const delayMs of [20, 60, 100]) {
        const preAp03 = await runControlledStageTimingScenario(
          delayMs,
          false,
          true,
        );
        const currentHead = await runControlledStageTimingScenario(
          delayMs,
          true,
        );
        const cOnlyIsolated = await runControlledStageTimingScenario(
          delayMs,
          false,
        );
        comparisons.push({
          delayMs,
          preAp03: summarize(preAp03),
          currentHead: summarize(currentHead),
          cOnlyIsolated: summarize(cOnlyIsolated),
        });
        expect(preAp03.rows).toHaveLength(20);
        expect(currentHead.rows).toHaveLength(20);
        expect(cOnlyIsolated.rows).toHaveLength(20);
        for (const result of [preAp03, currentHead, cOnlyIsolated]) {
          expect(result.rows.every((row) => row.stageCommitAtMs === null ||
            row.stageCommitAtMs >= row.requestedAtMs)).toBe(true);
          expect(result.rows.every((row) => row.frameIndex >= 1 && row.frameIndex < 21)).toBe(true);
          expect(result.skippedTargetFrames.every((frameIndex) => frameIndex >= 1 && frameIndex < 21)).toBe(true);
          expect(result.displayedTargetFrames[0]).toBe(0);
          expect(result.displayedTargetFrames.every((frameIndex, index, displayed) =>
            index === 0 || frameIndex > displayed[index - 1]!
          )).toBe(true);
        }
        expect(preAp03.rows.map((row) => row.stageCommitAtMs)).toEqual(
          cOnlyIsolated.rows.map((row) => row.stageCommitAtMs),
        );
        expect(currentHead.maximumOldFrameHoldMs).toBeLessThan(
          cOnlyIsolated.maximumOldFrameHoldMs,
        );
        const committedCurrentFrames = currentHead.rows
          .filter((row) => row.stageCommitAtMs !== null)
          .map((row) => row.frameIndex);
        expect(currentHead.displayedTargetFrames.slice(1)).toEqual(
          committedCurrentFrames,
        );
        if (delayMs > 20) {
          const committedIsolatedFrames = cOnlyIsolated.rows.filter(
            (row) => row.stageCommitAtMs !== null,
          ).length;
          expect(committedCurrentFrames.length).toBeGreaterThan(
            committedIsolatedFrames,
          );
        }
      }
      console.info('[issue957-c-stage-prewarm-timing]', JSON.stringify(comparisons));
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps two 21-frame instances independent and reuses the same cold/hot source images', () => {
    const singleProject = build21FrameProject({ includeSecond: false });
    const dualProject = build21FrameProject({ secondEndBehavior: 'hold' });
    const run = (project: Project, times: readonly number[]) => {
      const harness = makeHarness();
      const urls = buildAssetUrls(project);
      const visit = (timeMs: number) => {
        const evaluated = evaluateShotAtTime(project.shots[0]!, timeMs, project);
        const { current, upcoming, model } = buildSources(project, evaluated, urls);
        harness.session.reconcile(current, () => {});
        harness.session.prewarm(upcoming);
        settleImageLoads(harness.images);
        const state = harness.session.getSnapshot();
        expect(state.ready).toBe(true);
        expect(
          isStageFrameReady({
            error: state.error,
            hasModel: true,
            imageState: state,
            layerCount: model.layers.length,
            sourceKey: buildStageImageSourceKey(current),
          }),
        ).toBe(true);
        expect(new Set(state.images.values()).size).toBe(
          new Set(current.map((source) => `${source.assetId}:${source.sha256}`)).size,
        );
        return { evaluated, model };
      };

      for (const timeMs of times) visit(timeMs);
      const coldImageCreations = harness.session.getDiagnostics().imageCreations;
      const coldCacheHits = harness.session.getDiagnostics().cacheHits;
      const beforeHot = coldImageCreations;
      for (const timeMs of times) visit(timeMs);
      const hotImageCreations = harness.session.getDiagnostics().imageCreations - beforeHot;
      const diagnostics = harness.session.getDiagnostics();
      harness.session.dispose();
      return { coldImageCreations, hotImageCreations, coldCacheHits, diagnostics };
    };

    const singleTimes = Array.from({ length: 21 }, (_, index) => index * 40);
    const dualTimes = Array.from({ length: 47 }, (_, index) => index * 40);
    const single = run(singleProject, singleTimes);
    const dual = run(dualProject, dualTimes);

    expect(single.coldImageCreations).toBe(21);
    expect(dual.coldImageCreations).toBe(21);
    expect(single.hotImageCreations).toBe(0);
    expect(dual.hotImageCreations).toBe(0);
    expect(single.diagnostics.prewarmInFlightPeak).toBeLessThanOrEqual(2);
    expect(dual.diagnostics.prewarmInFlightPeak).toBeLessThanOrEqual(2);
    expect(single.diagnostics.retainedEntries).toBeLessThanOrEqual(64);
    expect(dual.diagnostics.retainedEntries).toBeLessThanOrEqual(64);
    expect(single.coldCacheHits).toBeGreaterThan(0);
    expect(dual.coldCacheHits).toBeGreaterThan(0);

    console.info('[issue947-ap03-cold-hot]', JSON.stringify({
      single: {
        coldImageCreations: single.coldImageCreations,
        hotImageCreations: single.hotImageCreations,
        cacheHits: single.diagnostics.cacheHits,
        optionalDecodePeak: single.diagnostics.prewarmInFlightPeak,
      },
      dual: {
        coldImageCreations: dual.coldImageCreations,
        hotImageCreations: dual.hotImageCreations,
        cacheHits: dual.diagnostics.cacheHits,
        optionalDecodePeak: dual.diagnostics.prewarmInFlightPeak,
      },
    }));
  });

  it('keeps A=0 Loop and B=1000 Once/Hold or Hide frame, crop, and transforms independent', () => {
    const holdProject = build21FrameProject({ secondEndBehavior: 'hold' });
    const atZero = evaluateShotAtTime(holdProject.shots[0]!, 0, holdProject);
    const atStart = evaluateShotAtTime(holdProject.shots[0]!, 1_000, holdProject);
    const atNextFrame = evaluateShotAtTime(holdProject.shots[0]!, 1_040, holdProject);
    const atEnd = evaluateShotAtTime(holdProject.shots[0]!, 1_840, holdProject);
    const layer = (state: typeof atStart, id: string) =>
      state.layers.find((candidate) => candidate.id === id)!;

    expect(layer(atZero, LAYER_A).animationFrame?.offset.x).toBe(0);
    expect(layer(atZero, LAYER_B).visible).toBe(false);
    expect(layer(atStart, LAYER_A).animationFrame?.offset.x).toBe(12);
    expect(layer(atStart, LAYER_B).animationFrame?.offset.x).toBe(0);
    expect(layer(atNextFrame, LAYER_A).animationFrame?.offset.x).toBe(15);
    expect(layer(atNextFrame, LAYER_B).animationFrame?.offset.x).toBe(3);
    expect(layer(atEnd, LAYER_A).animationFrame?.offset.x).toBe(12);
    expect(layer(atEnd, LAYER_B).animationFrame?.offset.x).toBe(60);
    expect(layer(atEnd, LAYER_B).visible).toBe(true);

    const urls = buildAssetUrls(holdProject);
    const rendered = buildStageRenderModel(holdProject, atNextFrame, urls);
    const renderedA = rendered.layers.find((candidate) => candidate.id === LAYER_A)!;
    const renderedB = rendered.layers.find((candidate) => candidate.id === LAYER_B)!;
    expect(renderedA.render).toMatchObject({
      x: 300,
      y: 400,
      scaleX: 1,
      scaleY: 0.9,
      rotationDeg: 7,
      opacity: 0.8,
    });
    expect(renderedB.render).toMatchObject({
      x: 900,
      y: 600,
      scaleX: -1.5,
      scaleY: 1.25,
      rotationDeg: -11,
      opacity: 0.6,
    });
    expect(renderedA.visual?.parts[0]?.localRect.x).not.toBe(
      renderedB.visual?.parts[0]?.localRect.x,
    );
    expect(layer(atNextFrame, LAYER_A).flipX).toBe(false);
    expect(layer(atNextFrame, LAYER_B).flipX).toBe(true);

    const hideProject = build21FrameProject({ secondEndBehavior: 'hide' });
    expect(evaluateLayer(hideProject, 1_840, LAYER_B)).toMatchObject({
      visible: false,
      animationFrame: { offset: { x: 60 } },
    });
    expect(evaluateLayer(hideProject, 1_040, LAYER_B).animationFrame?.offset.x).toBe(3);
  });
});
