import { describe, expect, it } from 'vitest';
import {
  attachDialogueManifestIdentities,
  reconcileDialogueDraftRows,
  type DialogueDraftRowSeed,
  type DialogueManifestPendingIdentity,
  type StableDialogueDraftRow,
} from '../../src/domain';

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
});
