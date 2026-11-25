// @vitest-environment happy-dom
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  AudioClipService,
  ProjectSchema,
  applyFlaSceneAudioClips,
  audioClipSourceTimeMs,
  buildFormalExportAudioMixPlan,
  extractFlaTimelineSoundEvents,
  isAudioClipActiveAtTime,
  planFlaSceneAudioClips,
  type FlaResolvedSoundAsset,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { adaptFlaDocument } from '../../src/renderer/fla-import/fla-viewer-adapter';
import { buildProject, IDS } from './domain/testProject';

const ASSET_VOICE = '10000000-0000-4000-8000-000000000801';
const ASSET_SFX = '10000000-0000-4000-8000-000000000802';
const ASSET_START_ONLY = '10000000-0000-4000-8000-000000000803';

function projectWithAudioAssets(shotDurationMs = 5000) {
  const base = buildProject();
  return ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets,
      {
        id: ASSET_VOICE,
        name: 'voice_line.wav',
        kind: 'audio',
        relativePath: 'assets/voice_line.wav',
        mimeType: 'audio/wav',
        durationMs: 3000,
        metadata: { status: 'ready', warnings: [] },
      },
      {
        id: ASSET_SFX,
        name: 'pop.wav',
        kind: 'audio',
        relativePath: 'assets/pop.wav',
        mimeType: 'audio/wav',
        durationMs: 800,
        metadata: { status: 'ready', warnings: [] },
      },
      {
        id: ASSET_START_ONLY,
        name: 'bgm_start.wav',
        kind: 'audio',
        relativePath: 'assets/bgm_start.wav',
        mimeType: 'audio/wav',
        durationMs: 4000,
        metadata: { status: 'ready', warnings: [] },
      },
    ],
    shots: base.shots.map((shot) =>
      shot.id === IDS.shot ? { ...shot, durationMs: shotDurationMs } : shot,
    ),
  });
}

