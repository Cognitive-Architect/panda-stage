import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  FlaInspectionResponse,
  FlaRasterSelectionIntent,
} from '../../shared/fla-import-api';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import {
  compatibilityCounts,
  compatibilityWarnings,
  createFlaRasterSelectionIntent,
  FLA_COMPATIBILITY_LABELS,
  FLA_COMPATIBILITY_STATUSES,
  reviewMedia,
  type FlaReviewMedia,
} from './fla-review';

interface FlaCompatibilityReviewSessionProps {
  snapshot: EditorProjectSnapshot | null;
  onClose: () => void;
  onIntent?: (intent: FlaRasterSelectionIntent) => void;
}

type SessionPhase = 'inspecting' | 'ready' | 'confirmed' | 'error';

interface ActiveSession {
  requestId?: string;
  sessionId?: string;
}

export function FlaCompatibilityReviewSession({
  snapshot,
  onClose,
  onIntent,
}: FlaCompatibilityReviewSessionProps): React.JSX.Element {
  const [phase, setPhase] = useState<SessionPhase>('inspecting');
  const [response, setResponse] = useState<FlaInspectionResponse | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedMediaIds, setSelectedMediaIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [intent, setIntent] = useState<FlaRasterSelectionIntent | null>(null);
  const [thumbnailUrls, setThumbnailUrls] = useState<Readonly<Record<string, string>>>({});
  const activeSession = useRef<ActiveSession | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    const nextRequestId = crypto.randomUUID();
    activeSession.current = { requestId: nextRequestId };
    setRequestId(nextRequestId);
    void window.pandaStage.fla
      .chooseAndInspect(nextRequestId)
      .then((nextResponse) => {
        if (cancelled.current) return;
        setResponse(nextResponse);
        setRequestId(null);
        if (nextResponse.ok) {
          activeSession.current = { sessionId: nextResponse.sessionId };
          setSessionId(nextResponse.sessionId);
          setSelectedMediaIds(
            new Set(nextResponse.ir.media.map((media) => media.id)),
          );
          setPhase('ready');
        } else {
          activeSession.current = null;
          setPhase('error');
        }
      })
      .catch((error: unknown) => {
        if (cancelled.current) return;
        setRequestId(null);
        setResponse({
          ok: false,
          error: {
            code: 'PARSER_CRASH',
            message: error instanceof Error ? error.message : 'FLA inspection failed',
          },
        });
        activeSession.current = null;
        setPhase('error');
      });

    return () => {
      cancelled.current = true;
      const active = activeSession.current;
      activeSession.current = null;
      if (active?.requestId) {
        void window.pandaStage.fla.cancel(active.requestId);
      }
      if (active?.sessionId) {
        void window.pandaStage.fla.cancel(active.sessionId);
      }
    };
  }, []);

  const ir = response?.ok ? response.ir : null;
  const reviewItems = useMemo(
    () => (ir ? reviewMedia(ir, snapshot?.project.assets ?? []) : []),
    [ir, snapshot],
  );
  const selectedCount = reviewItems.filter(({ media }) =>
    selectedMediaIds.has(media.id),
  ).length;

  useEffect(() => {
    if (!ir) return undefined;
    const created: Record<string, string> = {};
    if (typeof URL.createObjectURL === 'function') {
      for (const media of ir.media) {
        const bytes = media.payload.bytes.slice();
        const blob = new Blob([bytes.buffer as ArrayBuffer], {
          type: media.payload.mimeType,
        });
        created[media.id] = URL.createObjectURL(blob);
      }
    }
    setThumbnailUrls(created);
    return () => {
      for (const url of Object.values(created)) URL.revokeObjectURL(url);
    };
  }, [ir]);

  const closeSession = async (): Promise<void> => {
    cancelled.current = true;
    const active = activeSession.current;
    activeSession.current = null;
    try {
      if (active?.requestId) await window.pandaStage.fla.cancel(active.requestId);
      if (active?.sessionId) await window.pandaStage.fla.cancel(active.sessionId);
    } finally {
      onClose();
    }
  };

  if (phase === 'inspecting') {
    return (
      <section
        aria-label="FLA compatibility review"
        className="fla-review-session"
        data-testid="fla-review-session"
      >
        <header className="fla-review-heading">
          <div>
            <p className="eyebrow">FLA V1 Slice 2</p>
            <h2>Compatibility review</h2>
          </div>
          <button
            data-testid="fla-review-cancel"
            onClick={() => void closeSession()}
            type="button"
          >
            Cancel
          </button>
        </header>
        <p>Reading the selected FLA in the isolated parser. No Project or Asset data is being changed.</p>
        <output data-testid="fla-review-status">Inspecting source{requestId ? ` (${requestId})` : ''}...</output>
      </section>
    );
  }

  if (!ir || !sessionId) {
    return (
      <section
        aria-label="FLA compatibility review"
        className="fla-review-session"
        data-testid="fla-review-session"
      >
        <header className="fla-review-heading">
          <div>
            <p className="eyebrow">FLA V1 Slice 2</p>
            <h2>Compatibility review</h2>
          </div>
          <button onClick={onClose} type="button">Back to Asset Library</button>
        </header>
        <output data-testid="fla-review-error" role="alert">
          {response?.ok === false
            ? `${response.error.code}: ${response.error.message}`
            : 'FLA inspection failed.'}
        </output>
      </section>
    );
  }

  const counts = compatibilityCounts(ir);
  const warnings = compatibilityWarnings(ir);
  const toggle = (mediaId: string): void => {
    setSelectedMediaIds((current) => {
      const next = new Set(current);
      if (next.has(mediaId)) next.delete(mediaId);
      else next.add(mediaId);
      return next;
    });
    setIntent(null);
    if (phase === 'confirmed') setPhase('ready');
  };
  const selectAll = (): void => {
    setSelectedMediaIds(new Set(reviewItems.map(({ media }) => media.id)));
    setIntent(null);
    if (phase === 'confirmed') setPhase('ready');
  };
  const clearAll = (): void => {
    setSelectedMediaIds(new Set());
    setIntent(null);
    if (phase === 'confirmed') setPhase('ready');
  };
  const confirm = (): void => {
    if (selectedCount === 0) return;
    const nextIntent = createFlaRasterSelectionIntent(
      ir,
      sessionId,
      selectedMediaIds,
    );
    setIntent(nextIntent);
    setPhase('confirmed');
    onIntent?.(nextIntent);
  };

  return (
    <section
      aria-label="FLA compatibility review"
      className="fla-review-session"
      data-testid="fla-review-session"
    >
      <header className="fla-review-heading">
        <div>
          <p className="eyebrow">FLA V1 Slice 2</p>
          <h2>Compatibility review</h2>
        </div>
        <button
          data-testid="fla-review-cancel"
          onClick={() => void closeSession()}
          type="button"
        >
          Cancel
        </button>
      </header>
      <p className="fla-review-readonly-note">
        Read-only review. Confirming creates only a selection intent for Slice 3; it does not create Assets, change Project state, or add History.
      </p>

      <dl className="fla-review-summary" data-testid="fla-review-summary">
        <div><dt>Source</dt><dd>{ir.source.basename}</dd></div>
        <div><dt>SHA-256</dt><dd><code>{ir.source.sha256}</code></dd></div>
        <div><dt>Stage</dt><dd>{ir.document.width} x {ir.document.height} @ {ir.document.frameRate} fps</dd></div>
        <div><dt>Media</dt><dd data-testid="fla-review-media-count">{ir.media.length}</dd></div>
        <div><dt>Placed</dt><dd>{ir.summary.placedInstanceCount}</dd></div>
        <div><dt>Library-only</dt><dd>{ir.summary.libraryOnlyMediaCount}</dd></div>
      </dl>

      <section aria-labelledby="fla-compatibility-heading" className="fla-review-compatibility">
        <h3 id="fla-compatibility-heading">Compatibility</h3>
        <ul data-testid="fla-compatibility-summary">
          {FLA_COMPATIBILITY_STATUSES.map((status) => (
            <li data-status={status} key={status}>
              <strong>{FLA_COMPATIBILITY_LABELS[status]}</strong>
              <span>{counts[status]}</span>
            </li>
          ))}
        </ul>
        {warnings.length > 0 ? (
          <ul className="fla-review-warnings" data-testid="fla-compatibility-warnings">
            {warnings.map((warning) => (
              <li key={`${warning.feature}:${warning.status}`}>
                <strong>{FLA_COMPATIBILITY_LABELS[warning.status]} · {warning.feature}</strong>
                <span>{warning.reason}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="fla-review-selection-toolbar">
        <div>
          <strong data-testid="fla-review-selected-count">Selected: {selectedCount} / {reviewItems.length}</strong>
          {intent ? <output data-testid="fla-review-intent-status">Read-only selection intent ready; no Assets were created.</output> : null}
        </div>
        <div>
          <button data-testid="fla-review-select-all" onClick={selectAll} type="button">Select all</button>
          <button data-testid="fla-review-clear-all" onClick={clearAll} type="button">Clear all</button>
          <button
            data-testid="fla-review-confirm"
            disabled={selectedCount === 0 || phase === 'confirmed'}
            onClick={confirm}
            type="button"
          >
            {phase === 'confirmed' ? 'Selection intent confirmed' : 'Continue / Confirm selection'}
          </button>
        </div>
      </div>

      <div
        aria-label="FLA raster media"
        className="fla-review-media-grid"
        data-testid="fla-review-media-grid"
      >
        {reviewItems.map((item) => (
          <FlaReviewMediaCard
            item={item}
            key={item.media.id}
            selected={selectedMediaIds.has(item.media.id)}
            thumbnailUrl={thumbnailUrls[item.media.id]}
            onToggle={() => toggle(item.media.id)}
          />
        ))}
      </div>
    </section>
  );
}

function FlaReviewMediaCard({
  item,
  selected,
  thumbnailUrl,
  onToggle,
}: {
  item: FlaReviewMedia;
  selected: boolean;
  thumbnailUrl?: string;
  onToggle: () => void;
}): React.JSX.Element {
  const { media } = item;
  return (
    <article
      className={`fla-review-media-card${selected ? ' fla-review-media-card-selected' : ''}`}
      data-alpha-kind={media.payload.alpha.kind}
      data-fla-media-id={media.id}
      data-library-only={item.libraryOnly ? 'true' : 'false'}
      data-zero-alpha-pixels={media.payload.alpha.zeroAlphaPixels}
    >
      <label>
        <input
          aria-label={`Select ${media.name}`}
          checked={selected}
          onChange={onToggle}
          type="checkbox"
        />
        <span>Select</span>
      </label>
      <div className="fla-review-thumbnail">
        {thumbnailUrl ? (
          <img alt={media.name} loading="lazy" src={thumbnailUrl} />
        ) : (
          <span>Thumbnail unavailable</span>
        )}
      </div>
      <strong title={media.name}>{media.name}</strong>
      <span title={media.sourceReference}>Source/library: {media.sourceReference}</span>
      <span>{media.width} x {media.height} · source {media.sourceFormat}</span>
      <span>{item.libraryOnly ? 'Library-only' : 'Placed in timeline'}</span>
      <code>{media.id}</code>
      <span>Future target: {item.name.targetFileName}</span>
      {item.warnings.length > 0 ? (
        <ul className="fla-review-name-warnings">
          {item.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
    </article>
  );
}
