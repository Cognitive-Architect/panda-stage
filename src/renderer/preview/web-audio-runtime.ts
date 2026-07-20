import type {
  PreviewAudioRuntime,
  PreviewAudioSource,
} from './preview-playback-engine';

function loadAudioBytes(url: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', url);
    request.responseType = 'arraybuffer';
    request.timeout = 10_000;
    request.onload = () => {
      if (request.status === 0 || (request.status >= 200 && request.status < 300)) {
        resolve(request.response);
      } else {
        reject(new Error(`音频加载失败（HTTP ${request.status}）：${url}`));
      }
    };
    request.onerror = () => reject(new Error(`无法加载预览音频：${url}`));
    request.ontimeout = () => reject(new Error(`预览音频加载超时：${url}`));
    request.send();
  });
}

class WebAudioSource implements PreviewAudioSource {
  private stopped = false;

  constructor(
    private readonly source: AudioBufferSourceNode,
    onEnded: () => void,
  ) {
    source.onended = onEnded;
  }

  start(offsetSeconds: number): void {
    this.source.start(0, offsetSeconds);
  }

  stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.source.onended = null;
    this.source.stop();
  }

  dispose(): void {
    this.source.onended = null;
    this.source.disconnect();
  }
}

class WebAudioRuntime implements PreviewAudioRuntime {
  constructor(
    private readonly context: AudioContext,
    private readonly buffer: AudioBuffer,
  ) {}

  nowSeconds(): number {
    return this.context.currentTime;
  }

  state(): string {
    return this.context.state;
  }

  async resume(): Promise<void> {
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    if (this.context.state !== 'running') {
      throw new Error(`AudioContext 无法启动，当前状态：${this.context.state}`);
    }
  }

  createSource(onEnded: () => void): PreviewAudioSource {
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.context.destination);
    return new WebAudioSource(source, onEnded);
  }

  async close(): Promise<void> {
    if (this.context.state !== 'closed') {
      await this.context.close();
    }
  }
}

export async function createWebAudioRuntime(
  audioUrl: string,
): Promise<PreviewAudioRuntime> {
  const context = new AudioContext({ latencyHint: 'interactive' });
  try {
    const bytes = await loadAudioBytes(audioUrl);
    const buffer = await context.decodeAudioData(bytes);
    return new WebAudioRuntime(context, buffer);
  } catch (error) {
    await context.close();
    throw error;
  }
}
