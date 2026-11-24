import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../../domain';
import { listCharacterTalkingSources } from '../../domain/selectors/characterFaceSource';
import type { AssetDialogueSilenceRequest } from '../../shared/asset-preview-audio-api';
import {
  DialogueSilenceIntervalsSchema,
  type DialogueSilence,
  type DialogueSilenceIntervals,
} from '../../shared/dialogue-silence';

export const DIALOGUE_SILENCE_CAPTURE_TIMEOUT_MS = 20_000;

export interface TalkingDialogueAudioAssetRef {
  assetId: string;
  sha256: string;
}

export interface CaptureDialogueSilenceOptions {
  project: Project;
  projectRoot: string;
  openInstanceId?: number | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface UseDialogueSilenceResult {
  dialogueSilence: DialogueSilence;
  captureForExport(options: CaptureDialogueSilenceOptions): Promise<DialogueSilence>;
}

interface SilenceRequestEntry {
  promise: Promise<DialogueSilenceIntervals | null>;
  settled: boolean;
  intervals: DialogueSilenceIntervals | null;
}

interface SilenceCacheScope {
  scopeKey: string;
  entries: Map<string, SilenceRequestEntry>;
}

type AnalyzeDialogueSilenceFn = (
  request: AssetDialogueSilenceRequest,
) => Promise<DialogueSilenceIntervals | null>;

function buildScopeKey(
  projectRoot: string | undefined,
  projectId: string | undefined,
  openInstanceId: number | null | undefined,
): string | null {
  if (!projectRoot || !projectId) return null;
  return JSON.stringify([projectRoot, projectId, openInstanceId ?? null]);
}

function assetEntryKey(asset: TalkingDialogueAudioAssetRef): string {
  return `${asset.assetId}:${asset.sha256}`;
}

export function collectTalkingDialogueAudioAssets(
  project: Project | undefined,
): TalkingDialogueAudioAssetRef[] {
  if (!project) return [];
  const characters = new Set(
    project.characters
      .filter(
        (character) =>
          listCharacterTalkingSources(character).length > 0 &&
          (character.mode !== 'adaptive-parts' || character.faceBinding),
      )
      .map((character) => character.id),
  );
  if (characters.size === 0) return [];
  const used = new Set<string>();
  for (const shot of project.shots) {
    const placed = new Set(
      shot.layers.flatMap(({ source }) =>
        source.kind === 'character' ? [source.characterId] : [],
      ),
    );
    const clipIds = new Set(
      shot.dialogues.flatMap((dialogue) =>
        dialogue.characterId &&
        characters.has(dialogue.characterId) &&
        placed.has(dialogue.characterId) &&
        dialogue.audioClipId
          ? [dialogue.audioClipId]
          : [],
      ),
    );
    for (const clip of shot.audioClips) {
      if (clip.role === 'dialogue' && clip.endMs > clip.startMs && clipIds.has(clip.id)) {
        used.add(clip.assetId);
      }
    }
  }
  return project.assets.flatMap((asset) =>
    asset.kind === 'audio' && asset.sha256 && used.has(asset.id)
      ? [{ assetId: asset.id, sha256: asset.sha256 }]
      : [],
  );
}

function ensureRequestEntry(
  scope: SilenceCacheScope,
  projectRoot: string,
  asset: TalkingDialogueAudioAssetRef,
  analyze: AnalyzeDialogueSilenceFn,
): SilenceRequestEntry {
  const key = assetEntryKey(asset);
  const existing = scope.entries.get(key);
  if (existing) return existing;

  let rawPromise: Promise<DialogueSilenceIntervals | null>;
  try {
    rawPromise = Promise.resolve(analyze({ projectRoot, ...asset }));
  } catch {
    rawPromise = Promise.resolve(null);
  }
  const entry: SilenceRequestEntry = {
    settled: false,
    intervals: null,
    promise: rawPromise.then(
      (raw) => {
        const parsed = DialogueSilenceIntervalsSchema.nullable().safeParse(raw);
        const value = parsed.success ? parsed.data : null;
        entry.settled = true;
        entry.intervals = value;
        return value;
      },
      () => {
        entry.settled = true;
        entry.intervals = null;
        return null;
      },
    ),
  };
  scope.entries.set(key, entry);
  return entry;
}

export function useDialogueSilence(
  project: Project | undefined,
  projectRoot: string | undefined,
  openInstanceId?: number | null,
): UseDialogueSilenceResult {
  const assets = useMemo(
    () => collectTalkingDialogueAudioAssets(project),
    [project],
  );
  const cache = useRef<SilenceCacheScope | null>(null);
  const backgroundRequest = useRef<SilenceRequestEntry | null>(null);
  const [ready, setReady] = useState<{
    scopeKey: string;
    data: DialogueSilence;
  }>();
  const projectId = project?.id;
  const scopeKey = buildScopeKey(projectRoot, projectId, openInstanceId);

  const ensureScope = useCallback((targetScopeKey: string): SilenceCacheScope => {
    if (cache.current?.scopeKey !== targetScopeKey) {
      cache.current = { scopeKey: targetScopeKey, entries: new Map() };
    }
    return cache.current;
  }, []);

  useEffect(() => {
    if (!scopeKey) {
      cache.current = null;
      setReady((previous) => (previous === undefined ? previous : undefined));
      return;
    }
    const scope = ensureScope(scopeKey);
    const analyze = window.pandaStage?.assets?.analyzeDialogueSilence;
    if (!projectRoot || assets.length === 0 || !analyze) return;
    let active = true;
    const analyzeInBackground = async () => {
      // A previous effect may still be finishing its one request after an edit
      // or project switch. Export can reuse it or start its own required assets.
      if (backgroundRequest.current) await backgroundRequest.current.promise;
      for (const asset of assets) {
        if (!active) return;
        const entry = ensureRequestEntry(scope, projectRoot, asset, analyze);
        backgroundRequest.current = entry;
        const intervals = await entry.promise;
        if (backgroundRequest.current === entry) backgroundRequest.current = null;
        if (!active || !intervals?.length) continue;
        setReady((previous) => {
          const previousData =
            previous?.scopeKey === scopeKey ? previous.data : {};
          if (previousData[asset.assetId]?.sha256 === asset.sha256) {
            return previous;
          }
          return {
            scopeKey,
            data: {
              ...previousData,
              [asset.assetId]: { sha256: asset.sha256, intervals },
            },
          };
        });
      }
    };
    void analyzeInBackground();
    return () => {
      active = false;
    };
  }, [assets, ensureScope, projectRoot, scopeKey]);

  const dialogueSilence = useMemo(() => {
    if (!scopeKey || !ready || ready.scopeKey !== scopeKey) return {};
    return Object.fromEntries(
      assets.flatMap((asset) => {
        const entry = ready.data[asset.assetId];
        return entry?.sha256 === asset.sha256 ? [[asset.assetId, entry]] : [];
      }),
    );
  }, [assets, ready, scopeKey]);

  const captureForExport = useCallback(
    async ({
      project: targetProject,
      projectRoot: targetRoot,
      openInstanceId: targetInstanceId,
      signal,
      timeoutMs = DIALOGUE_SILENCE_CAPTURE_TIMEOUT_MS,
    }: CaptureDialogueSilenceOptions): Promise<DialogueSilence> => {
      if (signal?.aborted) return {};
      const analyze = window.pandaStage?.assets?.analyzeDialogueSilence;
      const targetScopeKey = buildScopeKey(
        targetRoot,
        targetProject.id,
        targetInstanceId,
      );
      const targetAssets = collectTalkingDialogueAudioAssets(targetProject);
      if (!analyze || !targetScopeKey || targetAssets.length === 0) return {};

      const scope = ensureScope(targetScopeKey);
      const results = new Map<string, DialogueSilenceIntervals | null>();
      const pending: Array<{ key: string; entry: SilenceRequestEntry }> = [];
      for (const asset of targetAssets) {
        const key = assetEntryKey(asset);
        const entry = ensureRequestEntry(scope, targetRoot, asset, analyze);
        if (entry.settled) {
          results.set(key, entry.intervals);
        } else {
          pending.push({ key, entry });
        }
      }

      if (pending.length > 0 && !signal?.aborted && timeoutMs > 0) {
        await new Promise<void>((resolve) => {
          let remaining = pending.length;
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            resolve();
          };
          const onAbort = () => finish();
          signal?.addEventListener('abort', onAbort, { once: true });
          const timer = setTimeout(finish, timeoutMs);
          for (const { key, entry } of pending) {
            void entry.promise.then((intervals) => {
              results.set(key, intervals);
              remaining -= 1;
              if (remaining <= 0) finish();
            });
          }
        });
      }

      if (signal?.aborted) return {};
      const captured: DialogueSilence = {};
      for (const asset of targetAssets) {
        const intervals = results.get(assetEntryKey(asset));
        if (intervals && intervals.length > 0) {
          captured[asset.assetId] = { sha256: asset.sha256, intervals };
        }
      }
      return captured;
    },
    [ensureScope],
  );

  return { dialogueSilence, captureForExport };
}
