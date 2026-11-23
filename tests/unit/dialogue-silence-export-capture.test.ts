// @vitest-environment happy-dom
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CharacterService,
  LayerService,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  evaluateShotAtTime,
  upsertMouthCueEventAtTime,
  type AdaptivePartsCharacter,
  type ImageAsset,
  type Project,
} from '../../src/domain';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';
import {
  ExportPreparationService,
} from '../../src/main/services/ExportPreparationService';
import type { ExportPreparationFileStore } from '../../src/main/services/ExportPreparationFileStore';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { EditorShell } from '../../src/renderer/shell/EditorShell';
import { projectProductPreviewDialogue } from '../../src/renderer/shell/productPreviewModel';
import {
  DIALOGUE_SILENCE_CAPTURE_TIMEOUT_MS,
  collectTalkingDialogueAudioAssets,
  useDialogueSilence,
  type UseDialogueSilenceResult,
} from '../../src/renderer/shell/useDialogueSilence';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import type { DialogueSilenceIntervals } from '../../src/shared/dialogue-silence';
import {
  EXPORT_PREPARATION_SUPPORT_PROFILE,
  ExportPreparationCandidateSchema,
  type ExportPreparationCandidate,
  type ExportPreparationRequest,
  type ExportPreparationResponse,
  type ExportPreparationSelectOutputRequest,
  type ExportPreparationSelectOutputResponse,
} from '../../src/shared/export-preparation-types';
import type { ExportStartResponse } from '../../src/shared/export-types';
import type { AssetDialogueSilenceRequest } from '../../src/shared/asset-preview-audio-api';
import { faceSource, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from './domain/testProject';

const PART_BODY_ASSET = 'd1000000-0000-4000-8000-000000000001';
const PART_FACE_ASSET = 'd1000000-0000-4000-8000-000000000002';
const EXPR_SMILE_ASSET = 'd1000000-0000-4000-8000-000000000003';
const MOUTH_OPEN_ASSET = 'd1000000-0000-4000-8000-000000000004';
const TALK_FRAME_2_ASSET = 'd1000000-0000-4000-8000-000000000005';
const AUDIO_ASSET_1 = 'd1000000-0000-4000-8000-000000000006';
const AUDIO_ASSET_2 = 'd1000000-0000-4000-8000-000000000007';
const PART_BODY_ID = 'd2000000-0000-4000-8000-000000000001';
const PART_FACE_ID = 'd2000000-0000-4000-8000-000000000002';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);

function makeImageAsset(id: string, name: string, sha256 = HASH_A): ImageAsset {
  return {
    id,
    kind: 'image',
    name,
    relativePath: `assets/${name}.png`,
    mimeType: 'image/png',
    sha256,
    width: 100,
    height: 100,
    usage: 'character',
    keywords: [],
  };
}

