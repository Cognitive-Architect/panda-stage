import {
  buildAudioEnvelopeFromChannels,
  type AudioAsset,
  type AudioEnvelope,
  type MouthEnvelopeResolution,
  type MouthEnvelopeUnavailableReason,
} from '../../domain';
import type {
  AssetPreviewAudioReadRequest,
  AssetPreviewAudioReadResponse,
} from '../../shared/asset-preview-audio-api';

/** 32 envelopes is <1% of one decoded AudioBuffer's memory. */
export const AUDIO_ENVELOPE_CACHE_ENTRIES = 32;

export interface AudioDecodedSource {
  channels: Float32Array[];
  sampleRate: number;
}

export type AudioEnvelopeDecoder = (
  bytes: Uint8Array,
  mimeType: string,
) => Promise<AudioDecodedSource>;

type Entry =
  | { status: 'ready'; sha256: string; envelope: AudioEnvelope }
  | {
      status: 'unavailable';
      sha256: string;
      reason: MouthEnvelopeUnavailableReason;
      message?: string;
    };

type Listener = () => void;

export interface AudioEnvelopeStoreOptions {
  readAudio?: (
    request: AssetPreviewAudioReadRequest,
  ) => Promise<AssetPreviewAudioReadResponse>;
  decode?: AudioEnvelopeDecoder;
}

/**
 * Offline decode only. No playback graph, no MediaElement: the same bytes and
 * the same mapping produce the same envelope in Editor, Preview and Export.
 */
export const decodeAudioBytesWithWebAudio: AudioEnvelopeDecoder = async (
  bytes,
  mimeType,
): Promise<AudioDecodedSource> => {
  const AudioContextCtor =
    (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!AudioContextCtor) {
    throw new Error('当前环境不支持 Web Audio 解码。');
  }
  const context = new AudioContextCtor({ latencyHint: 'playback' });
  try {
    // decodeAudioData detaches its input, so hand it an owned copy.
    const copy = bytes.slice().buffer;
    const buffer = await context.decodeAudioData(copy);
    const channels: Float32Array[] = [];
    for (let index = 0; index < buffer.numberOfChannels; index += 1) {
      channels.push(buffer.getChannelData(index));
    }
    return { channels, sampleRate: buffer.sampleRate };
  } catch (error) {
    throw new Error(
      `音频解码失败（${mimeType}）：${
        error instanceof Error ? error.message : '未知错误'
      }`,
      { cause: error },
    );
  } finally {
    void context.close().catch(() => undefined);
  }
};

/**
 * Rebuildable, bounded cache of per-AudioAsset volume envelopes. The Project
 * never stores envelope data; reopening a Project simply rebuilds it.
 */
export class AudioEnvelopeStore {
  private readonly entries = new Map<string, Entry>();
  private readonly inFlight = new Set<string>();
  private readonly listeners = new Set<Listener>();
  private readonly readAudio: NonNullable<AudioEnvelopeStoreOptions['readAudio']>;
  private readonly decode: AudioEnvelopeDecoder;
  private version = 0;

  constructor(options: AudioEnvelopeStoreOptions = {}) {
    this.readAudio =
      options.readAudio ??
      ((request) => window.pandaStage.assets.readAudio(request));
    this.decode = options.decode ?? decodeAudioBytesWithWebAudio;
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getVersion = (): number => this.version;

  /** Domain-facing lookup. Unknown assets are still pending, not "silent". */
  readonly resolveSource = (
    audioAssetId: string,
  ): MouthEnvelopeResolution | undefined => {
    const entry = this.entries.get(audioAssetId);
    if (!entry) return undefined;
    if (entry.status === 'ready') {
      return { status: 'ready', envelope: entry.envelope };
    }
    return {
      status: 'unavailable',
      reason: entry.reason,
      ...(entry.message === undefined ? {} : { message: entry.message }),
    };
  };

  /** Snapshot for diagnostics/tests; never persisted. */
  getEntry(assetId: string): Entry | undefined {
    return this.entries.get(assetId);
  }

  /** Idempotent and deduplicated; call from a render effect. */
  ensure(projectRoot: string, asset: AudioAsset): void {
    if (!asset.sha256) return;
    const existing = this.entries.get(asset.id);
    if (
      existing &&
      existing.sha256 === asset.sha256 &&
      existing.status === 'ready'
    ) {
      return;
    }
    if (this.inFlight.has(asset.id)) return;
    if (existing && existing.sha256 !== asset.sha256) {
      this.entries.delete(asset.id);
    }
    this.inFlight.add(asset.id);
    void this.build(projectRoot, asset)
      .then((entry) => {
        this.entries.delete(asset.id);
        this.entries.set(asset.id, entry);
        this.prune();
      })
      .catch((error: unknown) => {
        this.entries.delete(asset.id);
        this.entries.set(asset.id, {
          status: 'unavailable',
          sha256: asset.sha256!,
          reason: 'decode-failed',
          message:
            error instanceof Error ? error.message : '音频包络构建失败。',
        });
        this.prune();
      })
      .finally(() => {
        this.inFlight.delete(asset.id);
        this.emit();
      });
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
    this.emit();
  }

  private async build(
    projectRoot: string,
    asset: AudioAsset,
  ): Promise<Entry> {
    const request: AssetPreviewAudioReadRequest = {
      projectRoot,
      assetId: asset.id,
      sha256: asset.sha256!,
    };
    const response = await this.readAudio(request);
    if (!response.ok) {
      return {
        status: 'unavailable',
        sha256: asset.sha256!,
        reason: 'asset-missing',
        message: response.error.message,
      };
    }
    if (response.mimeType !== 'audio/mpeg' && response.mimeType !== 'audio/wav') {
      return {
        status: 'unavailable',
        sha256: asset.sha256!,
        reason: 'not-audio',
      };
    }
    const decoded = await this.decode(response.bytes, response.mimeType);
    return {
      status: 'ready',
      sha256: asset.sha256!,
      envelope: buildAudioEnvelopeFromChannels(
        decoded.channels,
        decoded.sampleRate,
      ),
    };
  }

  private prune(): void {
    while (this.entries.size > AUDIO_ENVELOPE_CACHE_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
    }
  }

  private emit(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }
}

export const audioEnvelopeStore = new AudioEnvelopeStore();
