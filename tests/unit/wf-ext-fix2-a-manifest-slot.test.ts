import { describe, expect, it } from 'vitest';
import {
  attachDialogueManifestIdentities,
  matchDialogueAudioRows,
  reconcileDialogueDraftRows,
  ProjectSchema,
  type AudioAsset,
  type DialogueDraftRowSeed,
  type DialogueManifestPendingIdentity,
  type StableDialogueDraftRow,
} from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';

const CHARACTER_ID = '20000000-0000-4000-8000-000000000001';

function seed(overrides: Partial<DialogueDraftRowSeed> = {}): DialogueDraftRowSeed {
  return {
    sourceLineNumber: 1,
    logicalOrdinal: 1,
    text: '你来了？',
    speakerType: 'character',
    characterId: CHARACTER_ID,
    speakerName: '熊猫',
    ...overrides,
  };
}

function identity(
  overrides: Partial<DialogueManifestPendingIdentity> = {},
): DialogueManifestPendingIdentity {
  return {
    lineKey: 'L002',
    dialogueId: 'dialogue-2',
    speaker: '熊猫',
    text: '你来了？',
    ...overrides,
  };
}

function buildRows(): StableDialogueDraftRow[] {
  return reconcileDialogueDraftRows(
    [],
    [seed({ sourceLineNumber: 1 }), seed({ sourceLineNumber: 2, logicalOrdinal: 2 })],
  );
}