function makePart(
  partId: string,
  displayName: string,
  assetId: string,
  drawOrder: number,
  tx: number,
  ty: number,
) {
  return {
    partId,
    displayName,
    source: { kind: 'manual' as const, sourceId: assetId },
    assetId,
    imageMapping: {
      sourceWidth: 100,
      sourceHeight: 100,
      crop: { x: 0, y: 0, width: 100, height: 100 },
      exportScale: 1,
    },
    drawOrder,
    restTransform: { a: 1, b: 0, c: 0, d: 1, tx, ty },
    sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx, ty },
    visible: true,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function buildTalkingProject(options?: {
  projectId?: string;
  audioHash1?: string;
  includeSecondSpeaker?: boolean;
}): {
  project: Project;
  characterId: string;
  secondCharacterId?: string;
  layerId: string;
  animationId: string;
  shotId: string;
} {
  const base = graphicFaceProject(true);
  const baseShot = base.shots[0]!;
  const source = base.animations[0]!.source;
  const animationId = 'd3000000-0000-4000-8000-000000000010';
  const frames = [PART_FACE_ASSET, TALK_FRAME_2_ASSET].map((assetId, ordinal) => ({
    assetId,
    ordinal,
    sourceFrameIndex: ordinal + 1,
    sha256: HASH_A,
    sourceViewport: { x: ordinal * 10, y: 0, width: 100, height: 100 },
    offset: { x: ordinal * 10, y: 0 },
    startMs: ordinal * 100,
    durationMs: 100,
    createdBySequenceImport: true,
  }));

  let project = ProjectSchema.parse({
    ...base,
    ...(options?.projectId ? { id: options.projectId } : {}),
    schemaVersion: PROJECT_SCHEMA_VERSION,
    assets: [
      ...base.assets.map((asset) => ({ ...asset, sha256: asset.sha256 ?? HASH_A })),
      makeImageAsset(PART_BODY_ASSET, 'Body'),
      makeImageAsset(PART_FACE_ASSET, 'OrigFace'),
      makeImageAsset(EXPR_SMILE_ASSET, 'SmilePng'),
      makeImageAsset(MOUTH_OPEN_ASSET, 'MouthOpenPng'),
      makeImageAsset(TALK_FRAME_2_ASSET, 'TalkFrame2'),
      {
        id: AUDIO_ASSET_1,
        kind: 'audio',
        name: 'Line1',
        sha256: options?.audioHash1 ?? HASH_B,
        relativePath: 'assets/line1.wav',
        mimeType: 'audio/wav',
        durationMs: 1_200,
      },
      ...(options?.includeSecondSpeaker
        ? [
            {
              id: AUDIO_ASSET_2,
              kind: 'audio' as const,
              name: 'Line2',
              sha256: HASH_C,
              relativePath: 'assets/line2.wav',
              mimeType: 'audio/wav',
              durationMs: 1_200,
            },
          ]
        : []),
    ],
    animations: [
      ...base.animations,
      {
        id: animationId,
        name: 'TalkingLoop',
        durationMs: 200,
        frames,
        source: {
          ...source,
          targetKind: 'scene',
          sourceFps: 10,
          startFrameIndex: 1,
          endFrameIndex: 2,
          canvas: { width: 110, height: 100 },
          anchor: { x: 0, y: 0 },
        },
      },
    ],
    shots: [{ ...baseShot, durationMs: 2_400 }],
  });

  const charSvc = new CharacterService();
  project = charSvc.createAdaptiveParts(project, {
    name: 'Hero',
    parts: [
      makePart(PART_BODY_ID, '身体', PART_BODY_ASSET, 0, -50, -50),
      makePart(PART_FACE_ID, '原脸', PART_FACE_ASSET, 1, -50, -50),
    ],
  });
  const char = project.characters.at(-1) as AdaptivePartsCharacter;
  project = charSvc.setAdaptivePartsFaceBinding(project, char.id, {
    targetPartId: PART_FACE_ID,
  });
  project = charSvc.addExpression(project, char.id, {
    name: '微笑',
    assetId: EXPR_SMILE_ASSET,
  });
  const exprId = project.characters.find((c) => c.id === char.id)!.expressions![0]!.id;
  project = charSvc.setDefaultExpression(project, char.id, exprId);
  project = charSvc.setMouthOpenVisualSource(project, char.id, faceSource(1));
  project = charSvc.setTalkingAnimation(project, char.id, animationId, {
    mode: 'loop',
    firstFrame: 0,
    lastFrame: 1,
    restFrame: 0,
  });

  const layerRes = new LayerService().createFromAdaptiveCharacter(
    project,
    IDS.shot,
    char.id,
    { x: 960, y: 540 },
  );
  project = layerRes.project;

  const clipId1 = 'd3000000-0000-4000-8000-000000000021';
  const voiceId1 = 'd3000000-0000-4000-8000-000000000022';
  const dialogueId1 = 'd3000000-0000-4000-8000-000000000023';

  let secondCharacterId: string | undefined;
  const extraAudioClips = [] as Project['shots'][number]['audioClips'];
  const extraDialogues = [] as Project['shots'][number]['dialogues'];
  const extraVoices = [] as Project['voiceProfiles'];

  if (options?.includeSecondSpeaker) {
    project = charSvc.createAdaptiveParts(project, {
      name: 'Companion',
      parts: [
        makePart(PART_BODY_ID, '身体', PART_BODY_ASSET, 0, -50, -50),
        makePart(PART_FACE_ID, '原脸', PART_FACE_ASSET, 1, -50, -50),
      ],
    });
    const char2 = project.characters.at(-1) as AdaptivePartsCharacter;
    secondCharacterId = char2.id;
    project = charSvc.setAdaptivePartsFaceBinding(project, char2.id, {
      targetPartId: PART_FACE_ID,
    });
    project = charSvc.setTalkingAnimation(project, char2.id, animationId, {
      mode: 'loop',
      firstFrame: 0,
      lastFrame: 1,
      restFrame: 0,
    });
    project = new LayerService().createFromAdaptiveCharacter(
      project,
      IDS.shot,
      char2.id,
      { x: 500, y: 540 },
    ).project;
    const clipId2 = 'd3000000-0000-4000-8000-000000000031';
    const voiceId2 = 'd3000000-0000-4000-8000-000000000032';
    const dialogueId2 = 'd3000000-0000-4000-8000-000000000033';
    extraVoices.push({
      ...project.voiceProfiles[0]!,
      id: voiceId2,
      name: 'CompanionVoice',
      characterId: char2.id,
    });
    extraAudioClips.push({
      id: clipId2,
      name: 'Line2',
      assetId: AUDIO_ASSET_2,
      role: 'dialogue',
      startMs: 1_200,
      endMs: 2_200,
      offsetMs: 0,
      volume: 1,
    });
    extraDialogues.push({
      id: dialogueId2,
      characterId: char2.id,
      voiceProfileId: voiceId2,
      subtitleStyleId: IDS.subtitle,
      audioClipId: clipId2,
      text: '第二句',
      startMs: 1_200,
      endMs: 2_200,
    });
  }

  project = ProjectSchema.parse({
    ...project,
    voiceProfiles: [
      ...project.voiceProfiles,
      {
        ...project.voiceProfiles[0]!,
        id: voiceId1,
        name: 'HeroVoice',
        characterId: char.id,
      },
      ...extraVoices,
    ],
    shots: project.shots.map((shot) => ({
      ...shot,
      audioClips: [
        {
          id: clipId1,
          name: 'Line1',
          assetId: AUDIO_ASSET_1,
          role: 'dialogue',
          startMs: 100,
          endMs: 1_100,
          offsetMs: 200,
          volume: 1,
        },
        ...extraAudioClips,
      ],
      dialogues: [
        {
          id: dialogueId1,
          characterId: char.id,
          voiceProfileId: voiceId1,
          subtitleStyleId: IDS.subtitle,
          audioClipId: clipId1,
          text: '你好呀',
          startMs: 100,
          endMs: 1_100,
        },
        ...extraDialogues,
      ],
    })),
  });

  return {
    project,
    characterId: char.id,
    secondCharacterId,
    layerId: layerRes.layer.id,
    animationId,
    shotId: IDS.shot,
  };
}

function installEnvironmentShims(): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof globalThis.IntersectionObserver !== 'function') {
    globalThis.IntersectionObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof IntersectionObserver;
  }
  if (typeof globalThis.ResizeObserver !== 'function') {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
  }
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (() => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
  if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = (() =>
      new Proxy(
        {
          measureText: () => ({ width: 0 }),
          createLinearGradient: () => ({ addColorStop: () => undefined }),
          createRadialGradient: () => ({ addColorStop: () => undefined }),
          createPattern: () => null,
          getImageData: () => ({ data: new Uint8ClampedArray(4) }),
        } as Record<string, unknown>,
        {
          get(target, prop) {
            if (typeof prop === 'string' && prop in target) return target[prop];
            return () => undefined;
          },
        },
      )) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  }
}

