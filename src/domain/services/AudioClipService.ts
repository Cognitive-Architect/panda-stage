import { ProjectSchema, type Project } from '../models/project';
import type { AudioClip } from '../models/audio';
import type { Shot } from '../models/shot';
import { audioClipDurationMs, audioClipGain } from '../audio-contract';

export type StandaloneAudioRole = 'bgm' | 'sfx';
export interface AudioClipTarget {
  shotId: string;
  clipId: string;
}
export interface CreateAudioClipInput {
  shotId: string;
  assetId: string;
  role: StandaloneAudioRole;
  startMs: number;
  endMs?: number;
  offsetMs?: number;
  name?: string;
  volume?: number;
}

/** Pure Shot-local standalone authoring. Dialogue audio remains DialogueService-owned. */
export class AudioClipService {
  constructor(private readonly options: {
    createId?: () => string;
    now?: () => Date;
  } = {}) {}

  create(project: Project, input: CreateAudioClipInput): Project {
    const shot = this.shot(project, input.shotId);
    const clip = this.buildClip(project, shot, input);
    return this.commit(project, shot, [...shot.audioClips, clip]);
  }

  createMany(project: Project, shotId: string, inputs: readonly Omit<CreateAudioClipInput, 'shotId'>[]): Project {
    if (inputs.length === 0) return project;
    const shot = this.shot(project, shotId);
    const clips = inputs.map((input) => this.buildClip(project, shot, { ...input, shotId }));
    return this.commit(project, shot, [...shot.audioClips, ...clips]);
  }

  private buildClip(project: Project, shot: Shot, input: CreateAudioClipInput): AudioClip {
    if (input.role !== 'bgm' && input.role !== 'sfx') {
      throw new Error('Standalone audio requires bgm or sfx role.');
    }
    const asset = this.readyAsset(project, input.assetId);
    this.integer(input.startMs);
    const offsetMs = input.offsetMs ?? 0;
    this.integer(offsetMs);
    if (offsetMs < 0 || offsetMs >= asset.durationMs!) {
      throw new Error('Audio source offset must be within the audio asset duration.');
    }
    const startMs = Math.max(0, Math.min(input.startMs, shot.durationMs));
    const maxEndMs = Math.min(startMs + asset.durationMs! - offsetMs, shot.durationMs);
    let endMs = maxEndMs;
    if (input.endMs !== undefined) {
      this.integer(input.endMs);
      endMs = Math.min(input.endMs, maxEndMs);
    }
    if (endMs <= startMs) {
      throw new Error('No positive audio duration is available at this Shot time.');
    }
    const volume = input.volume !== undefined ? audioClipGain(input.volume) : 1;
    const name = input.name?.trim() || asset.name;
    return {
      id: (this.options.createId ?? (() => crypto.randomUUID()))(),
      name,
      assetId: asset.id,
      role: input.role,
      startMs,
      endMs,
      offsetMs,
      volume,
    };
  }

  move(project: Project, input: AudioClipTarget & { startMs: number }): Project {
    const { shot, clip } = this.target(project, input);
    this.integer(input.startMs);
    const duration = audioClipDurationMs(clip);
    const startMs = Math.max(0, Math.min(input.startMs, shot.durationMs - duration));
    return this.replace(project, shot, clip, {
      ...clip,
      startMs,
      endMs: startMs + duration,
    });
  }

  trimStart(project: Project, input: AudioClipTarget & { startMs: number }): Project {
    const { shot, clip } = this.target(project, input);
    this.integer(input.startMs);
    const startMs = Math.max(
      Math.max(0, clip.startMs - clip.offsetMs),
      Math.min(input.startMs, clip.endMs - 1),
    );
    return this.replace(project, shot, clip, {
      ...clip,
      startMs,
      offsetMs: clip.offsetMs + startMs - clip.startMs,
    });
  }

  trimEnd(project: Project, input: AudioClipTarget & { endMs: number }): Project {
    const { shot, clip } = this.target(project, input);
    this.integer(input.endMs);
    const asset = this.readyAsset(project, clip.assetId);
    const maxEnd = Math.min(
      shot.durationMs,
      clip.startMs + asset.durationMs! - clip.offsetMs,
    );
    const endMs = Math.max(clip.startMs + 1, Math.min(input.endMs, maxEnd));
    return this.replace(project, shot, clip, { ...clip, endMs });
  }

  setVolume(project: Project, input: AudioClipTarget & { volume: number }): Project {
    const { shot, clip } = this.target(project, input);
    return this.replace(project, shot, clip, {
      ...clip,
      volume: audioClipGain(input.volume),
    });
  }

  remove(project: Project, input: AudioClipTarget): Project {
    const { shot, clip } = this.target(project, input);
    return this.commit(
      project, shot,
      shot.audioClips.filter((candidate) => candidate.id !== clip.id),
    );
  }

  private shot(project: Project, shotId: string): Shot {
    const shot = project.shots.find((candidate) => candidate.id === shotId);
    if (!shot) throw new Error(`Unknown Shot: ${shotId}`);
    return shot;
  }

  private target(project: Project, input: AudioClipTarget): { shot: Shot; clip: AudioClip } {
    const shot = this.shot(project, input.shotId);
    const clip = shot.audioClips.find((candidate) => candidate.id === input.clipId);
    if (!clip) throw new Error(`Unknown AudioClip: ${input.clipId}`);
    if (clip.role !== 'bgm' && clip.role !== 'sfx') {
      throw new Error('Dialogue audio is owned by DialogueService.');
    }
    if (shot.dialogues.some((dialogue) => dialogue.audioClipId === clip.id)) {
      throw new Error('Standalone audio cannot be Dialogue-bound.');
    }
    return { shot, clip };
  }

  private readyAsset(project: Project, assetId: string) {
    const asset = project.assets.find((candidate) => candidate.id === assetId);
    if (
      !asset || asset.kind !== 'audio' ||
      asset.metadata?.status === 'error' || asset.durationMs === undefined
    ) {
      throw new Error('Audio asset must have ready duration metadata.');
    }
    return asset;
  }

  private integer(value: number): void {
    if (!Number.isSafeInteger(value)) throw new Error('Audio time must be safe integer milliseconds.');
  }

  private replace(project: Project, shot: Shot, clip: AudioClip, next: AudioClip): Project {
    if (JSON.stringify(clip) === JSON.stringify(next)) return project;
    return this.commit(project, shot, shot.audioClips.map((candidate) =>
      candidate.id === clip.id ? next : candidate,
    ));
  }

  private commit(project: Project, shot: Shot, audioClips: AudioClip[]): Project {
    return ProjectSchema.parse({
      ...project,
      updatedAt: (this.options.now ?? (() => new Date()))().toISOString(),
      shots: project.shots.map((candidate) =>
        candidate.id === shot.id ? { ...shot, audioClips } : candidate,
      ),
    });
  }
}
