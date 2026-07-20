import { useCallback, useMemo, useRef } from 'react';
import { evaluateShotAtTime } from '../shared/domain';
import {
  PROBE_CAPTION,
  PROBE_PREVIEW_TIME_MS,
  PROBE_PROJECT,
  PROBE_SHOT,
} from '../shared/probe/probe-project';
import { CanvasStage } from './stage/CanvasStage';
import { PROBE_ASSET_URLS } from './stage/probe-assets';

export function HiddenApp(): React.JSX.Element {
  const announcedRef = useRef(false);
  const evaluatedShot = useMemo(
    () => evaluateShotAtTime(PROBE_SHOT, PROBE_PREVIEW_TIME_MS),
    [],
  );

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
        caption={PROBE_CAPTION}
        evaluatedShot={evaluatedShot}
        onError={(error) => console.error('Hidden stage failed.', error)}
        onReady={announceReady}
        project={PROBE_PROJECT}
      />
    </main>
  );
}