function createMemoryExportPreparationService(
  getSnapshot: () => { project: Project; revision: number; dirty: boolean; openInstanceId: number | null } | null,
) {
  const writes = new Map<string, Uint8Array>();
  const fileStore: ExportPreparationFileStore = {
    create: async () => undefined,
    writeAsset: async (snapshotId, handleId, _mimeType, bytes) => {
      const relative = `${handleId}.bin`;
      writes.set(`${snapshotId}/${relative}`, new Uint8Array(bytes));
      return relative;
    },
    readAsset: async (snapshotId, handleId) => {
      const data = writes.get(`${snapshotId}/${handleId}.bin`);
      if (!data) throw new Error('Missing frozen asset');
      return new Uint8Array(data);
    },
    delete: async (snapshotId) => {
      for (const key of [...writes.keys()]) {
        if (key.startsWith(`${snapshotId}/`)) writes.delete(key);
      }
    },
    dispose: async () => undefined,
  };
  const bytesByAsset = new Map<string, Uint8Array>();
  const service = new ExportPreparationService({
    getCurrentProjectSnapshot: () => getSnapshot(),
    fileStore,
    mediaReader: {
      getByteLength: async (_root, asset) => {
        const bytes = new TextEncoder().encode(`fake-media-${asset.id}`);
        bytesByAsset.set(asset.id, bytes);
        return bytes.byteLength;
      },
      read: async (_root, _project, asset) => ({
        bytes: bytesByAsset.get(asset.id) ?? new TextEncoder().encode(`fake-media-${asset.id}`),
        mimeType: asset.mimeType,
      }),
    },
  });
  const setMatchingHashes = (project: Project): Project => {
    const hashByAssetId = new Map<string, string>();
    const assets = project.assets.map((asset) => {
      const bytes = new TextEncoder().encode(`fake-media-${asset.id}`);
      bytesByAsset.set(asset.id, bytes);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      hashByAssetId.set(asset.id, sha256);
      return { ...asset, sha256 };
    });
    const animations = project.animations.map((animation) => ({
      ...animation,
      frames: animation.frames.map((frame) => ({
        ...frame,
        sha256: hashByAssetId.get(frame.assetId) ?? frame.sha256,
      })),
    }));
    return ProjectSchema.parse({
      ...project,
      assets,
      animations,
    });
  };
  return { service, setMatchingHashes };
}

function buildWindowPandaStageMock(overrides: {
  analyzeDialogueSilence: (
    request: AssetDialogueSilenceRequest,
  ) => Promise<DialogueSilenceIntervals | null>;
  selectOutput?: (
    request: ExportPreparationSelectOutputRequest,
  ) => Promise<ExportPreparationSelectOutputResponse>;
  prepare?: (request: ExportPreparationRequest) => Promise<ExportPreparationResponse>;
  cancelPrepare?: (attemptId: string) => Promise<{ accepted: boolean }>;
  discard?: (request: { selectionId?: string; snapshotId?: string }) => Promise<{ discarded: boolean }>;
  startFormal?: (
    snapshotId: string,
    reuseSnapshot?: boolean,
  ) => Promise<ExportStartResponse>;
}) {
  const stubDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  return {
    app: { ping: vi.fn(async () => ({ ok: true, pong: true })) },
    project: {
      chooseDirectory: vi.fn(async () => ({ status: 'cancelled' as const })),
      openFolder: vi.fn(async () => ({ ok: true as const })),
      confirmSwitch: vi.fn(async () => ({ outcome: 'saved' as const })),
      create: vi.fn(),
      createAt: vi.fn(),
      open: vi.fn(),
      save: vi.fn(async () => ({ ok: true as const })),
    },
    assets: {
      choose: vi.fn(),
      importDropped: vi.fn(),
      refreshMetadata: vi.fn(),
      cancelMetadata: vi.fn(async () => ({ cancelled: true })),
      delete: vi.fn(),
      readThumbnail: vi.fn(async () => ({
        ok: true as const,
        value: { kind: 'thumbnail' as const, status: 'ready' as const, dataUrl: stubDataUrl },
      })),
      readCanvasImage: vi.fn(async ({ assetId }: { assetId: string }) => ({
        ok: true as const,
        status: 'ready' as const,
        assetId,
        mimeType: 'image/png' as const,
        width: 100,
        height: 100,
        byteLength: 1,
        bytes: new Uint8Array([1]),
      })),
      readAudio: vi.fn(),
      analyzeDialogueSilence: overrides.analyzeDialogueSilence,
      getAudioInfo: vi.fn(),
    },
    recentProjects: {
      list: vi.fn(async () => ({ ok: true as const, entries: [] })),
      open: vi.fn(),
      remove: vi.fn(),
      relocate: vi.fn(),
    },
    autosave: {
      track: vi.fn(async () => ({ ok: true as const })),
      update: vi.fn(async () => ({ ok: true as const })),
      stop: vi.fn(async () => ({ ok: true as const })),
      onError: vi.fn(() => () => undefined),
    },
    nativeClose: {
      onSyncRequest: vi.fn(() => () => undefined),
      respondSync: vi.fn(),
    },
    recovery: {
      detect: vi.fn(async () => ({ ok: true as const, candidate: null })),
      restore: vi.fn(),
      ignore: vi.fn(),
    },
    export: {
      startProbe: vi.fn(),
      startFormal:
        overrides.startFormal ??
        vi.fn(async () => ({ jobId: crypto.randomUUID(), status: 'running' as const })),
      cancel: vi.fn(async () => ({ accepted: true })),
      revealOutput: vi.fn(async () => ({ opened: true })),
      onUpdate: vi.fn(() => () => undefined),
    },
    exportPreparation: {
      selectOutput:
        overrides.selectOutput ??
        vi.fn(async () => ({
          status: 'selected' as const,
          selectionId: crypto.randomUUID(),
          fileName: 'out.mp4',
          overwriteApproved: false as const,
        })),
      prepare:
        overrides.prepare ??
        vi.fn(async (request: ExportPreparationRequest): Promise<ExportPreparationResponse> => ({
          status: 'PREPARATION_READY' as const,
          candidate: ExportPreparationCandidateSchema.parse({
            version: 1,
            snapshotId: crypto.randomUUID(),
            jobId: crypto.randomUUID(),
            attemptId: request.attemptId,
            projectId: request.projectId,
            projectName: request.project.name,
            projectRoot: request.projectRoot,
            openInstanceId: request.openInstanceId,
            revision: request.revision,
            dirtyAtCapture: request.dirty,
            capturedAt: new Date().toISOString(),
            project: request.project,
            renderSettings: { width: 1_920, height: 1_080, fps: 24 },
            cameraMode: request.cameraMode,
            ...(request.dialogueSilence ? { dialogueSilence: request.dialogueSilence } : {}),
            supportProfileVersion: EXPORT_PREPARATION_SUPPORT_PROFILE.version,
            supportProfile: EXPORT_PREPARATION_SUPPORT_PROFILE,
            outputIntent: {
              selectionId: request.selectionId,
              targetPath: 'D:\\out.mp4',
              fileName: 'out.mp4',
              overwriteApproved: false,
              targetIdentity: null,
            },
            mediaManifest: [],
            totalMediaBytes: 0,
          }) as ExportPreparationCandidate,
        })),
      cancel: overrides.cancelPrepare ?? vi.fn(async () => ({ accepted: true })),
      getSnapshotRetryStatus: vi.fn(async () => ({ available: false, expiresAt: null })),
      discard: overrides.discard ?? vi.fn(async () => ({ discarded: true })),
    },
    fla: {
      chooseAndInspect: vi.fn(),
      previewRaster: vi.fn(),
      onInspectionStarted: vi.fn(() => () => undefined),
      cancel: vi.fn(async () => ({ cancelled: true })),
      commitSelected: vi.fn(),
      staticSnapshotCatalog: vi.fn(),
      staticSnapshotPreview: vi.fn(),
      staticSnapshotCommit: vi.fn(),
      staticSnapshotCancel: vi.fn(),
      partPreview: vi.fn(),
      partPreviewCancel: vi.fn(),
      createCharacterFromParts: vi.fn(),
      getCharacterCreateStatus: vi.fn(),
      frameSequenceRender: vi.fn(),
      frameSequenceCancel: vi.fn(),
      frameSequenceCommit: vi.fn(),
      commitGraphicInstance: vi.fn(),
      frameSequenceProgressSubscribe: vi.fn(() => () => undefined),
    },
  };
}

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;
const temporaryDirectories: string[] = [];

