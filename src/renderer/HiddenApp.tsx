import { useCallback, useMemo, useRef } from 'react';
import { evaluateShotAtTime } from '../shared/domain';
import {
  PROBE_PROJECT,
  PROBE_SHOT,
  PROBE_SUBTITLE_CUES,
} from '../shared/probe/probe-project';
import { evaluateSubtitleAtTime } from '../shared/preview/subtitle-engine';
import { CanvasStage } from './stage/CanvasStage';
import { PROBE_ASSET_URLS } from './stage/probe-assets';

export function HiddenApp(): React.JSX.Element {
  const announcedRef = useRef(false);
  const previewTimeMs = 0;
  const evaluatedShot = useMemo(() => evaluateShotAtTime(PROBE_SHOT, 0), []);
  const subtitle = evaluateSubtitleAtTime(PROBE_SUBTITLE_CUES, previewTimeMs);

  const announceReady = useCallback(() => {
    if (announcedRef.current) {
      return;
    }
    announcedRef.current = true;

    void window.pandaStageHidden
      .ready()
      .then((response) => {
        document.documentElement.dataset.ready = String(response.acknowledged);
      })
      .catch((error: unknown) => {
        announcedRef.current = false;
        document.documentElement.dataset.ready = 'false';
        console.error('Hidden window ready handshake failed.', error);
      });
  }, []);

  return (
    <main className="hidden-stage-shell">
      <CanvasStage
        assetUrls={PROBE_ASSET_URLS}
        caption={subtitle?.text ?? null}
        evaluatedShot={evaluatedShot}
        onError={(error) => console.error('Hidden stage failed.', error)}
        onReady={announceReady}
        project={PROBE_PROJECT}
      />
    </main>
  );
}
