import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHOT_CAMERA,
  migrateProject,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type Project,
} from '../../src/domain';
import { ProjectV7Schema } from '../../src/domain/models/project';
import { buildProject, IDS, legacyShot, legacyShots } from './domain/testProject';
import exampleProject from '../../demo-project/project-v1.example.json';

function currentProject(): Project {
  return buildProject();
}

describe('AUTO-07B Shot camera persistence contract', () => {
  it('defaults every Shot to the historical full-stage framing', () => {
    const project = currentProject();
    expect(project.shots[0]!.camera).toEqual(DEFAULT_SHOT_CAMERA);
    expect(ProjectSchema.parse(project)).toEqual(project);
  });

  it('migrates a strict v16 Project to v18 with a static camera on every Shot', () => {
    const current = currentProject();
    // v16 predates both the template list (v17) and the Shot camera (v18).
    const { shotTemplates: _templates, ...withoutTemplates } = current;
    void _templates;
    const version16 = {
      ...withoutTemplates,
      schemaVersion: 16,
      shots: legacyShots(current.shots),
    };
    const migrated = migrateProject(version16);

    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.shots.every((shot) => shot.camera.mode === 'static')).toBe(true);
    expect(migrated.shots.every((shot) => shot.camera.keyframes.length === 0)).toBe(true);
    // Pre-camera Shot data is preserved verbatim.
    expect(migrated.shots.map(legacyShot)).toEqual(version16.shots);
  });

  it('round-trips a manual track through persistence', () => {
    const current = currentProject();
    const withCamera = ProjectSchema.parse({
      ...current,
      shots: current.shots.map((shot) => ({
        ...shot,
        camera: {
          mode: 'manual',
          keyframes: [
            { timeMs: 0, centerX: 960, centerY: 540, zoom: 1 },
            { timeMs: 2_000, centerX: 1_100, centerY: 500, zoom: 1.8 },
          ],
        },
      })),
    });
    const reopened = ProjectSchema.parse(
      JSON.parse(JSON.stringify(withCamera)) as unknown,
    );
    expect(reopened.shots[0]!.camera).toEqual(withCamera.shots[0]!.camera);
  });

  it('rejects keyframes outside the Shot or out of order', () => {
    const current = currentProject();
    const shot = current.shots[0]!;
    const build = (keyframes: unknown[]) => ({
      ...current,
      shots: [{ ...shot, camera: { mode: 'manual', keyframes } }],
    });

    expect(
      ProjectSchema.safeParse(
        build([{ timeMs: 0, centerX: 960, centerY: 540, zoom: 1 }]),
      ).success,
    ).toBe(true);
    expect(
      ProjectSchema.safeParse(
        build([
          { timeMs: shot.durationMs + 1, centerX: 960, centerY: 540, zoom: 1 },
        ]),
      ).success,
    ).toBe(false);
    expect(
      ProjectSchema.safeParse(
        build([
          { timeMs: 500, centerX: 960, centerY: 540, zoom: 1 },
          { timeMs: 500, centerX: 900, centerY: 540, zoom: 1.2 },
        ]),
      ).success,
    ).toBe(false);
    // Unknown keys and out-of-range zoom stay rejected.
    expect(
      ProjectSchema.safeParse(
        build([{ timeMs: 0, centerX: 960, centerY: 540, zoom: 12 }]),
      ).success,
    ).toBe(false);
    expect(
      ProjectSchema.safeParse(
        build([{ timeMs: 0, centerX: 960, centerY: 540, zoom: 1, extra: 1 }]),
      ).success,
    ).toBe(false);
    expect(
      ProjectSchema.safeParse({
        ...current,
        shots: [{ ...shot, camera: { mode: 'dolly', keyframes: [] } }],
      }).success,
    ).toBe(false);
  });

  it('keeps the camera scoped to its own Shot', () => {
    const current = currentProject();
    const shot = current.shots[0]!;
    const second = {
      ...shot,
      id: IDS.shot.replace('01', '02'),
      name: 'second shot',
      camera: {
        mode: 'manual' as const,
        keyframes: [{ timeMs: 0, centerX: 700, centerY: 400, zoom: 1.5 }],
      },
    };
    const twoShots = ProjectSchema.parse({
      ...current,
      shots: [shot, second],
    });
    expect(twoShots.shots[0]!.camera).toEqual(DEFAULT_SHOT_CAMERA);
    expect(twoShots.shots[1]!.camera.keyframes).toHaveLength(1);
  });
});