function mountHookHarness(
  project: Project | undefined,
  projectRoot: string | undefined,
  openInstanceId?: number | null,
): {
  latest: () => UseDialogueSilenceResult;
  rerender: (nextProject: Project | undefined, nextRoot: string | undefined, nextInstance?: number | null) => void;
} {
  if (mountedRoot) {
    act(() => {
      mountedRoot!.unmount();
    });
    mountedRoot = null;
  }
  mountedContainer?.remove();
  mountedContainer = null;

  let result!: UseDialogueSilenceResult;
  function Harness(props: {
    project: Project | undefined;
    projectRoot: string | undefined;
    openInstanceId?: number | null;
  }) {
    result = useDialogueSilence(props.project, props.projectRoot, props.openInstanceId);
    return null;
  }
  mountedContainer = document.createElement('div');
  document.body.appendChild(mountedContainer);
  mountedRoot = createRoot(mountedContainer);
  act(() => {
    mountedRoot!.render(createElement(Harness, { project, projectRoot, openInstanceId }));
  });
  return {
    latest: () => result,
    rerender: (nextProject, nextRoot, nextInstance) => {
      act(() => {
        mountedRoot!.render(
          createElement(Harness, {
            project: nextProject,
            projectRoot: nextRoot,
            openInstanceId: nextInstance,
          }),
        );
      });
    },
  };
}

async function flushMicrotasks(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  installEnvironmentShims();
});

