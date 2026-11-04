import { describe, expect, it, vi } from 'vitest';
import {
  evaluateShotAtTime,
  ProjectSchema,
  type Project,
} from '../../src/domain';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { buildProductPreviewImagePlan } from '../../src/renderer/shell/productPreviewModel';
import { ProductPreviewImageSession } from '../../src/renderer/shell/productPreviewImages';
import {
  buildStageImageSourceKey,
  isStageFrameReady,
  StageImageResourceSession,
  type StageImageLayerSource,
} from '../../src/renderer/stage/stageImageResourceSession';
import {
  createPreviewFrameTraceContext,
  resolvePreviewAnimationFrame,
} from '../../src/renderer/stage/previewFrameTrace';
import {
  recordPreviewFrameTrace,
  resetPreviewFrameTraceRecorderForTests,
} from '../../src/renderer/stage/previewDiagnostics';
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

interface FrameTraceRecord {
  event: string;
  atMs: number;
  detail: Record<string, number | string | boolean | null>;
}

async function runApReal01FrameTraceScenario(delayMs: number): Promise<{
  delayMs: number;
  events: FrameTraceRecord[];
  commitLatenciesMs: number[];
  maxModeledOldFrameHoldMs: number;
  supersededTargets: number;
  pendingTargets: number;
  input: { projectId: string; shotId: string; frameIds: string[] };
}> {
  vi.clearAllTimers();
  vi.setSystemTime(0);
  resetPreviewFrameTraceRecorderForTests();
  const project = build21FrameProject({ includeSecond: false });
  const shot = project.shots[0]!;
  const animation = project.animations[0]!;
  const urls = buildAssetUrls(project);
  const byteLengthByAssetId = new Map(
    animation.frames.map((frame, index) => [frame.assetId, index + 1] as const),
  );
  const assetIdByByteLength = new Map(
    [...byteLengthByAssetId].map(([assetId, byteLength]) => [byteLength, assetId] as const),
  );
  const events: FrameTraceRecord[] = [];
  let objectUrlSequence = 0;
  const diagnosticSink = {
    frameTraceEnabled: true,
    record(event: string, atMs: number, detail: FrameTraceRecord['detail']) {
      if (events.length < 2_048) events.push({ event, atMs, detail });
    },
  };
  vi.stubGlobal('window', {
    __pandaPreviewDiagnostics: diagnosticSink,
  } as unknown as Window);

  const preview = new ProductPreviewImageSession({
    readCanvasImage: ({ assetId }) => new Promise((resolve) => {
      const byteLength = byteLengthByAssetId.get(assetId);
      if (byteLength === undefined) {
        throw new Error(`Unexpected synthetic animation asset ${assetId}.`);
      }
      setTimeout(() => resolve({
        ok: true as const,
        status: 'ready' as const,
        assetId,
        mimeType: 'image/png' as const,
        width: 640,
        height: 640,
        byteLength,
        bytes: new Uint8Array(byteLength),
      }), delayMs);
    }),
    createObjectUrl: (blob) => {
      const assetId = assetIdByByteLength.get(blob.size);
      if (!assetId) throw new Error(`No synthetic asset for ${blob.size} bytes.`);
      objectUrlSequence += 1;
      return `${urls[assetId]}:read-${objectUrlSequence}`;
    },
    revokeObjectUrl: () => {},
  });
  const decodePool = new ControlledImageDecodePool(delayMs, 2);
  const stage = new StageImageResourceSession({
    createImage: () => decodePool.createImage(),
  });
  const projectRoot = 'D:/PandaStage-Acceptance/issue964-frame-trace-synthetic';
  const playbackGeneration = 9_640 + delayMs;
  const committedTraceIds = new Set<string>();
  let activeTrace: ReturnType<typeof createPreviewFrameTraceContext> = null;
  let currentStageAssetId: string | null = null;
  let currentStageSourceKey = '';
  let currentStageSources: StageImageLayerSource[] = [];

  const onStageState = (): void => {
    const state = stage.getSnapshot();
    if (
      !activeTrace ||
      currentStageAssetId !== activeTrace.targetAssetId ||
      !state.ready ||
      state.desiredSourceKey !== currentStageSourceKey ||
      committedTraceIds.has(activeTrace.traceId)
    ) return;
    committedTraceIds.add(activeTrace.traceId);
    recordPreviewFrameTrace('test-exact-ready-resource-commit', activeTrace, {
      status: 'COMMITTED',
      committedFrameId: activeTrace.targetFrameId,
      displayedFrameId: 'NOT_OBSERVABLE',
      commitBoundary: 'StageImageResourceSession-state-only',
      stagePaint: 'NOT_OBSERVABLE',
      testOnly: true,
    });
  };

  const targetAt = (timeMs: number) => {
    const evaluatedShot = evaluateShotAtTime(shot, timeMs, project);
    const frame = resolvePreviewAnimationFrame(project, evaluatedShot, LAYER_A);
    if (!frame) throw new Error(`No synthetic target frame at ${timeMs}ms.`);
    const traceContext = createPreviewFrameTraceContext(
      frame,
      shot.id,
      evaluatedShot.timeMs,
      playbackGeneration,
      0,
    );
    if (!traceContext) throw new Error('The diagnostic sink was not enabled.');
    return { evaluatedShot, traceContext };
  };

  const requestTarget = (timeMs: number): void => {
    const { evaluatedShot, traceContext } = targetAt(timeMs);
    activeTrace = traceContext;
    recordPreviewFrameTrace('target-changed', traceContext, {
      status: 'PENDING',
      requestBoundary: 'synthetic-evaluator-target',
      testOnly: true,
    });
    if (currentStageSources.length > 0) {
      stage.reconcile(currentStageSources, onStageState, traceContext);
    }
    const scope = buildProductPreviewImagePlan(project, shot, evaluatedShot);
    const preparing = preview.prepare(
      projectRoot,
      project,
      scope,
      [],
      traceContext,
    );
    void preparing.then((state) => {
      if (!state || activeTrace?.traceId !== traceContext.traceId) return;
      preview.commitScope(projectRoot, project, scope);
      const readyUrls: Record<string, string> = {};
      for (const [assetId, url] of Object.entries(state.urls)) {
        if (url) readyUrls[assetId] = url;
      }
      const built = buildSources(project, evaluatedShot, readyUrls);
      currentStageSources = built.current;
      currentStageAssetId = traceContext.targetAssetId;
      currentStageSourceKey = buildStageImageSourceKey(built.current);
      decodePool.setRequiredSourceUrls(
        built.current.map((source) => source.sourceUrl),
      );
      stage.reconcile(currentStageSources, onStageState, traceContext);
    });
  };

  try {
    requestTarget(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(delayMs);
    await vi.advanceTimersByTimeAsync(delayMs);
    for (let frameIndex = 1; frameIndex < 21; frameIndex += 1) {
      await vi.advanceTimersByTimeAsync(40);
      requestTarget(frameIndex * 40);
      await vi.advanceTimersByTimeAsync(0);
    }
    await vi.advanceTimersByTimeAsync(40);
    requestTarget(840);
    await vi.advanceTimersByTimeAsync(0);
    const playbackEndedAtMs = performance.now();
    await vi.advanceTimersByTimeAsync(delayMs * 2 + 1);

    const targetEvents = events.filter(
      (event) => event.event === 'frame-trace:target-changed' &&
        Number(event.detail.shotTimeMs) > 0,
    );
    const exactReadyEvents = events.filter(
      (event) => event.event === 'frame-trace:test-exact-ready-resource-commit' &&
        event.detail.testOnly === true,
    );
    const initialTraceId = events.find(
      (event) => event.event === 'frame-trace:target-changed' &&
        Number(event.detail.shotTimeMs) === 0,
    )?.detail.traceId;
    const initialCommit = events.find(
      (event) => event.event === 'frame-trace:test-exact-ready-resource-commit' &&
        event.detail.traceId === initialTraceId &&
        event.detail.testOnly === true,
    );
    const displayTargetEvents = events.filter((event) =>
      event.event === 'frame-trace:target-changed' &&
      event.detail.traceId !== initialTraceId,
    );
    let displayedFrameId = String(initialCommit?.detail.committedFrameId ?? '');
    let staleStartedAtMs: number | null = null;
    let maxOldFrameHoldMs = 0;
    for (const event of [...displayTargetEvents, ...exactReadyEvents]
      .sort((left, right) => left.atMs - right.atMs)) {
      const targetFrameId = String(event.detail.targetFrameId ?? '');
      if (event.event === 'frame-trace:target-changed') {
        if (targetFrameId === displayedFrameId && staleStartedAtMs !== null) {
          maxOldFrameHoldMs = Math.max(
            maxOldFrameHoldMs,
            event.atMs - staleStartedAtMs,
          );
          staleStartedAtMs = null;
        } else if (targetFrameId !== displayedFrameId && staleStartedAtMs === null) {
          staleStartedAtMs = event.atMs;
        }
        continue;
      }
      if (targetFrameId !== displayedFrameId) {
        displayedFrameId = targetFrameId;
        if (staleStartedAtMs !== null) {
          maxOldFrameHoldMs = Math.max(
            maxOldFrameHoldMs,
            event.atMs - staleStartedAtMs,
          );
          staleStartedAtMs = null;
        }
      }
    }
    if (staleStartedAtMs !== null) {
      maxOldFrameHoldMs = Math.max(
        maxOldFrameHoldMs,
        playbackEndedAtMs - staleStartedAtMs,
      );
    }

    const commitLatenciesMs = exactReadyEvents
      .filter((event) => event.detail.traceId !== initialTraceId)
      .map((event) => Number(event.atMs) - Number(event.detail.requestedAt));
    const supersededTargets = events.filter(
      (event) => event.event === 'frame-trace:outcome' &&
        event.detail.status === 'SUPERSEDED',
    ).length;
    const terminalTraceIds = new Set([
      ...exactReadyEvents.map((event) => String(event.detail.traceId)),
      ...events
        .filter((event) => event.event === 'frame-trace:outcome' &&
          event.detail.status !== 'PENDING')
        .map((event) => String(event.detail.traceId)),
    ]);
    const pendingTargets = targetEvents.filter(
      (event) => !terminalTraceIds.has(String(event.detail.traceId)),
    ).length;

    return {
      delayMs,
      events,
      commitLatenciesMs,
      maxModeledOldFrameHoldMs: maxOldFrameHoldMs,
      supersededTargets,
      pendingTargets,
      input: {
        projectId: project.id,
        shotId: shot.id,
        frameIds: animation.frames.map((_, index) => `${animation.id}:frame-${index}`),
      },
    };
  } finally {
    preview.dispose();
    stage.dispose();
    vi.unstubAllGlobals();
  }
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

describe('Issue #964 single-animation frame trace', () => {
  it('links one synthetic 21-frame loop through byte read, decode, and exact-ready timing', async () => {
    vi.useFakeTimers();
    try {
      const results = [];
      for (const delayMs of [20, 60, 100]) {
        results.push(await runApReal01FrameTraceScenario(delayMs));
      }
      const percentile = (samples: readonly number[], fraction: number): number | null => {
        if (samples.length === 0) return null;
        const sorted = [...samples].sort((left, right) => left - right);
        return sorted[Math.ceil(fraction * sorted.length) - 1] ?? null;
      };
      const summaries = results.map((result) => {
        const targets = result.events.filter(
          (event) => event.event === 'frame-trace:target-changed',
        );
        const byteReady = result.events.filter(
          (event) => event.event === 'frame-trace:byte-read-ready',
        );
        const decodeReady = result.events.filter(
          (event) => event.event === 'frame-trace:decode-ready',
        );
        const commits = result.events.filter(
          (event) => event.event === 'frame-trace:test-exact-ready-resource-commit' &&
            event.detail.testOnly === true,
        );
        const initialTraceId = targets.find(
          (event) => Number(event.detail.shotTimeMs) === 0,
        )?.detail.traceId;
        const playbackTargets = targets.filter(
          (event) => event.detail.traceId !== initialTraceId,
        );
        const latencySamples = (
          fromEventName: string | null,
          toEventName: string,
        ): number[] => playbackTargets.flatMap((target) => {
          const toEvent = result.events.find((candidate) =>
            candidate.event === toEventName &&
            candidate.detail.traceId === target.detail.traceId,
          );
          if (!toEvent) return [];
          if (fromEventName === null) {
            return [toEvent.atMs - Number(target.detail.requestedAt)];
          }
          const fromEvent = result.events.find((candidate) =>
            candidate.event === fromEventName &&
            candidate.detail.traceId === target.detail.traceId,
          );
          return fromEvent ? [toEvent.atMs - fromEvent.atMs] : [];
        });
        const eventOffset = (traceId: unknown, eventName: string, requestedAt: number) => {
          const event = result.events.find((candidate) =>
            candidate.event === eventName && candidate.detail.traceId === traceId,
          );
          return event ? Math.round(event.atMs - requestedAt) : null;
        };
        const frameSamples = playbackTargets
          .filter((event) => [1, 20].includes(Number(event.detail.frameIndex)) ||
            Number(event.detail.cycleIndex) === 1)
          .map((event) => {
            const requestedAt = Number(event.detail.requestedAt);
            return {
              frameId: event.detail.targetFrameId,
              traceId: event.detail.traceId,
              targetToByteStartMs: eventOffset(
                event.detail.traceId,
                'frame-trace:byte-read-start',
                requestedAt,
              ),
              targetToByteReadyMs: eventOffset(
                event.detail.traceId,
                'frame-trace:byte-read-ready',
                requestedAt,
              ),
              targetToDecodeStartMs: eventOffset(
                event.detail.traceId,
                'frame-trace:decode-start',
                requestedAt,
              ),
              targetToDecodeReadyMs: eventOffset(
                event.detail.traceId,
                'frame-trace:decode-ready',
                requestedAt,
              ),
              targetToExactReadyResourceCommitMs: eventOffset(
                event.detail.traceId,
                'frame-trace:test-exact-ready-resource-commit',
                requestedAt,
              ),
              result: commits.some((commit) => commit.detail.traceId === event.detail.traceId)
                ? 'COMMITTED'
                : result.events.find((candidate) =>
                    candidate.event === 'frame-trace:outcome' &&
                    candidate.detail.traceId === event.detail.traceId,
                  )?.detail.status ?? 'PENDING',
            };
          });
        const summarizeSamples = (samples: readonly number[]) => ({
          count: samples.length,
          p50: percentile(samples, 0.5),
          p95: percentile(samples, 0.95),
          max: samples.length ? Math.max(...samples) : null,
        });
        return {
          delayMs: result.delayMs,
          targetCount: targets.length,
          distinctFrameIds: new Set(targets.map((event) => event.detail.targetFrameId)).size,
          byteReadyCount: byteReady.length,
          decodeReadyCount: decodeReady.length,
          syntheticExactReadyResourceCommitCount: commits.length,
          targetToCommitSampleCount: result.commitLatenciesMs.length,
          targetToCommitP50Ms: percentile(result.commitLatenciesMs, 0.5),
          targetToCommitP95Ms: percentile(result.commitLatenciesMs, 0.95),
          targetToCommitMaxMs: result.commitLatenciesMs.length
            ? Math.max(...result.commitLatenciesMs)
            : null,
          targetToByteReadyMs: summarizeSamples(
            latencySamples(null, 'frame-trace:byte-read-ready'),
          ),
          byteReadyToDecodeReadyMs: summarizeSamples(
            latencySamples('frame-trace:byte-read-ready', 'frame-trace:decode-ready'),
          ),
          decodeReadyToExactReadyResourceCommitMs: summarizeSamples(
            latencySamples(
              'frame-trace:decode-ready',
              'frame-trace:test-exact-ready-resource-commit',
            ),
          ),
          modeledOldFrameHoldMaxMs: result.maxModeledOldFrameHoldMs,
          supersededTargets: result.supersededTargets,
          pendingTargets: result.pendingTargets,
          eventCount: result.events.length,
          frameSamples,
        };
      });

      for (const result of results) {
        const targets = result.events.filter(
          (event) => event.event === 'frame-trace:target-changed',
        );
        expect(result.input.frameIds).toHaveLength(21);
        expect(new Set(targets.map((event) => event.detail.targetFrameId)).size).toBe(21);
        expect(result.events.length).toBeLessThanOrEqual(2_048);
        const supersededIndexByTrace = new Map(
          result.events.flatMap((event, index) =>
            event.event === 'frame-trace:outcome' &&
              event.detail.status === 'SUPERSEDED'
              ? [[String(event.detail.traceId), index] as const]
              : [],
          ),
        );
        for (const [eventIndex, event] of result.events.entries()) {
          if (
            event.event !== 'frame-trace:byte-read-ready' &&
            event.event !== 'frame-trace:decode-ready'
          ) continue;
          expect(event.detail.instanceId).toBe(LAYER_A);
          expect(event.detail.targetAssetId).toBe(event.detail.assetId);
          expect(event.detail.traceId).toBeTruthy();
          const supersededIndex = supersededIndexByTrace.get(String(event.detail.traceId));
          if (supersededIndex !== undefined && eventIndex > supersededIndex) {
            expect(event.detail.status).toBe('SUPERSEDED');
          }
        }
        for (const event of result.events.filter((candidate) =>
          candidate.event === 'frame-trace:test-exact-ready-resource-commit' &&
          candidate.detail.testOnly === true
        )) {
          expect(event.detail.committedFrameId).toBe(event.detail.targetFrameId);
          expect(event.detail.displayedFrameId).toBe('NOT_OBSERVABLE');
          expect(event.detail.stagePaint).toBe('NOT_OBSERVABLE');
          expect(event.detail.status).toBe('COMMITTED');
        }
      }
      expect(results[0]?.maxModeledOldFrameHoldMs).toBeLessThanOrEqual(40);
      expect(results[1]?.maxModeledOldFrameHoldMs).toBeGreaterThanOrEqual(760);
      expect(results[2]?.maxModeledOldFrameHoldMs).toBeGreaterThanOrEqual(760);
      console.info('[issue964-single-instance-frame-trace]', JSON.stringify(summaries));
    } finally {
      vi.useRealTimers();
    }
  }, 30_000);

  it('keeps the minimal two-instance trace identities isolated', () => {
    resetPreviewFrameTraceRecorderForTests();
    const records: FrameTraceRecord[] = [];
    vi.stubGlobal('window', {
      __pandaPreviewDiagnostics: {
        frameTraceEnabled: true,
        record(event: string, atMs: number, detail: FrameTraceRecord['detail']) {
          records.push({ event, atMs, detail });
        },
      },
    } as unknown as Window);
    try {
      const project = build21FrameProject({ includeSecond: true });
      const shot = project.shots[0]!;
      const evaluated = evaluateShotAtTime(shot, 1_000, project);
      const contextA = createPreviewFrameTraceContext(
        resolvePreviewAnimationFrame(project, evaluated, LAYER_A)!,
        shot.id,
        evaluated.timeMs,
        1,
        0,
      )!;
      const contextB = createPreviewFrameTraceContext(
        resolvePreviewAnimationFrame(project, evaluated, LAYER_B)!,
        shot.id,
        evaluated.timeMs,
        2,
        0,
      )!;
      recordPreviewFrameTrace('target-changed', contextA, { status: 'PENDING' });
      recordPreviewFrameTrace('required-queued', contextA, {
        status: 'PENDING',
        assetId: contextA.targetAssetId,
      });
      recordPreviewFrameTrace('target-changed', contextB, { status: 'PENDING' });
      recordPreviewFrameTrace('required-queued', contextB, {
        status: 'PENDING',
        assetId: contextB.targetAssetId,
      });

      const targetRecords = records.filter((record) =>
        record.event === 'frame-trace:required-queued',
      );
      expect(targetRecords.map((record) => record.detail.instanceId)).toEqual([
        LAYER_A,
        LAYER_B,
      ]);
      expect(targetRecords.map((record) => record.detail.traceId)).toEqual([
        contextA.traceId,
        contextB.traceId,
      ]);
      expect(contextA.targetAssetId).not.toBe(contextB.targetAssetId);

      const seekEvaluated = evaluateShotAtTime(shot, 1_040, project);
      const seekContextA = createPreviewFrameTraceContext(
        resolvePreviewAnimationFrame(project, seekEvaluated, LAYER_A)!,
        shot.id,
        seekEvaluated.timeMs,
        1,
        1,
      )!;
      recordPreviewFrameTrace('target-changed', seekContextA, { status: 'PENDING' });
      const outcomes = records.filter((record) =>
        record.event === 'frame-trace:outcome',
      );
      expect(seekContextA.traceId).not.toBe(contextA.traceId);
      expect(outcomes).toContainEqual(expect.objectContaining({
        detail: expect.objectContaining({
          traceId: contextA.traceId,
          status: 'SUPERSEDED',
          cause: 'target-changed',
        }),
      }));
      expect(outcomes.some((record) => record.detail.traceId === contextB.traceId)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