/**
 * Issue #1017 / CI #602: v7 verifier fixtures reused the *current* project as
 * their starting shape. The v18 `Shot.camera` made strict v7 parsing fail, so
 * migrateProject fell back to the current schema and reported a missing
 * `audioClips[].role` instead. Stripping current-only fields restores the real
 * v7 path, which adds the historical dialogue role itself.
 */
function v7VerifierFixture(withCamera: boolean): unknown {
  const base = migrateProject(exampleProject);
  const {
    animations: _animations,
    shotTemplates: _shotTemplates,
    ...legacyBase
  } = base;
  void _animations;
  void _shotTemplates;
  const shots = base.shots.map((shot) => {
    const audioClips = shot.audioClips.map(({ role, ...clip }) => {
      void role;
      return clip;
    });
    if (withCamera) return { ...shot, audioClips };
    const { camera: _camera, ...legacyShotShape } = shot;
    void _camera;
    return { ...legacyShotShape, audioClips };
  });
  return {
    ...legacyBase,
    schemaVersion: 7,
    assets: base.assets.map((asset) => {
      if (asset.kind !== 'image') return asset;
      const { usage, keywords, ...legacyAsset } = asset;
      void usage;
      void keywords;
      return legacyAsset;
    }),
    shots,
  };
}

describe('Issue #1017 strict v7 verifier fixture contract', () => {
  it('rejects a v18 camera on a v7 Shot and restores dialogue roles once stripped', () => {
    const withCamera = v7VerifierFixture(true);
    const refusal = ProjectV7Schema.safeParse(withCamera);
    expect(refusal.success).toBe(false);
    if (!refusal.success) {
      expect(
        refusal.error.issues.some(
          (issue) =>
            issue.code === 'unrecognized_keys' &&
            Array.isArray(issue.keys) &&
            issue.keys.includes('camera'),
        ),
      ).toBe(true);
    }

    const stripped = v7VerifierFixture(false);
    expect(ProjectV7Schema.safeParse(stripped).success).toBe(true);
    const migrated = migrateProject(stripped);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.shots[0]!.audioClips[0]!.role).toBe('dialogue');
    expect(migrated.shots[0]!.camera).toEqual(DEFAULT_SHOT_CAMERA);
  });

  it('keeps current-version camera out of the #602/#606 v7 fixtures', () => {
    for (const name of [
      'verify-issue602-composite.cjs',
      'verify-issue606-product-preview.cjs',
    ]) {
      const source = readFileSync(
        path.join(process.cwd(), 'scripts', name),
        'utf8',
      );
      expect(source).toContain('camera: _baseShotCamera');
      expect(source).toMatch(/\.\.\.baseShot \} = base\.shots\[0\]/);
    }
  });
});

describe('Issue #1020 Stage 0 verifier audio envelope contract', () => {
  it('keeps a decodable voice envelope reachable for the #602/#606 mouth assertions', () => {
    for (const name of [
      'verify-issue602-composite.cjs',
      'verify-issue606-product-preview.cjs',
    ]) {
      const source = readFileSync(
        path.join(process.cwd(), 'scripts', name),
        'utf8',
      );
      expect(source).toContain('IPC_CHANNELS.ASSET_PREVIEW_AUDIO_READ');
      expect(source).toContain('function proofVoiceWav');
      expect(source).toContain("mimeType: 'audio/wav'");
      expect(source).toContain("status: 'ready'");
      expect(source).toContain('byteLength: proofVoiceBytes.byteLength');
      // A failing audio read degrades the shared mouth judgment to "closed"
      // and makes the pending / fallback visual assertions unreachable.
      expect(source).not.toContain('intentionally not decoded');
      expect(source).not.toContain('ASSET_PREVIEW_AUDIO_READ_FAILED');
    }
  });
});