describe('WF-EXT FIX-02 A: manifest identity follows its own CSV slot (R-P2-01)', () => {
  it('never lets a foreign identical line inherit the current shot identity', () => {
    const rows = buildRows();
    // Line 1 belongs to another shot, so it produced a plain row and was never
    // registered as a pending identity. Line 2 is the real owner of L002.
    const pending = new Map<number, DialogueManifestPendingIdentity>([
      [2, identity()],
    ]);

    const attached = attachDialogueManifestIdentities(rows, pending);

    expect(attached[0]).toMatchObject({
      draftRowId: rows[0]!.draftRowId,
      text: '你来了？',
    });
    expect(attached[0]!.lineKey).toBeUndefined();
    expect(attached[0]!.existingDialogueId).toBeUndefined();
    expect(attached[1]).toMatchObject({
      draftRowId: rows[1]!.draftRowId,
      lineKey: 'L002',
      existingDialogueId: 'dialogue-2',
    });
    // The identity is retired after the single use.
    expect(pending.size).toBe(0);
  });

  it('leaves an unresolved line without identity instead of borrowing the next slot', () => {
    // Only line 2 resolves, so only one row exists (at slot 2); slot 1 stays
    // empty because line 1 needs manual mapping.
    const rows = reconcileDialogueDraftRows(
      [],
      [seed({ sourceLineNumber: 2, logicalOrdinal: 2 })],
    );
    const pending = new Map<number, DialogueManifestPendingIdentity>([
      [1, identity({ lineKey: 'L001' })],
      [2, identity()],
    ]);

    const attached = attachDialogueManifestIdentities(rows, pending);
    expect(attached).toHaveLength(1);
    expect(attached[0]).toMatchObject({ lineKey: 'L002' });
    // Slot 1 keeps waiting for its own line.
    expect(pending.has(1)).toBe(true);
  });

  it('drops a mismatched identity at the same slot instead of handing it on', () => {
    const rows = buildRows();
    const pending = new Map<number, DialogueManifestPendingIdentity>([
      [1, identity({ lineKey: 'L001', text: '完全不同的台词' })],
    ]);

    const attached = attachDialogueManifestIdentities(rows, pending);
    expect(attached[0]!.lineKey).toBeUndefined();
    expect(attached[1]!.lineKey).toBeUndefined();
    expect(pending.size).toBe(0);
  });

  it('keeps an already attached row identity untouched on later passes', () => {
    const rows = buildRows();
    const attached = attachDialogueManifestIdentities(
      rows,
      new Map([[2, identity()]]),
    );

    // A later pass must not rewrite an already-owned row.
    const second = attachDialogueManifestIdentities(
      attached,
      new Map([[2, identity({ lineKey: 'L999', dialogueId: 'dialogue-9' })]]),
    );
    expect(second[1]).toMatchObject({
      lineKey: 'L002',
      existingDialogueId: 'dialogue-2',
    });
  });

  it('keeps positional slots stable after a partial commit re-indexes the text', () => {
    const rows = buildRows();
    const pending = new Map<number, DialogueManifestPendingIdentity>([
      [2, identity()],
    ]);
    // Line 2 committed first: the survivor now sits at slot 1 and already owns
    // its identity, so the remaining pending slot must not touch it.
    const afterCommit = reconcileDialogueDraftRows(
      [rows[1]!],
      [seed({ sourceLineNumber: 1 })],
    );
    const attached = attachDialogueManifestIdentities(afterCommit, pending);
    expect(attached[0]!.draftRowId).toBe(rows[1]!.draftRowId);
    expect(attached[0]!.lineKey).toBeUndefined();
    expect(attached[0]!.existingDialogueId).toBeUndefined();
    // Nothing was consumed: the entry still belongs to an unproduced slot.
    expect(pending.size).toBe(1);
  });

  it('marks an out-of-scope CSV slot explicitly unselected so matchDialogueAudioRows does not fall back to 1_熊猫.wav', () => {
    const base = buildProject();
    const audio1: AudioAsset = {
      id: '10000000-0000-4000-8000-000000000951',
      kind: 'audio',
      name: '1_熊猫',
      relativePath: 'assets/1_熊猫.wav',
      mimeType: 'audio/wav',
      sha256: '1'.repeat(64),
      durationMs: 1_500,
    };
    const audio2: AudioAsset = {
      id: '10000000-0000-4000-8000-000000000952',
      kind: 'audio',
      name: 'take_l002',
      relativePath: 'assets/take_l002.wav',
      mimeType: 'audio/wav',
      sha256: '2'.repeat(64),
      durationMs: 2_000,
    };
    const project = ProjectSchema.parse({
      ...base,
      assets: [...base.assets, audio1, audio2],
    });

    const rows = buildRows();
    const pending = new Map<number, DialogueManifestPendingIdentity>([
      [1, { speaker: '熊猫', text: '你来了？', explicitAudioUnselected: true }],
      [2, identity()],
    ]);

    const attached = attachDialogueManifestIdentities(rows, pending);
    expect(attached[0]!.explicitAudioUnselected).toBe(true);
    expect(attached[0]!.lineKey).toBeUndefined();
    expect(attached[0]!.existingDialogueId).toBeUndefined();
    expect(attached[1]!.explicitAudioUnselected).toBeUndefined();
    expect(attached[1]!.lineKey).toBe('L002');

    // Reconcile after partial commit / reorder preserves explicitAudioUnselected
    // and refuses stale confirmedAudioAssetId inheritance.
    const survived = reconcileDialogueDraftRows(
      [{ ...attached[0]!, confirmedAudioAssetId: audio1.id }],
      [seed({ sourceLineNumber: 1, logicalOrdinal: 1 })],
    );
    expect(survived[0]!.explicitAudioUnselected).toBe(true);
    expect(survived[0]!.confirmedAudioAssetId).toBeUndefined();

    const report = matchDialogueAudioRows(
      project,
      [
        {
          draftRowId: survived[0]!.draftRowId,
          ordinal: 1,
          sourceLineNumber: 1,
          text: survived[0]!.text,
          speakerType: survived[0]!.speakerType,
          characterId: survived[0]!.characterId,
          speakerName: survived[0]!.speakerName,
          manualAudioAssetId: survived[0]!.explicitAudioUnselected
            ? null
            : undefined,
        },
        {
          draftRowId: attached[1]!.draftRowId,
          ordinal: 2,
          sourceLineNumber: 2,
          text: attached[1]!.text,
          speakerType: attached[1]!.speakerType,
          characterId: attached[1]!.characterId,
          speakerName: attached[1]!.speakerName,
          manualAudioAssetId: audio2.id,
          sourceStartMs: 200,
          sourceEndMs: 1_200,
        },
      ],
      { shotId: IDS.shot },
    );
    expect(report.rows[0]).toMatchObject({
      ready: false,
      audioAssetId: null,
      issue: 'AUDIO_UNSELECTED',
    });
    expect(report.rows[1]).toMatchObject({
      ready: true,
      audioAssetId: audio2.id,
      sourceStartMs: 200,
      sourceEndMs: 1_200,
    });
  });
});
