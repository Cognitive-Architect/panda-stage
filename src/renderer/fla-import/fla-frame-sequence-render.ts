/**
 * V2-R2 Frame Sequence — renderer-side adapter (R2-C/D/G client).
 *
 * Thin wrapper over the preload bridge. The review UI talks to this
 * module instead of touching `window.pandaStage` directly. All payloads
 * are Panda-owned R2 contract objects; the FLA source bytes and the
 * per-frame PNG bytes never accumulate on the Renderer side (the Main
 * process owns them — R2-E invariant). The Renderer only receives the
 * bounded R2 success envelope for transient display and returns it on
 * unmount.
 */

import type {
  FlaFrameSequenceCancelRequest,
  FlaFrameSequenceCancelResponse,
  FlaFrameSequenceCommitRequest,
  FlaFrameSequenceCommitResponse,
  FlaFrameSequenceRequest,
  FlaFrameSequenceResponse,
} from '../../shared/fla-frame-sequence-api';

export interface FlaFrameSequenceClient {
  render(request: FlaFrameSequenceRequest): Promise<FlaFrameSequenceResponse>;
  cancel(request: FlaFrameSequenceCancelRequest): Promise<FlaFrameSequenceCancelResponse>;
  commit(request: FlaFrameSequenceCommitRequest): Promise<FlaFrameSequenceCommitResponse>;
}

export const flaFrameSequenceClient: FlaFrameSequenceClient = {
  render: (request) => window.pandaStage.fla.frameSequenceRender(request),
  cancel: (request) => window.pandaStage.fla.frameSequenceCancel(request),
  commit: (request) => window.pandaStage.fla.frameSequenceCommit(request),
};
