import { describe, expect, it, vi } from 'vitest';
import {
  evaluateShotAtTime,
  ProjectSchema,
  type Project,
} from '../../src/domain';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { buildProductPreviewImagePlan } from '../../src/renderer/shell/productPreviewModel';
import {
  MAX_RETAINED_PREVIEW_CANDIDATE_BYTES,
  ProductPreviewImageSession,
} from '../../src/renderer/shell/productPreviewImages';
import {
  buildStageImageSourceKey,
  isStageFrameReady,
  MAX_RETAINED_STAGE_BYTES,
  MAX_RETAINED_STAGE_SOURCES,
  StageImageResourceSession,
  type StageImageLayerSource,
} from '../../src/renderer/stage/stageImageResourceSession';
import { buildProjectWithAnimation, IDS } from '../unit/domain/testProject';

const LAYER_A = '70000000-0000-4000-8000-000000000021';
const LAYER_B = '70000000-0000-4000-8000-000000000022';
const AP_REAL_02_PROJECT_ROOT = 'D:/PandaStage-Acceptance/issue966-ap-real-02';

interface FakeImage {
  onload: ((event: Event) => unknown) | null;
  onerror: ((event: Event | string) => unknown) | null;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  succeed(): void;
}

function createImage(dimensions = 640): FakeImage {
  return {
    onload: null,
    onerror: null,
    src: '',
    naturalWidth: dimensions,
    naturalHeight: dimensions,
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
  options: {
    includeSecond?: boolean;
    secondEndBehavior?: 'hold' | 'hide';
    secondMode?: 'once' | 'loop';
    secondStartTimeMs?: number;
  } = {},
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
      startTimeMs: options.secondStartTimeMs ?? 1_000,
      mode: options.secondMode ?? 'once',
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

function makeHarness(dimensions = 640): { session: StageImageResourceSession; images: FakeImage[] } {
  const images: FakeImage[] = [];
  const session = new StageImageResourceSession({
    createImage: () => {
      const image = createImage(dimensions);
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
    const frame = project.animations
      .flatMap((animation) => animation.frames)
      .find((candidate) => candidate.assetId === assetId);
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

interface PreviewQueueReadRecord {
  assetId: string;
  startedAtMs: number;
  readyAtMs: number | null;
  delayMs: number;
}

interface PreviewQueueTimingRow {
  frameIndex: number;
  requestedAtMs: number;
  targetTimeMs: number;
  requiredAssetIds: string[];
  optionalReadsInFlightAtRequest: number;
  requiredStartsAtRequest: number;
  previewReadyAtMs: number | null;
  stageCommitAtMs: number | null;
  displayedAtMs: number | null;
  displayedFrameAtRequest: number;
}

function buildPreviewReadContentionFixture(): {
  project: Project;
  optionalAssetIds: string[];
  assetUrls: Record<string, string>;
  assetByteLengths: Map<string, number>;
  assetIdByByteLength: Map<number, string>;
} {
  const base = build21FrameProject({ includeSecond: false });
  const baseAnimation = base.animations[0]!;
  const helperAnimations = [0, 1].map((animationIndex) => {
    const animationId =
      `84000000-0000-4000-8000-${String(animationIndex + 1).padStart(12, '0')}`;
    return {
      ...baseAnimation,
      id: animationId,
      name: `synthetic-required-helper-${animationIndex + 1}`,
      source: {
        ...baseAnimation.source,
        basename: `synthetic-required-helper-${animationIndex + 1}.fla`,
        sha256: (animationIndex + 100).toString(16).padStart(64, '0'),
        renderTargetId: `issue957-required-helper-${animationIndex + 1}`,
        targetName: `synthetic-required-helper-${animationIndex + 1}`,
      },
      frames: baseAnimation.frames.map((frame, frameIndex) => {
        const assetId =
          `85000000-0000-4000-8000-${String(animationIndex * 21 + frameIndex + 1).padStart(12, '0')}`;
        const sha256 = (animationIndex * 21 + frameIndex + 200).toString(16)
          .padStart(64, '0');
        return { ...frame, assetId, sha256 };
      }),
    };
  });
  const helperAssets = helperAnimations.flatMap((animation, animationIndex) =>
    animation.frames.map((frame, frameIndex) => ({
      id: frame.assetId,
      kind: 'image' as const,
      name: `synthetic-required-helper-${animationIndex + 1}-${frameIndex}`,
      relativePath: `assets/issue957-required-helper-${animationIndex + 1}-${frameIndex}.png`,
      mimeType: 'image/png',
      width: 640,
      height: 640,
      sha256: frame.sha256,
      usage: 'uncategorized' as const,
      keywords: ['synthetic', 'issue957', 'current-required'],
    })),
  );
  const optionalAssetIds = Array.from({ length: 2 }, (_, index) =>
    `83000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
  const optionalAssets = optionalAssetIds.map((id, index) => ({
    id,
    kind: 'image' as const,
    name: `synthetic-next-shot-optional-${index}`,
    relativePath: `assets/issue957-next-shot-optional-${index}.png`,
    mimeType: 'image/png',
    width: 640,
    height: 640,
    sha256: (index + 300).toString(16).padStart(64, '0'),
    usage: 'uncategorized' as const,
    keywords: ['synthetic', 'issue957', 'next-shot'],
  }));
  const currentShot = base.shots[0]!;
  const helperLayers = helperAnimations.map((animation, index) => ({
    ...animationLayer(
      `86000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      {
        startTimeMs: 0,
        mode: 'loop',
        endBehavior: 'hold',
        x: 520 + index * 120,
        y: 620,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: 0,
        opacity: 1,
        zIndex: 4 + index,
        flipX: false,
      },
    ),
    name: `required helper ${index + 1}`,
    source: { kind: 'animation' as const, animationId: animation.id },
  }));
  const nextShotId = '87000000-0000-4000-8000-000000000001';
  const nextShot = {
    ...currentShot,
    id: nextShotId,
    name: 'synthetic optional next shot',
    backgroundLayerId: null,
    layers: optionalAssetIds.map((assetId, index) => ({
      id: `88000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: `next-shot optional ${index + 1}`,
      source: { kind: 'asset' as const, assetId },
      anchor: 'center' as const,
      x: 700 + index * 200,
      y: 540,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      zIndex: index,
      locked: false,
      flipX: false,
    })),
  };
  const project = ProjectSchema.parse({
    ...base,
    assets: [...base.assets, ...helperAssets, ...optionalAssets],
    animations: [...base.animations, ...helperAnimations],
    shots: base.shots.map((shot) =>
      shot.id === currentShot.id
        ? { ...shot, layers: [...shot.layers, ...helperLayers] }
        : shot,
    ).concat(nextShot),
  });
  const assetUrls = Object.fromEntries(
    project.assets.map((asset) => [
      asset.id,
      `blob:issue957-b-${asset.id}-${asset.sha256 ?? 'no-hash'}`,
    ]),
  );
  const assetByteLengths = new Map(
    project.assets.map((asset, index) => [asset.id, index + 1]),
  );
  const assetIdByByteLength = new Map(
    [...assetByteLengths].map(([assetId, byteLength]) => [byteLength, assetId]),
  );
  return {
    project,
    optionalAssetIds,
    assetUrls,
    assetByteLengths,
    assetIdByByteLength,
  };
}

async function runControlledPreviewQueueScenario(
  requiredReadDelayMs: number,
  optionalReadDelayMs: number,
  optionalByteReadsEnabled: boolean,
): Promise<{
  requiredReadDelayMs: number;
  optionalReadDelayMs: number;
  optionalByteReadsEnabled: boolean;
  skippedTargetFrames: number[];
  displayedTargetFrames: number[];
  maximumOldFrameHoldMs: number;
  oldFrameHoldIntervals: Array<{
    frameIndex: number;
    startedAtMs: number;
    endedAtMs: number;
    durationMs: number;
  }>;
  diagnostics: ReturnType<ProductPreviewImageSession['getDiagnostics']>;
  stageDiagnostics: ReturnType<StageImageResourceSession['getDiagnostics']>;
  cPrewarmRequestKeys: string[][];
  rows: PreviewQueueTimingRow[];
  readRecords: PreviewQueueReadRecord[];
}> {
  vi.clearAllTimers();
  vi.setSystemTime(-requiredReadDelayMs);
  const fixture = buildPreviewReadContentionFixture();
  const projectRoot = 'D:/PandaStage-Acceptance/issue957-preview-read-contention';
  const project = fixture.project;
  const shot = project.shots[0]!;
  const optionalAssetIds = optionalByteReadsEnabled
    ? fixture.optionalAssetIds
    : [];
  const optionalIds = new Set(fixture.optionalAssetIds);
  const readRecords: PreviewQueueReadRecord[] = [];
  const preview = new ProductPreviewImageSession({
    readCanvasImage: ({ assetId }) => {
      const delayMs = optionalIds.has(assetId)
        ? optionalReadDelayMs
        : requiredReadDelayMs;
      const record: PreviewQueueReadRecord = {
        assetId,
        startedAtMs: Date.now(),
        readyAtMs: null,
        delayMs,
      };
      readRecords.push(record);
      const byteLength = fixture.assetByteLengths.get(assetId);
      if (byteLength === undefined) {
        throw new Error(`Missing synthetic Preview asset ${assetId}.`);
      }
      return new Promise((resolve) => {
        setTimeout(() => {
          record.readyAtMs = Date.now();
          resolve({
            ok: true as const,
            status: 'ready' as const,
            assetId,
            mimeType: 'image/png' as const,
            width: 640,
            height: 640,
            byteLength,
            bytes: new Uint8Array(byteLength),
          });
        }, delayMs);
      });
    },
    createObjectUrl: (blob) => {
      const assetId = fixture.assetIdByByteLength.get(blob.size);
      if (!assetId) throw new Error(`No synthetic asset for ${blob.size} bytes.`);
      return fixture.assetUrls[assetId]!;
    },
    revokeObjectUrl: () => {},
  });
  const stageHarness = makeHarness();
  const stage = stageHarness.session;
  const rows: PreviewQueueTimingRow[] = [];
  const pendingPrepares: Array<
    Promise<Awaited<ReturnType<ProductPreviewImageSession['prepare']>>>
  > = [];
  const cPrewarmRequestKeys: string[][] = [];
  const events: StageTimingEvent[] = [];
  let eventSequence = 0;
  let targetFrameIndex = 0;
  let displayedFrameIndex = -1;
  let desiredStageSourceKey = '';
  let targetRow: PreviewQueueTimingRow | null = null;
  let playStartedAtMs = 0;
  let finalized = false;

  const elapsedMs = (): number => Date.now() - playStartedAtMs;
  const buildScope = (frameIndex: number) => {
    const evaluated = evaluateShotAtTime(shot, frameIndex * 40, project);
    const plan = buildProductPreviewImagePlan(project, shot, evaluated);
    return {
      evaluated,
      scope: {
        ...plan,
        candidateAssetIds: [],
        recentAnimationAssetIds: [],
      },
    };
  };

  const initial = buildScope(0);
  const initialReady = preview.prepare(projectRoot, project, initial.scope);
  await vi.advanceTimersByTimeAsync(requiredReadDelayMs);
  const initialState = await initialReady;
  expect(initialState?.status).toBe('ready');
  preview.commitScope(projectRoot, project, initial.scope);

  const initialStageSources = buildSources(
    project,
    initial.evaluated,
    fixture.assetUrls,
  );
  expect(initial.scope.requiredAssetIds).toHaveLength(
    initialStageSources.current.length,
  );
  desiredStageSourceKey = buildStageImageSourceKey(initialStageSources.current);
  stage.reconcile(initialStageSources.current, () => {});
  settleImageLoads(stageHarness.images);
  stage.prewarm(initialStageSources.upcoming);
  settleImageLoads(stageHarness.images);
  expect(stage.getSnapshot().ready).toBe(true);

  const initialRow: PreviewQueueTimingRow = {
    frameIndex: 0,
    requestedAtMs: 0,
    targetTimeMs: 0,
    requiredAssetIds: initial.scope.requiredAssetIds.slice(),
    optionalReadsInFlightAtRequest: 0,
    requiredStartsAtRequest: 0,
    previewReadyAtMs: 0,
    stageCommitAtMs: 0,
    displayedAtMs: 0,
    displayedFrameAtRequest: 0,
  };
  rows.push(initialRow);
  playStartedAtMs = Date.now();
  targetFrameIndex = 0;
  displayedFrameIndex = 0;
  events.push({ kind: 'display', frameIndex: 0, atMs: 0, sequence: eventSequence++ });

  // Start two next-shot byte reads shortly before frame 1 is requested. These
  // are real low-priority Preview scope entries, separate from Stage C's next
  // animation-frame prewarm.
  await vi.advanceTimersByTimeAsync(30);
  const warmScope = buildScope(0);
  const warmPrepare = preview.prepare(
    projectRoot,
    project,
    warmScope.scope,
    optionalAssetIds,
  );
  const warmState = await warmPrepare;
  expect(warmState?.status).toBe('ready');
  preview.commitScope(projectRoot, project, warmScope.scope, optionalAssetIds);
  await vi.advanceTimersByTimeAsync(0);
  expect(preview.getDiagnostics().optionalInFlightCount).toBe(
    optionalByteReadsEnabled ? 1 : 0,
  );

  const commitCurrentTarget = (
    frameIndex: number,
    row: PreviewQueueTimingRow,
    scope: ReturnType<typeof buildScope>['scope'],
    currentSources: ReturnType<typeof buildSources>,
    state: Awaited<ReturnType<ProductPreviewImageSession['prepare']>>,
  ): void => {
    if (state?.status !== 'ready') return;
    row.previewReadyAtMs = elapsedMs();
    if (finalized || targetFrameIndex !== frameIndex) return;
    expect(scope.requiredAssetIds.every((assetId) => Boolean(state.urls[assetId]))).toBe(true);
    preview.commitScope(projectRoot, project, scope, optionalAssetIds);
    stage.reconcile(currentSources.current, onStageState);
    settleImageLoads(stageHarness.images);
  };

  const onStageState = (): void => {
    const state = stage.getSnapshot();
    if (!state.ready || state.desiredSourceKey !== desiredStageSourceKey) return;
    if (targetRow && targetRow.stageCommitAtMs === null) {
      targetRow.stageCommitAtMs = elapsedMs();
    }
    if (displayedFrameIndex !== targetFrameIndex) {
      displayedFrameIndex = targetFrameIndex;
      if (targetRow) targetRow.displayedAtMs = elapsedMs();
      events.push({
        kind: 'display',
        frameIndex: targetFrameIndex,
        atMs: elapsedMs(),
        sequence: eventSequence++,
      });
    }
  };

  // Initial scope was prepared before this listener existed; attach it without
  // changing the current source set or the Stage C prewarm behavior.
  stage.reconcile(initialStageSources.current, onStageState);

  for (let frameIndex = 1; frameIndex < 21; frameIndex += 1) {
    await vi.advanceTimersByTimeAsync(frameIndex === 1 ? 10 : 40);
    targetFrameIndex = frameIndex;
    const requestedAtMs = elapsedMs();
    const built = buildScope(frameIndex);
    const currentSources = buildSources(project, built.evaluated, fixture.assetUrls);
    expect([...built.scope.requiredAssetIds].sort()).toEqual(
      [...new Set(currentSources.current.map((source) => source.assetId))].sort(),
    );
    desiredStageSourceKey = buildStageImageSourceKey(currentSources.current);
    const row: PreviewQueueTimingRow = {
      frameIndex,
      requestedAtMs,
      targetTimeMs: frameIndex * 40,
      requiredAssetIds: built.scope.requiredAssetIds.slice(),
      optionalReadsInFlightAtRequest: preview.getDiagnostics().optionalInFlightCount,
      requiredStartsAtRequest: 0,
      previewReadyAtMs: null,
      stageCommitAtMs: null,
      displayedAtMs: null,
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

    // C stays enabled and receives the same next-frame URLs in both arms.
    cPrewarmRequestKeys.push(
      currentSources.upcoming.map((source) => source.sourceUrl),
    );
    stage.prewarm(currentSources.upcoming);
    settleImageLoads(stageHarness.images);

    const prepare = preview.prepare(
      projectRoot,
      project,
      built.scope,
      optionalAssetIds,
    );
    pendingPrepares.push(prepare);
    void prepare.then((state) =>
      commitCurrentTarget(frameIndex, row, built.scope, currentSources, state),
    );
    await vi.advanceTimersByTimeAsync(0);
    row.requiredStartsAtRequest = row.requiredAssetIds.filter((assetId) =>
      readRecords.some(
        (record) =>
          record.assetId === assetId && record.startedAtMs === requestedAtMs,
      ),
    ).length;
  }

  // The next loop target is due at 840ms; late frame 20 work is not a commit.
  await vi.advanceTimersByTimeAsync(40);
  const finalTimeMs = elapsedMs();
  finalized = true;
  const diagnostics = preview.getDiagnostics();
  const stageDiagnostics = stage.getDiagnostics();
  preview.dispose();
  await vi.advanceTimersByTimeAsync(Math.max(requiredReadDelayMs, optionalReadDelayMs) + 1);
  await Promise.all(pendingPrepares);

  const skippedTargetFrames = rows
    .filter((row) => row.frameIndex > 0 && row.stageCommitAtMs === null)
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

  stage.dispose();
  return {
    requiredReadDelayMs,
    optionalReadDelayMs,
    optionalByteReadsEnabled,
    skippedTargetFrames,
    displayedTargetFrames: events
      .filter((event) => event.kind === 'display')
      .map((event) => event.frameIndex),
    maximumOldFrameHoldMs,
    oldFrameHoldIntervals,
    diagnostics,
    stageDiagnostics,
    cPrewarmRequestKeys,
    rows,
    readRecords,
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

  it('measures B-only optional byte-read contention with Stage C held on', async () => {
    vi.useFakeTimers();
    try {
      const scenarios = [
        { label: 'uniform-20ms', requiredReadDelayMs: 20, optionalReadDelayMs: 20 },
        { label: 'uniform-60ms', requiredReadDelayMs: 60, optionalReadDelayMs: 60 },
        { label: 'uniform-100ms', requiredReadDelayMs: 100, optionalReadDelayMs: 100 },
        {
          label: 'optional-100ms-required-20ms-contention',
          requiredReadDelayMs: 20,
          optionalReadDelayMs: 100,
        },
      ];
      const comparisons = [];
      const summarize = (
        result: Awaited<ReturnType<typeof runControlledPreviewQueueScenario>>,
      ) => ({
        path: result.optionalByteReadsEnabled
          ? 'B-on-next-shot-cap1-C-on'
          : 'B-only-isolated-C-on',
        displayedTargetFrames: result.displayedTargetFrames,
        skippedTargetFrames: result.skippedTargetFrames,
        maximumOldFrameHoldMs: result.maximumOldFrameHoldMs,
        oldFrameHoldIntervals: result.oldFrameHoldIntervals,
        previewReadDiagnostics: result.diagnostics,
        stagePrewarmDiagnostics: result.stageDiagnostics,
        frameTimings: result.rows.slice(1).map((row) => [
          row.frameIndex,
          row.requestedAtMs,
          row.targetTimeMs,
          row.optionalReadsInFlightAtRequest,
          row.requiredStartsAtRequest,
          row.requiredAssetIds.map((assetId) => {
            const read = result.readRecords.find(
              (record) => record.assetId === assetId,
            );
            return [
              assetId.slice(-4),
              read ? read.startedAtMs - row.requestedAtMs : null,
              read?.readyAtMs === null || !read
                ? null
                : read.readyAtMs - row.requestedAtMs,
            ];
          }),
          row.previewReadyAtMs === null
            ? null
            : row.previewReadyAtMs - row.requestedAtMs,
          row.stageCommitAtMs === null
            ? null
            : row.stageCommitAtMs - row.requestedAtMs,
        row.displayedAtMs === null
          ? null
          : row.displayedAtMs - row.requestedAtMs,
          row.displayedFrameAtRequest,
        ]),
      });

      for (const scenario of scenarios) {
        const current = await runControlledPreviewQueueScenario(
          scenario.requiredReadDelayMs,
          scenario.optionalReadDelayMs,
          true,
        );
        const bOnlyIsolated = await runControlledPreviewQueueScenario(
          scenario.requiredReadDelayMs,
          scenario.optionalReadDelayMs,
          false,
        );
        comparisons.push({
          ...scenario,
          current: summarize(current),
          bOnlyIsolated: summarize(bOnlyIsolated),
        });

        for (const result of [current, bOnlyIsolated]) {
          expect(result.rows).toHaveLength(21);
          expect(result.rows.slice(1).every((row) =>
            row.requiredAssetIds.length === 3
          )).toBe(true);
          expect(result.diagnostics.inFlightPeak).toBeLessThanOrEqual(3);
          expect(result.stageDiagnostics.prewarmInFlightPeak).toBeLessThanOrEqual(2);
          const committedFrames = result.rows
            .slice(1)
            .filter((row) => row.stageCommitAtMs !== null)
            .map((row) => row.frameIndex);
          expect(result.displayedTargetFrames.slice(1)).toEqual(committedFrames);
          expect(result.rows.slice(1).every((row) =>
            row.stageCommitAtMs === null ||
            (row.previewReadyAtMs !== null && row.stageCommitAtMs >= row.previewReadyAtMs)
          )).toBe(true);
        }
        expect(current.cPrewarmRequestKeys).toEqual(
          bOnlyIsolated.cPrewarmRequestKeys,
        );
        expect(current.rows[1]?.optionalReadsInFlightAtRequest).toBe(1);
        expect(bOnlyIsolated.rows[1]?.optionalReadsInFlightAtRequest).toBe(0);
        expect(current.rows[1]?.requiredStartsAtRequest).toBe(2);
        expect(bOnlyIsolated.rows[1]?.requiredStartsAtRequest).toBe(3);
      }
      console.info('[issue957-b-preview-read-timing]', JSON.stringify(comparisons));
    } finally {
      vi.useRealTimers();
    }
  }, 30_000);

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

interface ApReal02LoopMetrics {
  loop: number;
  readRequests: number;
  previewCacheHits: number;
  readAssetIds: string[];
  blobUrlsCreated: number;
  blobUrlAssetIds: string[];
  blobUrlsRevoked: number;
  revokedUrlAssetIds: string[];
  stageImageCreations: number;
  stageCacheHits: number;
  exactReadyFrames: number;
  oldFrameHoldFrames: number;
  supersededTargets: number;
}

interface ApReal02ScenarioOptions {
  loopCount: number;
  previewFrameBytes: number;
  stageDimensions: number;
  instanceCount: 1 | 2;
  readDelayMs: number;
  stageDecodeDelayMs: number;
}

async function waitForPreviewReads(session: ProductPreviewImageSession): Promise<void> {
  for (let turn = 0; turn < 100; turn += 1) {
    const diagnostics = session.getDiagnostics();
    if (diagnostics.inFlightCount === 0 && diagnostics.queuedOptionalCount === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Synthetic Preview image reads did not settle.');
}

async function runApReal02Scenario(options: ApReal02ScenarioOptions): Promise<{
  loops: ApReal02LoopMetrics[];
  seekReplay: Omit<
    ApReal02LoopMetrics,
    'loop' | 'readAssetIds' | 'blobUrlAssetIds' | 'revokedUrlAssetIds'
  >;
  frameAssetIds: string[];
  urlCreates: number;
  urlRevokes: number;
  previewBytes: number;
  stageEntries: number;
  stageBytes: number;
}> {
  const project = build21FrameProject(
    options.instanceCount === 2
      ? { secondStartTimeMs: 0, secondMode: 'loop' }
      : { includeSecond: false },
  );
  const shot = project.shots[0]!;
  const frameAssetIds = project.animations[0]!.frames.map((frame) => frame.assetId);
  const frameIndexByAssetId = new Map(
    frameAssetIds.map((assetId, index) => [assetId, index] as const),
  );
  const frameByteLengthByIndex = new Map(
    frameAssetIds.map((_, index) => [index, options.previewFrameBytes + index] as const),
  );
  const frameIndexByByteLength = new Map(
    [...frameByteLengthByIndex].map(([index, byteLength]) => [byteLength, index]),
  );
  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];
  const readsByLoop = Array.from({ length: options.loopCount }, () => [] as string[]);
  const createsByLoop = Array.from({ length: options.loopCount }, () => [] as string[]);
  const revokesByLoop = Array.from({ length: options.loopCount }, () => [] as string[]);
  const assetIdByUrl = new Map<string, string>();
  let activeLoop = -1;
  let urlSequence = 0;
  const preview = new ProductPreviewImageSession({
    readCanvasImage: async ({ assetId }) => {
      const frameIndex = frameIndexByAssetId.get(assetId);
      if (frameIndex === undefined) throw new Error(`Unexpected Preview read: ${assetId}`);
      if (activeLoop >= 0) readsByLoop[activeLoop]?.push(assetId);
      if (options.readDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.readDelayMs));
      }
      const byteLength = frameByteLengthByIndex.get(frameIndex)!;
      return {
        ok: true as const,
        status: 'ready' as const,
        assetId,
        mimeType: 'image/png' as const,
        width: options.stageDimensions,
        height: options.stageDimensions,
        byteLength,
        bytes: new Uint8Array(byteLength),
      };
    },
    createObjectUrl: (blob) => {
      const frameIndex = frameIndexByByteLength.get(blob.size);
      if (frameIndex === undefined) throw new Error(`Unexpected Blob size: ${blob.size}`);
      const assetId = frameAssetIds[frameIndex]!;
      const url = `blob:issue966-${frameIndex}-${urlSequence++}`;
      createdUrls.push(url);
      assetIdByUrl.set(url, assetId);
      if (activeLoop >= 0) createsByLoop[activeLoop]?.push(assetId);
      return url;
    },
    revokeObjectUrl: (url) => {
      revokedUrls.push(url);
      const assetId = assetIdByUrl.get(url);
      if (assetId && activeLoop >= 0) revokesByLoop[activeLoop]?.push(assetId);
    },
  });
  const stageHarness = makeHarness(options.stageDimensions);
  const loops: ApReal02LoopMetrics[] = [];

  const visit = async (timeMs: number): Promise<StageImageLayerSource[]> => {
    const evaluated = evaluateShotAtTime(shot, timeMs, project);
    const plan = buildProductPreviewImagePlan(project, shot, evaluated);
    expect(new Set(plan.retainedAnimationAssetIds)).toEqual(new Set(frameAssetIds));
    const loading = preview.prepare(AP_REAL_02_PROJECT_ROOT, project, plan);
    const previewState = await loading;
    expect(previewState?.status).toBe('ready');
    if (!previewState) throw new Error('Preview session was disposed unexpectedly.');
    await waitForPreviewReads(preview);
    preview.commitScope(AP_REAL_02_PROJECT_ROOT, project, plan);

    const assetUrls: Record<string, string> = {};
    for (const [assetId, url] of Object.entries(previewState.urls)) {
      if (url) assetUrls[assetId] = url;
    }
    const { current } = buildSources(project, evaluated, assetUrls);
    const expectedFrameIndex = Math.floor(timeMs / 40) % frameAssetIds.length;
    expect(current).toHaveLength(options.instanceCount);
    expect(current.every((source) => source.assetId === frameAssetIds[expectedFrameIndex])).toBe(true);
    expect(new Set(current.map((source) => source.sourceUrl)).size).toBe(1);
    return current;
  };

  for (let loop = 0; loop < options.loopCount; loop += 1) {
    activeLoop = loop;
    const beforePreview = preview.getDiagnostics();
    const beforeUrlCreates = createdUrls.length;
    const beforeUrlRevokes = revokedUrls.length;
    const beforeStage = stageHarness.session.getDiagnostics();
    let exactReadyFrames = 0;
    let oldFrameHoldFrames = 0;

    for (let frame = 0; frame < frameAssetIds.length; frame += 1) {
      const current = await visit((loop * frameAssetIds.length + frame) * 40);
      const previous = stageHarness.session.getSnapshot();
      stageHarness.session.reconcile(current, () => {});
      let stageState = stageHarness.session.getSnapshot();
      if (
        !stageState.ready &&
        current.some((source) => {
          const heldUrl = previous.sourceUrls.get(source.id);
          return heldUrl !== undefined && heldUrl !== source.sourceUrl;
        })
      ) {
        oldFrameHoldFrames += 1;
      }
      if (!stageState.ready && options.stageDecodeDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.stageDecodeDelayMs));
      }
      settleImageLoads(stageHarness.images);
      stageState = stageHarness.session.getSnapshot();
      expect(isStageFrameReady({
        hasModel: true,
        layerCount: current.length,
        error: stageState.error,
        imageState: stageState,
        sourceKey: buildStageImageSourceKey(current),
      })).toBe(true);
      expect(stageState.sourceUrls.size).toBe(options.instanceCount);
      if (options.instanceCount === 2) {
        expect(stageState.images.get(current[1]!.id)).toBe(
          stageState.images.get(current[0]!.id),
        );
      }
      exactReadyFrames += 1;
    }

    const afterPreview = preview.getDiagnostics();
    const afterStage = stageHarness.session.getDiagnostics();
    loops.push({
      loop,
      readRequests: afterPreview.readRequests - beforePreview.readRequests,
      previewCacheHits: afterPreview.cacheHits - beforePreview.cacheHits,
      readAssetIds: readsByLoop[loop]!.slice(),
      blobUrlsCreated: createdUrls.length - beforeUrlCreates,
      blobUrlAssetIds: createsByLoop[loop]!.slice(),
      blobUrlsRevoked: revokedUrls.length - beforeUrlRevokes,
      revokedUrlAssetIds: revokesByLoop[loop]!.slice(),
      stageImageCreations: afterStage.imageCreations - beforeStage.imageCreations,
      stageCacheHits: afterStage.cacheHits - beforeStage.cacheHits,
      exactReadyFrames,
      oldFrameHoldFrames,
      supersededTargets: 0,
    });
  }

  activeLoop = -1;
  const beforeSeekPreview = preview.getDiagnostics();
  const beforeSeekCreates = createdUrls.length;
  const beforeSeekRevokes = revokedUrls.length;
  const beforeSeekStage = stageHarness.session.getDiagnostics();
  let seekExactReadyFrames = 0;
  let seekOldFrameHoldFrames = 0;
  if (options.loopCount > 1) {
    for (const frame of [7, 8, 7, 8]) {
      const current = await visit((options.loopCount * frameAssetIds.length + frame) * 40);
      const previous = stageHarness.session.getSnapshot();
      stageHarness.session.reconcile(current, () => {});
      const pending = stageHarness.session.getSnapshot();
      if (
        !pending.ready &&
        current.some((source) => {
          const heldUrl = previous.sourceUrls.get(source.id);
          return heldUrl !== undefined && heldUrl !== source.sourceUrl;
        })
      ) {
        seekOldFrameHoldFrames += 1;
      }
      settleImageLoads(stageHarness.images);
      const state = stageHarness.session.getSnapshot();
      expect(isStageFrameReady({
        hasModel: true,
        layerCount: current.length,
        error: state.error,
        imageState: state,
        sourceKey: buildStageImageSourceKey(current),
      })).toBe(true);
      seekExactReadyFrames += 1;
    }
  }
  const afterSeekPreview = preview.getDiagnostics();
  const afterSeekStage = stageHarness.session.getDiagnostics();
  const seekReplay = {
    readRequests: afterSeekPreview.readRequests - beforeSeekPreview.readRequests,
    previewCacheHits: afterSeekPreview.cacheHits - beforeSeekPreview.cacheHits,
    blobUrlsCreated: createdUrls.length - beforeSeekCreates,
    blobUrlsRevoked: revokedUrls.length - beforeSeekRevokes,
    stageImageCreations: afterSeekStage.imageCreations - beforeSeekStage.imageCreations,
    stageCacheHits: afterSeekStage.cacheHits - beforeSeekStage.cacheHits,
    exactReadyFrames: seekExactReadyFrames,
    oldFrameHoldFrames: seekOldFrameHoldFrames,
    supersededTargets: 0,
  };

  const previewBytes = preview.getDiagnostics().readyCacheBytes;
  const finalStage = stageHarness.session.getDiagnostics();
  preview.dispose();
  stageHarness.session.dispose();
  return {
    loops,
    seekReplay,
    frameAssetIds,
    urlCreates: createdUrls.length,
    urlRevokes: revokedUrls.length,
    previewBytes,
    stageEntries: finalStage.retainedEntries,
    stageBytes: finalStage.retainedBytes,
  };
}

describe('Issue #966 AP-REAL-02 animation loop resource retention', () => {
  it('reuses all in-budget frames across three loops and seek/replay', async () => {
    const result = await runApReal02Scenario({
      loopCount: 3,
      previewFrameBytes: 512 * 1024,
      stageDimensions: 512,
      instanceCount: 2,
      readDelayMs: 20,
      stageDecodeDelayMs: 20,
    });
    const ids = result.frameAssetIds;
    expect(result.loops).toEqual([
      { loop: 0, readRequests: 21, readAssetIds: ids, blobUrlsCreated: 21,
        blobUrlAssetIds: ids, blobUrlsRevoked: 0, revokedUrlAssetIds: [],
        previewCacheHits: 63, stageImageCreations: 21, stageCacheHits: 0,
        exactReadyFrames: 21, oldFrameHoldFrames: 20,
        supersededTargets: 0 },
      { loop: 1, readRequests: 0, readAssetIds: [], blobUrlsCreated: 0,
        blobUrlAssetIds: [], blobUrlsRevoked: 0, revokedUrlAssetIds: [],
        previewCacheHits: 84, stageImageCreations: 0, stageCacheHits: 42,
        exactReadyFrames: 21, oldFrameHoldFrames: 0,
        supersededTargets: 0 },
      { loop: 2, readRequests: 0, readAssetIds: [], blobUrlsCreated: 0,
        blobUrlAssetIds: [], blobUrlsRevoked: 0, revokedUrlAssetIds: [],
        previewCacheHits: 84, stageImageCreations: 0, stageCacheHits: 42,
        exactReadyFrames: 21, oldFrameHoldFrames: 0,
        supersededTargets: 0 },
    ]);
    expect(result.seekReplay).toEqual({
      readRequests: 0,
      previewCacheHits: 16,
      blobUrlsCreated: 0,
      blobUrlsRevoked: 0,
      stageImageCreations: 0,
      stageCacheHits: 8,
      exactReadyFrames: 4,
      oldFrameHoldFrames: 0,
      supersededTargets: 0,
    });
    expect(result.urlCreates).toBe(21);
    expect(result.urlRevokes).toBe(result.urlCreates);
    expect(result.previewBytes).toBeLessThanOrEqual(MAX_RETAINED_PREVIEW_CANDIDATE_BYTES);
    expect(result.stageEntries).toBeLessThanOrEqual(MAX_RETAINED_STAGE_SOURCES);
    expect(result.stageBytes).toBeLessThanOrEqual(MAX_RETAINED_STAGE_BYTES);
  });

  it('evicts over-budget loop assets while both resource caches stay bounded', async () => {
    const result = await runApReal02Scenario({
      loopCount: 1,
      previewFrameBytes: 4 * 1024 * 1024,
      stageDimensions: 1024,
      instanceCount: 1,
      readDelayMs: 0,
      stageDecodeDelayMs: 0,
    });
    const loop = result.loops[0]!;
    expect(loop).toMatchObject({
      readRequests: 24,
      blobUrlsCreated: 24,
      blobUrlsRevoked: 8,
      stageImageCreations: 21,
      exactReadyFrames: 21,
      oldFrameHoldFrames: 20,
      supersededTargets: 0,
    });
    const readCounts = new Map<string, number>();
    loop.readAssetIds.forEach((assetId) =>
      readCounts.set(assetId, (readCounts.get(assetId) ?? 0) + 1),
    );
    expect([...readCounts].filter(([, count]) => count > 1).map(([id]) => id))
      .toEqual(result.frameAssetIds.slice(0, 3));
    expect(loop.blobUrlAssetIds).toHaveLength(loop.blobUrlsCreated);
    expect(loop.revokedUrlAssetIds).toHaveLength(loop.blobUrlsRevoked);
    expect(result.previewBytes).toBeLessThanOrEqual(
      MAX_RETAINED_PREVIEW_CANDIDATE_BYTES + 4 * 1024 * 1024 + 21,
    );
    expect(result.stageEntries).toBeLessThanOrEqual(MAX_RETAINED_STAGE_SOURCES);
    expect(result.stageBytes).toBeLessThanOrEqual(MAX_RETAINED_STAGE_BYTES);
    expect(result.urlRevokes).toBe(result.urlCreates);
  });
});