describe('S05-A: Main Scene Stream / Event audio recovery', () => {
  it('recovers non-24fps (30fps) 1 stream + 2 repeated event triggers with 44.1kHz trim math and Shot boundary', () => {
    const project = projectWithAudioAssets(5000);
    const assetMap = new Map<string, FlaResolvedSoundAsset>([
      ['snd-voice', { assetId: ASSET_VOICE, name: 'voice_line.wav', durationMs: 3000 }],
      ['snd-pop', { assetId: ASSET_SFX, name: 'pop.wav', durationMs: 800 }],
    ]);

    const events = extractFlaTimelineSoundEvents({
      layers: [
        {
          sourceLayerIndex: 0,
          frames: [
            {
              // 30fps: frame 3 => 100ms; span 15 frames => frame 18 => 600ms.
              // inPoint44 = 22050 => 500ms, outPoint44 = 88200 => 2000ms (available 1500ms),
              // trimmed by stream span to [100, 600] (500ms).
              sourceFrameIndex: 3,
              startFrame: 3,
              duration: 15,
              sound: {
                soundId: 'snd-voice',
                name: 'voice_line.wav',
                sync: 'stream',
                inPoint44: 22_050,
                outPoint44: 88_200,
              },
            },
          ],
        },
        {
          sourceLayerIndex: 1,
          frames: [
            {
              // 30fps: frame 10 => 333.333ms; event does NOT truncate at duration=1 frame.
              // inPoint44 = 4410 => 100ms, outPoint44 = 26460 => 600ms => available 500ms => endMs = round(833.333) = 833.
              sourceFrameIndex: 10,
              startFrame: 10,
              duration: 1,
              sound: {
                soundId: 'snd-pop',
                name: 'pop.wav',
                sync: 'event',
                inPoint44: 4_410,
                outPoint44: 26_460,
              },
            },
            {
              // Repeated trigger of the same sound near Shot end (frame 140 @ 30fps => 4666.667ms).
              // Available 800ms would reach 5466.667ms, trimmed to Shot boundary 5000ms.
              sourceFrameIndex: 140,
              startFrame: 140,
              duration: 1,
              sound: {
                soundId: 'snd-pop',
                name: 'pop.wav',
                sync: 'event',
              },
            },
          ],
        },
      ],
    });

    const service = new AudioClipService();
    const applied = applyFlaSceneAudioClips(
      project,
      {
        sourceFps: 30,
        shotId: IDS.shot,
        shotDurationMs: 5000,
        events,
        resolveAsset: (sound) => (sound.soundId ? assetMap.get(sound.soundId) : undefined),
      },
      service,
    );

    expect(applied.diagnostics).toEqual([]);
    expect(applied.createdClipIds).toHaveLength(3);

    const shot = applied.project.shots.find((s) => s.id === IDS.shot)!;
    // Must not create DialogueService entries
    expect(shot.dialogues).toEqual([]);
    expect(shot.audioClips).toHaveLength(3);

    const [streamClip, event1, event2] = shot.audioClips;
    expect(streamClip).toMatchObject({
      assetId: ASSET_VOICE,
      role: 'sfx',
      startMs: 100,
      endMs: 600,
      offsetMs: 500,
      volume: 1,
    });
    expect(event1).toMatchObject({
      assetId: ASSET_SFX,
      role: 'sfx',
      startMs: 333,
      endMs: 833,
      offsetMs: 100,
      volume: 1,
    });
    expect(event2).toMatchObject({
      assetId: ASSET_SFX,
      role: 'sfx',
      startMs: 4667,
      endMs: 5000,
      offsetMs: 0,
      volume: 1,
    });
    // Repeated event triggers share the same assetId with independent clip IDs
    expect(event1!.id).not.toBe(event2!.id);
    expect(event1!.assetId).toBe(event2!.assetId);

    // Preview seek contract & formal FFmpeg export mix plan stay synchronized
    expect(isAudioClipActiveAtTime(streamClip!, 100)).toBe(true);
    expect(audioClipSourceTimeMs(streamClip!, 250)).toBe(650);
    expect(isAudioClipActiveAtTime(streamClip!, 600)).toBe(false);
    expect(isAudioClipActiveAtTime(event1!, 400)).toBe(true);
    expect(audioClipSourceTimeMs(event1!, 400)).toBe(167);

    const mixPlan = buildFormalExportAudioMixPlan(
      shot.durationMs,
      shot.audioClips.map((clip) => ({
        clipId: clip.id,
        assetId: clip.assetId,
        role: clip.role,
        sourcePath: `assets/${clip.assetId}.wav`,
        startMs: clip.startMs,
        endMs: clip.endMs,
        offsetMs: clip.offsetMs,
        volume: clip.volume,
      })),
    );
    expect(mixPlan.clips).toEqual([
      expect.objectContaining({
        clipId: streamClip!.id,
        assetId: ASSET_VOICE,
        role: 'sfx',
        startMs: 100,
        endMs: 600,
        sourceOffsetMs: 500,
        volume: 1,
      }),
      expect.objectContaining({
        clipId: event1!.id,
        assetId: ASSET_SFX,
        role: 'sfx',
        startMs: 333,
        endMs: 833,
        sourceOffsetMs: 100,
        volume: 1,
      }),
      expect.objectContaining({
        clipId: event2!.id,
        assetId: ASSET_SFX,
        role: 'sfx',
        startMs: 4667,
        endMs: 5000,
        sourceOffsetMs: 0,
        volume: 1,
      }),
    ]);

    // Clips remain editable via AudioClipService and undoable via EditorProjectStore
    const editor = new EditorProjectStore();
    editor.open('D:\\s05-a.pandastage', project);
    editor.updateProject(applied.project, 'Recover FLA Scene audio');
    expect(editor.getSnapshot()!.project.shots[0]!.audioClips).toHaveLength(3);
    const moved = service.move(editor.getSnapshot()!.project, {
      shotId: IDS.shot,
      clipId: event1!.id,
      startMs: 1000,
    });
    expect(moved.shots[0]!.audioClips[1]).toMatchObject({ startMs: 1000, endMs: 1500, offsetMs: 100 });
    editor.undo();
    expect(editor.getSnapshot()!.project.shots[0]!.audioClips).toHaveLength(0);
    // Audio assets remain preserved on undo
    expect(editor.getSnapshot()!.project.assets.some((a) => a.id === ASSET_VOICE)).toBe(true);
    expect(editor.getSnapshot()!.project.assets.some((a) => a.id === ASSET_SFX)).toBe(true);
  });

  it('emits local diagnostics for unsupported sync/loop without dropping assets', () => {
    const assetMap = new Map<string, FlaResolvedSoundAsset>([
      ['snd-pop', { assetId: ASSET_SFX, name: 'pop.wav', durationMs: 800 }],
      ['snd-start', { assetId: ASSET_START_ONLY, name: 'bgm_start.wav', durationMs: 4000 }],
    ]);

    const plan = planFlaSceneAudioClips({
      sourceFps: 25,
      shotId: IDS.shot,
      shotDurationMs: 5000,
      events: [
        {
          layerIndex: 0,
          frameIndex: 0,
          frameDuration: 10,
          sound: { soundId: 'snd-start', name: 'bgm_start.wav', sync: 'start' },
        },
        {
          layerIndex: 0,
          frameIndex: 10,
          frameDuration: 1,
          sound: { soundId: 'snd-start', name: 'bgm_start.wav', sync: 'stop' },
        },
        {
          layerIndex: 1,
          frameIndex: 5,
          frameDuration: 1,
          sound: {
            soundId: 'snd-pop',
            name: 'pop.wav',
            sync: 'event',
            loopMode: 'repeat',
            loopCount: 3,
          },
        },
      ],
      resolveAsset: (sound) => (sound.soundId ? assetMap.get(sound.soundId) : undefined),
    });

    expect(plan.diagnostics.map((d) => d.code)).toEqual([
      'unsupported-sync',
      'unsupported-loop',
      'unsupported-sync',
    ]);
    // First pass of looped event is still placed; start/stop skipped with diagnostics
    expect(plan.clips).toEqual([
      {
        assetId: ASSET_SFX,
        role: 'sfx',
        startMs: 200,
        endMs: 1000,
        offsetMs: 0,
        name: 'pop.wav',
      },
    ]);
  });

  it('wires parsed FrameSound through FLAParser and adaptFlaDocument into FlaFrameIR with resolved soundId', async () => {
    const domXml = `<?xml version="1.0" encoding="utf-8"?>
<DOMDocument width="1280" height="720" frameRate="30" backgroundColor="#ffffff">
  <media>
    <DOMSoundItem name="pop.wav" href="pop.wav" soundDataHRef="pop.dat" format="44kHz 16bit Mono" sampleCount="4410"/>
  </media>
  <timelines>
    <DOMTimeline name="Scene 1">
      <layers>
        <DOMLayer name="Audio">
          <frames>
            <DOMFrame index="6" duration="12" keyMode="9728" soundName="pop.wav" soundSync="stream" inPoint44="4410" outPoint44="22050" soundLoopMode="repeat" soundLoop="2">
              <elements/>
            </DOMFrame>
          </frames>
        </DOMLayer>
        <DOMLayer name="Guide" layerType="guide">
          <frames>
            <DOMFrame index="0" duration="10" keyMode="9728" soundName="pop.wav" soundSync="event">
              <elements/>
            </DOMFrame>
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`;
    const zip = new JSZip();
    zip.file('DOMDocument.xml', domXml);
    const bytes = await zip.generateAsync({ type: 'uint8array' });

    const ir = await adaptFlaDocument(
      {
        basename: 'scene-audio.fla',
        byteLength: bytes.byteLength,
        sha256: 'a'.repeat(64),
        bytes,
        containsActionScript: false,
      },
      () => undefined,
      () => false,
      'structure',
    );

    expect(ir.sounds).toHaveLength(1);
    const soundId = ir.sounds![0]!.id;
    expect(ir.timelines[0]!.layers[0]!.frames[0]!.sound).toEqual({
      soundId,
      name: 'pop.wav',
      sync: 'stream',
      inPoint44: 4410,
      outPoint44: 22050,
      loopMode: 'repeat',
      loopCount: 2,
    });
    // Guide layer sound is ignored
    expect(ir.timelines[0]!.layers[1]!.frames[0]!.sound).toBeUndefined();
  });
});
