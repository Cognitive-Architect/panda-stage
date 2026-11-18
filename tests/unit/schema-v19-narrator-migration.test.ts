import { describe, expect, it } from 'vitest';
import {
  DialogueV18Schema, PROJECT_SCHEMA_VERSION, ProjectSchema, ProjectV18Schema,
  UnsupportedSchemaVersionError, detectSchemaVersion, migrateProject,
} from '../../src/domain';
import historicalV18 from '../fixtures/project-v18-character-dialogue.json';

// Written by the pre-narrator v18 ProjectService (7444000); only repository demo data.
describe('v18 -> v19 narrator version boundary (#1111)', () => {
  it('upgrades only the envelope and leaves legacy speaker/audio/timing/style data intact', () => {
    const before = structuredClone(historicalV18);
    expect(detectSchemaVersion(before)).toBe(18);
    expect(ProjectV18Schema.safeParse(before).success).toBe(true);
    expect(ProjectSchema.safeParse(before).success).toBe(false);
    const migrated = migrateProject(before);
    expect(migrated).toEqual({ ...before, schemaVersion: PROJECT_SCHEMA_VERSION });
    expect(migrated.shots[0]!.dialogues[0]!.speakerType).toBeUndefined();
    expect(migrated.subtitleStyles[0]!.backgroundColor).toBe('#0a1411c7');
    expect(migrateProject(migrated)).toEqual(migrated);
    expect(before).toEqual(historicalV18);
  });

  it.each(['character', 'narrator'])('does not reinterpret v18 data carrying speakerType=%s', (speakerType) => {
    const input = structuredClone(historicalV18);
    Object.assign(input.shots[0]!.dialogues[0]!, { speakerType });
    expect(ProjectV18Schema.safeParse(input).success).toBe(false);
    expect(() => migrateProject(input)).toThrow();
  });

  it.each([17, 18])('rejects narrator data falsely labelled v%s before upgrading', (schemaVersion) => {
    const input = structuredClone(historicalV18);
    const { characterId: _character, voiceProfileId: _voice, ...line } = input.shots[0]!.dialogues[0]!;
    void _character; void _voice;
    const narrator = { ...line, speakerType: 'narrator' };
    const payload = { ...input, schemaVersion, shots: [{ ...input.shots[0]!, dialogues: [narrator] }] };
    expect(DialogueV18Schema.safeParse(narrator).success).toBe(false);
    expect(() => migrateProject(payload)).toThrow();
    expect(ProjectSchema.safeParse({ ...payload, schemaVersion: PROJECT_SCHEMA_VERSION }).success).toBe(true);
  });

  it('keeps historical v18 reference and strict-field validation', () => {
    const input = structuredClone(historicalV18);
    input.shots[0]!.dialogues[0]!.voiceProfileId = 'f0000000-0000-4000-8000-000000000001';
    expect(ProjectV18Schema.safeParse(input).success).toBe(false);
    expect(ProjectV18Schema.safeParse({ ...historicalV18, unexpected: true }).success).toBe(false);
    expect(() => migrateProject(input)).toThrow();
  });

  it('rejects a future envelope before interpreting dialogue contents', () => {
    expect(() => migrateProject({ schemaVersion: PROJECT_SCHEMA_VERSION + 1 })).toThrow(UnsupportedSchemaVersionError);
  });
});
