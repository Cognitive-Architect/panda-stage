import { describe, expect, it } from 'vitest';
import exampleProject from '../../../demo-project/project-v1.example.json';
import { ProjectSchema } from '../../../src/domain';

function projectWithAudioRange(
  startMs: number,
  endMs: number,
  offsetMs: number,
): typeof exampleProject {
  const input = structuredClone(exampleProject);
  Object.assign(input.shots[0]!.audioClips[0]!, {
    startMs,
    endMs,
    offsetMs,
  });
  return input;
}

describe('AudioClip source range validation', () => {
  it('accepts a 3000ms clip at offsetMs=0 from a 3000ms source', () => {
    const input = projectWithAudioRange(0, 3000, 0);

    expect(ProjectSchema.safeParse(input).success).toBe(true);
  });

  it('accepts a 2000ms clip at offsetMs=1000 from a 3000ms source', () => {
    const input = projectWithAudioRange(0, 2000, 1000);

    expect(ProjectSchema.safeParse(input).success).toBe(true);
  });

  it('rejects a 3000ms clip at offsetMs=1 from a 3000ms source', () => {
    const input = projectWithAudioRange(0, 3000, 1);

    expect(ProjectSchema.safeParse(input).success).toBe(false);
  });

  it('reports the precise offset path and complete source-range context', () => {
    const input = projectWithAudioRange(0, 3000, 1);
    const result = ProjectSchema.safeParse(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['shots', 0, 'audioClips', 0, 'offsetMs'],
            message: expect.stringMatching(
              /exceeds the source audio range.*offsetMs=1.*requested clip duration 3000ms.*source durationMs=3000/iu,
            ),
          }),
        ]),
      );
    }
  });
});
