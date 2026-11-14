import type { FlaPartPreviewResponse } from '../../../shared/fla-part-preview-api';
import type { AnimationImportIR } from '../../../shared/fla-import-api';
import type { FlaRenderTarget } from '../../../shared/fla-static-snapshot-api';
import type { FlaWorkbenchCandidate } from '../../fla-import/fla-workbench-candidates';
import type { FlaGraphicInstanceCommitErrorCode } from '../../../shared/fla-graphic-instance-api';

export class FlaGraphicImportError extends Error {
  constructor(readonly code: FlaGraphicInstanceCommitErrorCode, message: string) {
    super(message);
    this.name = 'FlaGraphicImportError';
  }
}

export type EditableFlaGraphicInstancePreview = Extract<
  FlaPartPreviewResponse,
  { ok: true; status: 'PREVIEW_READY'; capability: 'EDITABLE_PARTS_READY' }
> & { sessionId: string; generation: number };

export type ImportFlaGraphicInstance = (
  preview: EditableFlaGraphicInstancePreview,
  unitId: string,
) => Promise<void>;

export function createFlaGraphicInstanceWorkbenchCandidates(
  preview: EditableFlaGraphicInstancePreview,
  input: {
    sessionId: string;
    source: Pick<AnimationImportIR['source'], 'basename' | 'sha256'>;
    renderTargetId: FlaRenderTarget['renderTargetId'];
    previewUrls: Readonly<Record<string, string>>;
    focusedIdentityKey: string | null;
  },
): Extract<FlaWorkbenchCandidate, { kind: 'graphic' }>[] {
  const occurrences = preview.partPreviews.filter((part) =>
    part.sourceKind === 'graphic-symbol-occurrence',
  );
  const duplicateCounts = new Map<string, number>();
  for (const part of occurrences) {
    const label = part.sourceSymbolId ?? part.layerName;
    duplicateCounts.set(label, (duplicateCounts.get(label) ?? 0) + 1);
  }
  const occurrenceIndexes = new Map<string, number>();

  return occurrences.map((part) => {
    const baseLabel = part.sourceSymbolId ?? part.layerName;
    const occurrenceIndex = (occurrenceIndexes.get(baseLabel) ?? 0) + 1;
    occurrenceIndexes.set(baseLabel, occurrenceIndex);
    const displayLabel = duplicateCounts.get(baseLabel)! > 1
      ? `${baseLabel} · ${occurrenceIndex}`
      : baseLabel;
    const identityKey = JSON.stringify([
      input.sessionId,
      preview.planId,
      preview.generation,
      preview.poseIdentity,
      part.sourceAddress,
      part.occurrenceId,
      part.adapterIdentity,
      part.sourceSymbolId,
      part.sourceDefinitionFrameCount,
    ]);
    const previewUrl = input.previewUrls[part.unitId];
    const importable = part.graphicInstanceImportable === true;
    const searchText = [
      baseLabel,
      displayLabel,
      part.layerName,
      part.sourceAddress,
      part.sourceSymbolId,
      part.occurrenceId,
      part.adapterIdentity,
      part.sourceDefinitionFrameCount === null ? '' : String(part.sourceDefinitionFrameCount),
    ].filter(Boolean).join(' ').toLocaleLowerCase('en-US');

    return {
      id: part.unitId,
      identityKey,
      kind: 'graphic',
      displayLabel,
      searchText,
      source: {
        sessionId: input.sessionId,
        basename: input.source.basename,
        sha256: input.source.sha256,
      },
      preview: {
        status: 'verified',
        verified: true,
        bindingKey: identityKey,
        ...(previewUrl ? { previewUrl } : {}),
        sha256: part.image.sha256,
      },
      supported: importable,
      blank: false,
      unscanned: false,
      selectable: importable,
      focused: identityKey === input.focusedIdentityKey,
      checked: false,
      provenance: {
        renderTargetId: input.renderTargetId,
        targetKind: 'scene',
        selectedFrameIndex: 0,
        frameCount: part.sourceDefinitionFrameCount,
        sourceSymbolId: part.sourceSymbolId,
        sourceAddress: part.sourceAddress,
        occurrenceId: part.occurrenceId,
        adapterIdentity: part.adapterIdentity,
        layerName: part.layerName,
      },
      operation: {
        kind: 'graphic',
        sessionId: input.sessionId,
        sourceSha256: input.source.sha256,
        planId: preview.planId,
        generation: preview.generation,
        poseIdentity: preview.poseIdentity,
        unitId: part.unitId,
      },
    };
  });
}
