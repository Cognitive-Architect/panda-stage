import type {
  FlaFrameSequenceCommitItem,
  FlaFrameSequenceCommitResponse,
} from '../../../shared/fla-frame-sequence-api';
import type { EditorProjectStore } from '../../stores/EditorProjectStore';

export interface FlaFrameSequenceCommitUiOutcome {
  status: string;
  results: FlaFrameSequenceCommitItem[] | null;
  /** True when newly-created ImageAssets were applied to the editor store. */
  applied: boolean;
}

/**
 * Applies the authoritative result of a successful R2 sequence commit to the
 * single renderer Project store. Duplicate items are intentionally not added
 * as new assets; their deterministic frame-to-existing-asset mapping remains
 * available in `results`.
 */
export function applyFlaFrameSequenceCommitResponse(
  response: FlaFrameSequenceCommitResponse,
  store: EditorProjectStore,
): FlaFrameSequenceCommitUiOutcome {
  if (!response.ok) {
    return {
      status: response.error.message,
      results: null,
      applied: false,
    };
  }

  const importedAssets = response.result.items
    .filter((item) => item.status === 'imported')
    .map((item) => item.asset);

  // Main records a successful sequence commit as one revision even when all
  // requested frames reuse existing assets. Applying an empty asset list in
  // that case keeps the Renderer revision aligned without fabricating assets
  // or dirtying the Project.
  if (response.projectChanged || response.savedRevision !== response.baseRevision) {
    store.applyAssetImport(
      response.project,
      importedAssets,
      response.baseRevision,
      response.savedRevision,
    );
  }

  const { importedCount, duplicateCount, renamedCount } = response.result.summary;
  const status =
    importedCount > 0
      ? `Imported ${importedCount} frame(s) as ordinary image asset(s); reused ${duplicateCount} existing asset(s).${
          renamedCount > 0 ? ` Renamed ${renamedCount} asset(s) to avoid collisions.` : ''
        }`
      : `No new image assets; reused ${duplicateCount} existing asset(s).`;

  return {
    status,
    results: response.result.items,
    applied: importedAssets.length > 0,
  };
}
