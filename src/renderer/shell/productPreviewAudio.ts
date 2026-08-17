import { useEffect, useRef, useState } from 'react';
import type {
  AudioAsset,
  AudioClip,
  Dialogue,
  Project,
  Shot,
} from '../../domain';
import {
  type AssetPreviewAudioReadRequest,
  type AssetPreviewAudioReadResponse,
} from '../../shared/asset-preview-audio-api';

export interface ProductPreviewAudioSelection {
  dialogue: Dialogue;
  clip: AudioClip;
  asset: AudioAsset;
}

export function resolveProductPreviewAudio(
  project: Project,
  shot: Shot,
  activeDialogueId: string | null,
): ProductPreviewAudioSelection | null {
  if (!activeDialogueId) return null;
  const dialogue = shot.dialogues.find(
    (candidate) => candidate.id === activeDialogueId,
  );
  if (!dialogue?.audioClipId) return null;
  const clip = shot.audioClips.find(
    (candidate) => candidate.id === dialogue.audioClipId,
  );
  if (!clip) return null;
  const asset = project.assets.find(
    (candidate) => candidate.id === clip.assetId,
  );
  if (
    !asset ||
    asset.kind !== 'audio' ||
    asset.durationMs === undefined ||
    !asset.sha256 ||
    (asset.mimeType !== 'audio/mpeg' && asset.mimeType !== 'audio/wav')
  ) {
    return null;
  }
  return { dialogue, clip, asset };
}

/** Maps the preview master clock to a bounded source position in milliseconds. */
export function productPreviewSourceTimeMs(
  previewTimeMs: number,
  clip: AudioClip,
  asset: AudioAsset,
): number {
  const durationMs = asset.durationMs ?? 0;
  const raw =
    clip.offsetMs +
    (Number.isFinite(previewTimeMs) ? previewTimeMs : clip.startMs) -
    clip.startMs;
  return Math.min(durationMs, Math.max(0, raw));
}

export interface ProductPreviewAudioElement {
  src: string;
  currentTime: number;
  volume: number;
  pause(): void;
  play(): Promise<void>;
  load?(): void;
}

export interface ProductPreviewAudioTransportOptions {
  createAudio?: () => ProductPreviewAudioElement;
  readAudio?: (
    request: AssetPreviewAudioReadRequest,
  ) => Promise<AssetPreviewAudioReadResponse>;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  onWarning?: (message: string | null) => void;
}

export interface ProductPreviewAudioSyncInput {
  projectRoot: string;
  project: Project;
  shot: Shot | null;
  activeDialogueId: string | null;
  timeMs: number;
  playing: boolean;
  seekRevision: number;
}

function defaultReadAudio(
  request: AssetPreviewAudioReadRequest,
): Promise<AssetPreviewAudioReadResponse> {
  return window.pandaStage.assets.readAudio(request);
}

/**
 * One reusable audio element for the read-only Product Preview transport.
 * `timeMs` remains the renderer's master clock: ordinary clock ticks do not
 * seek the element. A new dialogue, explicit seek, pause/resume, or stop
 * repositions the subordinate audio source from the master time.
 */
export class ProductPreviewAudioTransport {
  private readonly audio: ProductPreviewAudioElement;
  private readonly readAudio: (
    request: AssetPreviewAudioReadRequest,
  ) => Promise<AssetPreviewAudioReadResponse>;
  private readonly createObjectUrl: (blob: Blob) => string;
  private readonly revokeObjectUrl: (url: string) => void;
  private readonly onWarning: (message: string | null) => void;
  private readonly urlCache = new Map<string, string>();
  private readonly urlReads = new Map<string, Promise<string | null>>();
  private generation = 0;
  private activeKey: string | null = null;
  private pendingKey: string | null = null;
  private startedKey: string | null = null;
  private failedKey: string | null = null;
  private lastSeekRevision: number | null = null;
  private disposed = false;

  constructor(options: ProductPreviewAudioTransportOptions = {}) {
    this.audio = (options.createAudio ?? (() => new Audio()))();
    this.readAudio = options.readAudio ?? defaultReadAudio;
    this.createObjectUrl =
      options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
    this.revokeObjectUrl =
      options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
    this.onWarning = options.onWarning ?? (() => undefined);
    this.audio.src = '';
  }

