import { describe, expect, it } from 'vitest';
import {
  DialogueAudioManifestError,
  dialogueAudioManifestTextHash,
  parseDialogueAudioManifestCsv,
  serializeDialogueAudioManifestCsv,
  validateDialogueAudioManifestScope,
  type DialogueAudioManifestRow,
} from '../../src/domain';

const PROJECT_ID = '10000000-0000-4000-8000-000000000001';
const SHOT_ID = '10000000-0000-4000-8000-000000000002';

function row(overrides: Partial<DialogueAudioManifestRow> = {}): DialogueAudioManifestRow {
  const speaker = overrides.speaker ?? 'Panda';
  const text = overrides.text ?? '你好';
  return {
    version: 1,
    projectId: PROJECT_ID,
    shotId: SHOT_ID,
    lineKey: 'line-1',
    ordinal: 1,
    speaker,
    text,
    ...overrides,
    textHash: overrides.textHash ?? dialogueAudioManifestTextHash(speaker, text),
  };
}

describe('WF-EXT A dialogue audio manifest CSV', () => {
  it('roundtrips Chinese text, commas, quotes, newlines and formula-like prefixes losslessly', () => {
    const tricky = '你好，世界 "引号"\n第二行 =SUM(A1)';
    const rows = [
      row({ lineKey: 'line-1', text: tricky, audioFilename: 'line-1.wav', sourceStartMs: 120, sourceEndMs: 1_240 }),
      row({ lineKey: 'line-2', ordinal: 2, speaker: '旁白', text: "'=不是公式" }),
      row({ lineKey: 'line-3', ordinal: 3, text: '@开头', audioFilename: '', sourceStartMs: undefined, sourceEndMs: undefined }),
    ];

    const csv = serializeDialogueAudioManifestCsv(rows);
    expect(csv.startsWith('\uFEFFversion,projectId')).toBe(true);
    const parsed = parseDialogueAudioManifestCsv(csv);

    expect(parsed.issues).toEqual([]);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]).toMatchObject({
      lineKey: 'line-1',
      text: tricky,
      audioFilename: 'line-1.wav',
      sourceStartMs: 120,
      sourceEndMs: 1_240,
    });
    expect(parsed.rows[1]!.text).toBe("'=不是公式");
    expect(parsed.rows[2]!.text).toBe('@开头');
  });

  it('rejects a duplicated lineKey locally and keeps the healthy subset', () => {
    const csv = serializeDialogueAudioManifestCsv([
      row({ lineKey: 'duplicate', ordinal: 1, text: '第一句' }),
      row({ lineKey: 'duplicate', ordinal: 2, text: '第二句' }),
      row({ lineKey: 'healthy', ordinal: 3, text: '第三句' }),
    ]);
    const parsed = parseDialogueAudioManifestCsv(csv);

    expect(parsed.rows.map((item) => item.lineKey)).toEqual(['duplicate', 'healthy']);
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DUPLICATE_LINE_KEY', lineKey: 'duplicate' }),
      ]),
    );
  });

  it('flags text changes through the exported text hash without dropping the row', () => {
    const csv = serializeDialogueAudioManifestCsv([
      row({ lineKey: 'line-1', text: '原台词', audioFilename: 'line-1.wav', sourceStartMs: 0, sourceEndMs: 800 }),
    ]);
    const edited = csv.replace('原台词', '改过的台词');
    const parsed = parseDialogueAudioManifestCsv(edited);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'TEXT_HASH_MISMATCH', lineKey: 'line-1' }),
      ]),
    );
  });

  it('rejects invalid source ranges and mismatched project/shot scopes', () => {
    const csv = serializeDialogueAudioManifestCsv([
      row({ lineKey: 'bad-range', ordinal: 1, audioFilename: 'a.wav', sourceStartMs: 500, sourceEndMs: 500 }),
      row({ lineKey: 'other-project', ordinal: 2, projectId: 'other-project' }),
      row({ lineKey: 'other-shot', ordinal: 3, shotId: 'other-shot' }),
    ]);
    const parsed = parseDialogueAudioManifestCsv(csv);
    expect(parsed.rows.map((item) => item.lineKey)).toEqual(['other-project', 'other-shot']);
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'INVALID_SOURCE_RANGE', lineKey: 'bad-range' }),
      ]),
    );

    const scopeIssues = validateDialogueAudioManifestScope(parsed.rows, PROJECT_ID, SHOT_ID);
    expect(scopeIssues.map((issue) => issue.code)).toEqual([
      'PROJECT_MISMATCH',
      'SHOT_MISMATCH',
    ]);
  });

  it('rejects a CSV without the required header', () => {
    expect(() => parseDialogueAudioManifestCsv('speaker,text\nPanda,你好\n')).toThrow(
      DialogueAudioManifestError,
    );
  });
});