afterEach(() => {
  if (mountedRoot) {
    act(() => {
      mountedRoot!.unmount();
    });
    mountedRoot = null;
  }
  mountedContainer?.remove();
  mountedContainer = null;
  selectionStore.clear();
  editorProjectStore.clear();
  delete (window as { pandaStage?: unknown }).pandaStage;
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const dir of temporaryDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Issue #1220: pending dialogue silence capture for export', () => {
  it('reuses pending silence analysis on immediate export in EditorShell and maintains Stage/Preview/Export parity', async () => {
    const setup = buildTalkingProject();
    const projectRoot = 'C:/temp/issue1220-immediate.pandastage';
    const deferred = createDeferred<DialogueSilenceIntervals | null>();
    const analyzeDialogueSilence = vi.fn(() => deferred.promise);
    const prepareRequests: ExportPreparationRequest[] = [];
    const prepare = vi.fn(async (request: ExportPreparationRequest) => {
      prepareRequests.push(request);
      return buildWindowPandaStageMock({ analyzeDialogueSilence }).exportPreparation.prepare(request);
    });
    const startFormal = vi.fn(async (snapshotId: string) => {
      void snapshotId;
      return { jobId: crypto.randomUUID(), status: 'running' as const };
    });

    (window as { pandaStage?: unknown }).pandaStage = buildWindowPandaStageMock({
      analyzeDialogueSilence,
      prepare,
      startFormal,
    });

    editorProjectStore.open(projectRoot, setup.project);
    shotStore.select(setup.shotId);
    mountedContainer = document.createElement('div');
    document.body.appendChild(mountedContainer);
    mountedRoot = createRoot(mountedContainer);

    await act(async () => {
      mountedRoot!.render(createElement(EditorShell));
    });

    // Switch from Project Center to Editor without waiting for silence analysis to finish.
    const continueBtn = mountedContainer.querySelector('[data-testid="return-to-editor"]') as HTMLButtonElement;
    expect(continueBtn).not.toBeNull();
    await act(async () => {
      continueBtn.click();
    });

    // Silence analysis was started once by useDialogueSilence and is STILL pending.
    expect(analyzeDialogueSilence).toHaveBeenCalledTimes(1);
    expect(analyzeDialogueSilence).toHaveBeenCalledWith({
      projectRoot,
      assetId: AUDIO_ASSET_1,
      sha256: HASH_B,
    });

    // Immediately click Export while analysis is pending.
    const exportBtn = mountedContainer.querySelector('[data-testid="quick-action-export"]') as HTMLButtonElement;
    expect(exportBtn).not.toBeNull();
    await act(async () => {
      exportBtn.click();
      await flushMicrotasks();
    });

    // Preparation has NOT frozen a premature snapshot without silence, and did NOT duplicate analysis.
    expect(prepareRequests).toHaveLength(0);
    expect(analyzeDialogueSilence).toHaveBeenCalledTimes(1);

    // Resolve the pending analysis with a pause at source [500, 900] (shot time [400, 800] since start=100, offset=200).
    await act(async () => {
      deferred.resolve([[500, 900]]);
      await flushMicrotasks(12);
    });

    expect(analyzeDialogueSilence).toHaveBeenCalledTimes(1);
    expect(prepareRequests).toHaveLength(1);
    expect(prepareRequests[0]!.dialogueSilence).toEqual({
      [AUDIO_ASSET_1]: { sha256: HASH_B, intervals: [[500, 900]] },
    });
    expect(startFormal).toHaveBeenCalledTimes(1);

    // Verify Stage, Product Preview, and Export evaluate identically at voiced & silent frames.
    const capturedSilence = prepareRequests[0]!.dialogueSilence!;
    const shot = setup.project.shots[0]!;
    for (const [timeMs, expectedState] of [
      [250, 150],
      [450, 'rest'],
      [850, 750],
    ] as const) {
      const exported = evaluateExportShotAtTime(setup.project, shot, timeMs, undefined, capturedSilence)
        .layers.find((l) => l.id === setup.layerId)!;
      const preview = projectProductPreviewDialogue(
        setup.project,
        shot,
        evaluateShotAtTime(shot, timeMs, setup.project),
        undefined,
        capturedSilence,
      ).layers.find((l) => l.id === setup.layerId)!;
      const stage = buildEditorTemporalCanvasModel({
        project: setup.project,
        shot,
        currentTimeMs: timeMs,
        dialogueSilence: capturedSilence,
        readyAssetIds: new Set(setup.project.assets.map((a) => a.id)),
        previousVisuals: new Map(),
      }).evaluatedShot.layers.find((l) => l.id === setup.layerId)!;
      expect(exported.talkingAnimationElapsedMs).toBe(expectedState);
      expect(preview.talkingAnimationElapsedMs).toBe(expectedState);
      expect(stage.talkingAnimationElapsedMs).toBe(expectedState);
    }
  });

  it('deduplicates when export triggers capture before Effect has started analysis, and runs zero delay when already settled', async () => {
    const setup = buildTalkingProject();
    const projectRoot = 'C:/temp/issue1220-dedupe.pandastage';
    const deferred = createDeferred<DialogueSilenceIntervals | null>();
    const analyzeDialogueSilence = vi.fn(() => deferred.promise);
    (window as { pandaStage?: unknown }).pandaStage = buildWindowPandaStageMock({
      analyzeDialogueSilence,
    });

    // Mount with undefined first so Effect does not start analysis before captureForExport is called.
    const hook = mountHookHarness(undefined, undefined, null);
    expect(collectTalkingDialogueAudioAssets(setup.project)).toEqual([
      { assetId: AUDIO_ASSET_1, sha256: HASH_B },
    ]);

    const capturePromise = hook.latest().captureForExport({
      project: setup.project,
      projectRoot,
      openInstanceId: 1,
    });
    expect(analyzeDialogueSilence).toHaveBeenCalledTimes(1);

    // Rerender with the project -> Effect reuses the exact in-flight request without calling analyze again.
    hook.rerender(setup.project, projectRoot, 1);
    expect(analyzeDialogueSilence).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve([[400, 800]]);
      await flushMicrotasks();
    });
    await expect(capturePromise).resolves.toEqual({
      [AUDIO_ASSET_1]: { sha256: HASH_B, intervals: [[400, 800]] },
    });
    expect(hook.latest().dialogueSilence).toEqual({
      [AUDIO_ASSET_1]: { sha256: HASH_B, intervals: [[400, 800]] },
    });

    // Already-settled fast path creates no timer and resolves immediately.
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const fastResult = await hook.latest().captureForExport({
      project: setup.project,
      projectRoot,
      openInstanceId: 1,
    });
    expect(fastResult).toEqual({
      [AUDIO_ASSET_1]: { sha256: HASH_B, intervals: [[400, 800]] },
    });
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(analyzeDialogueSilence).toHaveBeenCalledTimes(1);
  });

  it('serializes background analysis across a batch of 16 dialogue assets and a project switch', async () => {
    const { project } = buildTalkingProject();
    const shot = project.shots[0]!;
    const audio = project.assets.find((asset) => asset.id === AUDIO_ASSET_1)!;
    const extraLines = Array.from({ length: 15 }, () => {
      const asset = { ...audio, id: crypto.randomUUID() };
      const clip = { ...shot.audioClips[0]!, id: crypto.randomUUID(), assetId: asset.id };
      const dialogue = { ...shot.dialogues[0]!, id: crypto.randomUUID(), audioClipId: clip.id };
      return { asset, clip, dialogue };
    });
    const batch = {
      ...project,
      assets: [...project.assets, ...extraLines.map(({ asset }) => asset)],
      shots: [{
        ...shot,
        audioClips: [...shot.audioClips, ...extraLines.map(({ clip }) => clip)],
        dialogues: [...shot.dialogues, ...extraLines.map(({ dialogue }) => dialogue)],
      }],
    };
    expect(collectTalkingDialogueAudioAssets(batch)).toHaveLength(16);
    const requests: ReturnType<typeof createDeferred<DialogueSilenceIntervals | null>>[] = [];
    const analyzeDialogueSilence = vi.fn(() => {
      const request = createDeferred<DialogueSilenceIntervals | null>();
      requests.push(request);
      return request.promise;
    });
    (window as { pandaStage?: unknown }).pandaStage = buildWindowPandaStageMock({
      analyzeDialogueSilence,
    });

    const hook = mountHookHarness(batch, 'C:/temp/issue1221-batch.pandastage', 1);
    for (let index = 0; index < 12; index += 1) {
      expect(analyzeDialogueSilence).toHaveBeenCalledTimes(index + 1);
      await act(async () => requests[index]!.resolve([[300, 700]]));
    }
    expect(Object.keys(hook.latest().dialogueSilence)).toHaveLength(12);
    expect(analyzeDialogueSilence).toHaveBeenCalledTimes(13);
    const targetRoot = 'C:/temp/issue1221-next.pandastage';
    hook.rerender(project, targetRoot, 2);
    expect(hook.latest().dialogueSilence).toEqual({});
    expect(analyzeDialogueSilence).toHaveBeenCalledTimes(13);
    await act(async () => requests[12]!.resolve([[400, 900]]));
    expect(hook.latest().dialogueSilence).toEqual({});
    expect(analyzeDialogueSilence).toHaveBeenCalledTimes(14);
    expect(analyzeDialogueSilence).toHaveBeenLastCalledWith({
      projectRoot: targetRoot,
      assetId: AUDIO_ASSET_1,
      sha256: HASH_B,
    });
    await act(async () => requests[13]!.resolve([[500, 800]]));
    expect(hook.latest().dialogueSilence).toEqual({
      [AUDIO_ASSET_1]: { sha256: HASH_B, intervals: [[500, 800]] },
    });

    const unconfigured = {
      ...project,
      characters: project.characters.map((character) => ({
        ...character,
        talkingAnimationId: undefined,
      })),
    };
    hook.rerender(unconfigured, targetRoot, 3);
    await expect(hook.latest().captureForExport({
      project: unconfigured,
      projectRoot: targetRoot,
      openInstanceId: 3,
    })).resolves.toEqual({});
    expect(analyzeDialogueSilence).toHaveBeenCalledTimes(14);
  });

  it('completes boundedly on reject, null, empty, or timeout while preserving settled intervals for other audio assets', async () => {
    vi.useFakeTimers();
    const setup = buildTalkingProject({ includeSecondSpeaker: true });
    const projectRoot = 'C:/temp/issue1220-fallback.pandastage';
    const d1 = createDeferred<DialogueSilenceIntervals | null>();
    const d2 = createDeferred<DialogueSilenceIntervals | null>();
    const analyzeDialogueSilence = vi.fn(({ assetId }: { assetId: string }) =>
      assetId === AUDIO_ASSET_1 ? d1.promise : d2.promise,
    );
    (window as { pandaStage?: unknown }).pandaStage = buildWindowPandaStageMock({
      analyzeDialogueSilence,
    });

    const hook = mountHookHarness(setup.project, projectRoot, 1);
    expect(analyzeDialogueSilence).toHaveBeenCalledTimes(1);

    const capturePromise = hook.latest().captureForExport({
      project: setup.project,
      projectRoot,
      openInstanceId: 1,
    });
    expect(analyzeDialogueSilence).toHaveBeenCalledTimes(2);

    // Audio 1 succeeds; Audio 2 never resolves -> bounded timeout (20s) preserves Audio 1 and degrades Audio 2 to M0.
    await act(async () => {
      d1.resolve([[300, 700]]);
      await flushMicrotasks();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DIALOGUE_SILENCE_CAPTURE_TIMEOUT_MS);
    });
    await expect(capturePromise).resolves.toEqual({
      [AUDIO_ASSET_1]: { sha256: HASH_B, intervals: [[300, 700]] },
    });

    // Audio 2 rejecting or returning null / [] degrades gracefully without blocking Audio 1.
    const rejectMock = vi.fn(async ({ assetId }: { assetId: string }) => {
      if (assetId === AUDIO_ASSET_1) return [[300, 700]] as DialogueSilenceIntervals;
      throw new Error('ffmpeg crashed');
    });
    (window as { pandaStage?: unknown }).pandaStage = buildWindowPandaStageMock({
      analyzeDialogueSilence: rejectMock,
    });
    const hook2 = mountHookHarness(setup.project, projectRoot, 2);
    await act(async () => {
      await expect(
        hook2.latest().captureForExport({
          project: setup.project,
          projectRoot,
          openInstanceId: 2,
        }),
      ).resolves.toEqual({
        [AUDIO_ASSET_1]: { sha256: HASH_B, intervals: [[300, 700]] },
      });
    });

    const nullAndEmptyMock = vi.fn(async ({ assetId }: { assetId: string }) =>
      assetId === AUDIO_ASSET_1 ? null : ([] as DialogueSilenceIntervals),
    );
    (window as { pandaStage?: unknown }).pandaStage = buildWindowPandaStageMock({
      analyzeDialogueSilence: nullAndEmptyMock,
    });
    const hook3 = mountHookHarness(setup.project, projectRoot, 3);
    await act(async () => {
      await expect(
        hook3.latest().captureForExport({
          project: setup.project,
          projectRoot,
          openInstanceId: 3,
        }),
      ).resolves.toEqual({});
    });
  });

  it('prevents cross-project, stale-hash, and stale-revision injection during wait and supports cancel during wait', async () => {
    const setupA = buildTalkingProject({ audioHash1: HASH_B });
    const projectRootA = 'C:/temp/issue1220-project-a.pandastage';
    const deferredA = createDeferred<DialogueSilenceIntervals | null>();
    const deferredD = createDeferred<DialogueSilenceIntervals | null>();
    const analyzeDialogueSilence = vi.fn(({ sha256 }: { sha256: string }) =>
      sha256 === HASH_B ? deferredA.promise : deferredD.promise,
    );
    const prepare = vi.fn();
    const discard = vi.fn(async () => ({ discarded: true }));
    const selectionId = crypto.randomUUID();
    const selectOutput = vi.fn(async () => ({
      status: 'selected' as const,
      selectionId,
      fileName: 'out.mp4',
      overwriteApproved: false as const,
    }));

    const pandaMock = buildWindowPandaStageMock({
      analyzeDialogueSilence,
      selectOutput,
      prepare,
      discard,
    });
    (window as { pandaStage?: unknown }).pandaStage = pandaMock;

    // Scenario A: Switch to another project while waiting -> discards selection, never calls prepare with old silence.
    editorProjectStore.open(projectRootA, setupA.project);
    shotStore.select(setupA.shotId);
    mountedContainer = document.createElement('div');
    document.body.appendChild(mountedContainer);
    mountedRoot = createRoot(mountedContainer);

    await act(async () => {
      mountedRoot!.render(createElement(EditorShell));
    });
    await act(async () => {
      (mountedContainer!.querySelector('[data-testid="return-to-editor"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (mountedContainer!.querySelector('[data-testid="quick-action-export"]') as HTMLButtonElement).click();
      await flushMicrotasks();
    });
    expect(prepare).not.toHaveBeenCalled();

    const setupB = buildTalkingProject({
      projectId: 'd9000000-0000-4000-8000-000000000099',
      audioHash1: HASH_D,
    });
    await act(async () => {
      editorProjectStore.open('C:/temp/issue1220-project-b.pandastage', setupB.project);
      deferredA.resolve([[450, 900]]);
      await flushMicrotasks(12);
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledWith({ selectionId });

    // Scenario B: Audio hash / revision changes while waiting -> aborts wait, discards selection, blocks stale snapshot.
    prepare.mockClear();
    discard.mockClear();
    const deferredB1 = createDeferred<DialogueSilenceIntervals | null>();
    const deferredB2 = createDeferred<DialogueSilenceIntervals | null>();
    analyzeDialogueSilence.mockImplementation(({ sha256 }: { sha256: string }) =>
      sha256 === HASH_B ? deferredB1.promise : deferredB2.promise,
    );
    await act(async () => {
      editorProjectStore.open(projectRootA, setupA.project);
      await flushMicrotasks();
    });
    await act(async () => {
      const retryFromA = [...mountedContainer!.querySelectorAll('button')].find((btn) =>
        btn.textContent?.includes('按当前内容重新导出'),
      ) as HTMLButtonElement;
      retryFromA.click();
      await flushMicrotasks();
    });
    expect(prepare).not.toHaveBeenCalled();

    const updatedHashProject = ProjectSchema.parse({
      ...setupA.project,
      assets: setupA.project.assets.map((asset) =>
        asset.id === AUDIO_ASSET_1 ? { ...asset, sha256: HASH_D } : asset,
      ),
    });
    await act(async () => {
      editorProjectStore.updateProject(updatedHashProject, 'Replace audio hash');
      deferredB1.resolve([[450, 900]]);
      await flushMicrotasks(12);
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledWith({ selectionId });
    expect(mountedContainer.textContent).toContain('工程内容或保存版本已变化');

    // Scenario C: Retrying export after hash change waits ONLY for HASH_D, never reuses HASH_B's intervals!
    const prepare2 = vi.fn(async (req: ExportPreparationRequest) =>
      buildWindowPandaStageMock({ analyzeDialogueSilence }).exportPreparation.prepare(req),
    );
    pandaMock.exportPreparation.prepare = prepare2;
    const retryCurrentBtn = [...mountedContainer.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('按当前内容重新导出'),
    ) as HTMLButtonElement;
    expect(retryCurrentBtn).toBeDefined();
    await act(async () => {
      retryCurrentBtn.click();
      await flushMicrotasks();
    });
    expect(prepare2).not.toHaveBeenCalled();
    await act(async () => {
      deferredB2.resolve([[300, 650]]);
      await flushMicrotasks(12);
    });
    expect(prepare2).toHaveBeenCalledTimes(1);
    expect(prepare2.mock.calls[0]![0].dialogueSilence).toEqual({
      [AUDIO_ASSET_1]: { sha256: HASH_D, intervals: [[300, 650]] },
    });

    // Scenario D: Cancel during pending silence wait cancels cleanly without calling prepare.
    const deferredCancel = createDeferred<DialogueSilenceIntervals | null>();
    analyzeDialogueSilence.mockImplementation(() => deferredCancel.promise);
    const prepare3 = vi.fn(async (req: ExportPreparationRequest) =>
      buildWindowPandaStageMock({ analyzeDialogueSilence }).exportPreparation.prepare(req),
    );
    discard.mockClear();
    pandaMock.exportPreparation.prepare = prepare3;
    const freshProject = buildTalkingProject({ audioHash1: HASH_C });
    await act(async () => {
      mountedRoot!.unmount();
    });
    editorProjectStore.open('C:/temp/issue1220-cancel.pandastage', freshProject.project);
    mountedRoot = createRoot(mountedContainer);
    await act(async () => {
      mountedRoot!.render(createElement(EditorShell));
    });
    await act(async () => {
      (mountedContainer!.querySelector('[data-testid="return-to-editor"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (mountedContainer!.querySelector('[data-testid="quick-action-export"]') as HTMLButtonElement).click();
      await flushMicrotasks();
    });
    const cancelBtn = [...mountedContainer.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('取消导出'),
    ) as HTMLButtonElement;
    expect(cancelBtn).toBeDefined();
    await act(async () => {
      cancelBtn.click();
      await flushMicrotasks(12);
    });
    expect(prepare3).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledWith({ selectionId });
    expect(mountedContainer.querySelector('[data-testid="export-task-surface"]')?.getAttribute('data-task-status')).toBe('cancelled');
  });

  it('preserves ExportPreparationService consistency and V1 reverse playback, restFrame, manual cues, offset and multi-instance isolation', async () => {
    const setup = buildTalkingProject();
    let project = new CharacterService().setTalkingAnimation(
      setup.project,
      setup.characterId,
      setup.animationId,
      { mode: 'loop reverse', firstFrame: 0, lastFrame: 1, restFrame: 0 },
    );
    project = upsertMouthCueEventAtTime(project, setup.shotId, setup.layerId, 'open', 550);
    project = upsertMouthCueEventAtTime(project, setup.shotId, setup.layerId, 'rest', 700);

    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'panda-issue1220-'));
    temporaryDirectories.push(tempDir);
    const projectRoot = path.join(tempDir, 'project.pandastage');
    const outputFile = path.join(tempDir, 'issue1220-e2e.mp4');

    const { service, setMatchingHashes } = createMemoryExportPreparationService(() => {
      const snap = editorProjectStore.getSnapshot();
      if (!snap) return null;
      return {
        project: snap.project,
        revision: snap.revision,
        dirty: snap.dirty,
        openInstanceId: editorProjectStore.getProjectInstanceId(),
      };
    });
    project = setMatchingHashes(project);
    const audioHash = project.assets.find((asset) => asset.id === AUDIO_ASSET_1)!.sha256!;
    editorProjectStore.open(projectRoot, project);

    const deferred = createDeferred<DialogueSilenceIntervals | null>();
    const analyzeDialogueSilence = vi.fn(() => deferred.promise);
    const prepareRequests: ExportPreparationRequest[] = [];
    const startFormal = vi.fn(async (snapshotId: string) => {
      void snapshotId;
      return { jobId: crypto.randomUUID(), status: 'running' as const };
    });

    const selectOutput = vi.fn((req) => service.selectOutput(req, outputFile));
    const prepare = vi.fn((req) => {
      prepareRequests.push(req);
      return service.prepare(req);
    });
    (window as { pandaStage?: unknown }).pandaStage = buildWindowPandaStageMock({
      analyzeDialogueSilence,
      selectOutput,
      prepare,
      cancelPrepare: vi.fn(async (attemptId: string) => ({ accepted: service.cancel(attemptId) })),
      discard: vi.fn((req) => service.discard(req.selectionId, req.snapshotId).then((discarded) => ({ discarded }))),
      startFormal,
    });

    mountedContainer = document.createElement('div');
    document.body.appendChild(mountedContainer);
    mountedRoot = createRoot(mountedContainer);
    await act(async () => {
      mountedRoot!.render(createElement(EditorShell));
    });
    await act(async () => {
      (mountedContainer!.querySelector('[data-testid="return-to-editor"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (mountedContainer!.querySelector('[data-testid="quick-action-export"]') as HTMLButtonElement).click();
      await vi.waitFor(() => {
        expect(selectOutput).toHaveBeenCalledTimes(1);
      });
      await selectOutput.mock.results[0]!.value;
      await flushMicrotasks();
    });

    // Preparation has not been called while silence analysis is pending.
    expect(prepare).not.toHaveBeenCalled();

    await act(async () => {
      deferred.resolve([[500, 900]]);
      await vi.waitFor(() => {
        expect(startFormal).toHaveBeenCalledTimes(1);
      });
    });

    expect(prepareRequests).toHaveLength(1);
    const prepResult = prepareRequests[0]!;
    expect(prepResult.dialogueSilence).toEqual({
      [AUDIO_ASSET_1]: { sha256: audioHash, intervals: [[500, 900]] },
    });
    expect(startFormal).toHaveBeenCalledTimes(1);
    const frozenSnapshotId = startFormal.mock.calls[0]![0] as string;
    const frozen = await service.acquireCandidateForExport(frozenSnapshotId);
    expect(frozen.candidate.dialogueSilence).toEqual({
      [AUDIO_ASSET_1]: { sha256: audioHash, intervals: [[500, 900]] },
    });

    // Check V1 behaviors on frozen candidate: offset + silence pause + manual open/rest cues.
    const shot = frozen.candidate.project.shots[0]!;
    const evalAt = (timeMs: number) =>
      evaluateExportShotAtTime(
        frozen.candidate.project,
        shot,
        timeMs,
        undefined,
        frozen.candidate.dialogueSilence,
      ).layers.find((l) => l.id === setup.layerId)!;
    // Before pause (source 350ms, shot 250ms): active talking
    expect(evalAt(250).talkingAnimationElapsedMs).toBe(150);
    // Inside pause [500, 900] (shot 400..800), cue=none -> rest
    expect(evalAt(450).talkingAnimationElapsedMs).toBe('rest');
    // Inside pause, manual cue='open' at 550ms -> mouthOverrideAssetId/mouthOpen overrides pause
    expect(evalAt(600).mouthOpen).toBe(true);
    // Manual cue='rest' at 700ms -> rest
    expect(evalAt(850).talkingAnimationElapsedMs).toBe('rest');

    // Reopening the same project path gets a new openInstanceId and does not reuse old session cache.
    const reopenDeferred = createDeferred<DialogueSilenceIntervals | null>();
    analyzeDialogueSilence.mockImplementation(() => reopenDeferred.promise);
    await act(async () => {
      mountedRoot!.unmount();
    });
    editorProjectStore.clear();
    editorProjectStore.open(projectRoot, project);
    mountedRoot = createRoot(mountedContainer);
    await act(async () => {
      mountedRoot!.render(createElement(EditorShell));
    });
    await act(async () => {
      (mountedContainer!.querySelector('[data-testid="return-to-editor"]') as HTMLButtonElement).click();
    });
    expect(analyzeDialogueSilence).toHaveBeenCalledTimes(2);
    await act(async () => {
      mountedRoot!.unmount();
      mountedRoot = null;
    });
  });
});
