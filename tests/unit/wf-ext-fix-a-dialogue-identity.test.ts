import { describe, expect, it } from 'vitest';
import {
  buildAudioAssetFileNameIndex,
  dialogueAudioManifestTextHash,
  parseDialogueAudioManifestCsv,
  pickDialogueAudioManifestLineBreak,
  reconcileDialogueDraftRows,
  resolveAudioAssetFileNameCandidates,
  resolveDialogueAudioManifestRows,
  restoreDialogueAudioManifestLineBreaks,
  serializeDialogueAudioManifestCsv,
  type AudioAsset,
  type DialogueAudioManifestRow,
  type DialogueDraftRowSeed,
  type StableDialogueDraftRow,
} from '../../src/domain';

const PROJECT_ID = '10000000-0000-4000-8000-000000000001';
const SHOT_ID = '10000000-0000-4000-8000-000000000002';
const CHARACTER_ID = '20000000-0000-4000-8000-000000000001';

function makeAudioAsset(
  index: number,
  name: string,
  durationMs: number | undefined,
  relativePath = `assets/${name}`,
): AudioAsset {
  return {
    id: `10000000-0000-4000-8000-${String(700 + index).padStart(12, '0')}`,
    kind: 'audio',
    name,
    relativePath,
    mimeType: 'audio/wav',
    sha256: String(index % 10).repeat(64),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

function manifestRow(
  overrides: Partial<DialogueAudioManifestRow> = {},
): DialogueAudioManifestRow {
  const speaker = overrides.speaker ?? '熊猫';
  const text = overrides.text ?? '同样的话';
  return {
    version: 1,
    projectId: PROJECT_ID,
    shotId: SHOT_ID,
    lineKey: 'L001',
    ordinal: 1,
    speaker,
    text,
    ...overrides,
    textHash:
      overrides.textHash ?? dialogueAudioManifestTextHash(speaker, text),
  };
}

function seed(overrides: Partial<DialogueDraftRowSeed> = {}): DialogueDraftRowSeed {
  return {
    sourceLineNumber: 1,
    logicalOrdinal: 1,
    text: '同样的话',
    speakerType: 'character',
    characterId: CHARACTER_ID,
    speakerName: '熊猫',
    ...overrides,
  };
}

function stableRow(
  overrides: Partial<StableDialogueDraftRow> = {},
): StableDialogueDraftRow {
  return {
    ...seed(),
    draftRowId: 'draft-row-2',
    ...overrides,
  };
}

describe('WF-EXT FIX A: dialogue identity after partial commit (P2-01)', () => {
  it('keeps L002 identity when a stale positional seed carries L001 after commit + renumber', () => {
    // Line 1 (L001) was already committed and removed from the session rows.
    const remaining = stableRow({
      draftRowId: 'draft-row-2',
      sourceLineNumber: 2,
      logicalOrdinal: 2,
      lineKey: 'L002',
      existingDialogueId: 'dialogue-2',
      confirmedAudioAssetId: 'audio-2',
      confirmedSpeakerKey: 'character:' + CHARACTER_ID,
      sourceStartMs: 200,
      sourceEndMs: 1_000,
    });

    // The compacted text re-numbers the survivor to line 1, and a stale manifest
    // bridge still claims L001/dialogue-1 for that position.
    const reconciled = reconcileDialogueDraftRows(
      [remaining],
      [
        seed({
          lineKey: 'L001',
          existingDialogueId: 'dialogue-1',
        }),
      ],
    );

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      draftRowId: 'draft-row-2',
      lineKey: 'L002',
      existingDialogueId: 'dialogue-2',
      confirmedAudioAssetId: 'audio-2',
      sourceStartMs: 200,
      sourceEndMs: 1_000,
    });
    // The committed dialogue must never be inherited by the remaining line.
    expect(reconciled[0]!.existingDialogueId).not.toBe('dialogue-1');
  });

  it('reorders and inserts without cross-wiring two identical lines', () => {
    const rows = reconcileDialogueDraftRows(
      [],
      [
        seed({ lineKey: 'L001', text: '同样的话', speakerName: '熊猫' }),
        seed({
          lineKey: 'L002',
          text: '同样的话',
          speakerName: '熊猫',
          sourceLineNumber: 2,
          logicalOrdinal: 2,
        }),
      ],
    );
    expect(rows.map((row) => row.lineKey)).toEqual(['L001', 'L002']);

    // Insert a new line above; the two original identities still follow their
    // own text occurrence instead of sliding onto the new first line.
    const afterInsert = reconcileDialogueDraftRows(rows, [
      seed({ lineKey: 'L000', text: '新插入', speakerName: '熊猫' }),
      seed({ text: '同样的话', speakerName: '熊猫', sourceLineNumber: 2 }),
      seed({ text: '同样的话', speakerName: '熊猫', sourceLineNumber: 3 }),
    ]);
    expect(afterInsert.map((row) => row.lineKey)).toEqual([
      'L000',
      'L001',
      'L002',
    ]);
  });
});

