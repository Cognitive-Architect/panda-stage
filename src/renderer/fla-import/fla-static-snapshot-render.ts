/**
 * V2-R1 Static Snapshot — renderer-side adapter (R1-B/C/D/E).
 *
 * Thin wrapper over the preload bridge. The review UI talks to this
 * module instead of touching `window.pandaStage` directly. All payloads
 * are Panda-owned R1 contract objects; the FLA source bytes never cross
 * the renderer boundary here (the Main side owns them).
 */

import type {
  FlaRenderableTargetCatalogResponse,
  FlaStaticSnapshotCancelRequest,
  FlaStaticSnapshotCancelResponse,
  FlaStaticSnapshotCommitRequest,
  FlaStaticSnapshotCommitResponse,
  FlaStaticSnapshotPreviewRequest,
  FlaStaticSnapshotPreviewResponse,
} from '../../shared/fla-static-snapshot-api';

export interface FlaStaticSnapshotCatalogClient {
  catalog(sessionId: string): Promise<FlaRenderableTargetCatalogResponse>;
  preview(request: FlaStaticSnapshotPreviewRequest): Promise<FlaStaticSnapshotPreviewResponse>;
  commit(request: FlaStaticSnapshotCommitRequest): Promise<FlaStaticSnapshotCommitResponse>;
  cancel(request: FlaStaticSnapshotCancelRequest): Promise<FlaStaticSnapshotCancelResponse>;
}

export const flaStaticSnapshotClient: FlaStaticSnapshotCatalogClient = {
  catalog: (sessionId) =>
    window.pandaStage.fla.staticSnapshotCatalog({
      format: 'fla-static-snapshot-catalog',
      version: 1,
      sessionId,
    }),
  preview: (request) => window.pandaStage.fla.staticSnapshotPreview(request),
  commit: (request) => window.pandaStage.fla.staticSnapshotCommit(request),
  cancel: (request) => window.pandaStage.fla.staticSnapshotCancel(request),
};