  sync(input: ProductPreviewAudioSyncInput): void {
    if (this.disposed) return;
    const selection = input.shot
      ? resolveProductPreviewAudio(
          input.project,
          input.shot,
          input.activeDialogueId,
        )
      : null;

    if (!input.playing || !selection) {
      this.stopTransport(input.timeMs <= 0);
      this.lastSeekRevision = input.seekRevision;
      return;
    }

    const key = this.selectionKey(input.projectRoot, input.shot!, selection);
    const selectionChanged = this.activeKey !== key;
    const seekChanged = this.lastSeekRevision !== input.seekRevision;
    if (selectionChanged || seekChanged) {
      this.cancelActivePlayback();
      this.activeKey = key;
      this.lastSeekRevision = input.seekRevision;
      this.failedKey = null;
    }

    if (
      this.startedKey === key ||
      this.pendingKey === key ||
      this.failedKey === key
    ) {
      return;
    }

    const token = this.generation;
    this.pendingKey = key;
    void this.startSelection(
      token,
      key,
      input.projectRoot,
      selection,
      input.timeMs,
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTransport(true);
    this.audio.src = '';
    this.audio.load?.();
    for (const url of this.urlCache.values()) {
      this.revokeObjectUrl(url);
    }
    this.urlCache.clear();
    this.urlReads.clear();
  }

  private async startSelection(
    token: number,
    key: string,
    projectRoot: string,
    selection: ProductPreviewAudioSelection,
    previewTimeMs: number,
  ): Promise<void> {
    try {
      const url = await this.urlFor(projectRoot, selection);
      if (!url || !this.isCurrent(token, key)) return;
      this.audio.src = url;
      this.audio.volume = Math.min(1, Math.max(0, selection.clip.volume));
      this.audio.currentTime =
        productPreviewSourceTimeMs(
          previewTimeMs,
          selection.clip,
          selection.asset,
        ) / 1_000;
      await this.audio.play();
      if (!this.isCurrent(token, key)) {
        this.audio.pause();
        return;
      }
      this.startedKey = key;
      this.failedKey = null;
      this.onWarning(null);
    } catch {
      if (this.isCurrent(token, key)) {
        this.failedKey = key;
        this.onWarning('对白音频无法预览，已继续播放字幕和口型。');
      }
    } finally {
      if (this.pendingKey === key) this.pendingKey = null;
    }
  }

  private async urlFor(
    projectRoot: string,
    selection: ProductPreviewAudioSelection,
  ): Promise<string | null> {
    const key = `${projectRoot}\u0000${selection.asset.id}\u0000${selection.asset.sha256}`;
    const cached = this.urlCache.get(key);
    if (cached) return cached;
    const pending = this.urlReads.get(key);
    if (pending) return pending;

    const read = this.readAudio({
      projectRoot,
      assetId: selection.asset.id,
      sha256: selection.asset.sha256!,
    })
      .then((response) => {
        if (!response.ok || response.status !== 'ready') {
          this.onWarning('对白音频无法读取，已继续播放字幕和口型。');
          return null;
        }
        const blob = new Blob([response.bytes], {
          type: response.mimeType,
        });
        const url = this.createObjectUrl(blob);
        this.urlCache.set(key, url);
        return url;
      })
      .catch(() => {
        this.onWarning('对白音频无法读取，已继续播放字幕和口型。');
        return null;
      })
      .finally(() => {
        this.urlReads.delete(key);
      });
    this.urlReads.set(key, read);
    return read;
  }

  private selectionKey(
    projectRoot: string,
    shot: Shot,
    selection: ProductPreviewAudioSelection,
  ): string {
    const { clip, asset, dialogue } = selection;
    return [
      projectRoot,
      shot.id,
      dialogue.id,
      clip.id,
      asset.id,
      asset.sha256,
      clip.startMs,
      clip.endMs,
      clip.offsetMs,
      clip.volume,
    ].join('\u0000');
  }

  private stopTransport(reset: boolean): void {
    this.cancelActivePlayback();
    if (reset) {
      try {
        this.audio.currentTime = 0;
      } catch {
        // The element may not have loaded a source yet.
      }
      this.audio.src = '';
      this.audio.load?.();
    }
  }

  private cancelActivePlayback(): void {
    this.generation += 1;
    this.audio.pause();
    this.activeKey = null;
    this.pendingKey = null;
    this.startedKey = null;
    this.failedKey = null;
  }

  private isCurrent(token: number, key: string): boolean {
    return (
      !this.disposed &&
      token === this.generation &&
      this.activeKey === key
    );
  }
}

export function useProductPreviewAudio(
  input: ProductPreviewAudioSyncInput,
): string | null {
  const [warning, setWarning] = useState<string | null>(null);
  const transportRef = useRef<ProductPreviewAudioTransport | null>(null);

  useEffect(() => {
    const transport = new ProductPreviewAudioTransport({
      onWarning: setWarning,
    });
    transportRef.current = transport;
    return () => {
      transport.dispose();
      transportRef.current = null;
    };
  }, []);

  useEffect(() => {
    transportRef.current?.sync(input);
  }, [input]);

  return warning;
}