describe('WF-EXT FIX A: per-row manifest diagnostics (P2-02)', () => {
  it('treats identical asset names as ambiguous instead of last-write-wins', () => {
    const first = makeAudioAsset(1, 'L001_熊猫.wav', 1_500);
    const second = makeAudioAsset(2, 'L001_熊猫.wav', 1_500);
    const index = buildAudioAssetFileNameIndex([first, second]);

    const candidates = resolveAudioAssetFileNameCandidates(
      index,
      'L001_熊猫.wav',
    );
    expect(candidates.map((asset) => asset.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );

    // Case-insensitive collision is also ambiguous, not silently resolved.
    const mixedCase = buildAudioAssetFileNameIndex([
      makeAudioAsset(3, 'Take.WAV', 1_000),
      makeAudioAsset(4, 'take.wav', 1_000),
    ]);
    expect(
      resolveAudioAssetFileNameCandidates(mixedCase, 'TAKE.wav'),
    ).toHaveLength(2);

    const unique = buildAudioAssetFileNameIndex([first]);
    expect(
      resolveAudioAssetFileNameCandidates(unique, 'L001_熊猫.wav'),
    ).toHaveLength(1);
  });

  it('keeps healthy rows while a foreign-scope row degrades to plain text', () => {
    const resolved = resolveDialogueAudioManifestRows(
      [
        manifestRow({ lineKey: 'L001', ordinal: 1, text: '健康行' }),
        manifestRow({
          lineKey: 'L002',
          ordinal: 2,
          projectId: '10000000-0000-4000-8000-0000000000ff',
          text: '别的工程',
        }),
        manifestRow({ lineKey: 'L003', ordinal: 3, shotId: 'other-shot' }),
      ],
      PROJECT_ID,
      SHOT_ID,
      new Set<string>(),
    );

    expect(resolved.map((entry) => entry.inScope)).toEqual([true, false, false]);
    expect(resolved[0]!.issues).toEqual([]);
    expect(resolved[1]!.issues.map((issue) => issue.code)).toEqual([
      'PROJECT_MISMATCH',
    ]);
    expect(resolved[2]!.issues.map((issue) => issue.code)).toEqual([
      'SHOT_MISMATCH',
    ]);
  });

  it('drops a formal dialogue id that no longer exists but keeps the row usable', () => {
    const [resolved] = resolveDialogueAudioManifestRows(
      [manifestRow({ lineKey: 'L001', dialogueId: 'gone-dialogue' })],
      PROJECT_ID,
      SHOT_ID,
      new Set(['alive-dialogue']),
    );

    expect(resolved!.inScope).toBe(true);
    expect(resolved!.row.dialogueId).toBeUndefined();
    expect(resolved!.row.lineKey).toBe('L001');
    expect(resolved!.issues.map((issue) => issue.code)).toEqual([
      'DIALOGUE_ID_MISSING',
    ]);
  });

  it('accepts a healthy row next to an unreadable row and keeps its real range', () => {
    const csv = serializeDialogueAudioManifestCsv([
      manifestRow({
        lineKey: 'L001',
        ordinal: 1,
        audioFilename: 'L001_熊猫.wav',
        sourceStartMs: 120,
        sourceEndMs: 1_120,
      }),
      manifestRow({
        lineKey: 'L002',
        ordinal: 2,
        audioFilename: 'L002_熊猫.wav',
        sourceStartMs: 900,
        sourceEndMs: 100,
      }),
      manifestRow({ lineKey: 'L003', ordinal: 3, audioFilename: 'missing.wav' }),
    ]);
    const parsed = parseDialogueAudioManifestCsv(csv);

    expect(parsed.rows.map((row) => row.lineKey)).toEqual(['L001', 'L003']);
    expect(parsed.rows[0]).toMatchObject({
      sourceStartMs: 120,
      sourceEndMs: 1_120,
    });
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_SOURCE_RANGE',
          lineKey: 'L002',
        }),
      ]),
    );
  });
});

describe('WF-EXT FIX A: multi-line text round trip (P2-03)', () => {
  it('packs and restores real line breaks for CSV cells', () => {
    const texts = ['第一行\n第二行，含逗号 "引号"', '=SUM(A1) 前缀'];
    const marker = pickDialogueAudioManifestLineBreak(texts);
    const packed = texts[0]!.replaceAll(/\r\n?|\n/gu, marker);

    expect(packed.includes('\n')).toBe(false);
    expect(restoreDialogueAudioManifestLineBreaks(packed, marker)).toBe(
      texts[0],
    );
  });

  it('never rewrites a literal U+E000 already present in real text', () => {
    const literal = 'A\uE000B';
    const marker = pickDialogueAudioManifestLineBreak([literal]);

    expect(marker).not.toBe('\uE000');
    expect(restoreDialogueAudioManifestLineBreaks(literal, marker)).toBe(
      literal,
    );
    // A plain-subtitle paste without an import marker stays byte-identical.
    expect(restoreDialogueAudioManifestLineBreaks(literal, null)).toBe(literal);
  });

  it('keeps the plain batch path free of placeholder residue', () => {
    const texts = ['多行\n台词'];
    const marker = pickDialogueAudioManifestLineBreak(texts);
    const packed = texts[0]!.replaceAll('\n', marker);

    const restored = restoreDialogueAudioManifestLineBreaks(packed, marker);
    expect(restored).toBe(texts[0]);
    expect(restored.includes('\uE000')).toBe(false);
  });
});
